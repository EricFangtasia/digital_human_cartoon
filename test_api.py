import urllib.request
import json

url = 'http://localhost:8880/adh/agent/v0/engine'
payload = {
    "engine": "default",
    "data": "你好，我最近心情不太好",
    "conversation_id": "test123"
}

data = json.dumps(payload).encode('utf-8')
req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        response_data = resp.read().decode('utf-8')
        print('Status:', resp.status)
        print('Response:')
        print(response_data[:2000])
except Exception as e:
    print('Error:', e)
