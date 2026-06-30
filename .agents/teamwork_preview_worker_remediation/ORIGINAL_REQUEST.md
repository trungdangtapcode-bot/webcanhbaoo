## 2026-06-30T05:50:06Z
You are teamwork_preview_worker_remediation, the worker responsible for correcting the bugs identified during the E2E review and adversarial verification.
Your working directory is /home/tuanhung/web2/webcanhbaoo/.agents/teamwork_preview_worker_remediation.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Please implement the following fixes in the codebase:

1. CSS Cascade Override: In `frontend/css/style.css` (around line 3336), locate the second `html[data-theme="light"]` block and remove or comment out the duplicate `--text-muted: #868179;` declaration, allowing the cascade to inherit the earlier, WCAG-compliant color-mix value of `--text-muted`.
2. Responsive IntersectionObserver Threshold: In `frontend/js/app.js` (around lines 2690-2715), change the IntersectionObserver threshold from `0.6` to `0.35` (or similar) to ensure videos load on short displays (like mobile landscape H <= 360px). Update both `threshold: [0.35]` and the ratio check `entry.intersectionRatio >= 0.35`.
3. Close Button Transition: Add transition and hover style properties in `frontend/css/style.css` for `.video-modal-content .modal-close` to ensure smooth visual transition when hovered.
4. Keyboard Escape check ordering: In the global keydown event listener in `frontend/js/app.js` (around line 3160), move the Escape key handling check BEFORE the `activeElement` input tags checks.
5. Prevent Keyboard Interception on Buttons/Tabs: In the global keydown event listener, add "BUTTON" to the ignore list along with INPUT, TEXTAREA, and SELECT. Also ensure arrow key scrolling is only active when `activeNewsTab === "video"`.
6. Rapid navigation swallowing check: Maintain a state variable `currentTargetIndex` (e.g. initialize to 0) in JS. Update `currentTargetIndex = cards.indexOf(entry.target)` inside the IntersectionObserver callback when cards intersect. In `moveNewsFeed(direction)`, update `currentTargetIndex = Math.min(cards.length - 1, Math.max(0, currentTargetIndex + direction))` and scroll to `cards[currentTargetIndex]`.
7. Skeleton Loader Lock on Fetch Failures: In `loadVideoNews`, add a catch block that ensures `currentVideoNews = []` and calls `applyNewsFilterAndRender()` to clear the shimmer skeleton layout and render the empty state.
8. Mobile controls SVG rotation: In `frontend/css/style.css` under the `@media (max-width: 820px)` section, rotate the SVGs inside `.feed-nav-btn.prev-btn svg` and `.feed-nav-btn.next-btn svg` by `-90deg` or `270deg` so that the up/down arrows appear as left/right arrows when the layout changes to horizontal row.
9. Index Mismatch handling: In `updateVideoFeedIndicator` in `app.js`, handle case where card index resolves to `-1` by setting correct button disabled state (`disabled = index === -1 || index >= cards.length - 1`).

Verification Criteria:
- Run the standard E2E test runner: `node tests/e2e_runner.js`. All 11 tests must pass.
- Run the adversarial layout test: `node tests/adversarial_layout_test.js`. All tests must pass.
- Run the adversarial verification suite: `node tests/adversarial_verification.js`. All tests must pass.
- Ensure no new console errors or console alerts are introduced.

When done, write your report to handoff.md, ensure all tests exit with 0, and notify the caller agent.
