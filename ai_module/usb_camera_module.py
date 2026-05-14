"""
USB Camera — Unified Real-time Detection Module
Detects: 🔥 Fire, 🌊 Flood, 🚗 Traffic (vehicles)
Uses YOLOv8 with GPU (CUDA) acceleration.
Live preview window with detection overlays.
"""

import os
import sys
import time
import base64
import logging
import threading
import requests  # type: ignore
import cv2
import numpy as np
import math
from dotenv import load_dotenv
from collections import deque

load_dotenv()

# ═══════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════
CAMERA_ID = os.getenv("CAMERA_ID", "USB_CAM_001")
CAMERA_INDEX = int(os.getenv("USB_CAMERA_INDEX", "1"))  # 0 = laptop webcam, 1 = USB camera
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000/api/events")
API_TOKEN = os.getenv("API_TOKEN", "")

# Detection toggles
DETECT_FIRE = os.getenv("DETECT_FIRE", "true").lower() == "true"
DETECT_FLOOD = os.getenv("DETECT_FLOOD", "true").lower() == "true"
DETECT_TRAFFIC = os.getenv("DETECT_TRAFFIC", "true").lower() == "true"
SHOW_PREVIEW = os.getenv("SHOW_PREVIEW", "true").lower() == "true"

# Thresholds
FIRE_CONFIDENCE = float(os.getenv("FIRE_CONFIDENCE", "0.4"))
FIRE_CONFIRM_FRAMES = int(os.getenv("FIRE_CONFIRM_FRAMES", "3"))
TRAFFIC_CONFIDENCE = float(os.getenv("TRAFFIC_CONFIDENCE", "0.4"))
FLOOD_WATCH_THRESHOLD = float(os.getenv("FLOOD_WATCH_THRESHOLD", "0.15"))
FLOOD_ALERT_THRESHOLD = float(os.getenv("FLOOD_ALERT_THRESHOLD", "0.30"))

# Cooldown (seconds) — avoid spamming backend
FIRE_COOLDOWN = int(os.getenv("FIRE_COOLDOWN", "30"))
FLOOD_COOLDOWN = int(os.getenv("FLOOD_COOLDOWN", "60"))
TRAFFIC_COOLDOWN = int(os.getenv("TRAFFIC_COOLDOWN", "30"))

# Camera resolution
CAM_WIDTH = int(os.getenv("CAM_WIDTH", "1280"))
CAM_HEIGHT = int(os.getenv("CAM_HEIGHT", "720"))
TARGET_FPS = int(os.getenv("TARGET_FPS", "30"))

# AI inference settings — lower FPS = more time per frame = higher accuracy
INFERENCE_FPS = int(os.getenv("INFERENCE_FPS", "5"))  # Run AI at 5 FPS (every 200ms)
INFERENCE_IMGSZ = int(os.getenv("INFERENCE_IMGSZ", "640"))  # YOLO input resolution

JPEG_QUALITY = 70
RESIZE_DIM = (640, 640)

# Flood HSV range (muddy/brown water)
FLOOD_HSV_LOWER = np.array([5, 30, 30])
FLOOD_HSV_UPPER = np.array([35, 200, 180])

# COCO vehicle class IDs
VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

