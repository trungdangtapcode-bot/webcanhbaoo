"""
Test script: Send a fake fire alert with AUTO-DETECTED location.
Run: python test_send_alert.py
"""
import requests
import time
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000/api/events")
API_TOKEN = os.getenv("API_TOKEN", "")
print("=" * 60)
print("  TEST: Send Fire Alert to Backend")
print("=" * 60)
print(f"  Backend  : {BACKEND_URL}")
print()

if not API_TOKEN:
    print("[ERROR] API_TOKEN is empty!")
    exit(1)

payload = {
    "camera_id": "USB_CAM_001",
    "event_type": "fire",
    "confidence": 0.92,
    "image_base64": "",
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}

headers = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}

print(f"[SEND] Sending fire event ...")
try:
    resp = requests.post(BACKEND_URL, json=payload, headers=headers, timeout=10)
    print(f"[RECV] Status : {resp.status_code}")
    print(f"[RECV] Body   : {resp.text}")
    if resp.status_code == 201 and resp.json().get("alert_triggered"):
        print("\n[OK] Alert triggered! Check browser at http://localhost:3000")
    elif resp.status_code == 201:
        print("\n[WARN] Event saved but alert NOT triggered")
    else:
        print(f"\n[ERROR] {resp.status_code}: {resp.text}")
except requests.exceptions.ConnectionError:
    print("\n[ERROR] Cannot connect! Is backend running?")
except Exception as e:
    print(f"\n[ERROR] {e}")
