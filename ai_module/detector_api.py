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
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from dotenv import load_dotenv

MODULE_DIR = Path(__file__).resolve().parent
load_dotenv(MODULE_DIR / ".env", override=False)

HOST = os.getenv("DETECTOR_HOST", "127.0.0.1")
PORT = int(os.getenv("DETECTOR_PORT", "5055"))
ENABLE_YOLO = os.getenv("DETECTOR_ENABLE_YOLO", "false").lower() == "true"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
AI_PROVIDER = os.getenv("DETECTOR_AI_PROVIDER", "groq").strip().lower()
REQUESTED_AI_MODEL = os.getenv(
    "DETECTOR_AI_MODEL",
    "nvidia/nemotron-3-super-120b-a12b:free" if AI_PROVIDER == "openrouter" else GROQ_VISION_MODEL,
)
AI_TEXT_MODEL_FALLBACK = os.getenv("DETECTOR_AI_TEXT_MODEL_FALLBACK", "x-ai/grok-4.3")
IMAGE_ONLY_AI_MODELS = {"x-ai/grok-imagine-image-quality"}
AI_MODEL_FALLBACK_REASON = ""
AI_MODEL = REQUESTED_AI_MODEL
if AI_PROVIDER == "openrouter" and REQUESTED_AI_MODEL in IMAGE_ONLY_AI_MODELS:
    AI_MODEL = AI_TEXT_MODEL_FALLBACK
    AI_MODEL_FALLBACK_REASON = (
        f"{REQUESTED_AI_MODEL} outputs images, so detector uses {AI_TEXT_MODEL_FALLBACK} for image-to-JSON recognition"
    )
AI_ENDPOINT = os.getenv(
    "DETECTOR_AI_ENDPOINT",
    "https://openrouter.ai/api/v1/chat/completions"
    if AI_PROVIDER == "openrouter"
    else "https://api.groq.com/openai/v1/chat/completions",
)
AI_API_KEY = OPENROUTER_API_KEY if AI_PROVIDER == "openrouter" else GROQ_API_KEY
AI_ENABLED_DEFAULT = os.getenv("DETECTOR_GROQ_ENABLED", "false") if AI_PROVIDER == "groq" else "true"
AI_ENABLED = os.getenv("DETECTOR_AI_ENABLED", AI_ENABLED_DEFAULT).lower() == "true" and bool(AI_API_KEY)
AI_RATE_LIMIT_PER_MIN = int(os.getenv("DETECTOR_AI_RATE_LIMIT_PER_MIN", "20" if AI_PROVIDER == "openrouter" else "30"))
AI_REFERER = os.getenv("DETECTOR_AI_REFERER", "http://localhost:3000")
AI_TITLE = os.getenv("DETECTOR_AI_TITLE", "Smart Alert Detector Demo")
AI_FIRE_MIN_CONFIDENCE = float(os.getenv("DETECTOR_AI_FIRE_MIN_CONFIDENCE", "0.75"))
AI_FLOOD_MIN_CONFIDENCE = float(os.getenv("DETECTOR_AI_FLOOD_MIN_CONFIDENCE", "0.78"))
OPENCV_INCIDENT_FALLBACK = os.getenv("DETECTOR_OPENCV_INCIDENT_FALLBACK", "false").lower() == "true"
OPENCV_FIRE_SAFETY_NET = os.getenv("DETECTOR_OPENCV_FIRE_SAFETY_NET", "true").lower() == "true"
FIRE_REQUIRE_AI_VERIFICATION = os.getenv("DETECTOR_FIRE_REQUIRE_AI_VERIFICATION", "true").lower() == "true"
FIRE_ALLOW_LOCAL_FALLBACK = os.getenv("DETECTOR_FIRE_ALLOW_LOCAL_FALLBACK", "false").lower() == "true"
FLOOD_REQUIRE_AI_VERIFICATION = os.getenv("DETECTOR_FLOOD_REQUIRE_AI_VERIFICATION", "true").lower() == "true"
FLOOD_ALLOW_LOCAL_FALLBACK = os.getenv("DETECTOR_FLOOD_ALLOW_LOCAL_FALLBACK", "false").lower() == "true"

# ── Fire thresholds ──────────────────────────────────────────────────────────
MIN_FIRE_RATIO = float(os.getenv("DETECTOR_FIRE_RATIO", "0.025"))
STRONG_FIRE_RATIO = float(os.getenv("DETECTOR_STRONG_FIRE_RATIO", "0.08"))
# Require this many consecutive positive frames before alerting (per-camera)
FIRE_CONFIRM_FRAMES = int(os.getenv("DETECTOR_FIRE_CONFIRM_FRAMES", "2"))

# ── Flood thresholds ─────────────────────────────────────────────────────────
FLOOD_WATCH_RATIO = float(os.getenv("DETECTOR_FLOOD_WATCH_RATIO", "0.22"))
FLOOD_ALERT_RATIO = float(os.getenv("DETECTOR_FLOOD_ALERT_RATIO", "0.38"))
# Minimum connected-component area (px²) to avoid noise specks
FLOOD_MIN_AREA = int(os.getenv("DETECTOR_FLOOD_MIN_AREA", "2500"))
FLOOD_ROI_START_RATIO = float(os.getenv("DETECTOR_FLOOD_ROI_START_RATIO", "0.45"))
FLOOD_MIN_LARGEST_BLOB_RATIO = float(os.getenv("DETECTOR_FLOOD_MIN_LARGEST_BLOB_RATIO", "0.08"))
FLOOD_MIN_BOTTOM_COVERAGE = float(os.getenv("DETECTOR_FLOOD_MIN_BOTTOM_COVERAGE", "0.18"))
FLOOD_MAX_TEXTURE_SCORE = float(os.getenv("DETECTOR_FLOOD_MAX_TEXTURE_SCORE", "0.50"))
FLOOD_MAX_EDGE_DENSITY = float(os.getenv("DETECTOR_FLOOD_MAX_EDGE_DENSITY", "0.18"))

# ── Traffic thresholds ───────────────────────────────────────────────────────
TRAFFIC_MIN_VEHICLES = int(os.getenv("DETECTOR_TRAFFIC_MIN_VEHICLES", "21"))
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

