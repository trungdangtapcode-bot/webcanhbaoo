import requests
import json

url = "https://cds.hanoi.gov.vn/api/1.0/public/video-wall-cameras-v2?refresh=false&page=1&per_page=1000&id=&address=&name=&userId=42914592"

headers = {
    "accept": "application/json",
    "accept-encoding": "gzip",
    "accept-language": "vi",
    "authorization": "Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MjkxNDU5MiIsImF1ZCI6IjA5Njk4MTQ0MzUiLCJwd2RFeHAiOjE3ODYxNzE5MzkzODIsImV4cCI6MTc4NjE3MTkzOSwiZGV2aWNlSWQiOiI4Y2I5Y2UxODE5NjNjNjg2IiwiaWF0IjoxNzc4Mzk1OTM5fQ.BI8Mv0ECFn8j1gJaAtzSYRyOOplqxsycYT4gMHK19Zr-UzYQxa98lmMiUnFJzOcFwugKdi2O_bkjSBOMuMeDKEgEXJP5AYd_0lv0gKXlCymCDJu-ZE4qNuNrKkGXaOcWgWsINqkc9clq0p3I3tFMah_8DLHhEiY8r7_RmpWL9YTnlEYIYIjhmT4x9YT48Mi9MZaRIKt_TtgzGMbgQ8BKT6vDu9FR05oOviFie7zXGCsl9Ttazfx8yikKXGC_0PAcmFmVTBcUdtumjNyXvGT2_VEjOeMQ0OIjDQDolv2SzqLLoRrMjv-dHKbGsxNBN3HoDmgdJSdrFXX9knvP5e_Tvdn8pPFwnXOX0qlpyC7oXWjjFBvNQUQ464f4GbOmiHlJsJnCnjupfUxBxozRwGI0EqZhD3cP37UUpaMPayK0VRuXh5QnjIvE6W3MFi2GXki6r14IBBpTz4w5OAMVXWaB7VJKB_j9bYN82ZWPvSRjQ329qlxbrHfdx3bnr2iWDiYSU7JmjnqMc1-vQ8n83f2ho_2MpeFWNibyWTrRTiCZqhElbfkE3mSkxcilRq5BKIIR_vBIL9_yBsgH6LT0xjnOrGvH9lTZ49oSoV0Tc7Mw-6UaBKg88rvz4fy297tuDTQxn2cEYdBIzSbN0ajTVd-bOTF2Y5IMgxUILYv2naQJ1c0",
    "content-type": "application/json",
    "deviceid": "8cb9ce181963c686",
    "host": "cds.hanoi.gov.vn",
    "mode": "514",
    "os_type": "Android",
    "placeid": "514",
    "user-agent": "Dart/3.3 (dart:io)",
    "userid": "42914592",
    "x-language": "vi"
}

try:
    print("[INFO] Fetching cameras from Hanoi API...")
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        cameras = data.get("data", [])
        print(f"[SUCCESS] Retrieved {len(cameras)} cameras from API.")
        
        # Save to file so node.js can import it easily!
        with open("../backend/hanoi_cameras.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print("[INFO] Saved data to backend/hanoi_cameras.json")
        
        # Let's inspect the stream URL of the first active camera
        for cam in cameras:
            if cam.get("availability") == 1 and cam.get("profile"):
                print("\n[INFO] Sample Active Camera found:", cam.get("name"))
                streams = cam["profile"][0].get("streams", [])
                for s in streams:
                    print(f"       - Protocol: {s.get('protocol')} => {s.get('source')}")
                break
    else:
        print(f"[ERROR] API returned {response.status_code}")
        print(response.text[:500])
except Exception as e:
    print(f"[EXCEPTION] {e}")
