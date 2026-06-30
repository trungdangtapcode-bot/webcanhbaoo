# Scope: Milestone M1 (E2E Testing Track)

## Architecture
The E2E Testing Track verifies the integration between the backend camera API, frontend Leaflet map rendering, and the incident demo simulation controls without modifying the main application code or database records.

We utilize:
- **Offline Static/Dynamic Analysis**: Reads and sandbox-evaluates the HTML/JS/CSS assets to verify frontend elements, classes, and logic.
- **Node.js Sandbox**: Runs `app.js` using Node's `vm` module to mock global browser APIs (window, document, fetch, Leaflet `L`) and assert frontend behaviors.
- **Backend Code Analysis**: Statically parses `backend/src/controllers/cameraController.js` to verify simulated camera configuration, endpoints, and coordinate shifting logic.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Design & Test Plan | Define test cases, coverage tiers (1-4), and write `TEST_INFRA.md` | None | PLANNED |
| 2 | Implementation | Write the Node.js test runner in `tests/camera_demo_e2e.js` | M1.1 | PLANNED |
| 3 | Execution & Audit | Run verification tests, perform review/gating, run forensic audits | M1.2 | PLANNED |
| 4 | Final Publication | Publish `TEST_READY.md` containing the test suite summary and completion status | M1.3 | PLANNED |

## Interface Contracts
### E2E Test Suite ↔ System Files
- Read-only access to `backend/src/controllers/cameraController.js`, `frontend/index.html`, `frontend/js/app.js`, `frontend/css/style.css`.
- Writes test report and statuses to project root `TEST_INFRA.md` and `TEST_READY.md`.
