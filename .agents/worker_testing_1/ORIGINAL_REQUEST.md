## 2026-06-30T14:59:20Z
Write the Node.js E2E test suite file at `tests/camera_demo_e2e.js`.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Requirements for `tests/camera_demo_e2e.js`:
1. Use Node.js. It must run completely offline (using static parsing and/or Node's `vm` sandbox to load `frontend/js/app.js` with mocks).
2. Maintain a test registry and run 38 test cases corresponding to:
   - Tier 1: Feature Coverage (15 test cases: TC_T1_BE_01 to TC_T1_BE_05, TC_T1_FE_01 to TC_T1_FE_05, TC_T1_PANEL_01 to TC_T1_PANEL_05)
   - Tier 2: Boundary & Corner Cases (15 test cases: TC_T2_BE_01 to TC_T2_BE_05, TC_T2_FE_01 to TC_T2_FE_05, TC_T2_PANEL_01 to TC_T2_PANEL_05)
   - Tier 3: Cross-Feature Combinations (3 test cases: TC_T3_01 to TC_T3_03)
   - Tier 4: Real-World Scenarios (5 test cases: TC_T4_01 to TC_T4_05)
3. Ensure it verifies the 3 simulated demo cameras (R1, R2, R3) and their API endpoints, Leaflet map markers, camera list sidebar, and incident demo panel controls (Cháy, Ngập, Ùn tắc, Chạy cả 3, Đặt lại).
4. Run all tests and print structured results (indicating PASSED or FAILED and error reasons). Exit with code 0 if all 38 tests pass, non-zero on failure.

When complete, write a handoff report at `.agents/worker_testing_1/handoff.md` with:
- Summary of implemented test cases.
- Command and verification output of running the tests.
- Confirmation that the E2E tests compile and pass.
- Send a completion message to the caller (id: 783c85e7-0293-433c-a89e-28e764241fd0).