YOLO_WEIGHTS = os.getenv("DETECTOR_YOLO_WEIGHTS", "yolo26x.pt")
YOLO_FALLBACK_WEIGHTS = [
    item.strip()
    for item in os.getenv("DETECTOR_YOLO_FALLBACK_WEIGHTS", "yolo26l.pt,yolo26m.pt,yolo11x.pt,yolov8m.pt").split(",")
    if item.strip()
]
YOLO_CONF = float(os.getenv("DETECTOR_YOLO_CONF", "0.25"))
YOLO_SLICE_CONF = float(os.getenv("DETECTOR_YOLO_SLICE_CONF", "0.20"))
YOLO_IOU = float(os.getenv("DETECTOR_YOLO_IOU", "0.45"))
YOLO_IMG_SIZE = int(os.getenv("DETECTOR_YOLO_IMG_SIZE", "1280"))
YOLO_ENABLE_SLICES = os.getenv("DETECTOR_YOLO_ENABLE_SLICES", "true").lower() == "true"
VEHICLE_CLASSES = {2, 3, 5, 7}

ENABLE_FIRE_YOLO = os.getenv("DETECTOR_ENABLE_FIRE_YOLO", "true").lower() == "true"
FIRE_YOLO_WEIGHTS = os.getenv("DETECTOR_FIRE_YOLO_WEIGHTS", "fire_smoke_yolov8n.pt")
FIRE_YOLO_CONF = float(os.getenv("DETECTOR_FIRE_YOLO_CONF", "0.50"))
FIRE_YOLO_IOU = float(os.getenv("DETECTOR_FIRE_YOLO_IOU", "0.45"))
FIRE_YOLO_IMG_SIZE = int(os.getenv("DETECTOR_FIRE_YOLO_IMG_SIZE", "640"))
FIRE_YOLO_CLASSES = {"fire", "smoke"}
FIRE_YOLO_MIN_BOX_AREA_RATIO = float(os.getenv("DETECTOR_FIRE_YOLO_MIN_BOX_AREA_RATIO", "0.004"))
FIRE_YOLO_IGNORE_TOP_RATIO = float(os.getenv("DETECTOR_FIRE_YOLO_IGNORE_TOP_RATIO", "0.10"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [DETECTOR] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

model = None
model_name: Optional[str] = None
fire_model = None
fire_model_name: Optional[str] = None

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


def resolve_weight_candidate(candidate: str) -> str:
    candidate_path = Path(candidate)
    if candidate_path.is_absolute() or candidate_path.exists():
        return str(candidate_path)

    module_candidate = MODULE_DIR / candidate_path
    if module_candidate.exists():
        return str(module_candidate)

    return candidate


def is_git_lfs_pointer(candidate: str) -> bool:
    path = Path(candidate)
    if not path.exists() or path.stat().st_size > 1024:
        return False
    try:
        return path.read_text(encoding="utf-8").startswith("version https://git-lfs.github.com/spec/v1")
    except UnicodeDecodeError:
        return False


def load_yolo():
    global model, model_name
    if not ENABLE_YOLO or model is not None:
        return model

    try:
        from ultralytics import YOLO
    except Exception as exc:
        log.warning("YOLO disabled: ultralytics import failed: %s", exc)
        return None

    candidates = []
    for candidate in [YOLO_WEIGHTS, *YOLO_FALLBACK_WEIGHTS]:
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    for candidate in candidates:
        candidate = resolve_weight_candidate(candidate)
        if is_git_lfs_pointer(candidate):
            log.warning("YOLO candidate skipped (%s): Git LFS pointer, real weights are not downloaded", candidate)
            continue
        try:
            model = YOLO(candidate)
            model_name = candidate
            log.info("YOLO loaded: %s", candidate)
            return model
        except Exception as exc:
            log.warning("YOLO candidate failed (%s): %s", candidate, exc)

    log.warning("YOLO disabled: no candidate weights could be loaded")
    model = None
    model_name = None
    return model


def load_fire_yolo():
    global fire_model, fire_model_name
    if not ENABLE_FIRE_YOLO or fire_model is not None:
        return fire_model

    try:
        from ultralytics import YOLO
    except Exception as exc:
        log.warning("Fire YOLO disabled: ultralytics import failed: %s", exc)
        return None

    candidate = resolve_weight_candidate(FIRE_YOLO_WEIGHTS)
    if is_git_lfs_pointer(candidate):
        log.warning("Fire YOLO skipped (%s): Git LFS pointer, real weights are not downloaded", candidate)
        return None

    try:
        fire_model = YOLO(candidate)
        fire_model_name = candidate
        log.info("Fire YOLO loaded: %s classes=%s", candidate, getattr(fire_model, "names", {}))
        return fire_model
    except Exception as exc:
        log.warning("Fire YOLO disabled: failed to load %s: %s", candidate, exc)
        fire_model = None
        fire_model_name = None
        return None


def box_iou(a: List[float], b: List[float]) -> float:
    ax1, ay1, ax2, ay2 = a[:4]
    bx1, by1, bx2, by2 = b[:4]
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def add_vehicle_box(
    boxes: List[List[float]],
    confidences: List[float],
    candidate: List[float],
    iou_threshold: float = YOLO_IOU,
) -> bool:
    if any(box_iou(candidate, existing) >= iou_threshold for existing in boxes):
        return False
    boxes.append(candidate)
    confidences.append(candidate[4])
    return True


def collect_vehicle_boxes(results: Any, offset: Tuple[int, int] = (0, 0)) -> List[List[float]]:
    ox, oy = offset
    boxes: List[List[float]] = []
    for result in results:
        for box in result.boxes:
            cls_id = int(box.cls[0])
            if cls_id not in VEHICLE_CLASSES:
                continue
            conf = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            boxes.append([x1 + ox, y1 + oy, x2 + ox, y2 + oy, conf])
    return boxes


def detect_fire_yolo(frame: np.ndarray, camera_id: str = "unknown") -> Dict[str, Any] | None:
    yolo = load_fire_yolo()
    if yolo is None:
        return None

    results = yolo(
        frame,
        verbose=False,
        conf=FIRE_YOLO_CONF,
        iou=FIRE_YOLO_IOU,
        imgsz=FIRE_YOLO_IMG_SIZE,
        agnostic_nms=True,
    )

    detections: List[Dict[str, Any]] = []
    class_counts: Dict[str, int] = defaultdict(int)
    confidences: List[float] = []
    frame_h, frame_w = frame.shape[:2]
    frame_area = float(max(1, frame_h * frame_w))
    ignored_detections = 0
    for result in results:
        names = getattr(result, "names", getattr(yolo, "names", {}))
        for box in result.boxes:
            cls_id = int(box.cls[0])
            label = str(names.get(cls_id, cls_id)).lower()
            if label not in FIRE_YOLO_CLASSES:
                continue
            conf = float(box.conf[0])
            x1, y1, x2, y2 = [round(float(v), 2) for v in box.xyxy[0].tolist()]
            area_ratio = max(0.0, (x2 - x1) * (y2 - y1)) / frame_area
            if area_ratio < FIRE_YOLO_MIN_BOX_AREA_RATIO or y2 < frame_h * FIRE_YOLO_IGNORE_TOP_RATIO:
                ignored_detections += 1
                continue
            detections.append({
                "label": label,
                "confidence": round(conf, 3),
                "box": [x1, y1, x2, y2],
                "area_ratio": round(area_ratio, 5),
            })
            class_counts[label] += 1
            confidences.append(conf)

    if not detections:
        if ignored_detections:
            log.info("Fire YOLO ignored %d tiny/overlay candidates at %s", ignored_detections, camera_id)
        return None

    max_conf = max(confidences)
    has_fire = class_counts.get("fire", 0) > 0
    severity = "critical" if has_fire and max_conf >= 0.8 else "high" if max_conf >= 0.65 else "medium"
    primary_label = "fire" if has_fire else "smoke"
    log.info(
        "Fire YOLO candidate at %s: event=%s conf=%.3f classes=%s",
        camera_id, primary_label, max_conf, dict(class_counts),
    )
    return {
        "event_type": "fire",
        "confidence": round(max_conf, 3),
        "severity": severity,
        "metadata": {
            "detector": "yolov8_fire_smoke_v1",
            "fire_yolo_model": fire_model_name,
            "fire_yolo_conf": FIRE_YOLO_CONF,
            "fire_yolo_iou": FIRE_YOLO_IOU,
            "fire_yolo_imgsz": FIRE_YOLO_IMG_SIZE,
            "fire_yolo_min_box_area_ratio": FIRE_YOLO_MIN_BOX_AREA_RATIO,
            "fire_yolo_ignore_top_ratio": FIRE_YOLO_IGNORE_TOP_RATIO,
            "ignored_detections": ignored_detections,
            "primary_label": primary_label,
            "class_counts": dict(class_counts),
            "detections": detections[:20],
        },
    }


def traffic_slices(frame: np.ndarray) -> List[Tuple[np.ndarray, Tuple[int, int]]]:
    h, w = frame.shape[:2]
    if h < 360 or w < 480:
        return []

    return [
        (frame[0:h // 2, 0:w // 2], (0, 0)),
        (frame[0:h // 2, w // 2:w], (w // 2, 0)),
        (frame[h // 3:2 * h // 3, 0:w // 2], (0, h // 3)),
        (frame[h // 3:2 * h // 3, w // 2:w], (w // 2, h // 3)),
        (frame[0:2 * h // 3, w // 4:3 * w // 4], (w // 4, 0)),
    ]


def detect_vehicle_boxes(yolo: Any, frame: np.ndarray) -> Tuple[List[List[float]], Dict[str, Any]]:
    boxes: List[List[float]] = []
    confidences: List[float] = []
    full_results = yolo(
        frame,
        verbose=False,
        conf=YOLO_CONF,
        iou=YOLO_IOU,
        imgsz=YOLO_IMG_SIZE,
        classes=list(VEHICLE_CLASSES),
        agnostic_nms=True,
    )

    for candidate in collect_vehicle_boxes(full_results):
        add_vehicle_box(boxes, confidences, candidate)

    slice_added = 0
    slice_count = 0
    if YOLO_ENABLE_SLICES:
        for image_slice, offset in traffic_slices(frame):
            slice_count += 1
            slice_results = yolo(
                image_slice,
                verbose=False,
                conf=YOLO_SLICE_CONF,
                iou=YOLO_IOU,
                imgsz=YOLO_IMG_SIZE,
                classes=list(VEHICLE_CLASSES),
                agnostic_nms=True,
            )
            for candidate in collect_vehicle_boxes(slice_results, offset):
                if add_vehicle_box(boxes, confidences, candidate):
                    slice_added += 1

    return boxes, {
        "avg_confidence": float(np.mean(confidences)) if confidences else 0.65,
        "full_frame_detections": len(boxes) - slice_added,
        "slice_added": slice_added,
        "slice_count": slice_count,
    }


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

    - Flame red/orange:  H  0–12,  S >= 150,  V >= 150  (bright saturated)
    - Flame yellow:      H 13–35,  S >=  80,  V >= 170  (bright screen/video flames)
    - Deep red wrap:     H 170–180, S >= 140,  V >= 120
    Avoids sunset/orange signage (lower brightness/saturation) and
    red traffic lights (smaller area, handled by component filter).
    """
    # Flame orange / red-orange (strict to avoid yellow box junctions)
    orange_lower = np.array([0,  150, 150])
    orange_upper = np.array([12, 255, 255])
    # Yellow-orange flame areas, common in videos/screens and large fires
    yellow_lower = np.array([13,  80, 170])
    yellow_upper = np.array([35, 255, 255])
    # Wrap-around deep red
    red_lower    = np.array([170, 140, 120])
    red_upper    = np.array([180, 255, 255])

    mask = (
        cv2.inRange(hsv, orange_lower, orange_upper) |
        cv2.inRange(hsv, yellow_lower, yellow_upper) |
        cv2.inRange(hsv, red_lower, red_upper)
    )
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
    strong_fire_mass = fire_ratio >= STRONG_FIRE_RATIO
    if not _has_fire_flicker(frame, mask) and not strong_fire_mass:
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
            "strong_fire_mass": strong_fire_mass,
            "strong_fire_ratio_threshold": STRONG_FIRE_RATIO,
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
    Only the lower road band is analysed (sky / signage excluded).
    """
    h, w = hsv.shape[:2]
    roi_start = int(h * FLOOD_ROI_START_RATIO)

    hsv_roi = hsv[roi_start:, :]

    # Range 1 — muddy/brown flood water
    muddy_lower = np.array([5,  30,  30])
    muddy_upper = np.array([35, 200, 180])
    tan_lower = np.array([8,  12,  70])
    tan_upper = np.array([45, 190, 235])

    # Range 2 — grey-blue stagnant water on urban roads
    grey_lower  = np.array([90,  15,  30])
    grey_upper  = np.array([130, 150, 180])
    reflective_lower = np.array([0, 0, 55])
    reflective_upper = np.array([180, 70, 210])

    mask = (
        cv2.inRange(hsv_roi, muddy_lower, muddy_upper) |
        cv2.inRange(hsv_roi, tan_lower, tan_upper) |
        cv2.inRange(hsv_roi, grey_lower, grey_upper) |
        cv2.inRange(hsv_roi, reflective_lower, reflective_upper)
    )

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


def _flood_region_stats(mask: np.ndarray) -> Dict[str, float]:
    roi_area = float(mask.shape[0] * mask.shape[1]) if mask.size else 0.0
    if roi_area <= 0:
        return {"largest_blob_ratio": 0.0, "bottom_coverage": 0.0}

    n_labels, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    largest_area = 0
    for i in range(1, n_labels):
        largest_area = max(largest_area, int(stats[i, cv2.CC_STAT_AREA]))

    band_height = max(1, int(mask.shape[0] * 0.18))
    bottom_band = mask[-band_height:, :]
    bottom_area = float(bottom_band.shape[0] * bottom_band.shape[1])
    bottom_coverage = cv2.countNonZero(bottom_band) / bottom_area if bottom_area > 0 else 0.0

    return {
        "largest_blob_ratio": largest_area / roi_area,
        "bottom_coverage": float(bottom_coverage),
    }


def _flood_edge_density(frame: np.ndarray) -> float:
    h = frame.shape[0]
    roi = frame[int(h * FLOOD_ROI_START_RATIO):, :]
    if roi.size == 0:
        return 1.0

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 60, 160)
    return cv2.countNonZero(edges) / float(edges.shape[0] * edges.shape[1])


def _flood_texture_score(frame: np.ndarray) -> float:
    """
    Texture analysis bằng Gabor filter: nước thật có reflection + ripple pattern
    (texture mịn, đồng đều) khác với mặt đường khô (texture thô).

    Trả về score 0.0–1.0:
    - Score thấp (< 0.3) → texture mịn → khả năng có nước
    - Score cao (> 0.6) → texture thô → đường khô, không phải nước
    """
    h, w = frame.shape[:2]
    roi = frame[int(h * FLOOD_ROI_START_RATIO):, :]
    if roi.size == 0:
        return 1.0

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

    # Ratio is relative to the same lower road band used by _flood_mask.
    roi_area = mask.shape[0] * mask.shape[1]
    water_pixels = float(cv2.countNonZero(mask))
    water_ratio = water_pixels / float(roi_area) if roi_area > 0 else 0.0

    if water_ratio < FLOOD_WATCH_RATIO:
        return None

    # ── Texture analysis: giảm false positive ──
    # Nước thật có texture mịn (score thấp), đường ướt có texture thô (score cao)
    region_stats = _flood_region_stats(mask)
    texture_score = _flood_texture_score(frame)
    edge_density = _flood_edge_density(frame)

    # Nếu texture thô (score > 0.55) VÀ water_ratio thấp → có thể chỉ là đường ướt
    strong_shape = (
        region_stats["largest_blob_ratio"] >= FLOOD_MIN_LARGEST_BLOB_RATIO and
        region_stats["bottom_coverage"] >= FLOOD_MIN_BOTTOM_COVERAGE
    )
    smooth_enough = (
        texture_score <= FLOOD_MAX_TEXTURE_SCORE and
        edge_density <= FLOOD_MAX_EDGE_DENSITY
    )

    # Wet asphalt and rain reflections are often scattered, high-texture, or
    # edge-heavy. Require a continuous lower-frame water region before alerting.
    if not strong_shape:
        very_weak_bottom = region_stats["bottom_coverage"] < FLOOD_MIN_BOTTOM_COVERAGE * 0.6
        very_rough = texture_score > max(FLOOD_MAX_TEXTURE_SCORE + 0.12, 0.62)
        very_edge_heavy = edge_density > max(FLOOD_MAX_EDGE_DENSITY + 0.07, 0.25)
        if water_ratio < FLOOD_ALERT_RATIO or very_weak_bottom or very_rough or very_edge_heavy:
            log.info(
                "Flood candidate rejected: ratio=%.4f texture=%.3f edge=%.3f largest=%.3f bottom=%.3f",
                water_ratio,
                texture_score,
                edge_density,
                region_stats["largest_blob_ratio"],
                region_stats["bottom_coverage"],
            )
            return None
    elif not smooth_enough:
        very_edge_heavy = edge_density > max(FLOOD_MAX_EDGE_DENSITY + 0.07, 0.25)
        weak_for_texture_only = (
            texture_score > max(FLOOD_MAX_TEXTURE_SCORE + 0.12, 0.62) and
            region_stats["bottom_coverage"] < 0.35
        )
        if water_ratio < FLOOD_ALERT_RATIO or very_edge_heavy or weak_for_texture_only:
            log.info(
                "Flood candidate rejected: ratio=%.4f texture=%.3f edge=%.3f largest=%.3f bottom=%.3f",
                water_ratio,
                texture_score,
                edge_density,
                region_stats["largest_blob_ratio"],
                region_stats["bottom_coverage"],
            )
            return None

    if texture_score > FLOOD_MAX_TEXTURE_SCORE and water_ratio < FLOOD_ALERT_RATIO:
        log.info(
            "Flood candidate rejected: texture_score=%.3f (too rough for water), ratio=%.4f",
            texture_score, water_ratio,
        )
        return None

    # Điều chỉnh confidence dựa trên texture
    # Texture mịn → tăng confidence, texture thô → giảm confidence
    texture_modifier = max(0.55, 1.0 - texture_score * 0.6)
    geometry_modifier = min(1.15, 0.75 + region_stats["bottom_coverage"])
    confidence = min(0.99, water_ratio * 2.2 * texture_modifier * geometry_modifier)

    severity = "high" if water_ratio >= FLOOD_ALERT_RATIO else "medium"
    return {
        "event_type": "flood",
        "confidence": round(confidence, 3),
        "severity": severity,
        "water_ratio": round(water_ratio, 4),
        "metadata": {
            "water_ratio": round(water_ratio, 4),
            "texture_score": round(texture_score, 3),
            "edge_density": round(edge_density, 3),
            "largest_blob_ratio": round(region_stats["largest_blob_ratio"], 3),
            "bottom_coverage": round(region_stats["bottom_coverage"], 3),
            "detector": "opencv_dual_hsv_geometry_v3",
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

    vehicle_boxes, detection_stats = detect_vehicle_boxes(yolo, frame)
    vehicle_count = len(vehicle_boxes)
    frame_area = frame.shape[0] * frame.shape[1]

    # Vehicle density: vehicles per 10 000 px² of frame
    vehicle_density = vehicle_count / (frame_area / 10000.0) if frame_area > 0 else 0.0
    avg_confidence = detection_stats["avg_confidence"]

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
        if speed_class == "stopped" and vehicle_count >= TRAFFIC_MIN_VEHICLES:
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
        "detector": "yolo_temporal_iou_sliced_v4",
        "yolo_model": model_name or YOLO_WEIGHTS,
        "yolo_conf": YOLO_CONF,
        "yolo_slice_conf": YOLO_SLICE_CONF,
        "yolo_iou": YOLO_IOU,
        "yolo_imgsz": YOLO_IMG_SIZE,
        "yolo_sliced": YOLO_ENABLE_SLICES,
        "full_frame_detections": detection_stats["full_frame_detections"],
        "slice_added_detections": detection_stats["slice_added"],
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

# Rate limiting for AI provider API.
ai_request_times = deque(maxlen=max(1, AI_RATE_LIMIT_PER_MIN))
ai_backoff_until = 0.0

def can_call_ai() -> bool:
    if not AI_ENABLED:
        return False
    now = time.time()
    if now < ai_backoff_until:
        return False
    # Remove timestamps older than 60 seconds
    while ai_request_times and now - ai_request_times[0] >= 60:
        ai_request_times.popleft()

    if len(ai_request_times) >= AI_RATE_LIMIT_PER_MIN:
        return False
    return True


def set_ai_backoff(exc: Exception) -> None:
    global ai_backoff_until
    error_text = str(exc)
    if "429" in error_text:
        ai_backoff_until = time.time() + 90.0
    elif AI_PROVIDER == "openrouter" and "402" in error_text:
        ai_backoff_until = time.time() + 300.0
    elif AI_PROVIDER == "openrouter" and ("400" in error_text or "404" in error_text):
        ai_backoff_until = time.time() + 60.0


def ai_headers() -> Dict[str, str]:
    headers = {
        "Authorization": f"Bearer {AI_API_KEY}",
        "Content-Type": "application/json",
    }
    if AI_PROVIDER == "openrouter":
        headers["HTTP-Referer"] = AI_REFERER
        headers["X-Title"] = AI_TITLE
    return headers


def call_ai_chat(payload: Dict[str, Any], timeout: int = 15) -> requests.Response:
    ai_request_times.append(time.time())
    return requests.post(AI_ENDPOINT, headers=ai_headers(), json=payload, timeout=timeout)


def ai_incident_min_confidence(incident_type: str) -> float:
    if incident_type == "fire":
        return AI_FIRE_MIN_CONFIDENCE
    if incident_type == "flood":
        return AI_FLOOD_MIN_CONFIDENCE
    return 0.50


def ai_local_context(incident_type: str, local_result: Dict[str, Any]) -> str:
    metadata = local_result.get("metadata", {})
    context = {
        "incident_type": incident_type,
        "local_confidence": local_result.get("confidence"),
        "local_severity": local_result.get("severity"),
        "water_ratio": local_result.get("water_ratio"),
        "detector": metadata.get("detector"),
        "primary_label": metadata.get("primary_label"),
        "class_counts": metadata.get("class_counts"),
        "fire_color_ratio": metadata.get("fire_color_ratio"),
        "strong_fire_mass": metadata.get("strong_fire_mass"),
        "water_metrics": {
            "texture_score": metadata.get("texture_score"),
            "edge_density": metadata.get("edge_density"),
            "largest_blob_ratio": metadata.get("largest_blob_ratio"),
            "bottom_coverage": metadata.get("bottom_coverage"),
        },
        "detections": metadata.get("detections"),
    }
    return json.dumps(context, ensure_ascii=False, separators=(",", ":"))[:1400]


def parse_ai_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "y", "1"}:
            return True
        if normalized in {"false", "no", "n", "0", ""}:
            return False
    return False


def evidence_is_allowed(incident_type: str, evidence: str) -> bool:
    normalized = evidence.strip().lower().replace("-", "_").replace(" ", "_")
    if incident_type == "fire":
        allowed = {"flame", "flames", "active_flame", "active_flames", "smoke_plume", "rising_smoke"}
        rejected = {
            "", "unclear", "unknown", "light_reflection", "reflection", "wet_road", "road_marking",
            "traffic_light", "brake_light", "street_lamp", "led", "sign", "screen", "sunset", "glare",
            "exhaust", "fog", "blur",
        }
    elif incident_type == "flood":
        allowed = {
            "standing_water", "submerged_road", "submerged_lane", "submerged_curb",
            "water_reaching_wheels", "wake", "ripples_across_lane", "continuous_water_sheet",
        }
        rejected = {
            "", "unclear", "unknown", "wet_road", "wet_asphalt", "reflection", "puddle",
            "small_puddle", "rain", "spray", "shadow", "dark_pavement", "glare",
        }
    else:
        return True

    if normalized in rejected:
        return False
    return normalized in allowed


def verify_incident_with_ai(frame: np.ndarray, incident_type: str, local_result: Dict[str, Any]) -> Dict[str, Any]:
    default_result = {
        "is_verified": False,
        "confidence": 0.0,
        "reason": f"ai_unavailable_default_no_for_{incident_type}",
        "status": "unavailable",
    }

    if not AI_ENABLED:
        return {**default_result, "status": "disabled"}

    if not can_call_ai():
        log.warning("%s rate limit — skipping %s verification", AI_PROVIDER, incident_type)
        return default_result

    try:
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        img_b64 = base64.b64encode(buffer).decode('utf-8')
        local_context = ai_local_context(incident_type, local_result)
        min_confidence = ai_incident_min_confidence(incident_type)

        if incident_type == "fire":
            prompt = (
                "You are verifying a traffic-camera fire/smoke alert. Use the image first, and use the local detector context only as a hint.\n"
                f"Local detector context: {local_context}\n\n"
                "Verify TRUE only when the image shows clear active flame, a real smoke plume, or smoke visibly rising from a likely fire source. "
                "Reject isolated orange/red/yellow regions, brake lights, traffic lights, street lamps, LEDs, signs, screens, sunsets, reflections, construction cones, fire hydrants, and road markings. "
                "For smoke-only alerts, require a visible gray/white/black plume, haze column, or expanding cloud; do not count blur, fog, camera glare, or exhaust as fire smoke. "
                "If the evidence is ambiguous, set is_verified=false. "
                "The visual_evidence value must be one of: flame, active_flame, smoke_plume, rising_smoke, light_reflection, wet_road, unclear. "
                "Return a JSON object with:\n"
                "- \"is_verified\": true/false\n"
                "- \"confidence\": 0.0 to 1.0\n"
                "- \"reason\": brief explanation naming the visual evidence or rejection cause\n"
                "- \"visual_evidence\": short phrase such as flame, smoke_plume, light_reflection, wet_road, unclear\n"
                "ONLY output valid JSON."
            )
        else:
            prompt = (
                "You are verifying a traffic-camera flood alert. Use the image first, and use the local detector context only as a hint.\n"
                f"Local detector context: {local_context}\n\n"
                "Verify TRUE only when standing water visibly covers a meaningful road, lane, sidewalk, or low-lying area with depth cues. "
                "Good evidence includes continuous water sheets, submerged curbs/lane markings, vehicles driving through water, wakes/ripples across the lane, or water reaching wheels. "
                "Reject rain, wet asphalt, shiny road reflections, small puddles, gutter water, spray, shadows, dark pavement, and camera glare. "
                "If you cannot distinguish flood water from wet road or reflections, set is_verified=false. "
                "The visual_evidence value must be one of: standing_water, submerged_road, submerged_lane, submerged_curb, water_reaching_wheels, wet_road, reflection, puddle, unclear. "
                "Return a JSON object with:\n"
                "- \"is_verified\": true/false\n"
                "- \"confidence\": 0.0 to 1.0\n"
                "- \"reason\": brief explanation naming the visual evidence or rejection cause\n"
                "- \"visual_evidence\": short phrase such as standing_water, wet_road, reflection, puddle, unclear\n"
                "ONLY output valid JSON."
            )

        payload = {
            "model": AI_MODEL,
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

        resp = call_ai_chat(payload, timeout=15)
        resp.raise_for_status()

        answer = resp.json()["choices"][0]["message"]["content"].strip()
        data = json.loads(answer)
        raw_is_verified = parse_ai_bool(data.get("is_verified", False))
        confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
        visual_evidence = str(data.get("visual_evidence", ""))
        allowed_evidence = evidence_is_allowed(incident_type, visual_evidence)
        is_verified = raw_is_verified and confidence >= min_confidence and allowed_evidence
        reason = str(data.get("reason", "no_reason"))
        if raw_is_verified and not is_verified:
            if not allowed_evidence:
                reason = f"ai_evidence_not_allowed({visual_evidence or 'missing'}): {reason}"
            else:
                reason = f"ai_confidence_below_threshold({confidence:.2f}<{min_confidence:.2f}): {reason}"

        result = {
            "is_verified": is_verified,
            "confidence": confidence,
            "reason": reason,
            "status": "ok",
            "visual_evidence": visual_evidence,
            "raw_is_verified": raw_is_verified,
            "min_confidence": min_confidence,
        }
        log.info(
            "%s %s verification: is_verified=%s, confidence=%.2f, reason=%s",
            AI_PROVIDER, incident_type, result["is_verified"], result["confidence"], result["reason"],
        )
        return result
    except Exception as e:
        set_ai_backoff(e)
        log.error("%s %s verification failed: %s", AI_PROVIDER, incident_type, e)
        return {**default_result, "status": "failed", "reason": str(e)}


def verify_traffic_jam_with_ai(frame: np.ndarray, tracking_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Nâng cấp: Groq trả về JSON chi tiết thay vì chỉ YES/NO.
    Bao gồm thông tin từ temporal analysis để Groq tham khảo.

    Returns dict:
        is_jam: bool
        confidence: float (0.0–1.0)
        reason: str
    """
    default_result = {
        "is_jam": True,
        "confidence": 0.8,
        "reason": "ai_unavailable_default_yes",
        "status": "unavailable",
    }

    if not AI_ENABLED:
        return {**default_result, "status": "disabled"}

    if not can_call_ai():
        log.warning("Groq rate limit — skipping traffic verification")
        return default_result

    try:
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

        payload = {
            "model": AI_MODEL,
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

        resp = call_ai_chat(payload, timeout=15)
        resp.raise_for_status()

        answer = resp.json()["choices"][0]["message"]["content"].strip()
        data = json.loads(answer)

        vehicle_count = int(tracking_info.get("vehicle_count", 0) or 0)
        raw_is_jam = parse_ai_bool(data.get("is_jam", False))
        result = {
            "is_jam": raw_is_jam and vehicle_count >= TRAFFIC_MIN_VEHICLES,
            "confidence": float(data.get("confidence", 0.5)),
            "road_occupancy": data.get("road_occupancy", None),
            "reason": str(data.get("reason", "no_reason")) if vehicle_count >= TRAFFIC_MIN_VEHICLES else "vehicle_count_below_threshold",
            "status": "ok",
        }

        log.info(
            "%s traffic verification: is_jam=%s, confidence=%.2f, reason=%s",
            AI_PROVIDER, result["is_jam"], result["confidence"], result["reason"],
        )
        return result

    except Exception as e:
        set_ai_backoff(e)
        log.error("%s traffic verification failed: %s", AI_PROVIDER, e)
        return {**default_result, "status": "failed", "reason": str(e)}


def analyze_traffic_with_ai(frame: np.ndarray, camera_id: str = "unknown") -> Dict[str, Any] | None:
    """
    Gửi ảnh camera cho Groq Vision AI để phân tích lưu lượng giao thông.
    Dùng khi YOLO không khả dụng hoặc để bổ sung thêm thông tin.

    Trả về traffic_volume event với:
    - vehicle_count: số xe ước tính
    - traffic_level: EMPTY / LOW / MODERATE / HIGH / GRIDLOCK
    - road_occupancy: % mặt đường bị chiếm
    """
    if not AI_ENABLED:
        return None

    if not can_call_ai():
        log.warning("Groq rate limit — skipping AI traffic analysis")
        return None

    try:
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

        payload = {
            "model": AI_MODEL,
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

        log.info("Calling %s for traffic volume analysis (camera=%s)...", AI_PROVIDER, camera_id)
        resp = call_ai_chat(payload, timeout=15)
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
            "%s traffic analysis (camera=%s): %d vehicles, level=%s, occupancy=%s%%, desc=%s",
            AI_PROVIDER, camera_id, vehicle_count, traffic_level,
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
                "detector": f"{AI_PROVIDER}_vision_traffic_v1",
                "ai_model": AI_MODEL,
            },
        }

        # Nếu AI phát hiện GRIDLOCK → báo traffic_jam luôn
        if traffic_level == "GRIDLOCK" and vehicle_count >= TRAFFIC_MIN_VEHICLES:
            result["event_type"] = "traffic_jam"
            result["confidence"] = 0.85
            result["severity"] = "high"
            result["avg_speed"] = 0
            result["metadata"]["detector"] = f"{AI_PROVIDER}_vision_traffic_jam_v1"
            log.info("Groq detected GRIDLOCK at camera=%s — reporting as traffic_jam", camera_id)

        return result

    except Exception as e:
        set_ai_backoff(e)
        log.error("%s traffic analysis failed: %s", AI_PROVIDER, e)
        return None


def detect(
    frame: np.ndarray,
    camera_id: str = "unknown",
    diagnostics: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    detections = []

    # 1. Fire Detection (Fire/Smoke YOLO first, then Groq verify).
    fire_result = detect_fire_yolo(frame, camera_id)
    if fire_result is None and OPENCV_FIRE_SAFETY_NET:
        fire_result = detect_fire(frame, camera_id)
        if fire_result:
            fire_result["metadata"]["fallback_reason"] = "fire_yolo_no_detection"

    if fire_result:
        log.info("Fire candidate detected by %s (camera=%s). Verifying with AI...", fire_result["metadata"].get("detector"), camera_id)
        ai_verify = verify_incident_with_ai(frame, "fire", fire_result)
        fire_meta = fire_result.get("metadata", {})
        strong_local_fire = (
            fire_result.get("confidence", 0.0) >= 0.75 or
            (
                fire_meta.get("primary_label") == "fire" and
                fire_result.get("confidence", 0.0) >= 0.65
            ) or
            bool(fire_meta.get("strong_fire_mass"))
        )
        if ai_verify["is_verified"]:
            ai_status = ai_verify.get("status", "unavailable")
            fire_result["metadata"]["verified_by_ai"] = ai_status == "ok"
            fire_result["metadata"]["ai_provider"] = AI_PROVIDER
            fire_result["metadata"]["ai_model"] = AI_MODEL
            fire_result["metadata"]["ai_status"] = ai_status
            fire_result["metadata"]["ai_reason"] = ai_verify["reason"]
            fire_result["metadata"]["ai_visual_evidence"] = ai_verify.get("visual_evidence", "")
            fire_result["metadata"]["ai_min_confidence"] = ai_verify.get("min_confidence")
            if ai_status == "ok":
                # Combine confidences (60% local, 40% AI)
                local_conf = fire_result.get("confidence", 0.8)
                ai_conf = ai_verify.get("confidence", 0.8)
                fire_result["confidence"] = round(max(local_conf * 0.6 + ai_conf * 0.4, 0.65), 3)
                detections.append(fire_result)
            elif strong_local_fire and FIRE_ALLOW_LOCAL_FALLBACK and not FIRE_REQUIRE_AI_VERIFICATION:
                fire_result["metadata"]["fallback_reason"] = "ai_unavailable"
                fire_result["metadata"]["local_fallback"] = True
                detections.append(fire_result)
            else:
                log.info(
                    "Skipping fire candidate because AI is unavailable or required (camera=%s, conf=%.2f, status=%s).",
                    camera_id,
                    fire_result.get("confidence", 0.0),
                    ai_status,
                )
        else:
            log.info("AI provider rejected the fire (reason: %s).", ai_verify["reason"])

    # 1b. Flood Detection (Local first, then AI verify)
    flood_result = detect_flood(frame)
    if flood_result:
        log.info("Flood detected by OpenCV (camera=%s). Verifying with AI...", camera_id)
        ai_verify = verify_incident_with_ai(frame, "flood", flood_result)
        flood_meta = flood_result.get("metadata", {})
        strong_local_flood = (
            flood_result.get("water_ratio", 0.0) >= FLOOD_ALERT_RATIO and
            flood_meta.get("bottom_coverage", 0.0) >= max(0.35, FLOOD_MIN_BOTTOM_COVERAGE) and
            flood_meta.get("largest_blob_ratio", 0.0) >= max(0.20, FLOOD_MIN_LARGEST_BLOB_RATIO)
        )
        flood_diagnostic = {
            "type": "flood_candidate",
            "accepted": bool(
                (ai_verify["is_verified"] and ai_verify.get("status") == "ok") or
                (
                    ai_verify.get("status") != "ok" and
                    strong_local_flood and
                    FLOOD_ALLOW_LOCAL_FALLBACK and
                    not FLOOD_REQUIRE_AI_VERIFICATION
                )
            ),
            "candidate": flood_result,
            "ai_provider": AI_PROVIDER,
            "ai_model": AI_MODEL,
            "ai_status": ai_verify.get("status", "unavailable"),
            "ai_reason": ai_verify["reason"],
            "local_fallback": bool(ai_verify.get("status") != "ok" and strong_local_flood),
        }
        if ai_verify["is_verified"]:
            ai_status = ai_verify.get("status", "unavailable")
            flood_result["metadata"]["verified_by_ai"] = ai_status == "ok"
            flood_result["metadata"]["ai_provider"] = AI_PROVIDER
            flood_result["metadata"]["ai_model"] = AI_MODEL
            flood_result["metadata"]["ai_status"] = ai_status
            flood_result["metadata"]["ai_reason"] = ai_verify["reason"]
            flood_result["metadata"]["ai_visual_evidence"] = ai_verify.get("visual_evidence", "")
            flood_result["metadata"]["ai_min_confidence"] = ai_verify.get("min_confidence")
            if ai_status == "ok":
                local_conf = flood_result.get("confidence", 0.8)
                ai_conf = ai_verify.get("confidence", 0.8)
                flood_result["confidence"] = round(max(local_conf * 0.6 + ai_conf * 0.4, 0.65), 3)
                detections.append(flood_result)
                flood_diagnostic["accepted"] = True
            elif strong_local_flood and FLOOD_ALLOW_LOCAL_FALLBACK and not FLOOD_REQUIRE_AI_VERIFICATION:
                flood_result["metadata"]["fallback_reason"] = "ai_unavailable_strong_local_flood"
                flood_result["metadata"]["local_fallback"] = True
                detections.append(flood_result)
            else:
                flood_result["metadata"]["fallback_reason"] = (
                    "ai_unavailable_or_required"
                    if FLOOD_REQUIRE_AI_VERIFICATION
                    else "ai_unavailable"
                )
                log.info(
                    "Skipping flood candidate because AI is unavailable or required (camera=%s, ratio=%.3f, status=%s).",
                    camera_id,
                    flood_result.get("water_ratio", 0.0),
                    ai_status,
                )
        else:
            log.info("AI provider rejected the flood (reason: %s).", ai_verify["reason"])
        if diagnostics is not None:
            diagnostics.append(flood_diagnostic)

    # 2. Traffic Detection
    traffic_result = detect_traffic(frame, camera_id)

    if traffic_result:
        # YOLO available — use temporal analysis result
        if traffic_result.get("event_type") == "traffic_jam":
            # Đã qua temporal confirmation → double-check với Groq
            log.info(
                "Traffic jam confirmed by temporal analysis (camera=%s). "
                "Verifying with configured AI provider...",
                camera_id,
            )
            ai_verification = verify_traffic_jam_with_ai(
                frame, traffic_result.get("metadata", {})
            )

            if ai_verification["is_jam"]:
                ai_status = ai_verification.get("status", "unavailable")
                traffic_result["metadata"]["verified_by_ai"] = ai_status == "ok"
                traffic_result["metadata"]["ai_provider"] = AI_PROVIDER
                traffic_result["metadata"]["ai_model"] = AI_MODEL
                traffic_result["metadata"]["ai_status"] = ai_status
                traffic_result["metadata"]["ai_confidence"] = ai_verification["confidence"]
                traffic_result["metadata"]["ai_reason"] = ai_verification["reason"]
                if ai_verification.get("road_occupancy") is not None:
                    traffic_result["metadata"]["ai_road_occupancy"] = ai_verification["road_occupancy"]

                if ai_status == "ok":
                    # Combine confidence: 60% temporal + 40% AI
                    temporal_conf = traffic_result["confidence"]
                    ai_conf = ai_verification["confidence"]
                    combined_conf = temporal_conf * 0.6 + ai_conf * 0.4
                    traffic_result["confidence"] = round(max(combined_conf, 0.65), 3)
                else:
                    traffic_result["metadata"]["fallback_reason"] = "ai_unavailable"

                detections.append(traffic_result)
            else:
                log.info(
                    "AI provider rejected the traffic jam (reason: %s). "
                    "Downgrading to moderate volume.",
                    ai_verification["reason"],
                )
                traffic_result["event_type"] = "traffic_volume"
                traffic_result["severity"] = "moderate"
                traffic_result["metadata"]["ai_rejected"] = True
                traffic_result["metadata"]["ai_provider"] = AI_PROVIDER
                traffic_result["metadata"]["ai_model"] = AI_MODEL
                traffic_result["metadata"]["ai_reason"] = ai_verification["reason"]
                detections.append(traffic_result)
        else:
            detections.append(traffic_result)
    else:
        # 2b. YOLO không khả dụng → gửi ảnh cho AI phân tích lưu lượng
        ai_traffic = analyze_traffic_with_ai(frame, camera_id)
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
                "yolo_requested_weights": YOLO_WEIGHTS,
                "yolo_loaded_weights": model_name,
                "yolo_fallback_weights": YOLO_FALLBACK_WEIGHTS,
                "yolo_conf": YOLO_CONF,
                "yolo_slice_conf": YOLO_SLICE_CONF,
                "yolo_iou": YOLO_IOU,
                "yolo_imgsz": YOLO_IMG_SIZE,
                "yolo_sliced": YOLO_ENABLE_SLICES,
                "fire_yolo_enabled": ENABLE_FIRE_YOLO,
                "fire_yolo_requested_weights": FIRE_YOLO_WEIGHTS,
                "fire_yolo_loaded_weights": fire_model_name,
                "fire_yolo_conf": FIRE_YOLO_CONF,
                "fire_yolo_iou": FIRE_YOLO_IOU,
                "fire_yolo_imgsz": FIRE_YOLO_IMG_SIZE,
                "fire_yolo_min_box_area_ratio": FIRE_YOLO_MIN_BOX_AREA_RATIO,
                "fire_require_ai_verification": FIRE_REQUIRE_AI_VERIFICATION,
                "fire_allow_local_fallback": FIRE_ALLOW_LOCAL_FALLBACK,
                "flood_require_ai_verification": FLOOD_REQUIRE_AI_VERIFICATION,
                "flood_allow_local_fallback": FLOOD_ALLOW_LOCAL_FALLBACK,
                "fire_yolo_classes": sorted(FIRE_YOLO_CLASSES),
                "ai_provider": AI_PROVIDER,
                "ai_endpoint": AI_ENDPOINT,
                "ai_requested_model": REQUESTED_AI_MODEL,
                "ai_model": AI_MODEL,
                "ai_model_fallback_reason": AI_MODEL_FALLBACK_REASON,
                "ai_enabled": AI_ENABLED,
                "ai_rate_limit_per_min": AI_RATE_LIMIT_PER_MIN,
                "ai_fire_min_confidence": AI_FIRE_MIN_CONFIDENCE,
                "ai_flood_min_confidence": AI_FLOOD_MIN_CONFIDENCE,
                "ai_backoff_seconds": max(0, round(ai_backoff_until - time.time())),
                "groq_enabled": AI_ENABLED if AI_PROVIDER == "groq" else False,
                "groq_backoff_seconds": max(0, round(ai_backoff_until - time.time())),
                "opencv_incident_fallback": OPENCV_INCIDENT_FALLBACK,
                "opencv_fire_safety_net": OPENCV_FIRE_SAFETY_NET,
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
            is_demo = bool(payload.get("metadata", {}).get("demo"))
            diagnostics: Optional[List[Dict[str, Any]]] = [] if is_demo else None
            detections = detect(frame, camera_id, diagnostics=diagnostics)
            log.info("%s -> %d detections", camera_id, len(detections))
            response_payload: Dict[str, Any] = {"detections": detections}
            if diagnostics is not None:
                response_payload["diagnostics"] = diagnostics
            self._send_json(200, response_payload)
        except Exception as exc:
            log.exception("detect failed")
            self._send_json(400, {"error": str(exc)})

    def log_message(self, _format, *_args):
        return


def main():
    load_yolo()
    load_fire_yolo()
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
