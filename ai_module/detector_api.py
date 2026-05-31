"""
Lightweight HTTP detector for the multi-camera scanner.

POST /detect
{
  "camera": {"camera_id": "...", "name": "..."},
  "image_base64": "...",
  "content_type": "image/jpeg",
  "timestamp": "..."
}

Response:
{
  "detections": [
    {"event_type": "fire", "confidence": 0.82, "severity": "high", "metadata": {}}
  ]
}

This server intentionally uses Python's standard HTTP server so it can run with
the current requirements. OpenCV handles the baseline fire/flood heuristics.
YOLO traffic detection can be enabled with DETECTOR_ENABLE_YOLO=true.
"""

import base64
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List

import cv2
import numpy as np
from dotenv import load_dotenv

load_dotenv()

HOST = os.getenv("DETECTOR_HOST", "127.0.0.1")
PORT = int(os.getenv("DETECTOR_PORT", "5055"))
ENABLE_YOLO = os.getenv("DETECTOR_ENABLE_YOLO", "false").lower() == "true"
MIN_FIRE_RATIO = float(os.getenv("DETECTOR_FIRE_RATIO", "0.035"))
FLOOD_WATCH_RATIO = float(os.getenv("DETECTOR_FLOOD_WATCH_RATIO", "0.15"))
FLOOD_ALERT_RATIO = float(os.getenv("DETECTOR_FLOOD_ALERT_RATIO", "0.30"))
TRAFFIC_MIN_VEHICLES = int(os.getenv("DETECTOR_TRAFFIC_MIN_VEHICLES", "8"))
YOLO_WEIGHTS = os.getenv("DETECTOR_YOLO_WEIGHTS", "yolov8n.pt")

VEHICLE_CLASSES = {2, 3, 5, 7}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [DETECTOR] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

model = None


def load_yolo():
    global model
    if not ENABLE_YOLO or model is not None:
        return model
    try:
        from ultralytics import YOLO

        model = YOLO(YOLO_WEIGHTS)
        log.info("YOLO loaded: %s", YOLO_WEIGHTS)
    except Exception as exc:
        log.warning("YOLO disabled: %s", exc)
        model = None
    return model


def decode_frame(image_base64: str) -> np.ndarray:
    raw = base64.b64decode(image_base64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("image_base64 is not a valid image")
    return frame


def ratio_for_mask(mask: np.ndarray) -> float:
    return float(cv2.countNonZero(mask)) / float(mask.shape[0] * mask.shape[1])


def detect_fire(frame: np.ndarray) -> Dict[str, Any] | None:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    orange_lower = np.array([0, 80, 120])
    orange_upper = np.array([35, 255, 255])
    red_lower = np.array([170, 80, 120])
    red_upper = np.array([180, 255, 255])

    mask = cv2.inRange(hsv, orange_lower, orange_upper) | cv2.inRange(hsv, red_lower, red_upper)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    fire_ratio = ratio_for_mask(mask)

    if fire_ratio < MIN_FIRE_RATIO:
        return None

    confidence = min(0.99, 0.55 + fire_ratio * 8)
    severity = "critical" if confidence >= 0.85 else "high" if confidence >= 0.7 else "medium"
    return {
        "event_type": "fire",
        "confidence": round(confidence, 3),
        "severity": severity,
        "metadata": {"fire_color_ratio": round(fire_ratio, 4), "detector": "opencv_color"},
    }


def detect_flood(frame: np.ndarray) -> Dict[str, Any] | None:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    muddy_lower = np.array([5, 30, 30])
    muddy_upper = np.array([35, 200, 180])
    water_mask = cv2.inRange(hsv, muddy_lower, muddy_upper)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    water_mask = cv2.morphologyEx(water_mask, cv2.MORPH_OPEN, kernel)
    water_mask = cv2.morphologyEx(water_mask, cv2.MORPH_CLOSE, kernel)
    water_ratio = ratio_for_mask(water_mask)

    if water_ratio < FLOOD_WATCH_RATIO:
        return None

    confidence = min(0.99, water_ratio * 2.2)
    severity = "high" if water_ratio >= FLOOD_ALERT_RATIO else "medium"
    return {
        "event_type": "flood",
        "confidence": round(confidence, 3),
        "severity": severity,
        "water_ratio": round(water_ratio, 4),
        "metadata": {"water_ratio": round(water_ratio, 4), "detector": "opencv_hsv"},
    }


def detect_traffic(frame: np.ndarray) -> Dict[str, Any] | None:
    yolo = load_yolo()
    if yolo is None:
        return None

    results = yolo(frame, verbose=False, conf=0.35)
    vehicle_count = 0
    confidences: List[float] = []

    for result in results:
        for box in result.boxes:
            cls_id = int(box.cls[0])
            if cls_id in VEHICLE_CLASSES:
                vehicle_count += 1
                confidences.append(float(box.conf[0]))

    if vehicle_count < TRAFFIC_MIN_VEHICLES:
        return None

    confidence = float(np.mean(confidences)) if confidences else 0.65
    return {
        "event_type": "traffic_jam",
        "confidence": round(max(confidence, 0.65), 3),
        "severity": "medium",
        "vehicle_count": vehicle_count,
        "avg_speed": 0,
        "metadata": {"vehicle_count": vehicle_count, "detector": "yolov8_vehicle_count"},
    }


def detect(frame: np.ndarray) -> List[Dict[str, Any]]:
    detections = []
    for detector in (detect_fire, detect_flood, detect_traffic):
        result = detector(frame)
        if result:
            detections.append(result)
    return detections


class DetectorHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: Dict[str, Any]):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "yolo_enabled": ENABLE_YOLO})
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/detect":
            self._send_json(404, {"error": "not_found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            frame = decode_frame(payload.get("image_base64", ""))
            detections = detect(frame)
            camera_id = payload.get("camera", {}).get("camera_id", "unknown")
            log.info("%s -> %d detections", camera_id, len(detections))
            self._send_json(200, {"detections": detections})
        except Exception as exc:
            log.exception("detect failed")
            self._send_json(400, {"error": str(exc)})

    def log_message(self, _format, *_args):
        return


def main():
    load_yolo()
    server = ThreadingHTTPServer((HOST, PORT), DetectorHandler)
    log.info("Detector API listening on http://%s:%s", HOST, PORT)
    log.info("Use AI_DETECTOR_URL=http://%s:%s/detect in backend", HOST, PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
