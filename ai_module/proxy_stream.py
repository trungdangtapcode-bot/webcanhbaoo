from flask import Flask, Response
import cv2
import time
from ultralytics import YOLO
import threading
import subprocess
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # Enable CORS for frontend

print("[INFO] Loading YOLOv8 model for Proxy...")
model = YOLO('yolov8n.pt') # Using nano for real-time proxy speed

# Cache for YouTube stream URLs to avoid re-fetching on every client connection
stream_cache = {}

def get_youtube_stream(url):
    global stream_cache
    if url in stream_cache:
        return stream_cache[url]
        
    print(f"[INFO] Fetching stream URL for {url}")
    try:
        # Use yt-dlp to extract the raw stream URL (worst quality to save CPU for demo)
        result = subprocess.run(
            ['yt-dlp', '-f', 'worst', '-g', url],
            capture_output=True, text=True, check=True
        )
        stream_url = result.stdout.strip()
        stream_cache[url] = stream_url
        return stream_url
    except Exception as e:
        print(f"[ERROR] yt-dlp failed: {e}")
        return None

def generate_frames(camera_id):
    """
    Generator function to yield MJPEG frames.
    """
    # Decide which video to simulate based on camera_id (even/odd)
    is_flood = len(camera_id) % 2 == 0
    youtube_url = "https://www.youtube.com/watch?v=CaxaEGTtCDw" if is_flood else "https://www.youtube.com/watch?v=sTF-6_xinUU"
    
    stream_url = get_youtube_stream(youtube_url)
    if not stream_url:
        return
        
    cap = cv2.VideoCapture(stream_url)
    
    frame_count = 0
    while True:
        success, frame = cap.read()
        if not success:
            print("[INFO] Video ended or stream broken, restarting...")
            cap = cv2.VideoCapture(stream_url) # Loop
            continue
            
        frame_count += 1
        # Process every 2nd frame to save CPU
        if frame_count % 2 == 0:
            # Run YOLO
            results = model(frame, stream=True, verbose=False, conf=0.25)
            for r in results:
                # Plot the bounding boxes on the frame
                frame = r.plot()
                
            # Add proxy overlay text
            cv2.putText(frame, f"AI PROXY | CAM: {camera_id}", (20, 40), 
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            cv2.putText(frame, "LIVE AI PROCESSING", (20, 80), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            
            # Encode frame as JPEG
            ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            frame_bytes = buffer.tobytes()
            
            # Yield in MJPEG format
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                   
        # Small sleep to limit FPS and save CPU
        time.sleep(0.03)

@app.route('/video_feed/<camera_id>')
def video_feed(camera_id):
    """
    Route that serves the MJPEG stream.
    """
    print(f"[PROXY] Client requested stream for {camera_id}")
    return Response(generate_frames(camera_id),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

if __name__ == '__main__':
    print("[INFO] Starting AI Transcoding Proxy on port 5000...")
    app.run(host='0.0.0.0', port=5000, threaded=True)
