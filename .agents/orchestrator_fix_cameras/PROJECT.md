# Project: Fix Simulated Demo Cameras

## Architecture
The Smart Alert System consists of:
- **Backend API**: Node.js/Express server exposing camera list endpoints:
  - `/api/cameras` (returns all cameras, including HCM or Hanoi based on query parameters/env)
  - `/api/cameras/hcm` (returns HCM cameras)
  - `/api/cameras/hanoi` (returns Hanoi cameras)
- **Frontend Dashboard**: Plain HTML/CSS/JS frontend utilizing Leaflet map to show cameras and marker points, along with an incident demo control panel (`incident-demo-panel`) that allows simulated incident triggers (fire, flood, traffic jam).
- **AI Module**: Python-based detector (`ai_module/detector_api.py`) running on port 5055 to detect simulated incidents in stream feeds.

## Code Layout
- `backend/src/controllers/cameraController.js` — Contains `getSimulatedDemoCameras` logic and `DEMO_CAMERAS` data.
- `backend/.env` — Backend environment configuration.
- `frontend/index.html` — Main dashboard HTML containing the `#incident-demo-panel` element.
- `frontend/js/app.js` — Frontend logic managing Leaflet map, camera list loading, panel visibility, and incident demo triggers.
- `tests/` — Test suite directory.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | E2E Testing Track | Design and write independent E2E test cases (Tiers 1-4) for R1, R2, R3 requirements; publish `TEST_READY.md`. | None | IN_PROGRESS (Conv ID: 783c85e7-0293-433c-a89e-28e764241fd0) |
| M2 | Implementation Track | Fix backend gating/configuration, verify frontend rendering and interactive demo flows, pass E2E tests, and perform adversarial coverage hardening (Tier 5). | M1 | PLANNED |

## Interface Contracts
### Backend ↔ Frontend
- `GET /api/cameras` (optionally `?source=hcm` or `?source=hanoi`) -> Returns JSON array of camera objects, including the 3 simulated demo cameras when present.
- Each simulated camera must contain:
  - `camera_id`: e.g. `DEMO_FIRE_CAM_001`, `DEMO_FLOOD_CAM_001`, `DEMO_TRAFFIC_CAM_001`.
  - `source`: `'simulated_demo'`.
  - `stream_type`: `'recorded_demo'`.
  - `location`: coordinates matching the current city (HCM or Hanoi).
- `POST /api/scanner/demo/trigger` (or similar endpoint) triggered by incident buttons to start simulation, communicating with `ai_module/detector_api.py` on port 5055.
