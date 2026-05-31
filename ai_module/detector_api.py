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
import requests
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List

import cv2
import numpy as np
from dotenv import load_dotenv

load_dotenv()

HOST = os.getenv("DETECTOR_HOST", "127.0.0.1")
PORT = int(os.getenv("DETECTOR_PORT", "5055"))
ENABLE_YOLO = os.getenv("DETECTOR_ENABLE_YOLO", "false").lower() == "true"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

# ── Fire thresholds ──────────────────────────────────────────────────────────
MIN_FIRE_RATIO = float(os.getenv("DETECTOR_FIRE_RATIO", "0.025"))
# Require this many consecutive positive frames before alerting (per-camera)
FIRE_CONFIRM_FRAMES = int(os.getenv("DETECTOR_FIRE_CONFIRM_FRAMES", "2"))

# ── Flood thresholds ─────────────────────────────────────────────────────────
FLOOD_WATCH_RATIO = float(os.getenv("DETECTOR_FLOOD_WATCH_RATIO", "0.15"))
FLOOD_ALERT_RATIO = float(os.getenv("DETECTOR_FLOOD_ALERT_RATIO", "0.30"))
# Minimum connected-component area (px²) to avoid noise specks
FLOOD_MIN_AREA = int(os.getenv("DETECTOR_FLOOD_MIN_AREA", "800"))

# ── Traffic thresholds ───────────────────────────────────────────────────────
TRAFFIC_MIN_VEHICLES = int(os.getenv("DETECTOR_TRAFFIC_MIN_VEHICLES", "6"))
# Minimum vehicle density (vehicles per 10 000 px²) to confirm jam
TRAFFIC_MIN_DENSITY = float(os.getenv("DETECTOR_TRAFFIC_MIN_DENSITY", "0.015"))

YOLO_WEIGHTS = os.getenv("DETECTOR_YOLO_WEIGHTS", "yolov8n.pt")
VEHICLE_CLASSES = {2, 3, 5, 7}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [DETECTOR] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

model = None

# Per-camera fire frame counters: camera_id -> int
_fire_counters: Dict[str, int] = defaultdict(int)


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


# ─────────────────────────────────────────────────────────────────────────────
# Fire Detection
# ─────────────────────────────────────────────────────────────────────────────

def _fire_color_mask(hsv: np.ndarray) -> np.ndarray:
    """
    Narrower HSV ranges specifically for fire/flame colours.

    - Flame orange-red:  H  0–22,  S >= 150,  V >= 150  (bright saturated)
    - Deep red wrap:     H 170–180, S >= 140,  V >= 120
    Avoids sunset/orange signage (lower brightness/saturation) and
    red traffic lights (smaller area, handled by component filter).
    """
    # Flame orange / red-orange (strict to avoid yellow box junctions)
    orange_lower = np.array([0,  150, 150])
    orange_upper = np.array([12, 255, 255])
    # Wrap-around deep red
    red_lower    = np.array([170, 140, 120])
    red_upper    = np.array([180, 255, 255])

    mask = cv2.inRange(hsv, orange_lower, orange_upper) | cv2.inRange(hsv, red_lower, red_upper)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    return mask


def _has_fire_flicker(frame: np.ndarray, mask: np.ndarray) -> bool:
    """
    Lửa thật có variance độ sáng cao trong vùng màu lửa.
    Trả về True nếu std(V) của vùng mask > 25 (loại bỏ đèn đường tĩnh).
    """
    if cv2.countNonZero(mask) == 0:
        return False
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    v_channel = hsv[:, :, 2]
    fire_pixels = v_channel[mask > 0]
    return float(np.std(fire_pixels)) > 25.0


def _filter_road_marking_blobs(mask: np.ndarray) -> np.ndarray:
    """
    Loại bỏ các blob có hình dạng giống vạch đường:
    - Aspect ratio (width/height) > 4  → dải ngang rộng (vạch đường)
    - Diện tích quá nhỏ < 500px²       → nhiễu nhỏ
    - Nằm ở 30% dưới cùng frame        → mặt đường phẳng

    Trả về mask đã lọc.
    """
    h, w = mask.shape[:2]
    ground_start = int(h * 0.70)  # 70% trở xuống = vùng mặt đường

    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    filtered = np.zeros_like(mask)

    for i in range(1, n_labels):
        area   = stats[i, cv2.CC_STAT_AREA]
        bw     = stats[i, cv2.CC_STAT_WIDTH]
        bh     = stats[i, cv2.CC_STAT_HEIGHT]
        top_y  = stats[i, cv2.CC_STAT_TOP]

        # Quá nhỏ → bỏ
        if area < 500:
            continue

        # Tỉ lệ ngang rất cao → vạch kẻ đường
        aspect_ratio = bw / max(bh, 1)
        if aspect_ratio > 4.0:
            continue

        # Blob nằm hoàn toàn trong vùng mặt đường → bỏ
        if top_y > ground_start:
            continue

        filtered[labels == i] = 255

    return filtered


