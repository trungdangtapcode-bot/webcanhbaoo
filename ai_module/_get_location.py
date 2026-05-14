import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests
r = requests.get('http://ip-api.com/json', timeout=5).json()
print(f"LAT={r['lat']}")
print(f"LNG={r['lon']}")
print(f"City: {r.get('city','?')}, {r.get('country','?')}")
