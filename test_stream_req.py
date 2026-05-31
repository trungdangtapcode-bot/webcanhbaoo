import requests
import json

with open("backend/hanoi_cameras.json", "r", encoding="utf-8") as f:
    data = json.load(f)

cam = next((c for c in data.get("data", []) if c.get("availability") == 1), None)
if cam:
    https_stream = next((s["source"] for s in cam["profile"][0]["streams"] if s["protocol"] == "HTTPS"), None)
    if https_stream:
        print(f"Testing HTTPS stream: {https_stream}.m3u8")
        headers = {
            "User-Agent": "Dart/3.3 (dart:io)",
            "Referer": "https://cds.hanoi.gov.vn/",
        }
        res = requests.get(https_stream + ".m3u8", headers=headers)
        print(f"Status: {res.status_code}")
        print(res.text[:200])
