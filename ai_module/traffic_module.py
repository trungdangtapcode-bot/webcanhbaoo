"""
Traffic Jam Detection Module
YOLOv8n COCO (classes 2=car, 3=motorcycle, 5=bus, 7=truck)
SORT tracker, 1 frame/10s, background subtraction to skip static frames.

Speed estimation: Lucas-Kanade optical flow on tracked vehicle centroids
(pixel displacement per frame, averaged over all tracked vehicles).
Jam criteria: vehicle_count > 6 AND avg_speed < 5 px/frame.
"""

import os
import sys
import time
import base64
import logging
import requests
import cv2
import numpy as np
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

# ─── Config ───
CAMERA_ID = os.getenv("CAMERA_ID", "CAM_001")
RTSP_URL = os.getenv("RTSP_URL", "rtsp://admin:admin123@192.168.1.100:554/stream1")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000/api/events")
API_TOKEN = os.getenv("API_TOKEN", "")
FRAME_INTERVAL = int(os.getenv("FRAME_INTERVAL", "10"))  # seconds
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.4"))
JPEG_QUALITY = 70
RESIZE_DIM = (640, 640)

# Jam thresholds
JAM_MIN_VEHICLES = int(os.getenv("JAM_MIN_VEHICLES", "6"))
JAM_MAX_SPEED_PX = float(os.getenv("JAM_MAX_SPEED_PX", "5.0"))  # px/frame

# COCO vehicle classes
VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [TRAFFIC] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# Per-track centroid history for optical flow speed estimation
# {track_id: (cx, cy)}
_prev_centroids: dict = {}


def encode_frame(frame: np.ndarray) -> str:
    """Resize, JPEG-encode, and base64-encode a frame."""
    resized = cv2.resize(frame, RESIZE_DIM)
    _, buffer = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return base64.b64encode(buffer).decode("utf-8")


def has_significant_motion(prev_gray, curr_gray, threshold=5000):
    """Background subtraction: skip static frames."""
    if prev_gray is None:
        return True
    diff = cv2.absdiff(prev_gray, curr_gray)
    _, thresh = cv2.threshold(diff, 30, 255, cv2.THRESH_BINARY)
    motion_pixels = cv2.countNonZero(thresh)
    return motion_pixels > threshold


def is_youtube_url(url: str) -> bool:
    """Check if a URL is a YouTube link."""
    return any(domain in url for domain in ["youtube.com", "youtu.be", "youtube.com/live"])


def resolve_stream_url(url: str) -> str:
    """
    If the URL is a YouTube link, use yt-dlp to extract a direct stream URL.
    Otherwise, return the URL as-is (RTSP, file path, etc.).
    """
    if not is_youtube_url(url):
        return url

    log.info("Detected YouTube URL — extracting stream with yt-dlp...")
    try:
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            stream = info.get("url")
            if not stream:
                log.error("yt-dlp returned no stream URL")
                sys.exit(1)
            log.info("YouTube stream URL resolved successfully")
            return stream
    except ImportError:
        log.error("yt-dlp not installed. Run: pip install yt-dlp")
        sys.exit(1)
    except Exception as e:
        log.error(f"Failed to resolve YouTube URL: {e}")
        sys.exit(1)


def send_event(data: dict):
    """POST event to backend."""
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(BACKEND_URL, json=data, headers=headers, timeout=10)
        log.info(f"Event sent → {resp.status_code}: {resp.json()}")
    except Exception as e:
        log.error(f"Failed to send event: {e}")


def estimate_speed_optical_flow(
    prev_gray: np.ndarray,
    curr_gray: np.ndarray,
    tracked_boxes: list,
) -> float:
    """
    Estimate average vehicle speed using Lucas-Kanade sparse optical flow.

    For each tracked vehicle bounding box, sample the centroid as a feature
    point and track its movement to the next frame. Returns average pixel
    displacement per frame across all vehicles. Returns 0 if cannot compute.
    """
    if prev_gray is None or len(tracked_boxes) == 0:
        return 0.0

    # Build feature points from vehicle centroids
    pts = []
    for box in tracked_boxes:
        x1, y1, x2, y2 = box[:4]
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        pts.append([[cx, cy]])

    if not pts:
        return 0.0

    prev_pts = np.array(pts, dtype=np.float32)

    lk_params = dict(
        winSize=(15, 15),
        maxLevel=2,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03),
    )

    try:
        next_pts, status, _ = cv2.calcOpticalFlowPyrLK(
            prev_gray, curr_gray, prev_pts, None, **lk_params
        )
    except Exception:
        return 0.0

    displacements = []
    for i, (prev_pt, next_pt, st) in enumerate(zip(prev_pts, next_pts, status)):
        if st[0] == 1:
            dx = next_pt[0][0] - prev_pt[0][0]
            dy = next_pt[0][1] - prev_pt[0][1]
            displacement = float(np.sqrt(dx ** 2 + dy ** 2))
            displacements.append(displacement)

    return float(np.mean(displacements)) if displacements else 0.0


