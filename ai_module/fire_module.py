"""
Fire Detection Module
YOLOv8n fire weights, confidence threshold 0.6, CONFIRM_FRAMES=3.
Background subtraction to skip static frames.
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
FRAME_INTERVAL = int(os.getenv("FRAME_INTERVAL", "5"))  # seconds
CONFIDENCE_THRESHOLD = 0.6
CONFIRM_FRAMES = 3  # require 3 consecutive detections
JPEG_QUALITY = 70
RESIZE_DIM = (640, 640)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [FIRE] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


def encode_frame(frame: np.ndarray) -> str:
    """Resize, JPEG-encode, and base64-encode a frame."""
    resized = cv2.resize(frame, RESIZE_DIM)
    _, buffer = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return base64.b64encode(buffer).decode("utf-8")


def has_significant_motion(prev_gray, curr_gray, threshold=3000):
    """Background subtraction: skip static frames."""
    if prev_gray is None:
        return True
    diff = cv2.absdiff(prev_gray, curr_gray)
    _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
    motion_pixels = cv2.countNonZero(thresh)
    return motion_pixels > threshold


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
    log.info(f"Starting fire detection module for {CAMERA_ID}")
    log.info(f"RTSP: {RTSP_URL}")
    log.info(f"Confirm frames: {CONFIRM_FRAMES}, Confidence: {CONFIDENCE_THRESHOLD}")

    # ─── Load YOLOv8 with fire weights ───
    try:
        from ultralytics import YOLO
        # Use custom fire-trained weights if available, else fallback to base
        weights_path = os.getenv("FIRE_WEIGHTS", "yolov8n_fire.pt")
        if not os.path.exists(weights_path):
            log.warning(f"{weights_path} not found — using yolov8n.pt as placeholder")
            weights_path = "yolov8n.pt"
        model = YOLO(weights_path)
        log.info(f"YOLOv8 loaded: {weights_path}")
    except ImportError:
        log.error("ultralytics not installed. Run: pip install ultralytics")
        sys.exit(1)

    # ─── Open video stream ───
    cap = cv2.VideoCapture(RTSP_URL)
    if not cap.isOpened():
        log.error(f"Cannot open RTSP stream: {RTSP_URL}")
        sys.exit(1)

    prev_gray = None
    consecutive_detections = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            log.warning("Frame read failed — reconnecting in 5s")
            cap.release()
            time.sleep(5)
            cap = cv2.VideoCapture(RTSP_URL)
            consecutive_detections = 0
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

        fire_detected = False
        max_conf = 0.0

        for r in results:
            for box in r.boxes:
                conf = float(box.conf[0])
                if conf >= CONFIDENCE_THRESHOLD:
                    fire_detected = True
                    max_conf = max(max_conf, conf)

        if fire_detected:
            consecutive_detections += 1
            log.info(
                f"🔥 Fire detected (conf={max_conf:.2f}, "
                f"consecutive={consecutive_detections}/{CONFIRM_FRAMES})"
            )
        else:
            consecutive_detections = 0

        # ─── Send event only after CONFIRM_FRAMES consecutive detections ───
        if consecutive_detections >= CONFIRM_FRAMES:
            event = {
                "camera_id": CAMERA_ID,
                "event_type": "fire",
                "confidence": round(max_conf, 3),
                "image_base64": encode_frame(frame),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            send_event(event)
            consecutive_detections = 0  # reset after alert
            time.sleep(30)  # cool-down to avoid spam
        else:
            time.sleep(FRAME_INTERVAL)

    cap.release()


if __name__ == "__main__":
    main()
