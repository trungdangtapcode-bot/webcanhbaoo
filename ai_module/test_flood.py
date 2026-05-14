"""
Quick test: Run flood (water) detection on a single image using HSV thresholding.

Usage:
  python test_flood.py                     # Capture 1 frame from default YouTube stream
  python test_flood.py path/to/image.jpg   # Use your own image
"""

import sys
import os
import cv2
import numpy as np
from dotenv import load_dotenv

load_dotenv()

# HSV range for muddy/brown flood water
HSV_LOWER = np.array([5, 30, 30])
HSV_UPPER = np.array([35, 200, 180])

# Thresholds (same as flood_module.py)
WATCH_THRESHOLD = 0.15   # 15% water → WATCH
ALERT_THRESHOLD = 0.30   # 30% water → ALERT


def is_youtube_url(url: str) -> bool:
    return any(domain in url for domain in ["youtube.com", "youtu.be", "youtube.com/live"])


def resolve_youtube(url: str) -> str:
    """Use yt-dlp to get direct stream URL from YouTube."""
    import yt_dlp  # type: ignore
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        return info.get("url") or ""


def capture_frame(source: str):
    """Capture a single frame from an image file, RTSP, or YouTube."""
    if os.path.exists(source):
        print(f"[INFO] Loading local image: {source}")
        frame = cv2.imread(source)
        if frame is None:
            print(f"[ERROR] Failed to load image: {source}")
        return frame

    if is_youtube_url(source):
        print("[INFO] Detected YouTube URL — resolving stream...")
        source = resolve_youtube(source)
        if not source:
            print("[ERROR] Failed to resolve YouTube URL")
            return None

    print("[INFO] Opening video stream...")
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print("[ERROR] Cannot open stream")
        return None

    # Read a few frames to get a stable one
    frame = None
    for _ in range(30):
        ret, frame = cap.read()
        if not ret:
            break
    cap.release()

    return frame


def compute_water_ratio(frame: np.ndarray):
    """Compute ratio of water-colored pixels using HSV thresholding."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, HSV_LOWER, HSV_UPPER)

    # Morphological cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    water_pixels = cv2.countNonZero(mask)
    total_pixels = frame.shape[0] * frame.shape[1]
    ratio = water_pixels / total_pixels

    return ratio, mask


def main():
    print("=" * 55)
    print("  FLOOD DETECTION TESTER")
    print("=" * 55)

    # ─── Get source ───
    if len(sys.argv) > 1:
        source = sys.argv[1]
    else:
        # Default YouTube flood video for testing
        source = "https://www.youtube.com/watch?v=qZcvusYiWWg"
        print("[INFO] No image provided. Using default YouTube flood stream.")
        print("Usage: python test_flood.py [image_path_or_url]")

    frame = capture_frame(source)
    if frame is None:
        print("[ERROR] Failed to get an image to test.")
        sys.exit(1)

    print(f"[INFO] Frame loaded successfully: {frame.shape[1]}x{frame.shape[0]}")

    # ─── Compute water ratio ───
    print("[INFO] Running HSV water detection...")
    ratio, mask = compute_water_ratio(frame)

    # ─── Determine state ───
    if ratio >= ALERT_THRESHOLD:
        state = "🚨 ALERT"
        state_color = (0, 0, 255)   # Red
    elif ratio >= WATCH_THRESHOLD:
        state = "⚠️  WATCH"
        state_color = (0, 165, 255)  # Orange
    else:
        state = "✅ NORMAL"
        state_color = (0, 255, 0)    # Green

    # ─── Create visual result ───
    # Overlay water mask in blue on original frame
    colored_mask = np.zeros_like(frame)
    colored_mask[mask > 0] = [255, 0, 0]  # Blue for water

    result_img = cv2.addWeighted(frame, 0.7, colored_mask, 0.3, 0)

    # Add info text
    text_ratio = f"Water Ratio: {ratio:.2%}"
    text_state = f"State: {state}"
    cv2.putText(result_img, text_ratio, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, state_color, 3)
    cv2.putText(result_img, text_state, (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.2, state_color, 3)

    # ─── Print Summary ───
    print("-" * 55)
    print(f"  Water Ratio : {ratio:.4f} ({ratio:.2%})")
    print(f"  State       : {state}")
    print(f"  Thresholds  : WATCH >= {WATCH_THRESHOLD:.0%}, ALERT >= {ALERT_THRESHOLD:.0%}")
    print("=" * 55)

    # ─── Save & Show Result ───
    output_path = "flood_test_result.jpg"
    cv2.imwrite(output_path, result_img)
    print(f"\n[OK] Result saved to: {output_path}")
    print("[TIP] Open flood_test_result.jpg to see water detection overlay!\n")

    # Try to display
    try:
        cv2.imshow("Flood Test Result - Press any key to close", result_img)
        print("[INFO] Press any key to close the window...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    except Exception:
        pass


if __name__ == "__main__":
    main()