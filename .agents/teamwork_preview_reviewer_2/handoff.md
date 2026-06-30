# E2E Review Handoff Report — 2026-06-30T12:45:23+07:00

## 1. Observation
We performed offline analysis of the implemented modifications in `frontend/index.html`, `frontend/css/style.css`, and `frontend/js/app.js` and executed the E2E verification suites.

### Test Results
- Standard E2E test suite (`node tests/e2e_runner.js`): Passed 11/11 tests.
- Adversarial Layout test suite (`node tests/adversarial_layout_test.js`): Failed 1/3 tests.
  - Failure: "Mobile Landscape & Zoom IntersectionObserver Glitch"
    - Verbatim output:
      `[RUNNING] Mobile Landscape & Zoom IntersectionObserver Glitch...`
      `  [Observer Threshold] Found threshold: 0.6`
      `  [Simulation] H=320px -> Available Container Height=172px, Card Height=314.4px, Max Intersection Ratio=0.547`
      `FAIL`
      `          Reason: Glitch confirmed: at viewport height 320px, the max intersection ratio (0.547) is below the threshold 0.6. The video card will NEVER trigger as active (is-current).`

### Code Audits
1. **Video News Modal Close Button (`#video-news-close`)**:
   - Declared in `frontend/index.html` line 726:
     `<button class="modal-close" id="video-news-close" type="button" title="Close" aria-label="Close">`
   - Styled in `frontend/css/style.css` line 5092:
     ```css
     .video-modal-content .modal-close {
       display: grid;
       width: 40px;
       height: 40px;
       flex: 0 0 auto;
       place-items: center;
       border: 1px solid var(--border);
       border-radius: 50%;
       background: var(--surface);
       color: var(--text);
     }
     ```
   - No hover selector (e.g. `.modal-close:hover`) or `transition` property exists for this class.

2. **Keyboard Listener Event Interception**:
   - Declared in `frontend/js/app.js` line 3161:
     ```javascript
     document.addEventListener("keydown", (event) => {
       const section = document.getElementById("news-section");
       if (!section || section.hidden) return;

       // Skip arrow keys action when typing in form controls
       if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
       ...
     ```

3. **Dead Code & Leftovers**:
   - `window.openVideoModal` is declared at line 2547 in `frontend/js/app.js` but is never invoked.
   - `#video-news-modal` is declared at line 719 in `frontend/index.html` but is not active during regular feed usage.

4. **Contrast Ratios**:
   - Light theme `--text-muted` is set to `color-mix(in srgb, #516171 90%, transparent)` on `#ffffff` background.
   - Dark theme `--text-muted` is set to `color-mix(in srgb, #aeb9c4 82%, transparent)` on `#10161d` background.
   - Contrast calculation:
     - Light theme: **5.01 : 1** (meets WCAG 4.5:1)
     - Dark theme: **6.52 : 1** (meets WCAG 4.5:1)

## 2. Logic Chain
1. **R1 / IntersectionObserver Glitch**:
   - The IntersectionObserver triggers cards as active (`.is-current`) only if the intersection ratio is `>= 0.6`.
   - On screen heights `<= 360px` (such as mobile landscape), the scroll container's available height shrinks to `H - 148px` (e.g. `172px` at `H = 320px`) due to the fixed-height toggle buttons and search headers.
   - However, the video news cards have a min-height constraint of `100%` of the container plus padding/text content, resulting in a physical height of `314.4px`.
   - The max intersection ratio is `172px / 314.4px = 0.547`, which is strictly less than `0.6`.
   - Therefore, the IntersectionObserver callback will never fire with `entry.isIntersecting = true`.
   - Thus, video iframes will never load, and navigation controls will remain disabled.
2. **R3 / Hover Transition Deficiency**:
   - Requirement R3 states that hover states must transition smoothly on close/navigation buttons.
   - The close button class for the new news video modal was named `modal-close` instead of `close-modal`.
   - Unlike `.close-modal`, which gets hover styles and transitions at line 1535 of `style.css`, `.modal-close` has no `:hover` rule or transition properties.
   - Therefore, the news video modal close button does not change visual states on hover and lacks any smooth transitions.
3. **Keyboard Interception**:
   - The keyboard listener in `app.js` intercepts ArrowDown/ArrowUp keys but only checks for `INPUT`, `TEXTAREA`, and `SELECT` to bypass interception.
   - Standard `BUTTON` elements or tabs (e.g., in lists or custom select dropdowns) do not bypass this check.
   - Therefore, focusing a button and pressing arrow keys causes the video feed to scroll, disrupting accessible navigation.

## 3. Caveats
- No real browser-based E2E automation (like Playwright/Puppeteer) was used, as we complied with the offline testing guidelines specified in `TEST_INFRA.md`.
- Local calculations for WCAG contrast assumed sRGB linear interpolation for CSS `color-mix`. Actual browser colors might vary slightly depending on display profiles but will stay above the `4.5:1` threshold.

## 4. Conclusion & Verdict
**Verdict**: **REQUEST_CHANGES**

We cannot approve the implementation in its current state due to a **critical mobile responsive glitch** (videos do not load in mobile landscape viewports due to an unreachable IntersectionObserver threshold) and a **transition/hover styling gap** on the modal close button, along with minor keyboard navigation accessibility bugs.

### Summary of Findings
- **[Critical] Mobile Landscape / Short Viewport Glitch**: Videos fail to load and navigate when screen height is <= 360px because the IntersectionObserver threshold is hardcoded to 60%, but the physical layout limits maximum intersection ratio to ~54.7%.
- **[Major] Close Button Transition Deficiency**: The `#video-news-close` button (`.modal-close`) lacks hover styles and smooth transition states.
- **[Major] Accessible Keyboard Navigation Interception**: Arrow keys are intercepted when a `BUTTON` is focused, breaking standard accessible keyboard controls.
- **[Minor] Dead Code**: Unused `window.openVideoModal` and `#video-news-modal` remains in the codebase.

### Suggested Fixes
1. **IntersectionObserver threshold**: Change the threshold in `app.js` from `[0.6]` to `[0.5]` or lower, or dynamically adjust it based on viewport height to ensure it fires on short displays.
2. **News Video Modal Close Button**: Standardize `#video-news-close` to use the existing `close-modal` class to automatically inherit the correct hover styles and transitions, or define `.video-modal-content .modal-close:hover` and add `transition` properties.
3. **Keyboard Listener**: Modify the activeElement check in `app.js` to also exclude `BUTTON` tags.
4. **Dead Code**: Remove the unused modal markup and window property.

## 5. Verification Method
- Run `node tests/adversarial_layout_test.js` to verify the IntersectionObserver glitch.
- Open `frontend/css/style.css` and verify that no hover or transition properties exist for `.video-modal-content .modal-close`.
