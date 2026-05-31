import cv2

# A sample camera stream from the API
stream_url = "https://rec03ihanoi.vtscloud.vn:443/playback/view/a22212a31011xyzKX2lpWcY1a.m3u8"

print(f"[INFO] Trying to open camera stream: {stream_url}")

# Note: Sometimes URLs without extensions like .m3u8 might be an HLS stream that opencv can read directly,
# or it might require an HTTP referer/token. Let's try direct first.
cap = cv2.VideoCapture(stream_url)

if not cap.isOpened():
    print("[ERROR] Failed to open stream directly. Might need headers or yt-dlp.")
else:
    # Try reading a frame
    ret, frame = cap.read()
    if ret:
        print(f"[SUCCESS] Successfully read a frame! Resolution: {frame.shape[1]}x{frame.shape[0]}")
        cv2.imwrite("hanoi_cam_test.jpg", frame)
        print("[INFO] Saved frame to hanoi_cam_test.jpg")
    else:
        print("[ERROR] Stream opened, but failed to read any frames.")

cap.release()
