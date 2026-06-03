"""
Hanoi WSS camera proxy.

Hanoi cameras expose private WSS streams carrying HEVC/H.265 NAL units. Browsers
and the Node scanner cannot consume that directly, so this service keeps a
shared decoder per camera and exposes:

- /hanoi_feed/<camera_id>     browser-friendly MJPEG stream
- /hanoi_snapshot/<camera_id> latest decoded JPEG frame for AI scanning
- /hanoi_status/<camera_id>   lightweight stream health metadata
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
from typing import Dict, Iterable, Optional, Tuple

import imageio_ffmpeg
import websockets
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

load_dotenv()

HOST = os.getenv("HANOI_PROXY_HOST", "127.0.0.1")
PORT = int(os.getenv("HANOI_PROXY_PORT", "5001"))
FPS = int(os.getenv("HANOI_PROXY_FPS", "10"))
JPEG_QUALITY = int(os.getenv("HANOI_PROXY_JPEG_QUALITY", "4"))
HEADER_BYTES = int(os.getenv("HANOI_WSS_HEADER_BYTES", "12"))
IDLE_SECONDS = int(os.getenv("HANOI_PROXY_IDLE_SECONDS", "75"))
SNAPSHOT_TIMEOUT = float(os.getenv("HANOI_PROXY_SNAPSHOT_TIMEOUT", "12"))
STALE_SECONDS = float(os.getenv("HANOI_PROXY_STALE_SECONDS", "20"))
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


async def write_hevc_to_ffmpeg(wss_url: str, stdin, stop_event: threading.Event):
    headers = {
        "User-Agent": "Dart/3.3 (dart:io)",
        "Origin": "https://cds.hanoi.gov.vn",
    }

    while not stop_event.is_set():
        if getattr(stdin, "closed", False):
            break
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
                    if getattr(stdin, "closed", False):
                        return
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

                    stdin.write(b"\x00\x00\x00\x01" + message[HEADER_BYTES:])
                    stdin.flush()
        except Exception as exc:
            if stop_event.is_set() or getattr(stdin, "closed", False):
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


class CameraStream:
    def __init__(self, camera_key: str, wss_url: str):
        self.camera_key = camera_key
        self.wss_url = wss_url
        self.condition = threading.Condition()
        self.latest_frame = PLACEHOLDER_JPEG
        self.latest_at = 0.0
        self.sequence = 0
        self.clients = 0
        self.last_access = time.time()
        self.status = "idle"
        self.error: Optional[str] = None
        self.thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        self.decoder_started_at = 0.0

    def ensure_started(self):
        with self.condition:
            self.last_access = time.time()
            if self.thread and self.thread.is_alive():
                return
            self.stop_event = threading.Event()
            self.thread = threading.Thread(target=self._run, daemon=True)
            self.thread.start()

    def add_client(self):
        with self.condition:
            self.clients += 1
            self.last_access = time.time()
        self.ensure_started()

    def remove_client(self):
        with self.condition:
            self.clients = max(0, self.clients - 1)
            self.last_access = time.time()

    def _set_frame(self, frame: bytes):
        with self.condition:
            self.latest_frame = frame
            self.latest_at = time.time()
            self.sequence += 1
            self.status = "live"
            self.error = None
            self.condition.notify_all()

    def _set_status(self, status: str, error: Optional[str] = None):
        with self.condition:
            self.status = status
            self.error = error
            self.condition.notify_all()

    def _is_idle(self) -> bool:
        with self.condition:
            return self.clients == 0 and time.time() - self.last_access > IDLE_SECONDS

    def _run(self):
        log.info("Starting shared decoder for %s", self.camera_key)
        while not self.stop_event.is_set():
            if self._is_idle():
                break

            process = None
            writer_stop = threading.Event()
            try:
                self._set_status("connecting")
                with self.condition:
                    self.decoder_started_at = time.time()
                process = start_ffmpeg()
                start_writer_thread(self.wss_url, process.stdin, writer_stop)
                self._start_idle_watchdog(process)
                self._set_status("decoding")

                for frame in iter_jpegs(process.stdout):
                    self._set_frame(frame)
                    if self._is_idle():
                        break
            except Exception as exc:
                self._set_status("error", str(exc))
                log.warning("Decoder error for %s: %s", self.camera_key, exc)
            finally:
                writer_stop.set()
                if process:
                    try:
                        process.terminate()
                        process.wait(timeout=2)
                    except Exception:
                        process.kill()

            if self.stop_event.is_set() or self._is_idle():
                break
            time.sleep(1)

        self._set_status("idle")
        log.info("Stopped shared decoder for %s", self.camera_key)

    def _start_idle_watchdog(self, process: subprocess.Popen):
        def watchdog():
            while not self.stop_event.is_set() and process.poll() is None:
                if self._is_idle():
                    log.info("Stopping idle decoder for %s", self.camera_key)
                    try:
                        process.terminate()
                    except Exception:
                        pass
                    break
                with self.condition:
                    clients = self.clients
                    latest_at = self.latest_at
                    age = time.time() - latest_at if latest_at else None
                    cycle_age = time.time() - self.decoder_started_at if self.decoder_started_at else 0
                    waiting_age = time.time() - self.last_access
                    status = self.status

                is_stale_live = (
                    clients > 0 and
                    latest_at > 0 and
                    age and age > STALE_SECONDS and
                    cycle_age > STALE_SECONDS
                )
                is_stale_startup = (
                    clients > 0 and
                    latest_at <= 0 and
                    status in {"connecting", "decoding"} and
                    waiting_age > max(SNAPSHOT_TIMEOUT, STALE_SECONDS)
                )
                if is_stale_live or is_stale_startup:
                    log.info("Restarting stale decoder for %s", self.camera_key)
                    try:
                        process.terminate()
                    except Exception:
                        pass
                    break
                time.sleep(2)

        threading.Thread(target=watchdog, daemon=True).start()

    def wait_for_frame(self, last_sequence: int, timeout: float = 10) -> Tuple[bytes, int]:
        with self.condition:
            if self.sequence == last_sequence:
                self.condition.wait(timeout=timeout)
            return self.latest_frame, self.sequence

    def wait_for_snapshot(self, timeout: float) -> Optional[bytes]:
        self.ensure_started()
        deadline = time.time() + timeout
        with self.condition:
            while self.latest_at <= 0 and time.time() < deadline:
                self.condition.wait(timeout=max(0.1, deadline - time.time()))
            return self.latest_frame if self.latest_at > 0 else None

    def public_status(self) -> dict:
        with self.condition:
            return {
                "camera_id": self.camera_key,
                "clients": self.clients,
                "error": self.error,
                "last_frame_at": self.latest_at,
                "latest_age_ms": int((time.time() - self.latest_at) * 1000) if self.latest_at else None,
                "sequence": self.sequence,
                "status": self.status,
                "thread_alive": bool(self.thread and self.thread.is_alive()),
            }


streams: Dict[str, CameraStream] = {}
streams_lock = threading.Lock()


def get_stream(camera_key: str) -> Optional[CameraStream]:
    wss_url = get_wss_url(camera_key)
    if not wss_url:
        return None
    normalized_key = camera_key if camera_key.startswith("HANOI_") else f"HANOI_{camera_key}"
    with streams_lock:
        stream = streams.get(normalized_key)
        if not stream:
            stream = CameraStream(normalized_key, wss_url)
            streams[normalized_key] = stream
        return stream


def mjpeg_stream(camera_key: str):
    stream = get_stream(camera_key)
    if not stream:
        yield b""
        return

    stream.add_client()
    sequence = -1
    try:
        yield make_mjpeg_part(PLACEHOLDER_JPEG)
        while True:
            frame, sequence = stream.wait_for_frame(sequence, timeout=10)
            yield make_mjpeg_part(frame)
    finally:
        stream.remove_client()


@app.get("/health")
def health():
    with streams_lock:
        active_streams = [stream.public_status() for stream in streams.values()]
    return jsonify({
        "ok": True,
        "active_streams": active_streams,
        "cameras": len(load_camera_index()),
        "ffmpeg": imageio_ffmpeg.get_ffmpeg_exe(),
        "fps": FPS,
        "idle_seconds": IDLE_SECONDS,
        "jpeg_quality": JPEG_QUALITY,
        "snapshot_timeout": SNAPSHOT_TIMEOUT,
        "stale_seconds": STALE_SECONDS,
    })


@app.get("/hanoi_status/<camera_key>")
def hanoi_status(camera_key: str):
    stream = get_stream(camera_key)
    if not stream:
        return jsonify({"error": "Hanoi camera not found or WSS URL missing"}), 404
    return jsonify(stream.public_status())


@app.get("/hanoi_snapshot/<camera_key>")
def hanoi_snapshot(camera_key: str):
    stream = get_stream(camera_key)
    if not stream:
        return jsonify({"error": "Hanoi camera not found or WSS URL missing"}), 404

    timeout = float(request.args.get("timeout", SNAPSHOT_TIMEOUT))
    frame = stream.wait_for_snapshot(max(0.1, min(timeout, 30)))
    if not frame:
        return jsonify({"error": "No decoded frame available yet"}), 503
    return Response(frame, mimetype="image/jpeg")


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
