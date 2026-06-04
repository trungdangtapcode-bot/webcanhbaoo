import json

with open("backend/hanoi_cameras.json", "r", encoding="utf-8") as f:
    data = json.load(f)

cameras = data.get("data", [])
for cam in cameras:
    if cam.get("availability") == 1 and cam.get("profile"):
        name = str(cam['name']).encode('ascii', 'ignore').decode()
        print(f"Camera: {name}")
        profile = cam["profile"][0]
        print(f"Profile keys: {profile.keys()}")
        if "streams" in profile:
            for s in profile["streams"]:
                print(f"Stream: {s}")
        break
