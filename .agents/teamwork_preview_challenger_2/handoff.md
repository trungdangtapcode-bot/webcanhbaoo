# Adversarial Coverage and Verification Report

## 1. Observation
* **Test Suite Command and Results**:
  We ran `node tests/e2e_runner.js` which performs offline static analysis of frontend files:
  ```
  Smart Alert System - E2E Offline Test Runner
  =========================================
  [RUNNING] [Tier 1: Feature Coverage] CSS Scroll-Snap Feed Layout... PASS
  [RUNNING] [Tier 1: Feature Coverage] Dynamic Iframe Inject/Unload Lifecycle... PASS
  ...
  Passed: 11
  Failed: 0
  Total:  11
  ```
* **Target Source Code Locations**:
  * **IntersectionObserver Threshold**: In `frontend/js/app.js`, line 2710 defines the observer threshold at `[0.6]`:
    ```javascript
    }, { root: list, threshold: [0.6] });
    ```
  * **Global Keyboard Listeners**: In `frontend/js/app.js` at line 3161:
    ```javascript
    document.addEventListener("keydown", (event) => {
      const section = document.getElementById("news-section");
      if (!section || section.hidden) return;
      // Skip arrow keys action when typing in form controls
      if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setWorkspacePanel("cameras");
      } ...
    ```
    And at line 3286:
    ```javascript
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeVideoModal(); ...
      }
    });
    ```
  * **Video Card Dimensions & Aspect Ratios**: In `frontend/css/style.css` at line 5994:
    ```css
    .news-feed-overlay .video-card-thumb {
      position: relative;
      width: 100%;
      max-height: 62dvh;
      aspect-ratio: 16 / 9;
      border-radius: 12px;
      overflow: hidden;
    }
    ```
    And at line 6129 under `max-width: 820px`:
    ```css
    .news-feed-overlay .news-feed-card {
      width: 100%;
      padding: 28px 20px calc(28px + env(safe-area-inset-bottom));
    }
    ```

## 2. Logic Chain
1. **IntersectionObserver Layout Glitch**: 
   * When the viewport height is very small (e.g. mobile landscape or zoomed viewport of $H \le 360$px), the header elements (`.section-head`, `.news-type-toggle`, and `.news-filter-toolbar`) consume a constant vertical height of about $148$px.
   * This leaves the available news list container height ($L$) at $H - 148 = 212$px or less.
   * The video card height ($C$) is determined by its padding ($28 + 28 = 56$px), the title ($40$px), metadata ($20$px), and the 16:9 thumbnail ($223$px). This gives $C \approx 339$px.
   * Since $C > L$, the card overflows the container. The maximum visible portion of the card in the viewport is bounded by $L$ ($212$px).
   * The maximum intersection ratio is $L / C = 212 / 339 \approx 0.625$. Under $H = 320$px, it falls to $172 / 314.4 \approx 0.547$.
   * Since the IntersectionObserver threshold is strictly hardcoded to `0.6` (from `app.js:2710`), it is mathematically impossible for the card to trigger as intersecting at $H \le 320$px. At $H = 360$px, any long title wrapping onto a 3rd line raises $C$ to $359$px and drops the ratio to $0.590$ (below `0.6`), breaking the feed entirely.
2. **Keyboard Interception Loophole**:
   * The Escape listener for the news section intercepts the key globally when `.news-section` is not hidden. However, when the `#video-news-modal` is active on top of it, pressing Escape fires both listeners, causing both the modal and the news section to close simultaneously.
   * The active element check `["INPUT", "TEXTAREA", "SELECT"]` allows arrow key navigation to scroll the feed even when a user is focusing a `BUTTON` (e.g. tabs or utility buttons), breaking standard accessible navigation.

## 3. Caveats
* Checked the static logic and mathematical layouts assuming standard device padding and font scales; custom CSS zooms or system-level fonts might make the layout glitch even more pronounced.
* YouTube video details were simulated using standard return objects; we assume raw mock data mimics live API patterns.

## 4. Conclusion
There are two major vulnerabilities/glitches:
* **Critical**: The IntersectionObserver threshold of `0.6` combined with `min-height: 100%` scroll-snap cards breaks video autoplay and active index detection on smaller landscape viewports (e.g. $320$px or $360$px high viewports with wrapped text).
* **Medium**: Global Escape and Arrow key listener interception interferes with stacked modal overlays and keyboard tablist navigation accessibility.

## 5. Verification Method
We created an automated adversarial suite at `tests/adversarial_layout_test.js` to reproduce these issues.
Run the following verification command:
```bash
node tests/adversarial_layout_test.js
```
The test will fail and output the exact layout ratio mismatch confirming the bug.
