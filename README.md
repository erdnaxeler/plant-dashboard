# Smart Plant Watering App (Bubble Replacement)

This project replaces Bubble with a Python app that:

1. Receives moisture telemetry from your ESP32
2. Stores readings in a database
3. Serves threshold settings back to the ESP32
4. Displays moisture history in a chart
5. Lets you edit watering thresholds in a web UI

## 1) What this app provides

- `POST /api/device/telemetry` (ESP32 posts moisture)
- `GET /api/device/settings?plant_id=plant_001` (ESP32 fetches thresholds)
- `GET /dashboard` (chart + latest values)
- `GET/POST /settings` (edit start/stop thresholds)

The settings endpoint intentionally returns a Bubble-compatible JSON shape so your existing parser keeps working:

```json
{
  "response": {
    "results": [
      {
        "plant_name": "PLANT A",
        "start_threshold": 20.0,
        "stop_threshold": 35.0
      }
    ]
  }
}
```

## 2) Local setup (copy/paste)

### Prerequisites
- Python 3.10+

### Install and run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open:
- `http://localhost:5000/dashboard`
- `http://localhost:5000/settings`

## 3) Environment variables

The app can run without any env vars for quick local testing.

For production, set:

- `DATABASE_URL`  
  - Local default: `sqlite:///plant_app.db`
  - Postgres example: `postgresql://user:pass@host:5432/dbname`
- `DEVICE_API_TOKEN`  
  - If set, ESP32 must send: `Authorization: Bearer <token>`

## 4) ESP32 code changes

Replace Bubble endpoints with your deployed app URL.

Example:

```cpp
const char* moisture_endpoint = "https://YOUR-APP-URL/api/device/telemetry";
const char* settings_base_url = "https://YOUR-APP-URL/api/device/settings";
```

Build settings URL:

```cpp
String fullUrl = String(settings_base_url) + "?plant_id=" + String(PLANT_ID);
```

If `DEVICE_API_TOKEN` is enabled, add header in both POST and GET:

```cpp
http.addHeader("Authorization", "Bearer YOUR_DEVICE_TOKEN");
```

Your existing fields (`plant_id`, `plant_name`, `moisture`, `start_threshold`, `stop_threshold`) are already supported.

## 5) Deployment (Render or Railway)

This repo already includes:
- `requirements.txt`
- `Procfile` (`web: gunicorn app:app`)

### Recommended deployment steps
1. Push this repo to GitHub
2. Create a new web service on Render or Railway from the repo
3. Set env vars:
   - `DATABASE_URL` (Postgres)
   - `DEVICE_API_TOKEN` (optional but recommended)
4. Deploy
5. Visit `/dashboard` to verify app is live
6. Point ESP32 URLs to your live domain

## 6) API quick tests with curl

### Send telemetry
```bash
curl -X POST http://localhost:5000/api/device/telemetry \
  -H "Content-Type: application/json" \
  -d '{"plant_id":"plant_001","plant_name":"PLANT A","moisture":31.2,"start_threshold":20,"stop_threshold":35}'
```

### Fetch settings
```bash
curl "http://localhost:5000/api/device/settings?plant_id=plant_001"
```

## 7) Notes for your current firmware

- Your firmware currently logs and posts every cycle; this app accepts that.
- The pump safety logic remains in firmware (correct place for safety).
- Threshold edits from `/settings` are picked up on the next firmware settings fetch.
