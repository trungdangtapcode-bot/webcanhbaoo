import requests

url = "https://rec03ihanoi.vtscloud.vn:443/playback/view/a22212a31011xyzKX2lpWcY1a"

try:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Referer": "https://camera.hanoi.gov.vn/"  # Just guessing a referer
    }
    response = requests.get(url, headers=headers, timeout=10)
    print(f"Status Code: {response.status_code}")
    print(f"Content-Type: {response.headers.get('Content-Type')}")
    print("Preview of content:")
    print(response.text[:500])
except Exception as e:
    print(f"Error: {e}")
