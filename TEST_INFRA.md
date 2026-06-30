# E2E Test Infra: Fix Simulated Demo Cameras

## Test Philosophy
- **Opaque-box, requirement-driven**: Tests verify the system's external behavior (API endpoints, DOM elements, JS event handlers) without relying on internal function implementations of the camera service.
- **Methodology**: 4-Tier Testing Approach including Category-Partition (Tier 1), Boundary Value Analysis (Tier 2), Pairwise Combinatorial Testing (Tier 3), and Real-World Workload Testing (Tier 4).
- **Completely Offline & Sandbox-based**: Employs Node.js `vm` module to run `app.js` with mocked browser environments, allowing robust test verification without spinning up full browser engines or live network connections.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | Backend Demo Camera Data Injection | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 2 | Frontend Sidebar & Marker Rendering | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 3 | Incident Demo Panel & Scanning Flow | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |

## Test Architecture
- **Test runner**: `tests/camera_demo_e2e.js`
- **Invocation**: `node tests/camera_demo_e2e.js`
- **Pass/Fail Semantics**: Exits with code 0 on success, non-zero on failure. Outputs clear, colored details of each test.
- **Directory Layout**:
  - `tests/camera_demo_e2e.js`: The test implementation.
  - `TEST_INFRA.md`: Document detailing test philosophy, feature inventory, and architecture (this file).
  - `TEST_READY.md`: Execution checklist and status summary.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | HCM Startup Flow | F1, F2 | Medium |
| 2 | Hanoi Startup Flow | F1, F2 | Medium |
| 3 | API Server Offline / Error Fallback | F1, F2 | Medium |
| 4 | Demo Asset Verification | F2 | Low |
| 5 | Full Simulation Scanning Loop | F2, F3 | High |

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥5 test cases per feature (15 total)
- **Tier 2 (Boundary & Corner Cases)**: ≥5 test cases per feature (15 total)
- **Tier 3 (Cross-Feature Combinations)**: ≥3 pairwise feature interaction cases
- **Tier 4 (Real-World Application Scenarios)**: ≥5 realistic workflow scenarios
- **Total test cases**: 38 test cases
