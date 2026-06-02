"""
Quick test: Run the configured YOLO model on a single image and show detection results.

Usage:
  python test_detect.py                     # Capture 1 frame from YouTube stream in .env
  python test_detect.py path/to/image.jpg   # Use your own image
"""

import sys
import os
import cv2
import numpy as np
from dotenv import load_dotenv

load_dotenv()

# COCO vehicle classes
VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

# Colors for drawing (BGR)
COLORS = {
    "car": (0, 255, 0),         # Green
    "motorcycle": (0, 255, 255), # Yellow
    "bus": (255, 165, 0),        # Orange
    "truck": (0, 0, 255),        # Red
    "person": (255, 0, 255),     # Magenta
    "traffic light": (0, 200, 255),
    "default": (255, 255, 255),  # White
}


def is_youtube_url(url: str) -> bool:
    return any(d in url for d in ["youtube.com", "youtu.be"])


def resolve_youtube(url: str) -> str:
    """Use yt-dlp to get direct stream URL from YouTube."""
    import yt_dlp
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        return info.get("url")


def capture_frame_from_stream(source_url: str):
    """Capture a single frame from a video stream."""
    print(f"[INFO] Capturing frame from stream...")

    if is_youtube_url(source_url):
        print("[INFO] Detected YouTube URL — resolving with yt-dlp...")
        source_url = resolve_youtube(source_url)
        print("[INFO] YouTube stream resolved!")

    cap = cv2.VideoCapture(source_url)
    if not cap.isOpened():
        print("[ERROR] Cannot open stream")
        return None

    # Read a few frames to get a stable one
    frame = None
    for _ in range(5):
        ret, frame = cap.read()
    cap.release()

    if frame is not None:
        save_path = "captured_frame.jpg"
        cv2.imwrite(save_path, frame)
        print(f"[INFO] Frame captured and saved to: {save_path}")
    return frame


