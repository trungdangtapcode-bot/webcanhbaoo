import cv2
import numpy as np
import urllib.request
import yt_dlp
import os

# HSV range for muddy/brown flood water
HSV_LOWER = np.array([5, 30, 30])
HSV_UPPER = np.array([35, 200, 180])

def resolve_youtube(url: str) -> str:
    """Use yt-dlp to get direct stream URL from YouTube."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        return info.get("url")

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
    url = "https://www.youtube.com/watch?v=qZcvusYiWWg"
    print(f"[INFO] Resolving YouTube URL: {url}")
    stream_url = resolve_youtube(url)
    
    if not stream_url:
        print("[ERROR] Failed to resolve stream URL.")
        return

    print("[INFO] Opening video stream...")
    cap = cv2.VideoCapture(stream_url)
    
    if not cap.isOpened():
        print("[ERROR] Failed to open stream.")
        return

    # Read a few frames to make sure we get a good one
    frame = None
    for i in range(30):
        ret, frame = cap.read()
        if not ret:
            break

    cap.release()

    if frame is None:
        print("[ERROR] Failed to read frame.")
        return

    print(f"[INFO] Frame captured. Resolution: {frame.shape[1]}x{frame.shape[0]}")

    ratio, mask = compute_water_ratio(frame)
    print(f"[INFO] Computed Water Ratio: {ratio:.4f} ({ratio * 100:.2f}%)")

    # Create a visual representation
    # Color the masked area blue on the original frame
    colored_mask = np.zeros_like(frame)
    colored_mask[mask > 0] = [255, 0, 0] # Blue for water
    
    result_img = cv2.addWeighted(frame, 0.7, colored_mask, 0.3, 0)
    
    # Add text
    text = f"Water Ratio: {ratio:.2%}"
    cv2.putText(result_img, text, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 3)
    
    cv2.imwrite("flood_test_result.jpg", result_img)
    print("[INFO] Saved result to flood_test_result.jpg")

if __name__ == "__main__":
    main()
