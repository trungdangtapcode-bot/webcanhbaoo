import asyncio
import websockets
import requests
import json

api_url = "https://cds.hanoi.gov.vn/api/1.0/public/video-wall-cameras-v2?refresh=false&page=1&per_page=1000&id=&address=&name=&userId=42914592"
headers = {
    "accept": "application/json",
    "authorization": "Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MjkxNDU5MiIsImF1ZCI6IjA5Njk4MTQ0MzUiLCJwd2RFeHAiOjE3ODYxNzE5MzkzODIsImV4cCI6MTc4NjE3MTkzOSwiZGV2aWNlSWQiOiI4Y2I5Y2UxODE5NjNjNjg2IiwiaWF0IjoxNzc4Mzk1OTM5fQ.BI8Mv0ECFn8j1gJaAtzSYRyOOplqxsycYT4gMHK19Zr-UzYQxa98lmMiUnFJzOcFwugKdi2O_bkjSBOMuMeDKEgEXJP5AYd_0lv0gKXlCymCDJu-ZE4qNuNrKkGXaOcWgWsINqkc9clq0p3I3tFMah_8DLHhEiY8r7_RmpWL9YTnlEYIYIjhmT4x9YT48Mi9MZaRIKt_TtgzGMbgQ8BKT6vDu9FR05oOviFie7zXGCsl9Ttazfx8yikKXGC_0PAcmFmVTBcUdtumjNyXvGT2_VEjOeMQ0OIjDQDolv2SzqLLoRrMjv-dHKbGsxNBN3HoDmgdJSdrFXX9knvP5e_Tvdn8pPFwnXOX0qlpyC7oXWjjFBvNQUQ464f4GbOmiHlJsJnCnjupfUxBxozRwGI0EqZhD3cP37UUpaMPayK0VRuXh5QnjIvE6W3MFi2GXki6r14IBBpTz4w5OAMVXWaB7VJKB_j9bYN82ZWPvSRjQ329qlxbrHfdx3bnr2iWDiYSU7JmjnqMc1-vQ8n83f2ho_2MpeFWNibyWTrRTiCZqhElbfkE3mSkxcilRq5BKIIR_vBIL9_yBsgH6LT0xjnOrGvH9lTZ49oSoV0Tc7Mw-6UaBKg88rvz4fy297tuDTQxn2cEYdBIzSbN0ajTVd-bOTF2Y5IMgxUILYv2naQJ1c0",
    "deviceid": "8cb9ce181963c686",
    "mode": "514",
    "os_type": "Android",
    "placeid": "514",
    "user-agent": "Dart/3.3 (dart:io)",
    "userid": "42914592",
}

async def test_wss():
    print("[1] Fetching fresh API token...")
    res = requests.get(api_url, headers=headers)
    if res.status_code != 200:
        print("API Failed:", res.text)
        return
        
    data = res.json()
    cam = next((c for c in data.get("data", []) if c.get("availability") == 1), None)
    if not cam:
        print("No active camera found")
        return
        
    wss_url = next((s["source"] for s in cam["profile"][0]["streams"] if s["protocol"] == "WSS"), None)
    if not wss_url:
        print("No WSS URL found")
        return
        
    print(f"[2] Fresh WSS URL: {wss_url}")
    print("[3] Attempting WebSocket connection...")
    
    try:
        ws_headers = {
            "User-Agent": "Dart/3.3 (dart:io)",
            "Origin": "https://cds.hanoi.gov.vn"
        }
        async with websockets.connect(wss_url, additional_headers=ws_headers) as ws:
            print("[4] Connected successfully! Waiting for initial SockJS 'o'...")
            msg1 = await ws.recv()
            print(f"Received: {msg1}")
            
            if msg1 == "o":
                print("[5] Sending STOMP CONNECT...")
                token = headers['authorization'] # Bearer ...
                stomp_connect = f'CONNECT\naccept-version:1.1,1.0\nheart-beat:10000,10000\nAuthorization:{token}\n\n\x00'
                # Wrap in SockJS json array
                await ws.send(json.dumps([stomp_connect]))
                
                print("[6] Waiting for STOMP CONNECTED...")
                for i in range(5):
                    resp = await ws.recv()
                    print(f"Received data chunk {i+1}: {resp}")
                    # If connected, try to send a SUBSCRIBE if we know the topic, or just listen
    except Exception as e:
        print(f"WebSocket Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_wss())