def main():
    # ─── Get image ───
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
        if not os.path.exists(image_path):
            print(f"[ERROR] Image not found: {image_path}")
            sys.exit(1)
        frame = cv2.imread(image_path)
        print(f"[INFO] Image loaded: {image_path} ({frame.shape[1]}x{frame.shape[0]})")
    else:
        # Capture from YouTube stream in .env
        source = os.getenv("RTSP_URL", "")
        if not source:
            print("[ERROR] No RTSP_URL in .env and no image provided")
            print("Usage: python test_detect.py [image_path]")
            sys.exit(1)
        frame = capture_frame_from_stream(source)
        if frame is None:
            print("[ERROR] Failed to capture frame")
            sys.exit(1)

    # ─── Load YOLOv8 ───
    # YOLOv8 model sizes: n(nano) < s(small) < m(medium) < l(large) < x(xlarge)
    # Larger = more accurate but slower
    MODEL_NAME = os.getenv("DETECTOR_YOLO_WEIGHTS", "yolo26x.pt")
    try:
        from ultralytics import YOLO
        model = YOLO(MODEL_NAME)
        print(f"[INFO] {MODEL_NAME} model loaded")
    except ImportError:
        print("[ERROR] ultralytics not installed. Run: pip install ultralytics")
        sys.exit(1)

    # ─── Run detection ───
    CONF_THRESHOLD = 0.25  # Lower threshold to catch more vehicles
    print(f"[INFO] Running detection (conf >= {CONF_THRESHOLD:.0%})...")

    # ─── Detect on full image ───
    results = model(frame, verbose=False, conf=CONF_THRESHOLD)

    # ─── Also detect on image slices for small/distant vehicles ───
    h, w = frame.shape[:2]
    slice_detections_raw = []
    slices = [
        frame[0:h//2, 0:w//2],         # top-left
        frame[0:h//2, w//2:w],          # top-right
        frame[0:h//2, w//4:3*w//4],     # top-center
    ]
    slice_offsets = [
        (0, 0),
        (w//2, 0),
        (w//4, 0),
    ]
    print(f"[INFO] Running detection on {len(slices)} image slices for small objects...")
    for sl, (ox, oy) in zip(slices, slice_offsets):
        sl_results = model(sl, verbose=False, conf=CONF_THRESHOLD)
        for r in sl_results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                slice_detections_raw.append((cls_id, conf, x1 + ox, y1 + oy, x2 + ox, y2 + oy))

    # ─── Process results ───
    vehicle_count = 0
    person_count = 0
    all_detections = []
    seen_boxes = []  # to avoid duplicates between full + sliced

    def is_duplicate(bx, existing, iou_thresh=0.4):
        """Check if a box overlaps significantly with any existing box."""
        x1, y1, x2, y2 = bx
        for ex1, ey1, ex2, ey2 in existing:
            # Calculate IoU
            ix1, iy1 = max(x1, ex1), max(y1, ey1)
            ix2, iy2 = min(x2, ex2), min(y2, ey2)
            inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
            area1 = (x2 - x1) * (y2 - y1)
            area2 = (ex2 - ex1) * (ey2 - ey1)
            union = area1 + area2 - inter
            if union > 0 and inter / union > iou_thresh:
                return True
        return False

    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
            cls_name = model.names[cls_id]

            all_detections.append({
                "class": cls_name,
                "confidence": conf,
                "bbox": (x1, y1, x2, y2),
            })
            seen_boxes.append((x1, y1, x2, y2))

            if cls_id in VEHICLE_CLASSES:
                vehicle_count += 1
            if cls_id == 0:
                person_count += 1

    # ─── Merge slice detections (skip duplicates) ───
    slice_added = 0
    for cls_id, conf, x1, y1, x2, y2 in slice_detections_raw:
        box_tuple = (int(x1), int(y1), int(x2), int(y2))
        if is_duplicate(box_tuple, seen_boxes):
            continue
        cls_name = model.names[cls_id]
        all_detections.append({
            "class": cls_name,
            "confidence": conf,
            "bbox": box_tuple,
        })
        seen_boxes.append(box_tuple)
        slice_added += 1

        if cls_id in VEHICLE_CLASSES:
            vehicle_count += 1
        if cls_id == 0:
            person_count += 1

    print(f"[INFO] Slice detection added {slice_added} new objects")

    # ─── Draw all bounding boxes ───
    for det in all_detections:
        cls_name = det["class"]
        conf = det["confidence"]
        x1, y1, x2, y2 = det["bbox"]
        color = COLORS.get(cls_name, COLORS["default"])
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        label = f"{cls_name} {conf:.0%}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(frame, (x1, y1 - th - 10), (x1 + tw + 4, y1), color, -1)
        cv2.putText(frame, label, (x1 + 2, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

    # ─── Print summary ───
    print("=" * 55)
    print(f"  {MODEL_NAME} DETECTION RESULTS")
    print("=" * 55)
    print(f"  Total objects : {len(all_detections)}")
    print(f"  Vehicles      : {vehicle_count}  (car, motorcycle, bus, truck)")
    print(f"  People        : {person_count}")
    print("-" * 55)

    if all_detections:
        for i, det in enumerate(all_detections, 1):
            icon = "🚗" if det["class"] in VEHICLE_CLASSES else "👤" if det["class"] == "person" else "📦"
            print(f"  {i:2d}. {icon} {det['class']:15s} conf: {det['confidence']:.0%}  bbox: {det['bbox']}")
    else:
        print("  (No objects detected)")

    print("=" * 55)

    # ─── Save result ───
    output_path = "test_result.jpg"
    cv2.imwrite(output_path, frame)
    print(f"\n[OK] Result image saved to: {output_path}")
    print("[TIP] Open test_result.jpg to see bounding boxes!\n")

    # ─── Try to show (if GUI available) ───
    try:
        cv2.imshow("YOLOv8 Detection Result - Press any key to close", frame)
        print("[INFO] Press any key to close the window...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    except Exception:
        pass


if __name__ == "__main__":
    main()
