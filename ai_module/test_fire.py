import os
import sys
import cv2
import numpy as np
from dotenv import load_dotenv

load_dotenv()

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
        return cv2.imread(source)

    if is_youtube_url(source):
        print("[INFO] Detected YouTube URL — resolving stream...")
        source = resolve_youtube(source)
        if not source:
            print("[ERROR] Failed to resolve YouTube URL")
            return None

    print(f"[INFO] Opening video stream...")
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print("[ERROR] Cannot open stream")
        return None

    # Read a few frames to bypass potential empty buffers
    frame = None
    for _ in range(5):
        ret, frame = cap.read()
    cap.release()

    return frame

def main():
    print("=" * 55)
    print("  FIRE DETECTION TESTER")
    print("=" * 55)

    # ─── Get source ───
    if len(sys.argv) > 1:
        source = sys.argv[1]
    else:
        # Default YouTube fire video for testing if no arguments provided
        source = "https://www.youtube.com/watch?v=Fj7P52T51b4"
        print("[INFO] No image provided. Using default test video.")
        print("Usage: python test_fire.py [image_path_or_url]")

    frame = capture_frame(source)
    if frame is None:
        print("[ERROR] Failed to get an image to test.")
        sys.exit(1)

    print(f"[INFO] Frame loaded successfully: {frame.shape[1]}x{frame.shape[0]}")

    # ─── Load YOLOv8 Model ───
    try:
        from ultralytics import YOLO
    except ImportError:
        print("[ERROR] ultralytics not installed. Run: pip install ultralytics")
        sys.exit(1)

    weights_path = os.getenv("FIRE_WEIGHTS", "yolov8n_fire.pt")
    if not os.path.exists(weights_path):
        print(f"[WARNING] {weights_path} not found. Falling back to default yolov8n.pt")
        print("          (Note: default YOLOv8n doesn't detect fire, only COCO objects)")
        weights_path = "yolov8n.pt"

    model = YOLO(weights_path)
    print(f"[INFO] Model loaded: {weights_path}")

    # ─── Run Inference ───
    CONFIDENCE_THRESHOLD = 0.25  # Lowered a bit for testing
    print(f"[INFO] Running detection (conf >= {CONFIDENCE_THRESHOLD})...")
    
    results = model(frame, verbose=False, conf=CONFIDENCE_THRESHOLD)

    # ─── Process Results ───
    fire_count = 0
    for r in results:
        for box in r.boxes:
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            cls_name = model.names[cls_id]
            
            # Draw bounding box
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
            
            is_fire = "fire" in cls_name.lower()
            color = (0, 0, 255) if is_fire else (0, 255, 0)
            
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            
            label = f"{cls_name} {conf:.0%}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
            cv2.rectangle(frame, (x1, y1 - th - 10), (x1 + tw + 4, y1), color, -1)
            cv2.putText(frame, label, (x1 + 2, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

            if is_fire:
                fire_count += 1
            print(f"  -> Detected: {cls_name} ({conf:.0%}) at {x1, y1, x2, y2}")

    # ─── Print Summary ───
    print("-" * 55)
    if fire_count > 0:
        print(f"🔥 WARNING: Detected {fire_count} object(s)!")
    else:
        print("✅ CLEAR: No fire detected.")
    print("=" * 55)

    # ─── Save & Show Result ───
    output_path = "fire_test_result.jpg"
    cv2.imwrite(output_path, frame)
    print(f"\n[OK] Result saved to: {output_path}")

    # Try to display
    try:
        cv2.imshow("Fire Test Result", frame)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    except Exception:
        pass

if __name__ == "__main__":
    main()
