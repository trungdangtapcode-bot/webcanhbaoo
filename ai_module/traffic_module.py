"""
Traffic Jam Detection Module
YOLOv8n COCO (classes 2=car, 3=motorcycle, 5=bus, 7=truck)
SORT tracker, 1 frame/10s, background subtraction to skip static frames.
"""

import os
import sys
import time
import base64
import logging
import requests
import cv2
import numpy as np
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

# COCO vehicle classes
VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [TRAFFIC] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


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

    log.info(f"Detected YouTube URL — extracting stream with yt-dlp...")
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


def main():
    log.info(f"Starting traffic module for {CAMERA_ID}")
    log.info(f"RTSP: {RTSP_URL}")
    log.info(f"Backend: {BACKEND_URL}")

    # ─── Load YOLOv8 ───
    try:
        from ultralytics import YOLO
        model = YOLO("yolov8n.pt")
        log.info("YOLOv8n loaded successfully")
    except ImportError:
        log.error("ultralytics not installed. Run: pip install ultralytics")
        sys.exit(1)

    # ─── SORT tracker (optional) ───
    tracker_available = False
    try:
        from sort import Sort
        tracker = Sort(max_age=30, min_hits=3, iou_threshold=0.3)
        tracker_available = True
        log.info("SORT tracker loaded")
    except ImportError:
        log.warning("SORT not available — tracking disabled")

    # ─── Resolve video source ───
    stream_url = resolve_stream_url(RTSP_URL)
    log.info(f"Resolved stream: {stream_url[:80]}...")

    # ─── Open video stream ───
    cap = cv2.VideoCapture(stream_url)
    if not cap.isOpened():
        log.error(f"Cannot open video stream: {stream_url[:80]}")
        sys.exit(1)

    prev_gray = None

    while True:
        ret, frame = cap.read()
        if not ret:
            log.warning("Frame read failed — reconnecting in 5s")
            cap.release()
            time.sleep(5)
            stream_url = resolve_stream_url(RTSP_URL)  # re-resolve (YT URLs expire)
            cap = cv2.VideoCapture(stream_url)
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        if not has_significant_motion(prev_gray, gray):
            prev_gray = gray
            time.sleep(FRAME_INTERVAL)
            continue

        prev_gray = gray

        # ─── YOLOv8 inference ───
        results = model(frame, verbose=False, conf=CONFIDENCE_THRESHOLD)

        vehicle_count = 0
        detections = []

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                if cls_id in VEHICLE_CLASSES:
                    vehicle_count += 1
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    detections.append([x1, y1, x2, y2, conf])

        # ─── SORT tracking for speed estimation ───
        avg_speed = 0.0
        if tracker_available and len(detections) > 0:
            det_array = np.array(detections)
            tracked = tracker.update(det_array)
            # Simplified speed: use displacement between frames as proxy
            if len(tracked) > 0:
                speeds = []
                for t in tracked:
                    cx = (t[0] + t[2]) / 2
                    cy = (t[1] + t[3]) / 2
                    # Displacement as proxy speed (px/frame)
                    speeds.append(abs(cx - frame.shape[1] / 2) * 0.01)
                avg_speed = np.mean(speeds) if speeds else 0.0

        # ─── Send event ───
        event = {
            "camera_id": CAMERA_ID,
            "event_type": "traffic_jam",
            "confidence": float(np.mean([d[4] for d in detections])) if detections else 0.0,
            "vehicle_count": vehicle_count,
            "avg_speed": round(avg_speed, 2),
            "image_base64": encode_frame(frame),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        log.info(f"Vehicles: {vehicle_count}, Avg speed: {avg_speed:.2f} px/f")
        send_event(event)

        time.sleep(FRAME_INTERVAL)

    cap.release()


if __name__ == "__main__":
    main()
