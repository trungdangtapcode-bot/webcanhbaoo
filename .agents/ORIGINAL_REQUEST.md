# Original User Request

## Request — 2026-06-30T21:54:33+07:00

Fix 3 simulated demo cameras (fire, flood, traffic jam) that have disappeared from the Smart Alert System dashboard. The cameras previously worked but are now missing from the UI due to a backend environment configuration issue.

Working directory: /home/tuanhung/web2/webcanhbaoo
Integrity mode: development

## Root Cause Analysis (reference for the team)

The function `getSimulatedDemoCameras()` in `backend/src/controllers/cameraController.js` (line 144-161) has this gate:

```js
const enabled = explicitlyRequested || process.env.ENABLE_SIMULATED_CAMERA === 'true' || process.env.NODE_ENV !== 'production';
if (!enabled) return [];
```

The file `backend/.env` sets `NODE_ENV=production`, and `ENABLE_SIMULATED_CAMERA` is not set. This causes the function to return an empty array, making all 3 demo cameras disappear from both HCM and Hanoi API endpoints.

The 3 cameras affected:
- `DEMO_FIRE_CAM_001` — "Camera mô phỏng — Sự cố cháy" (boxcar-fire.webm)
- `DEMO_FLOOD_CAM_001` — "Camera mô phỏng — Tuyến đường ngập" (flood-intersection.webm)
- `DEMO_TRAFFIC_CAM_001` — "Camera mô phỏng — Ùn tắc giờ cao điểm" (rush-hour-traffic.webm)

## Requirements

### R1. Restore demo cameras in API responses
The 3 simulated demo cameras must be returned by the backend camera API endpoints (`/api/cameras`, `/api/cameras/hcm`, `/api/cameras/hanoi`) regardless of `NODE_ENV` value. These are core demo features that should always be available. Fix the gating logic so demo cameras are always included (or add `ENABLE_SIMULATED_CAMERA=true` to the `.env` file — whichever approach is cleaner and more maintainable).

### R2. Verify frontend rendering
After the backend fix, confirm that:
- All 3 demo cameras appear in the camera list sidebar (both HCM and Hanoi modes)
- All 3 demo cameras show as markers on the Leaflet map
- The "Mô phỏng camera" panel (`incident-demo-panel`) is visible and shows "Sẵn sàng · 3 camera mô phỏng"

### R3. Verify incident demo panel functionality
The demo incident buttons (Cháy, Ngập, Ùn tắc, Chạy cả 3) should trigger the demo scanning flow. The "Đặt lại" (reset) button should clear demo events. This requires the AI module (`ai_module/detector_api.py`) to be running on port 5055. Verify the flow works or document clearly what's needed to make it work.

## Acceptance Criteria

### API Response Verification
- [ ] `GET /api/cameras?source=hcm` returns JSON containing all 3 cameras with `camera_id` matching `DEMO_FIRE_CAM_001`, `DEMO_FLOOD_CAM_001`, `DEMO_TRAFFIC_CAM_001`
- [ ] `GET /api/cameras/hanoi` returns JSON containing the same 3 demo cameras with Hanoi-specific coordinates (lat ~21.0x, lng ~105.8x)
- [ ] Demo cameras have `source: 'simulated_demo'` and `stream_type: 'recorded_demo'` in the response
- [ ] The fix does not break any existing camera endpoints or non-demo camera data

### Frontend Rendering Verification
- [ ] Opening `http://localhost:3000` shows the dashboard with 3 demo cameras visible in the camera list
- [ ] Switching between HCM and Hanoi sources shows demo cameras with correct city-specific locations
- [ ] The `incident-demo-panel` is not hidden (i.e., `hidden` attribute is removed)
- [ ] The progress text shows "Sẵn sàng · 3 camera mô phỏng"

### Demo Video Assets
- [ ] The 3 `.webm` video files exist in `frontend/assets/demo/` and are accessible via the dev server
- [ ] Clicking a demo camera in the list opens a popup with "Xem camera mô phỏng" option

### Code Quality
- [ ] No unrelated code changes — fix only what's broken
- [ ] Existing tests (if any in `tests/` directory) continue to pass
- [ ] The fix is documented with a brief comment explaining the rationale
