"""
Hanoi WSS camera proxy.

The Hanoi video wall exposes realtime cameras as a private WSS stream carrying
HEVC/H.265 NAL units. Browsers cannot display that directly, so this service:

1. Connects to the camera WSS URL.
2. Sends the heartbeat that starts media packets.
3. Strips the 12-byte VMS packet header and rebuilds Annex-B HEVC.
4. Pipes HEVC to ffmpeg and returns browser-friendly MJPEG.

Run:
  python ai_module/hanoi_wss_proxy.py

Then open:
  http://localhost:5001/hanoi_feed/HANOI_92758
"""

import asyncio
import base64
import json
import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Dict, Iterable, Optional

import imageio_ffmpeg
import websockets
from flask import Flask, Response, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

HOST = os.getenv("HANOI_PROXY_HOST", "127.0.0.1")
PORT = int(os.getenv("HANOI_PROXY_PORT", "5001"))
FPS = int(os.getenv("HANOI_PROXY_FPS", "10"))
JPEG_QUALITY = int(os.getenv("HANOI_PROXY_JPEG_QUALITY", "4"))
HEADER_BYTES = int(os.getenv("HANOI_WSS_HEADER_BYTES", "12"))
CAMERA_CACHE = Path(os.getenv(
    "HANOI_CAMERA_CACHE_FILE",
    Path(__file__).resolve().parents[1] / "backend" / "hanoi_cameras.json",
))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [HANOI_PROXY] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

PLACEHOLDER_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////"
    "////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////"
    "////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ar//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/ISf/2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z"
)


def make_mjpeg_part(frame: bytes) -> bytes:
    return (
        b"--frame\r\n"
        b"Content-Type: image/jpeg\r\n"
        + f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii")
        + frame
        + b"\r\n"
    )


def load_camera_index() -> Dict[str, dict]:
    data = json.loads(CAMERA_CACHE.read_text(encoding="utf-8"))
    rows = data.get("data", [])
    index: Dict[str, dict] = {}
    for row in rows:
        camera_id = f"HANOI_{row.get('id')}"
        external_id = str(row.get("id") or "")
        raw_camera_id = str(row.get("camera_id") or "")
        for key in {camera_id, external_id, raw_camera_id}:
            if key:
                index[key] = row
    return index


def get_wss_url(camera_key: str) -> Optional[str]:
    row = load_camera_index().get(str(camera_key))
    if not row:
        return None
    profiles = row.get("profile") or []
    streams = (profiles[0].get("streams") if profiles else []) or []
    for stream in streams:
        if stream.get("protocol") == "WSS" and stream.get("source"):
            return stream["source"]
    return None


async def write_hevc_to_ffmpeg(wss_url: str, stdin, stop_event: threading.Event):
    headers = {
        "User-Agent": "Dart/3.3 (dart:io)",
        "Origin": "https://cds.hanoi.gov.vn",
    }

    while not stop_event.is_set():
        try:
            async with websockets.connect(
                wss_url,
                additional_headers=headers,
                ping_interval=None,
                open_timeout=10,
                max_size=None,
            ) as ws:
                log.info("Connected WSS camera stream")
                await ws.send("PING")
                last_keepalive = time.time()

                while not stop_event.is_set():
                    if time.time() - last_keepalive > 15:
                        await ws.send("PING")
                        last_keepalive = time.time()

                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=3)
                    except asyncio.TimeoutError:
                        continue

                    if isinstance(message, str):
                        if message == "PING":
                            await ws.send("PONG")
                        continue

                    if not isinstance(message, bytes) or len(message) <= HEADER_BYTES:
                        continue

                    nal = message[HEADER_BYTES:]
                    stdin.write(b"\x00\x00\x00\x01" + nal)
                    stdin.flush()
        except Exception as exc:
            if stop_event.is_set():
                break
            log.warning("WSS stream interrupted, reconnecting: %s", exc)
            await asyncio.sleep(1)


def start_writer_thread(wss_url: str, stdin, stop_event: threading.Event) -> threading.Thread:
    def runner():
        try:
            asyncio.run(write_hevc_to_ffmpeg(wss_url, stdin, stop_event))
        except Exception as exc:
            log.warning("Writer stopped: %s", exc)
        finally:
            try:
                stdin.close()
            except Exception:
                pass

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    return thread


def start_ffmpeg() -> subprocess.Popen:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-fflags",
        "nobuffer",
        "-flags",
        "low_delay",
        "-f",
        "hevc",
        "-i",
        "pipe:0",
        "-vf",
        f"fps={FPS}",
        "-q:v",
        str(JPEG_QUALITY),
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]
    return subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )


def iter_jpegs(stdout) -> Iterable[bytes]:
    buffer = bytearray()
    while True:
        chunk = stdout.read(4096)
        if not chunk:
            break
        buffer.extend(chunk)

        while True:
            start = buffer.find(b"\xff\xd8")
            end = buffer.find(b"\xff\xd9", start + 2 if start >= 0 else 0)
            if start < 0:
                buffer.clear()
                break
            if end < 0:
                if start > 0:
                    del buffer[:start]
                break
            frame = bytes(buffer[start:end + 2])
            del buffer[:end + 2]
            yield frame


def mjpeg_stream(camera_key: str):
    wss_url = get_wss_url(camera_key)
    if not wss_url:
        yield b""
        return

    yield make_mjpeg_part(PLACEHOLDER_JPEG)

    stop_event = threading.Event()
    process = start_ffmpeg()
    start_writer_thread(wss_url, process.stdin, stop_event)

    try:
        for frame in iter_jpegs(process.stdout):
            yield make_mjpeg_part(frame)
    finally:
        stop_event.set()
        try:
            process.terminate()
            process.wait(timeout=2)
        except Exception:
            process.kill()


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "cameras": len(load_camera_index()),
        "ffmpeg": imageio_ffmpeg.get_ffmpeg_exe(),
        "fps": FPS,
        "jpeg_quality": JPEG_QUALITY,
    })


@app.get("/hanoi_feed/<camera_key>")
def hanoi_feed(camera_key: str):
    if not get_wss_url(camera_key):
        return jsonify({"error": "Hanoi camera not found or WSS URL missing"}), 404
    return Response(
        mjpeg_stream(camera_key),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, threaded=True)