def detect_fire(frame: np.ndarray, camera_id: str = "unknown") -> Dict[str, Any] | None:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = _fire_color_mask(hsv)

    # Loại bỏ vạch đường và blob nằm ở mặt đường
    mask = _filter_road_marking_blobs(mask)

    fire_ratio = ratio_for_mask(mask)

    if fire_ratio < MIN_FIRE_RATIO:
        # Reset consecutive counter
        _fire_counters[camera_id] = 0
        return None

    # Extra filter: require brightness variance (real fire flickers)
    if not _has_fire_flicker(frame, mask):
        _fire_counters[camera_id] = 0
        return None

    # Temporal confirmation: require FIRE_CONFIRM_FRAMES consecutive hits
    _fire_counters[camera_id] += 1
    if _fire_counters[camera_id] < FIRE_CONFIRM_FRAMES:
        log.info(
            "Fire candidate at %s (ratio=%.4f, frame %d/%d) — waiting for confirmation",
            camera_id, fire_ratio, _fire_counters[camera_id], FIRE_CONFIRM_FRAMES,
        )
        return None

    confidence = min(0.99, 0.55 + fire_ratio * 8)
    severity = "critical" if confidence >= 0.85 else "high" if confidence >= 0.7 else "medium"
    return {
        "event_type": "fire",
        "confidence": round(confidence, 3),
        "severity": severity,
        "metadata": {
            "fire_color_ratio": round(fire_ratio, 4),
            "confirm_frames": _fire_counters[camera_id],
            "detector": "opencv_color_v3",
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Flood Detection
# ─────────────────────────────────────────────────────────────────────────────

def _flood_mask(hsv: np.ndarray) -> np.ndarray:
    """
    Dual-range flood mask:
    1. Muddy brown water (H 5–35): nước lũ bùn đỏ
    2. Grey-blue water (H 90–130, low S): nước đô thị sau mưa, mặt đường ngập
    Only the bottom 2/3 of the frame is analysed (sky / signage excluded).
    """
    h, w = hsv.shape[:2]
    roi_start = h // 3          # ignore top third (sky, billboards)

    hsv_roi = hsv[roi_start:, :]

    # Range 1 — muddy/brown flood water
    muddy_lower = np.array([5,  30,  30])
    muddy_upper = np.array([35, 200, 180])

    # Range 2 — grey-blue stagnant water on urban roads
    grey_lower  = np.array([90,  15,  30])
    grey_upper  = np.array([130, 150, 180])

    mask = cv2.inRange(hsv_roi, muddy_lower, muddy_upper) | cv2.inRange(hsv_roi, grey_lower, grey_upper)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    # Remove small noise blobs (area filter)
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    filtered = np.zeros_like(mask)
    for i in range(1, n_labels):
        if stats[i, cv2.CC_STAT_AREA] >= FLOOD_MIN_AREA:
            filtered[labels == i] = 255

    return filtered


def detect_flood(frame: np.ndarray) -> Dict[str, Any] | None:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = _flood_mask(hsv)

    # Ratio is relative to bottom-2/3 area
    roi_area = (frame.shape[0] * 2 // 3) * frame.shape[1]
    water_pixels = float(cv2.countNonZero(mask))
    water_ratio = water_pixels / float(roi_area) if roi_area > 0 else 0.0

    if water_ratio < FLOOD_WATCH_RATIO:
        return None

    confidence = min(0.99, water_ratio * 2.2)
    severity = "high" if water_ratio >= FLOOD_ALERT_RATIO else "medium"
    return {
        "event_type": "flood",
        "confidence": round(confidence, 3),
        "severity": severity,
        "water_ratio": round(water_ratio, 4),
        "metadata": {
            "water_ratio": round(water_ratio, 4),
            "detector": "opencv_dual_hsv_roi",
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Traffic Detection
# ─────────────────────────────────────────────────────────────────────────────

def detect_traffic(frame: np.ndarray) -> Dict[str, Any] | None:
    yolo = load_yolo()
    if yolo is None:
        return None

    results = yolo(frame, verbose=False, conf=0.35)
    vehicle_count = 0
    confidences: List[float] = []
    frame_area = frame.shape[0] * frame.shape[1]

    for result in results:
        for box in result.boxes:
            cls_id = int(box.cls[0])
            if cls_id in VEHICLE_CLASSES:
                vehicle_count += 1
                confidences.append(float(box.conf[0]))

    # Vehicle density: vehicles per 10 000 px² of frame
    vehicle_density = vehicle_count / (frame_area / 10000.0) if frame_area > 0 else 0.0

    confidence = float(np.mean(confidences)) if confidences else 0.65

    # Determine severity
    if vehicle_count >= 15 or vehicle_density >= 0.025:
        severity = "high"
    elif vehicle_count >= TRAFFIC_MIN_VEHICLES and vehicle_density >= TRAFFIC_MIN_DENSITY:
        severity = "medium"
    else:
        severity = "normal"

    # User requested: only report traffic_jam if severity is high
    if severity != "high":
        return {
            "event_type": "traffic_volume",
            "confidence": 1.0,
            "severity": severity,
            "vehicle_count": vehicle_count,
            "metadata": {"vehicle_count": vehicle_count}
        }

    return {
        "event_type": "traffic_jam",
        "confidence": round(max(confidence, 0.65), 3),
        "severity": "high",
        "vehicle_count": vehicle_count,
        "avg_speed": 0,
        "metadata": {
            "vehicle_count": vehicle_count,
            "vehicle_density": round(vehicle_density, 4),
            "detector": "yolov8_density_v2",
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Combined
# ─────────────────────────────────────────────────────────────────────────────

# Rate limiting for Groq API (30 requests per minute)
groq_request_times = deque(maxlen=30)

def can_call_groq() -> bool:
    now = time.time()
    # Remove timestamps older than 60 seconds
    while groq_request_times and now - groq_request_times[0] >= 60:
        groq_request_times.popleft()
    
    if len(groq_request_times) >= 30:
        return False
    return True

def detect_incidents_with_groq(frame: np.ndarray) -> List[Dict[str, Any]]:
    if not GROQ_API_KEY:
        return []
    
    if not can_call_groq():
        log.warning("Groq rate limit reached (30 req/min). Skipping AI detection for this frame.")
        return []
        
    try:
        # Record this request timestamp
        groq_request_times.append(time.time())
        
        # Encode frame to base64
        _, buffer = cv2.imencode('.jpg', frame)
        img_b64 = base64.b64encode(buffer).decode('utf-8')
        
        prompt = (
            "Examine this traffic camera image carefully. Is there any 'fire' or 'flood' incident happening? "
            "Return a JSON object with a single key 'events' containing an array of events found. If none, return {\"events\": []}. "
            "Example formats: "
            "{\"events\": [{\"event_type\": \"fire\", \"severity\": \"high\", \"confidence\": 0.95}]} or {\"events\": []}. "
            "IMPORTANT: ONLY output valid JSON. Do not include markdown blocks."
        )
        
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": GROQ_VISION_MODEL,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
                    ]
                }
            ],
            "temperature": 0.1,
            "max_tokens": 150
        }
        
        log.info(f"Calling Groq ({GROQ_VISION_MODEL}) for direct detection...")
        resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=15)
        resp.raise_for_status()
        
        answer = resp.json()["choices"][0]["message"]["content"].strip()
        data = json.loads(answer)
        events = data.get("events", [])
        
        if events:
            log.info(f"Groq detected incidents: {events}")
            for e in events:
                e["metadata"] = {"detector": "groq_vision_llm"}
        return events
    except Exception as e:
        log.error(f"Groq detection failed: {e}")
        return []

def verify_traffic_jam_with_groq(frame: np.ndarray) -> bool:
    try:
        if not GROQ_API_KEY:
            return True
            
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        img_b64 = base64.b64encode(buffer).decode('utf-8')
        
        prompt = (
            "A computer vision model has detected a severe traffic jam in this image. "
            "Please verify if there is actually a heavy traffic jam (cars stopped, extreme congestion). "
            "Reply with exactly one word: YES if it is a severe traffic jam, or NO if the traffic is flowing or light."
        )
        
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": GROQ_VISION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
                    ]
                }
            ],
            "temperature": 0.1,
            "max_tokens": 10
        }
        
        resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=10)
        resp.raise_for_status()
        
        answer = resp.json()["choices"][0]["message"]["content"].strip().upper()
        is_jam = "YES" in answer
        log.info(f"Groq traffic verification result: {answer} -> {is_jam}")
        return is_jam
    except Exception as e:
        log.error(f"Groq traffic verification failed: {e}")
        return True # Default to True so we don't lose the YOLO detection if API fails

def detect(frame: np.ndarray, camera_id: str = "unknown") -> List[Dict[str, Any]]:
    detections = []
    
    # 1. Fire and Flood Detection (Directly via Groq Vision API)
    groq_events = detect_incidents_with_groq(frame)
    if groq_events:
        detections.extend(groq_events)

    # 2. Traffic Detection (YOLO)
    traffic_result = detect_traffic(frame)
    if traffic_result:
        if traffic_result.get("event_type") == "traffic_jam" and traffic_result.get("severity") == "high":
            log.info("YOLO detected traffic jam. Double checking with Groq AI...")
            if verify_traffic_jam_with_groq(frame):
                traffic_result["metadata"]["verified_by_ai"] = True
                detections.append(traffic_result)
            else:
                log.info("Groq AI rejected the traffic jam. Downgrading to moderate volume.")
                traffic_result["event_type"] = "traffic_volume"
                traffic_result["severity"] = "moderate"
                detections.append(traffic_result)
        else:
            detections.append(traffic_result)
                
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
            camera_id = payload.get("camera", {}).get("camera_id", "unknown")
            detections = detect(frame, camera_id)
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