def main():
    log.info(f"Starting traffic module for {CAMERA_ID}")
    log.info(f"RTSP: {RTSP_URL}")
    log.info(f"Backend: {BACKEND_URL}")
    log.info(f"Jam criteria: vehicles > {JAM_MIN_VEHICLES}, speed < {JAM_MAX_SPEED_PX} px/frame")

    # ─── Load YOLOv8 ───
    try:
        from ultralytics import YOLO
        model = YOLO("yolov8n.pt")
        log.info("YOLOv8n loaded successfully")
    except ImportError:
        log.error("ultralytics not installed. Run: pip install ultralytics")
        sys.exit(1)

    # ─── SORT tracker (optional, tuned for fewer ghost tracks) ───
    tracker_available = False
    tracker = None
    try:
        from sort import Sort
        tracker = Sort(max_age=30, min_hits=5, iou_threshold=0.45)
        tracker_available = True
        log.info("SORT tracker loaded (min_hits=5, iou=0.45)")
    except ImportError:
        log.warning("SORT not available — tracking disabled, using raw detections")

    # ─── Resolve video source ───
    stream_url = resolve_stream_url(RTSP_URL)
    log.info(f"Resolved stream: {stream_url[:80]}...")

    # ─── Open video stream ───
    cap = cv2.VideoCapture(stream_url)
    if not cap.isOpened():
        log.error(f"Cannot open video stream: {stream_url[:80]}")
        sys.exit(1)

    prev_gray = None
    prev_gray_for_flow = None   # separate grayscale kept for optical flow

    while True:
        ret, frame = cap.read()
        if not ret:
            log.warning("Frame read failed — reconnecting in 5s")
            cap.release()
            time.sleep(5)
            stream_url = resolve_stream_url(RTSP_URL)  # re-resolve (YT URLs expire)
            cap = cv2.VideoCapture(stream_url)
            prev_gray = None
            prev_gray_for_flow = None
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray_blurred = cv2.GaussianBlur(gray, (21, 21), 0)

        if not has_significant_motion(prev_gray, gray_blurred):
            prev_gray = gray_blurred
            time.sleep(FRAME_INTERVAL)
            continue

        prev_gray = gray_blurred

        # ─── YOLOv8 inference ───
        results = model(frame, verbose=False, conf=CONFIDENCE_THRESHOLD)

        vehicle_count = 0
        raw_detections = []
        confidences = []

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                if cls_id in VEHICLE_CLASSES:
                    vehicle_count += 1
                    confidences.append(conf)
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    raw_detections.append([x1, y1, x2, y2, conf])

        # ─── SORT tracking ───
        tracked_boxes = raw_detections  # fallback: use raw detections
        if tracker_available and tracker is not None and len(raw_detections) > 0:
            det_array = np.array(raw_detections)
            tracked = tracker.update(det_array)
            tracked_boxes = tracked.tolist() if len(tracked) > 0 else raw_detections
            vehicle_count = len(tracked_boxes)

        # ─── Speed via optical flow ───
        avg_speed = 0.0
        if prev_gray_for_flow is not None and len(tracked_boxes) > 0:
            curr_gray_small = cv2.resize(gray, (640, 360))
            prev_gray_small = cv2.resize(prev_gray_for_flow, (640, 360))

            # Scale boxes to match resized frame
            h_orig, w_orig = frame.shape[:2]
            scale_x = 640 / w_orig
            scale_y = 360 / h_orig
            scaled_boxes = [
                [b[0] * scale_x, b[1] * scale_y, b[2] * scale_x, b[3] * scale_y]
                for b in tracked_boxes
            ]
            avg_speed = estimate_speed_optical_flow(prev_gray_small, curr_gray_small, scaled_boxes)

        prev_gray_for_flow = gray

        # ─── Compute vehicle density ───
        frame_area = frame.shape[0] * frame.shape[1]
        vehicle_density = vehicle_count / (frame_area / 10000.0) if frame_area > 0 else 0.0

        log.info(
            f"Vehicles: {vehicle_count}, Avg speed: {avg_speed:.2f} px/f, "
            f"Density: {vehicle_density:.4f} v/10kpx²"
        )

        # ─── Send event only when meaningful ───
        is_jam = vehicle_count >= JAM_MIN_VEHICLES and avg_speed < JAM_MAX_SPEED_PX
        avg_conf = float(np.mean(confidences)) if confidences else 0.0

        event = {
            "camera_id": CAMERA_ID,
            "event_type": "traffic_jam",
            "confidence": round(max(avg_conf, 0.4), 3) if vehicle_count > 0 else 0.0,
            "vehicle_count": vehicle_count,
            "avg_speed": round(avg_speed, 2),
            "image_base64": encode_frame(frame),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            # Include clear signal if not a jam so backend can reset state
            **({"active": False, "resolved": True} if not is_jam else {}),
        }

        send_event(event)
        time.sleep(FRAME_INTERVAL)

    cap.release()


if __name__ == "__main__":
    main()
