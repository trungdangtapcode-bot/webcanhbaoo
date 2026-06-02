"""
Flood Detection Module
Dual HSV threshold: muddy brown (H 5-35) + grey-blue urban water (H 90-130).
Bottom-half ROI analysis to exclude sky/signage.
water_ratio > 0.15 triggers WATCH, > 0.30 triggers ALERT.
Only sends events on state change or when in WATCH/ALERT state.
Dynamic polling: 300s (normal) → 30s (watch) → 10s (alert).
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
JPEG_QUALITY = 70
RESIZE_DIM = (640, 640)

# ── Dual HSV ranges ──────────────────────────────────────────────────────────
# Range 1: muddy/brown flood water
MUDDY_LOWER = np.array([5,  30,  30])
MUDDY_UPPER = np.array([35, 200, 180])
# Range 2: grey-blue stagnant water on urban roads / after rain
GREY_LOWER  = np.array([90,  15,  30])
GREY_UPPER  = np.array([130, 150, 180])

# Minimum connected-component area (px²) to filter out noise
MIN_BLOB_AREA = int(os.getenv("FLOOD_MIN_BLOB_AREA", "2500"))

# Dynamic polling intervals (seconds)
POLL_NORMAL = 300   # 5 minutes
POLL_WATCH  = 30    # 30 seconds
POLL_ALERT  = 10    # 10 seconds

# Thresholds
WATCH_THRESHOLD = float(os.getenv("FLOOD_WATCH_RATIO", "0.22"))
ALERT_THRESHOLD = float(os.getenv("FLOOD_ALERT_RATIO", "0.38"))
ROI_START_RATIO = float(os.getenv("FLOOD_ROI_START_RATIO", "0.45"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [FLOOD] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


def encode_frame(frame: np.ndarray) -> str:
    """Resize, JPEG-encode, and base64-encode a frame."""
    resized = cv2.resize(frame, RESIZE_DIM)
    _, buffer = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return base64.b64encode(buffer).decode("utf-8")


def has_significant_motion(prev_gray, curr_gray, threshold=2000):
    """Background subtraction: skip static frames."""
    if prev_gray is None:
        return True
    diff = cv2.absdiff(prev_gray, curr_gray)
    _, thresh = cv2.threshold(diff, 20, 255, cv2.THRESH_BINARY)
    motion_pixels = cv2.countNonZero(thresh)
    return motion_pixels > threshold


def is_youtube_url(url: str) -> bool:
    """Check if a URL is a YouTube link."""
    return any(domain in url for domain in ["youtube.com", "youtu.be", "youtube.com/live"])


def resolve_stream_url(url: str) -> str:
    """
    If the URL is a YouTube link, use yt-dlp to extract a direct stream URL.
    Otherwise, return the URL as-is.
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


def compute_water_ratio(frame: np.ndarray) -> float:
    """
    Compute ratio of water-coloured pixels using dual-range HSV thresholding.
    Only analyses the bottom 2/3 of the frame to exclude sky and signage.
    Applies connected-component area filter to remove noise specks.
    """
    h, w = frame.shape[:2]
    roi_start = int(h * ROI_START_RATIO)
    frame_roi = frame[roi_start:, :]

    hsv = cv2.cvtColor(frame_roi, cv2.COLOR_BGR2HSV)

    mask = (
        cv2.inRange(hsv, MUDDY_LOWER, MUDDY_UPPER)
        | cv2.inRange(hsv, GREY_LOWER, GREY_UPPER)
    )

    # Morphological cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    # Remove small blobs (noise, reflections on dry surfaces)
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    filtered = np.zeros_like(mask)
    for i in range(1, n_labels):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_BLOB_AREA:
            filtered[labels == i] = 255

    roi_area = frame_roi.shape[0] * w
    water_pixels = float(cv2.countNonZero(filtered))
    return water_pixels / float(roi_area) if roi_area > 0 else 0.0


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


def get_poll_interval(ratio: float) -> int:
    """Dynamic polling based on current water ratio."""
    if ratio >= ALERT_THRESHOLD:
        return POLL_ALERT
    elif ratio >= WATCH_THRESHOLD:
        return POLL_WATCH
    else:
        return POLL_NORMAL


def main():
    log.info(f"Starting flood detection module for {CAMERA_ID}")
    log.info(f"RTSP: {RTSP_URL}")
    log.info(f"Muddy HSV: {MUDDY_LOWER} → {MUDDY_UPPER}")
    log.info(f"Grey HSV:  {GREY_LOWER} → {GREY_UPPER}")
    log.info(f"Thresholds: WATCH={WATCH_THRESHOLD}, ALERT={ALERT_THRESHOLD}")

    # ─── Resolve video source ───
    stream_url = resolve_stream_url(RTSP_URL)
    log.info(f"Resolved stream: {stream_url[:80]}...")

    cap = cv2.VideoCapture(stream_url)
    if not cap.isOpened():
        log.error(f"Cannot open video stream: {stream_url[:80]}")
        sys.exit(1)

    prev_gray = None
    current_state = "NORMAL"

    while True:
        ret, frame = cap.read()
        if not ret:
            log.warning("Frame read failed — reconnecting in 5s")
            cap.release()
            time.sleep(5)
            stream_url = resolve_stream_url(RTSP_URL)  # Re-resolve in case it expired
            cap = cv2.VideoCapture(stream_url)
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        if not has_significant_motion(prev_gray, gray):
            prev_gray = gray
            # In WATCH/ALERT state, keep polling even without motion
            poll = get_poll_interval(0) if current_state == "NORMAL" else get_poll_interval(WATCH_THRESHOLD)
            time.sleep(poll)
            continue

        prev_gray = gray

        # ─── Compute water ratio (bottom-2/3 ROI, dual HSV) ───
        ratio = compute_water_ratio(frame)

        # Determine state
        if ratio >= ALERT_THRESHOLD:
            new_state = "ALERT"
        elif ratio >= WATCH_THRESHOLD:
            new_state = "WATCH"
        else:
            new_state = "NORMAL"

        log.info(f"Water ratio: {ratio:.4f} | State: {current_state} → {new_state}")

        # ─── Only send event when state changes OR when active (WATCH/ALERT) ───
        was_alert = current_state == "ALERT"
        is_alert = new_state == "ALERT"
        should_send = is_alert or (was_alert and not is_alert)

        if should_send:
            event = {
                "camera_id": CAMERA_ID,
                "event_type": "flood",
                "confidence": round(min(ratio * 2.5, 1.0), 3),
                "severity": "high" if is_alert else "low",
                "water_ratio": round(ratio, 4),
                "image_base64": encode_frame(frame),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                # Include active=False signal when going back to NORMAL
                **({"active": False, "resolved": True} if was_alert and not is_alert else {}),
            }
            send_event(event)

        current_state = new_state
        poll = get_poll_interval(ratio)
        log.info(f"Next poll in {poll}s")
        time.sleep(poll)

    cap.release()


if __name__ == "__main__":
    main()
