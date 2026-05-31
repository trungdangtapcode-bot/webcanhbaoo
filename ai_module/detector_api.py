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
from typing import Any, Dict, List, Optional, Tuple

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
# Displacement thresholds (pixels) for speed classification between frames
TRAFFIC_SPEED_STOPPED = float(os.getenv("DETECTOR_TRAFFIC_SPEED_STOPPED", "5.0"))
TRAFFIC_SPEED_SLOW = float(os.getenv("DETECTOR_TRAFFIC_SPEED_SLOW", "15.0"))
# Number of consecutive slow/stopped frames to confirm a traffic jam
TRAFFIC_JAM_CONFIRM_FRAMES = int(os.getenv("DETECTOR_TRAFFIC_JAM_CONFIRM", "3"))
# Number of consecutive flowing frames to clear a jam
TRAFFIC_JAM_CLEAR_FRAMES = int(os.getenv("DETECTOR_TRAFFIC_JAM_CLEAR", "2"))
# IoU threshold for matching vehicles between frames
TRAFFIC_IOU_THRESHOLD = float(os.getenv("DETECTOR_TRAFFIC_IOU_THRESHOLD", "0.3"))

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


# ─────────────────────────────────────────────────────────────────────────────
# Traffic State Tracker (per-camera temporal analysis)
# ─────────────────────────────────────────────────────────────────────────────

