"""
Scan cameras using multiple backends (DSHOW, MSMF, default).
"""
import cv2

print("=" * 50)
print("  Scanning cameras (multi-backend)...")
print("=" * 50)

backends = [
    ("DSHOW", cv2.CAP_DSHOW),
    ("MSMF", cv2.CAP_MSMF),
    ("Default", cv2.CAP_ANY),
]

for bname, bflag in backends:
    print(f"\n--- Backend: {bname} ---")
    found = 0
    for i in range(5):
        cap = cv2.VideoCapture(i, bflag)
        if cap.isOpened():
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            backend_name = cap.getBackendName()
            ret, frame = cap.read()
            status = "OK" if ret else "No frame"
            print(f"  [Index {i}] {w}x{h} backend={backend_name} — {status}")
            found += 1
            cap.release()
        else:
            cap.release()
    if found == 0:
        print("  No cameras found with this backend.")

print("\n" + "=" * 50)
print("If USB camera not showing, make sure it's plugged in")
print("and not being used by another app (like Windows Camera).")
print("=" * 50)
