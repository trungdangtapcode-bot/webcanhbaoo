"""
Capture frames from a USB camera and send them to detector_api.py.

Usage:
  python test_usb_camera_detector.py
  python test_usb_camera_detector.py --camera 1 --frames 5 --interval 2
  python test_usb_camera_detector.py --save-frame usb_test.jpg
"""

import argparse
import base64
import json
import time
from pathlib import Path

import cv2
import requests
from dotenv import load_dotenv


MODULE_DIR = Path(__file__).resolve().parent
load_dotenv(MODULE_DIR / ".env")


def parse_args():
    parser = argparse.ArgumentParser(description="Test detector API with a USB camera.")
    parser.add_argument("--camera", type=int, default=0, help="USB camera index, usually 0.")
    parser.add_argument("--frames", type=int, default=1, help="Number of frames to submit.")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between frames.")
    parser.add_argument(
        "--detector-url",
        default="http://127.0.0.1:5055/detect",
        help="Detector API URL.",
    )
    parser.add_argument("--camera-id", default="usb_camera_0", help="Camera id sent to detector.")
    parser.add_argument("--save-frame", default="", help="Optional path to save the last frame.")
    parser.add_argument("--warmup", type=int, default=10, help="Frames to skip before testing.")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    return parser.parse_args()


def open_camera(index: int):
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open USB camera index {index}")
    return cap


def encode_jpeg(frame):
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise RuntimeError("Cannot encode frame as JPEG")
    return base64.b64encode(buffer).decode("ascii")


def post_frame(detector_url: str, camera_id: str, image_base64: str, timeout: float):
    payload = {
        "camera": {
            "camera_id": camera_id,
            "name": "USB Camera Test",
            "source": "usb_camera",
        },
        "content_type": "image/jpeg",
        "image_base64": image_base64,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    response = requests.post(detector_url, json=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()


def main():
    args = parse_args()
    health_url = args.detector_url.rsplit("/", 1)[0] + "/health"

    try:
        health = requests.get(health_url, timeout=5).json()
        print("[HEALTH]", json.dumps(health, ensure_ascii=False, indent=2))
    except Exception as exc:
        print(f"[WARN] Cannot read detector health at {health_url}: {exc}")

    cap = open_camera(args.camera)
    try:
        for _ in range(max(args.warmup, 0)):
            cap.read()

        last_frame = None
        for index in range(args.frames):
            ok, frame = cap.read()
            if not ok or frame is None:
                raise RuntimeError("Cannot read frame from USB camera")

            last_frame = frame
            image_base64 = encode_jpeg(frame)
            result = post_frame(args.detector_url, args.camera_id, image_base64, args.timeout)

            print(f"\n[FRAME {index + 1}/{args.frames}]")
            print(json.dumps(result, ensure_ascii=False, indent=2))

            if index + 1 < args.frames:
                time.sleep(max(args.interval, 0))

        if args.save_frame and last_frame is not None:
            cv2.imwrite(args.save_frame, last_frame)
            print(f"\n[INFO] Saved last frame to {args.save_frame}")
    finally:
        cap.release()


if __name__ == "__main__":
    main()