class TrafficStateTracker:
    """
    Per-camera state cho traffic detection có temporal analysis.

    Lưu trữ:
    - Previous frame (grayscale) để tính optical flow
    - Previous vehicle bounding boxes để match qua IoU
    - Speed history (sliding window) để lọc nhiễu
    - Jam confirmation counter (tương tự fire_counters)
    - Clear counter (để giải phóng jam khi xe bắt đầu chạy lại)
    """

    def __init__(self, max_speed_history: int = 10):
        self.prev_gray: Optional[np.ndarray] = None
        self.prev_boxes: List[List[float]] = []  # [[x1,y1,x2,y2,conf], ...]
        self.speed_history: deque = deque(maxlen=max_speed_history)
        self.jam_counter: int = 0         # consecutive slow/stopped frames
        self.clear_counter: int = 0       # consecutive flowing frames
        self.is_jammed: bool = False       # current jam state
        self.last_update: float = 0.0

    def update(
        self,
        frame_gray: np.ndarray,
        current_boxes: List[List[float]],
        vehicle_count: int,
    ) -> Dict[str, Any]:
        """
        So sánh frame hiện tại với frame trước, trả về thông tin tốc độ.

        Returns dict:
            avg_displacement: float — trung bình pixel displacement
            matched_count: int — số xe matched giữa 2 frame
            speed_class: str — "stopped" | "slow" | "flowing"
            jam_counter: int — số frame liên tiếp bị chậm/dừng
            clear_counter: int — số frame liên tiếp xe chạy bình thường
            is_jammed: bool — trạng thái jam hiện tại
        """
        now = time.time()
        result = {
            "avg_displacement": 0.0,
            "matched_count": 0,
            "speed_class": "unknown",
            "jam_counter": self.jam_counter,
            "clear_counter": self.clear_counter,
            "is_jammed": self.is_jammed,
        }

        # Nếu chưa có frame trước, lưu và return
        if self.prev_gray is None or len(self.prev_boxes) == 0:
            self.prev_gray = frame_gray
            self.prev_boxes = current_boxes
            self.last_update = now
            result["speed_class"] = "no_history"
            return result

        # ─── IoU matching: match xe giữa 2 frame ───
        matches = self._match_vehicles_iou(
            self.prev_boxes, current_boxes, TRAFFIC_IOU_THRESHOLD
        )

        # ─── Tính centroid displacement ───
        displacements = []
        for prev_idx, curr_idx in matches:
            prev_cx, prev_cy = self._centroid(self.prev_boxes[prev_idx])
            curr_cx, curr_cy = self._centroid(current_boxes[curr_idx])
            dx = curr_cx - prev_cx
            dy = curr_cy - prev_cy
            disp = float(np.sqrt(dx * dx + dy * dy))
            displacements.append(disp)

        avg_disp = float(np.mean(displacements)) if displacements else 0.0
        self.speed_history.append(avg_disp)

        # Dùng trung bình trượt của speed_history để lọc nhiễu
        smoothed_speed = float(np.mean(self.speed_history))

        # ─── Phân loại tốc độ ───
        if smoothed_speed < TRAFFIC_SPEED_STOPPED:
            speed_class = "stopped"
        elif smoothed_speed < TRAFFIC_SPEED_SLOW:
            speed_class = "slow"
        else:
            speed_class = "flowing"

        # ─── Temporal confirmation logic ───
        is_congested = speed_class in ("stopped", "slow") and vehicle_count >= TRAFFIC_MIN_VEHICLES

        if is_congested:
            self.jam_counter += 1
            self.clear_counter = 0
        else:
            self.clear_counter += 1
            self.jam_counter = max(0, self.jam_counter - 1)

        # Trigger jam khi đủ N frame liên tiếp bị congested
        if not self.is_jammed and self.jam_counter >= TRAFFIC_JAM_CONFIRM_FRAMES:
            self.is_jammed = True
            log.info(
                "Traffic jam CONFIRMED after %d consecutive congested frames",
                self.jam_counter,
            )

        # Clear jam khi đủ N frame liên tiếp flowing
        if self.is_jammed and self.clear_counter >= TRAFFIC_JAM_CLEAR_FRAMES:
            self.is_jammed = False
            self.jam_counter = 0
            log.info(
                "Traffic jam CLEARED after %d consecutive flowing frames",
                self.clear_counter,
            )

        # Cập nhật state
        self.prev_gray = frame_gray
        self.prev_boxes = current_boxes
        self.last_update = now

        result.update({
            "avg_displacement": round(avg_disp, 2),
            "smoothed_speed": round(smoothed_speed, 2),
            "matched_count": len(matches),
            "speed_class": speed_class,
            "jam_counter": self.jam_counter,
            "clear_counter": self.clear_counter,
            "is_jammed": self.is_jammed,
        })
        return result

    @staticmethod
    def _centroid(box: List[float]) -> Tuple[float, float]:
        """Tính tâm của bounding box [x1, y1, x2, y2, ...]."""
        return (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0

    @staticmethod
    def _iou(box_a: List[float], box_b: List[float]) -> float:
        """Tính Intersection over Union giữa 2 boxes."""
        x1 = max(box_a[0], box_b[0])
        y1 = max(box_a[1], box_b[1])
        x2 = min(box_a[2], box_b[2])
        y2 = min(box_a[3], box_b[3])

        inter = max(0, x2 - x1) * max(0, y2 - y1)
        area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
        area_b = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
        union = area_a + area_b - inter

        return inter / union if union > 0 else 0.0

    def _match_vehicles_iou(
        self,
        prev_boxes: List[List[float]],
        curr_boxes: List[List[float]],
        iou_threshold: float,
    ) -> List[Tuple[int, int]]:
        """
        Greedy IoU matching: match mỗi xe ở frame trước với xe gần nhất
        ở frame hiện tại (IoU cao nhất >= threshold).

        Returns list of (prev_idx, curr_idx) pairs.
        """
        if not prev_boxes or not curr_boxes:
            return []

        # Tính IoU matrix
        n_prev = len(prev_boxes)
        n_curr = len(curr_boxes)
        iou_matrix = np.zeros((n_prev, n_curr), dtype=np.float32)

        for i in range(n_prev):
            for j in range(n_curr):
                iou_matrix[i, j] = self._iou(prev_boxes[i], curr_boxes[j])

        # Greedy matching: chọn cặp IoU cao nhất trước
        matches = []
        used_prev = set()
        used_curr = set()

        while True:
            max_iou = iou_threshold
            best_pair = None

            for i in range(n_prev):
                if i in used_prev:
                    continue
                for j in range(n_curr):
                    if j in used_curr:
                        continue
                    if iou_matrix[i, j] > max_iou:
                        max_iou = iou_matrix[i, j]
                        best_pair = (i, j)

            if best_pair is None:
                break

            matches.append(best_pair)
            used_prev.add(best_pair[0])
            used_curr.add(best_pair[1])

        return matches


# Per-camera traffic state trackers
_traffic_trackers: Dict[str, TrafficStateTracker] = defaultdict(TrafficStateTracker)


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


def _flood_texture_score(frame: np.ndarray) -> float:
    """
    Texture analysis bằng Gabor filter: nước thật có reflection + ripple pattern
    (texture mịn, đồng đều) khác với mặt đường khô (texture thô).

    Trả về score 0.0–1.0:
    - Score thấp (< 0.3) → texture mịn → khả năng có nước
    - Score cao (> 0.6) → texture thô → đường khô, không phải nước
    """
    h, w = frame.shape[:2]
    roi = frame[h // 3:, :]  # bottom 2/3

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

    # Gabor filter ở nhiều hướng
    texture_responses = []
    for theta in [0, np.pi / 4, np.pi / 2, 3 * np.pi / 4]:
        kernel = cv2.getGaborKernel(
            ksize=(21, 21), sigma=4.0, theta=theta,
            lambd=10.0, gamma=0.5, psi=0
        )
        response = cv2.filter2D(gray, cv2.CV_64F, kernel)
        texture_responses.append(float(np.std(response)))

    # Trung bình variance của texture ở các hướng
    avg_texture = float(np.mean(texture_responses))

    # Normalize: texture mịn (nước) cho score thấp, texture thô cho score cao
    # Giá trị thực nghiệm: nước thường < 15, đường khô > 25
    score = min(1.0, avg_texture / 40.0)
    return score


def detect_flood(frame: np.ndarray) -> Dict[str, Any] | None:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = _flood_mask(hsv)

    # Ratio is relative to bottom-2/3 area
    roi_area = (frame.shape[0] * 2 // 3) * frame.shape[1]
    water_pixels = float(cv2.countNonZero(mask))
    water_ratio = water_pixels / float(roi_area) if roi_area > 0 else 0.0

    if water_ratio < FLOOD_WATCH_RATIO:
        return None

    # ── Texture analysis: giảm false positive ──
    # Nước thật có texture mịn (score thấp), đường ướt có texture thô (score cao)
    texture_score = _flood_texture_score(frame)

    # Nếu texture thô (score > 0.55) VÀ water_ratio thấp → có thể chỉ là đường ướt
    if texture_score > 0.55 and water_ratio < FLOOD_ALERT_RATIO:
        log.info(
            "Flood candidate rejected: texture_score=%.3f (too rough for water), ratio=%.4f",
            texture_score, water_ratio,
        )
        return None

    # Điều chỉnh confidence dựa trên texture
    # Texture mịn → tăng confidence, texture thô → giảm confidence
    texture_modifier = max(0.7, 1.0 - texture_score * 0.5)
    confidence = min(0.99, water_ratio * 2.2 * texture_modifier)

    severity = "high" if water_ratio >= FLOOD_ALERT_RATIO else "medium"
    return {
        "event_type": "flood",
        "confidence": round(confidence, 3),
        "severity": severity,
        "water_ratio": round(water_ratio, 4),
        "metadata": {
            "water_ratio": round(water_ratio, 4),
            "texture_score": round(texture_score, 3),
            "detector": "opencv_dual_hsv_gabor_v2",
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Traffic Detection (upgraded with temporal analysis)
# ─────────────────────────────────────────────────────────────────────────────

def detect_traffic(frame: np.ndarray, camera_id: str = "unknown") -> Dict[str, Any] | None:
    """
    Nhận diện ùn tắc giao thông với temporal analysis:
    1. YOLOv8 detect vehicles
    2. IoU matching với frame trước → tính displacement (tốc độ)
    3. Temporal confirmation: cần N frame liên tiếp chậm/dừng mới trigger jam
    4. Groq Vision double-check (nếu có)
    """
    yolo = load_yolo()
    if yolo is None:
        return None

    results = yolo(frame, verbose=False, conf=0.35)
    vehicle_count = 0
    confidences: List[float] = []
    vehicle_boxes: List[List[float]] = []
    frame_area = frame.shape[0] * frame.shape[1]

    for result in results:
        for box in result.boxes:
            cls_id = int(box.cls[0])
            if cls_id in VEHICLE_CLASSES:
                vehicle_count += 1
                conf = float(box.conf[0])
                confidences.append(conf)
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                vehicle_boxes.append([x1, y1, x2, y2, conf])

    # Vehicle density: vehicles per 10 000 px² of frame
    vehicle_density = vehicle_count / (frame_area / 10000.0) if frame_area > 0 else 0.0
    avg_confidence = float(np.mean(confidences)) if confidences else 0.65

    # ─── Temporal analysis via TrafficStateTracker ───
    tracker = _traffic_trackers[camera_id]
    frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    tracking_info = tracker.update(frame_gray, vehicle_boxes, vehicle_count)

    avg_displacement = tracking_info["avg_displacement"]
    speed_class = tracking_info["speed_class"]
    is_jammed = tracking_info["is_jammed"]
    jam_counter = tracking_info["jam_counter"]
    matched_count = tracking_info["matched_count"]

    log.info(
        "Camera %s: vehicles=%d, displacement=%.1fpx, speed=%s, "
        "jam_counter=%d/%d, matched=%d, jammed=%s",
        camera_id, vehicle_count, avg_displacement, speed_class,
        jam_counter, TRAFFIC_JAM_CONFIRM_FRAMES, matched_count, is_jammed,
    )

    # ─── Quyết định severity dựa trên temporal state ───
    if is_jammed:
        # Đã confirmed jam qua temporal analysis
        if speed_class == "stopped" and vehicle_count >= 15:
            severity = "critical"
        elif speed_class == "stopped":
            severity = "high"
        else:
            severity = "high"
    elif speed_class == "slow" and vehicle_count >= TRAFFIC_MIN_VEHICLES:
        # Chưa confirmed jam nhưng đang chậm → cảnh báo medium
        severity = "medium"
    elif vehicle_count >= TRAFFIC_MIN_VEHICLES and vehicle_density >= TRAFFIC_MIN_DENSITY:
        # Nhiều xe nhưng có thể đang chạy → normal traffic volume
        severity = "normal"
    else:
        severity = "normal"

    # ─── Build metadata ───
    metadata = {
        "vehicle_count": vehicle_count,
        "vehicle_density": round(vehicle_density, 4),
        "avg_displacement_px": avg_displacement,
        "smoothed_speed_px": tracking_info.get("smoothed_speed", 0.0),
        "speed_class": speed_class,
        "matched_vehicles": matched_count,
        "jam_counter": jam_counter,
        "jam_confirm_threshold": TRAFFIC_JAM_CONFIRM_FRAMES,
        "is_jammed_temporal": is_jammed,
        "detector": "yolov8_temporal_iou_v3",
    }

    # ─── Return: chỉ báo traffic_jam khi is_jammed hoặc severity >= high ───
    if is_jammed:
        return {
            "event_type": "traffic_jam",
            "confidence": round(max(avg_confidence, 0.70), 3),
            "severity": severity,
            "vehicle_count": vehicle_count,
            "avg_speed": round(avg_displacement, 2),
            "metadata": metadata,
        }

    # Chưa confirmed jam → traffic_volume
    return {
        "event_type": "traffic_volume",
        "confidence": 1.0,
        "severity": severity,
        "vehicle_count": vehicle_count,
        "metadata": metadata,
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

def verify_traffic_jam_with_groq(frame: np.ndarray, tracking_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Nâng cấp: Groq trả về JSON chi tiết thay vì chỉ YES/NO.
    Bao gồm thông tin từ temporal analysis để Groq tham khảo.

    Returns dict:
        is_jam: bool
        confidence: float (0.0–1.0)
        reason: str
    """
    default_result = {"is_jam": True, "confidence": 0.8, "reason": "groq_unavailable_default_yes"}

    if not GROQ_API_KEY:
        return default_result

    if not can_call_groq():
        log.warning("Groq rate limit — skipping traffic verification")
        return default_result

    try:
        groq_request_times.append(time.time())

        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        img_b64 = base64.b64encode(buffer).decode('utf-8')

        # Context từ computer vision analysis
        cv_context = (
            f"Our computer vision system detected {tracking_info.get('vehicle_count', 0)} vehicles. "
            f"Average vehicle displacement between frames: {tracking_info.get('avg_displacement_px', 0):.1f} pixels "
            f"(lower = slower). Speed classification: {tracking_info.get('speed_class', 'unknown')}. "
            f"Consecutive congested frames: {tracking_info.get('jam_counter', 0)}."
        )

        prompt = (
            f"You are a traffic analysis expert. {cv_context}\n\n"
            "Analyze this traffic camera image and determine if there is a REAL traffic jam. "
            "Consider these factors:\n"
            "1. Are vehicles STOPPED or barely moving? (not just many vehicles)\n"
            "2. Are vehicles queued bumper-to-bumper in lanes?\n"
            "3. What percentage of the road is occupied by vehicles?\n"
            "4. Could this be normal heavy traffic that is still flowing?\n\n"
            "Return a JSON object with:\n"
            "- \"is_jam\": true/false\n"
            "- \"confidence\": 0.0 to 1.0\n"
            "- \"road_occupancy\": estimated percentage of road covered by vehicles\n"
            "- \"reason\": brief explanation\n"
            "ONLY output valid JSON."
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
            "max_tokens": 200
        }

        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers, json=payload, timeout=15,
        )
        resp.raise_for_status()

        answer = resp.json()["choices"][0]["message"]["content"].strip()
        data = json.loads(answer)

        result = {
            "is_jam": bool(data.get("is_jam", False)),
            "confidence": float(data.get("confidence", 0.5)),
            "road_occupancy": data.get("road_occupancy", None),
            "reason": str(data.get("reason", "no_reason")),
        }

        log.info(
            "Groq traffic verification: is_jam=%s, confidence=%.2f, reason=%s",
            result["is_jam"], result["confidence"], result["reason"],
        )
        return result

    except Exception as e:
        log.error(f"Groq traffic verification failed: {e}")
        return default_result


def analyze_traffic_with_groq(frame: np.ndarray, camera_id: str = "unknown") -> Dict[str, Any] | None:
    """
    Gửi ảnh camera cho Groq Vision AI để phân tích lưu lượng giao thông.
    Dùng khi YOLO không khả dụng hoặc để bổ sung thêm thông tin.

    Trả về traffic_volume event với:
    - vehicle_count: số xe ước tính
    - traffic_level: EMPTY / LOW / MODERATE / HIGH / GRIDLOCK
    - road_occupancy: % mặt đường bị chiếm
    """
    if not GROQ_API_KEY:
        return None

    if not can_call_groq():
        log.warning("Groq rate limit — skipping AI traffic analysis")
        return None

    try:
        groq_request_times.append(time.time())

        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        img_b64 = base64.b64encode(buffer).decode('utf-8')

        prompt = (
            "You are a traffic analysis expert. Analyze this traffic camera image and estimate the traffic conditions.\n\n"
            "Return a JSON object with:\n"
            '- "vehicle_count": estimated number of vehicles visible (integer)\n'
            '- "traffic_level": one of "EMPTY", "LOW", "MODERATE", "HIGH", "GRIDLOCK"\n'
            '  - EMPTY: 0 vehicles or nearly empty road\n'
            '  - LOW: a few vehicles, road is very clear\n'
            '  - MODERATE: normal traffic flow, some vehicles\n'
            '  - HIGH: heavy traffic, many vehicles, slow flow\n'
            '  - GRIDLOCK: vehicles stopped, bumper-to-bumper, severe congestion\n'
            '- "road_occupancy": estimated percentage (0-100) of road surface covered by vehicles\n'
            '- "description": one short sentence describing the current traffic situation in Vietnamese\n\n'
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
            "max_tokens": 200
        }

        log.info("Calling Groq for traffic volume analysis (camera=%s)...", camera_id)
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers, json=payload, timeout=15,
        )
        resp.raise_for_status()

        answer = resp.json()["choices"][0]["message"]["content"].strip()
        data = json.loads(answer)

        vehicle_count = int(data.get("vehicle_count", 0))
        traffic_level = str(data.get("traffic_level", "MODERATE")).upper()
        road_occupancy = data.get("road_occupancy", None)
        description = str(data.get("description", ""))

        # Validate traffic_level
        valid_levels = {"EMPTY", "LOW", "MODERATE", "HIGH", "GRIDLOCK"}
        if traffic_level not in valid_levels:
            traffic_level = "MODERATE"

        # Map traffic_level to severity
        level_to_severity = {
            "EMPTY": "normal",
            "LOW": "normal",
            "MODERATE": "normal",
            "HIGH": "medium",
            "GRIDLOCK": "high",
        }
        severity = level_to_severity.get(traffic_level, "normal")

        log.info(
            "Groq traffic analysis (camera=%s): %d vehicles, level=%s, occupancy=%s%%, desc=%s",
            camera_id, vehicle_count, traffic_level,
            road_occupancy, description[:60],
        )

        result = {
            "event_type": "traffic_volume",
            "confidence": 1.0,
            "severity": severity,
            "vehicle_count": vehicle_count,
            "metadata": {
                "vehicle_count": vehicle_count,
                "traffic_level": traffic_level,
                "road_occupancy": road_occupancy,
                "description": description,
                "detector": "groq_vision_traffic_v1",
            },
        }

        # Nếu AI phát hiện GRIDLOCK → báo traffic_jam luôn
        if traffic_level == "GRIDLOCK" and vehicle_count >= TRAFFIC_MIN_VEHICLES:
            result["event_type"] = "traffic_jam"
            result["confidence"] = 0.85
            result["severity"] = "high"
            result["avg_speed"] = 0
            result["metadata"]["detector"] = "groq_vision_traffic_jam_v1"
            log.info("Groq detected GRIDLOCK at camera=%s — reporting as traffic_jam", camera_id)

        return result

    except Exception as e:
        log.error(f"Groq traffic analysis failed: {e}")
        return None


def detect(frame: np.ndarray, camera_id: str = "unknown") -> List[Dict[str, Any]]:
    detections = []
    
    # 1. Fire and Flood Detection (Directly via Groq Vision API)
    groq_events = detect_incidents_with_groq(frame)
    if groq_events:
        detections.extend(groq_events)

    # 1b. OpenCV fallback for fire/flood when Groq is unavailable or rate-limited
    if not groq_events:
        # Fire (OpenCV)
        fire_result = detect_fire(frame, camera_id)
        if fire_result:
            detections.append(fire_result)

        # Flood (OpenCV + Gabor texture)
        flood_result = detect_flood(frame)
        if flood_result:
            detections.append(flood_result)

    # 2. Traffic Detection
    traffic_result = detect_traffic(frame, camera_id)

    if traffic_result:
        # YOLO available — use temporal analysis result
        if traffic_result.get("event_type") == "traffic_jam":
            # Đã qua temporal confirmation → double-check với Groq
            log.info(
                "Traffic jam confirmed by temporal analysis (camera=%s). "
                "Verifying with Groq AI...",
                camera_id,
            )
            groq_verification = verify_traffic_jam_with_groq(
                frame, traffic_result.get("metadata", {})
            )

            if groq_verification["is_jam"]:
                traffic_result["metadata"]["verified_by_ai"] = True
                traffic_result["metadata"]["ai_confidence"] = groq_verification["confidence"]
                traffic_result["metadata"]["ai_reason"] = groq_verification["reason"]
                if groq_verification.get("road_occupancy") is not None:
                    traffic_result["metadata"]["ai_road_occupancy"] = groq_verification["road_occupancy"]

                # Combine confidence: 60% temporal + 40% AI
                temporal_conf = traffic_result["confidence"]
                ai_conf = groq_verification["confidence"]
                combined_conf = temporal_conf * 0.6 + ai_conf * 0.4
                traffic_result["confidence"] = round(max(combined_conf, 0.65), 3)

                detections.append(traffic_result)
            else:
                log.info(
                    "Groq AI rejected the traffic jam (reason: %s). "
                    "Downgrading to moderate volume.",
                    groq_verification["reason"],
                )
                traffic_result["event_type"] = "traffic_volume"
                traffic_result["severity"] = "moderate"
                traffic_result["metadata"]["ai_rejected"] = True
                traffic_result["metadata"]["ai_reason"] = groq_verification["reason"]
                detections.append(traffic_result)
        else:
            detections.append(traffic_result)
    else:
        # 2b. YOLO không khả dụng → gửi ảnh cho AI phân tích lưu lượng
        ai_traffic = analyze_traffic_with_groq(frame, camera_id)
        if ai_traffic:
            detections.append(ai_traffic)

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
            self._send_json(200, {
                "status": "ok",
                "yolo_enabled": ENABLE_YOLO,
                "traffic_jam_confirm_frames": TRAFFIC_JAM_CONFIRM_FRAMES,
                "traffic_speed_stopped_threshold": TRAFFIC_SPEED_STOPPED,
                "traffic_speed_slow_threshold": TRAFFIC_SPEED_SLOW,
                "active_trackers": len(_traffic_trackers),
            })
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
    log.info(
        "Traffic config: jam_confirm=%d frames, speed_stopped=%.1fpx, "
        "speed_slow=%.1fpx, iou_threshold=%.2f",
        TRAFFIC_JAM_CONFIRM_FRAMES, TRAFFIC_SPEED_STOPPED,
        TRAFFIC_SPEED_SLOW, TRAFFIC_IOU_THRESHOLD,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
