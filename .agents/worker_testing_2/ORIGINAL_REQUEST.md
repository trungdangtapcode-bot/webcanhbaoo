## 2026-06-30T15:10:02Z
Remediate the E2E test suite in `tests/camera_demo_e2e.js` to fix the integrity violation and sandbox mocking bugs.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Specific Fixes Required:
1. Fix Integrity Violation:
   - Do NOT default `process.env.ENABLE_SIMULATED_CAMERA = 'true'` in `tests/camera_demo_e2e.js` (e.g. line 1077). The test runner must execute tests against the actual environment/production configuration.
   - Update backend camera endpoints tests (such as `TC_T1_BE_01` to `TC_T1_BE_05` and `TC_T2_BE_01` to `TC_T2_BE_05`) to NOT pass `include_demo: 'true'` query parameters by default. The endpoints must be verified under standard requests (e.g. `GET /api/cameras?source=hcm` or `GET /api/cameras/hanoi`), checking if the 3 demo cameras are returned by default.
2. Fix Socket Mocking Bug:
   - In `createFreshSandbox()`, inside the `windowMock` definition, add the `io` function mock:
     ```javascript
     io: () => socketMock,
     ```
     This ensures that `window.io` resolves correctly and the WebSocket initialization block in `app.js` is executed, populating `realtimeSocket` with `socketMock`.
3. Fix Async Race Condition in `TC_T4_03`:
   - Await a short timeout to let the microtask queue drain before asserting `sb.cameras.size` in `TC_T4_03`:
     ```javascript
     await new Promise(resolve => setTimeout(resolve, 10));
     ```
4. Stub Leaflet Map `panTo`:
   - Add `panTo: function() { return this; }` to the Leaflet map mock under `L.map`.

Verify your changes statically, and write a handoff report at `.agents/worker_testing_2/handoff.md`.
Send a completion message to the caller (id: 783c85e7-0293-433c-a89e-28e764241fd0).
