# E2E Test Suite Ready

## Test Runner
- Command: `node tests/camera_demo_e2e.js`
- Expected: all 38 tests pass with exit code 0 once the backend camera controller and `.env` fixes are applied.

## Coverage Summary
| Tier | Count | Description |
|------|------:|-------------|
| 1. Feature Coverage | 15 | Verifies basic backend API endpoints and frontend UI/panel rendering features |
| 2. Boundary & Corner | 15 | Tests boundary environment gating, coordinates, focus ranges, and input error handling |
| 3. Cross-Feature | 3 | Verifies switching city sources and interactive triggers/resets across the frontend and socket streams |
| 4. Real-World Application | 5 | Runs full HCM/Hanoi startup, API offline fallback, asset checking, and scanning simulation loops |
| **Total** | **38** | |

## Feature Checklist
| Feature | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---------|:------:|:------:|:------:|:------:|
| Backend Demo Camera Injection | 5 | 5 | ✓ | ✓ |
| Frontend Sidebar & Marker Rendering | 5 | 5 | ✓ | ✓ |
| Incident Demo Panel & Scanning Flow | 5 | 5 | ✓ | ✓ |

## Execution Details
- Under the initial (unfixed) codebase, 5 backend tests are expected to fail (`TC_T1_BE_02`, `TC_T1_BE_03`, `TC_T1_BE_04`, `TC_T2_BE_01`, `TC_T2_BE_02`) because the simulated cameras are not exposed in production by default. 
- Applying the backend controller repair and environment configuration in Milestone M2 will enable the simulated cameras globally, allowing all 38 tests to pass successfully (exit code 0).