# Colors for drawing (BGR)
COLORS = {
    "fire": (0, 0, 255),       # Red
    "flood": (255, 150, 0),    # Blue-ish
    "traffic": (0, 200, 255),  # Yellow-ish
    "text_bg": (0, 0, 0),      # Black
    "text": (255, 255, 255),   # White
    "green": (0, 255, 0),
    "orange": (0, 165, 255),
    "red": (0, 0, 255),
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [USB-CAM] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════
def encode_frame(frame: np.ndarray) -> str:
    """Resize, JPEG-encode, and base64-encode a frame."""
    resized = cv2.resize(frame, RESIZE_DIM)
    _, buffer = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return base64.b64encode(buffer).decode("utf-8")


def send_event(data: dict):
    """POST event to backend (non-blocking)."""
    def _send():
        headers = {
            "Authorization": f"Bearer {API_TOKEN}",
            "Content-Type": "application/json",
        }
        try:
            resp = requests.post(BACKEND_URL, json=data, headers=headers, timeout=10)
            log.info(f"✅ Event sent [{data['event_type']}] → {resp.status_code}")
        except Exception as e:
            log.error(f"❌ Failed to send event: {e}")

    threading.Thread(target=_send, daemon=True).start()


def compute_water_ratio(frame: np.ndarray) -> tuple[float, np.ndarray]:
    """Compute ratio of water-colored pixels using HSV thresholding."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, FLOOD_HSV_LOWER, FLOOD_HSV_UPPER)

    # Morphological cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    water_pixels = cv2.countNonZero(mask)
    total_pixels = frame.shape[0] * frame.shape[1]
    return water_pixels / total_pixels, mask


def draw_text_with_bg(frame, text, pos, font_scale=0.5, color=(255, 255, 255),
                       bg_color=(0, 0, 0), thickness=1, padding=4):
    """Draw text with a background rectangle."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), baseline = cv2.getTextSize(text, font, font_scale, thickness)
    x, y = pos
    cv2.rectangle(frame, (x - padding, y - th - padding),
                  (x + tw + padding, y + padding), bg_color, -1)
    cv2.putText(frame, text, (x, y), font, font_scale, color, thickness, cv2.LINE_AA)

def get_current_location() -> tuple[float, float]:
    """
    Get current latitude and longitude.
    Only uses CAMERA_LAT/CAMERA_LNG if explicitly set.
    Otherwise returns None, allowing the Backend to use the highly-accurate
    location provided by the Web Dashboard's Geolocation API.
    """
    env_lat = os.getenv("CAMERA_LAT", "")
    env_lng = os.getenv("CAMERA_LNG", "")
    if env_lat and env_lng:
        try:
            return float(env_lat), float(env_lng)
        except ValueError:
            pass
    return None, None

# Global coordinates
CURRENT_LAT, CURRENT_LON = None, None


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════
def main():
    log.info("=" * 60)
    log.info("  USB Camera — Unified Detection Module")
    log.info("=" * 60)
    log.info(f"Camera ID    : {CAMERA_ID}")
    log.info(f"Camera Index : {CAMERA_INDEX}")
    log.info(f"Backend      : {BACKEND_URL}")
    log.info(f"Detect Fire  : {DETECT_FIRE}")
    log.info(f"Detect Flood : {DETECT_FLOOD}")
    log.info(f"Detect Traffic: {DETECT_TRAFFIC}")
    log.info(f"Show Preview : {SHOW_PREVIEW}")
    log.info(f"Resolution   : {CAM_WIDTH}x{CAM_HEIGHT}")

    global CURRENT_LAT, CURRENT_LON
    CURRENT_LAT, CURRENT_LON = get_current_location()
    if CURRENT_LAT and CURRENT_LON:
        log.info(f"📍 Auto-detected Location: {CURRENT_LAT}, {CURRENT_LON}")
    else:
        log.warning("⚠️ Could not auto-detect location, will use backend default.")

    # ─── Load YOLOv8 models ───
    try:
        from ultralytics import YOLO
    except ImportError:
        log.error("ultralytics not installed. Run: pip install ultralytics")
        sys.exit(1)

    # Fire model (custom fire-trained weights)
    fire_model = None
    if DETECT_FIRE:
        fire_weights = os.getenv("FIRE_WEIGHTS", "yolov8n_fire.pt")
        if not os.path.exists(fire_weights):
            log.warning(f"{fire_weights} not found — fire detection uses yolov8n.pt")
            fire_weights = "yolov8n.pt"
        fire_model = YOLO(fire_weights)
        log.info(f"🔥 Fire model loaded: {fire_weights}")

    # Traffic model (COCO-pretrained for vehicle detection)
    traffic_model = None
    if DETECT_TRAFFIC:
        traffic_weights = os.getenv("TRAFFIC_WEIGHTS", "yolov8m.pt")
        if not os.path.exists(traffic_weights):
            log.warning(f"{traffic_weights} not found — trying yolov8n.pt")
            traffic_weights = "yolov8n.pt"
        traffic_model = YOLO(traffic_weights)
        log.info(f"🚗 Traffic model loaded: {traffic_weights}")

    # ─── Open USB Camera ───
    log.info(f"Opening USB camera (index={CAMERA_INDEX})...")
    cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_MSMF)  # MSMF for Windows (detects USB cameras)

    if not cap.isOpened():
        log.error(f"Cannot open USB camera at index {CAMERA_INDEX}")
        log.error("Tips: Try changing USB_CAMERA_INDEX=1 or check device in Device Manager")
        sys.exit(1)

    # Set camera properties
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, TARGET_FPS)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    actual_fps = cap.get(cv2.CAP_PROP_FPS)
    log.info(f"✅ Camera opened: {actual_w}x{actual_h} @ {actual_fps:.0f}fps")

    # ─── State ───
    fire_consecutive = 0
    flood_consecutive = 0
    traffic_consecutive = 0
    last_fire_alert = 0
    last_flood_alert = 0
    last_traffic_alert = 0
    last_inference_time = 0
    flood_state = "NORMAL"

    log.info(f"🧠 AI Inference  : {INFERENCE_FPS} FPS (imgsz={INFERENCE_IMGSZ})")

    # FPS counter and state
    fps_deque = deque(maxlen=30)
    frame_count = 0
    
    # Persistent detection state (for smooth preview)
    last_fire_boxes = []
    last_fire_max_conf = 0.0
    last_fire_detected = False
    
    last_water_ratio = 0.0
    last_flood_mask = None
    
    last_traffic_boxes = []
    last_vehicle_count = 0
    vehicle_track_history = {} # track_id -> list of (cx, cy, timestamp)

    log.info("🎬 Starting detection loop... Press 'q' to quit.")
    log.info("")

    try:
        while True:
            t_start = time.time()

            ret, frame = cap.read()
            if not ret:
                log.warning("Frame read failed — retrying...")
                time.sleep(0.5)
                continue

            frame_count += 1
            now = time.time()
            display_frame = frame.copy() if SHOW_PREVIEW else None

            # ═══════════════════════════════════════
            # AI INFERENCE (FPS-limited for higher accuracy)
            # ═══════════════════════════════════════
            inference_interval = 1.0 / INFERENCE_FPS
            if (now - last_inference_time) >= inference_interval:
                last_inference_time = now
                # 🔥 FIRE DETECTION
                fire_detected = False
                fire_max_conf = 0.0
                fire_boxes = []

                if DETECT_FIRE and fire_model is not None:
                    results = fire_model(frame, verbose=False, conf=FIRE_CONFIDENCE, imgsz=INFERENCE_IMGSZ)
                    for r in results:
                        for box in r.boxes:
                            conf = float(box.conf[0])
                            cls_id = int(box.cls[0])
                            cls_name = fire_model.names[cls_id].lower()

                            if conf >= FIRE_CONFIDENCE and "fire" in cls_name:
                                fire_detected = True
                                fire_max_conf = max(fire_max_conf, conf)
                                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                                fire_boxes.append((x1, y1, x2, y2, conf))

                    if fire_detected:
                        fire_consecutive += 1
                    else:
                        fire_consecutive = 0
                        
                    last_fire_boxes = fire_boxes
                    last_fire_max_conf = fire_max_conf
                    last_fire_detected = fire_detected

                    # Send alert after consecutive confirmations
                    if fire_consecutive >= FIRE_CONFIRM_FRAMES and (now - last_fire_alert) > FIRE_COOLDOWN:
                        log.info(f"🔥🔥🔥 FIRE CONFIRMED (conf={fire_max_conf:.2f})")
                        send_event({
                            "camera_id": CAMERA_ID,
                            "event_type": "fire",
                            "confidence": round(fire_max_conf, 3),
                            "lat": CURRENT_LAT,
                            "lng": CURRENT_LON,
                            "image_base64": encode_frame(frame),
                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        })
                        last_fire_alert = now
                        fire_consecutive = 0

                # 🌊 FLOOD DETECTION
                water_ratio = 0.0
                flood_mask = None

                if DETECT_FLOOD:
                    water_ratio, flood_mask = compute_water_ratio(frame)
                    last_water_ratio = water_ratio
                    last_flood_mask = flood_mask

                    # Determine state
                    if water_ratio >= FLOOD_ALERT_THRESHOLD:
                        new_flood_state = "ALERT"
                    elif water_ratio >= FLOOD_WATCH_THRESHOLD:
                        new_flood_state = "WATCH"
                    else:
                        new_flood_state = "NORMAL"

                    if new_flood_state != "NORMAL":
                        flood_consecutive += 1
                    else:
                        flood_consecutive = 0
                        flood_state = "NORMAL"

                    # Send alert on state transition to ALERT/WATCH with temporal smoothing
                    if flood_consecutive >= 5 and new_flood_state != flood_state and (now - last_flood_alert) > FLOOD_COOLDOWN:
                        log.info(f"🌊 Flood {new_flood_state} confirmed (water_ratio={water_ratio:.4f})")
                        send_event({
                            "camera_id": CAMERA_ID,
                            "event_type": "flood",
                            "confidence": round(min(water_ratio * 2, 1.0), 3),
                            "water_ratio": round(water_ratio, 4),
                            "lat": CURRENT_LAT,
                            "lng": CURRENT_LON,
                            "image_base64": encode_frame(frame),
                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        })
                        last_flood_alert = now
                        flood_state = new_flood_state

                # 🚗 TRAFFIC DETECTION (With BoT-SORT Tracking)
                vehicle_count = 0
                traffic_boxes = []

                if DETECT_TRAFFIC and traffic_model is not None:
                    # Drop the global conf parameter so YOLO detects everything > 0.2
                    # We will manually filter confidences per-class below.
                    # Using bytetrack.yaml instead of botsort to prevent 'not enough matching points' errors when camera shakes
                    results = traffic_model.track(frame, persist=True, tracker="bytetrack.yaml", verbose=False, conf=0.2, imgsz=INFERENCE_IMGSZ)
                    for r in results:
                        if r.boxes.id is not None:
                            # We only count tracked boxes
                            for i, box in enumerate(r.boxes):
                                cls_id = int(box.cls[0])
                                conf = float(box.conf[0])
                                track_id = int(r.boxes.id[i]) if r.boxes.id is not None else -1
                                
                                if cls_id in VEHICLE_CLASSES:
                                    cls_name = VEHICLE_CLASSES[cls_id]
                                    
                                    # Adaptive confidence: motorcycles are much harder to detect
                                    # so we lower the requirement by 0.2 (e.g. from 0.5 to 0.3)
                                    req_conf = TRAFFIC_CONFIDENCE
                                    if cls_name == "motorcycle" or cls_name == "bicycle":
                                        req_conf = max(0.2, TRAFFIC_CONFIDENCE - 0.2)
                                        
                                    if conf >= req_conf:
                                        vehicle_count += 1
                                        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                                        
                                        # Speed calculation logic
                                        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                                        if track_id not in vehicle_track_history:
                                            vehicle_track_history[track_id] = []
                                        vehicle_track_history[track_id].append((cx, cy, now))
                                        
                                        # Keep only last 3 seconds
                                        vehicle_track_history[track_id] = [p for p in vehicle_track_history[track_id] if now - p[2] <= 3.0]
                                        
                                        speed = 0.0
                                        if len(vehicle_track_history[track_id]) >= 2:
                                            p1 = vehicle_track_history[track_id][0]
                                            p2 = vehicle_track_history[track_id][-1]
                                            dist = math.hypot(p2[0]-p1[0], p2[1]-p1[1])
                                            dt = p2[2] - p1[2]
                                            if dt > 0:
                                                speed = dist / dt
                                                
                                        # Append track_id to the string for drawing
                                        traffic_boxes.append((x1, y1, x2, y2, conf, f"{cls_name} #{track_id}", speed))
                                    
                    last_vehicle_count = vehicle_count
                    last_traffic_boxes = traffic_boxes

                    if vehicle_count > 0:
                        traffic_consecutive += 1
                    else:
                        traffic_consecutive = 0

                    # Send event periodically when vehicles detected consistently
                    if traffic_consecutive >= 3 and (now - last_traffic_alert) > TRAFFIC_COOLDOWN:
                        avg_conf = np.mean([b[4] for b in traffic_boxes]) if traffic_boxes else 0
                        avg_speed = np.mean([b[6] for b in traffic_boxes]) if traffic_boxes else 0.0
                        
                        log.info(f"🚗 Vehicles: {vehicle_count} | Avg Speed: {avg_speed:.1f} px/s")
                        send_event({
                            "camera_id": CAMERA_ID,
                            "event_type": "traffic_jam",
                            "confidence": round(float(avg_conf), 3),
                            "vehicle_count": vehicle_count,
                            "avg_speed": round(float(avg_speed), 1),
                            "lat": CURRENT_LAT,
                            "lng": CURRENT_LON,
                            "image_base64": encode_frame(frame),
                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        })
                        last_traffic_alert = now

            # ═══════════════════════════════════════
            # 🖥️ PREVIEW WINDOW
            # ═══════════════════════════════════════
            if SHOW_PREVIEW and display_frame is not None:
                # Draw from persistent state for smooth preview
                for (x1, y1, x2, y2, conf) in last_fire_boxes:
                    cv2.rectangle(display_frame, (x1, y1), (x2, y2), COLORS["fire"], 3)
                    draw_text_with_bg(display_frame, f"FIRE {conf:.0%}",
                                      (x1, y1 - 5), 0.6, COLORS["text"], COLORS["fire"])
                                      
                for (x1, y1, x2, y2, conf, cls_name, speed) in last_traffic_boxes:
                    cv2.rectangle(display_frame, (x1, y1), (x2, y2), COLORS["traffic"], 2)
                    draw_text_with_bg(display_frame, f"{cls_name} {speed:.0f}px/s",
                                      (x1, y1 - 5), 0.45, COLORS["text"], COLORS["traffic"])
                # FPS calculation
                t_end = time.time()
                fps_deque.append(t_end - t_start)
                fps = 1.0 / (sum(fps_deque) / len(fps_deque)) if fps_deque else 0

                # ── Status bar (top-left) ──
                y_offset = 25
                draw_text_with_bg(display_frame,
                    f"Smart Alert System | FPS: {fps:.0f} | Frame: {frame_count}",
                    (10, y_offset), 0.5, (0, 255, 200), (0, 0, 0))

                # ── Detection status (top-right) ──
                status_lines = []
                if DETECT_FIRE:
                    fire_status = f"FIRE: {'DETECTED' if last_fire_detected else 'Clear'} ({fire_consecutive}/{FIRE_CONFIRM_FRAMES})"
                    fire_color = COLORS["red"] if last_fire_detected else COLORS["green"]
                    status_lines.append((fire_status, fire_color))

                if DETECT_FLOOD:
                    flood_color = COLORS["red"] if flood_state == "ALERT" else (COLORS["orange"] if flood_state == "WATCH" else COLORS["green"])
                    status_lines.append((f"FLOOD: {flood_state} ({last_water_ratio:.2%})", flood_color))

                if DETECT_TRAFFIC:
                    traffic_color = COLORS["orange"] if last_vehicle_count > 10 else COLORS["green"]
                    status_lines.append((f"VEHICLES: {last_vehicle_count}", traffic_color))

                for i, (text, color) in enumerate(status_lines):
                    draw_text_with_bg(display_frame, text,
                        (actual_w - 350, 25 + i * 25), 0.5, color, (0, 0, 0))

                # ── Flood overlay (semi-transparent blue tint on water areas) ──
                if DETECT_FLOOD and last_flood_mask is not None and last_water_ratio > 0.05:
                    flood_overlay = display_frame.copy()
                    flood_overlay[last_flood_mask > 0] = (255, 150, 0)  # Blue tint
                    cv2.addWeighted(flood_overlay, 0.3, display_frame, 0.7, 0, display_frame)

                # Show window
                cv2.imshow("Smart Alert System - USB Camera", display_frame)

                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    log.info("User pressed 'q' — stopping.")
                    break
                elif key == ord('f'):
                    DETECT_FIRE_toggle = not DETECT_FIRE
                    log.info(f"Fire detection toggled: {DETECT_FIRE_toggle}")
                elif key == ord('s'):
                    # Save screenshot
                    fname = f"screenshot_{int(time.time())}.jpg"
                    cv2.imwrite(fname, display_frame)
                    log.info(f"📸 Screenshot saved: {fname}")

    except KeyboardInterrupt:
        log.info("Interrupted by user.")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        log.info("Camera released. Goodbye! 👋")


if __name__ == "__main__":
    main()
