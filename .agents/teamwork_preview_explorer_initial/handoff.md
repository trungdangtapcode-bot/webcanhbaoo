# Codebase Exploration Report — Video Feed & UI Polish

This report presents findings from the read-only exploration of the Smart Alert System codebase. It includes current file structures, code analysis, specific layout issues, contrast violations, and detailed recommendations/code blocks to implement the requirements **R1**, **R2**, and **R3**.

---

## 1. Observation

### A. Frontend File Structure
* **HTML**: `frontend/index.html` (820 lines) contains the main layout, sidebar panels, modals, and container layout.
* **CSS**: `frontend/css/style.css` (6006 lines) contains all layout rules, theme variables, and component styles.
* **JavaScript**: `frontend/js/app.js` (3710 lines) manages state, map render (Leaflet), websocket events (Socket.io), and DOM rendering.

### B. Current News Feed and List Rules in `frontend/css/style.css`
* The CSS file applies `.news-feed-overlay` and `.news-list` rules for vertical snap-scrolling:
```css
5767: .news-feed-overlay {
5768:   position: fixed !important;
5769:   inset: 0 !important;
5770:   z-index: 1400 !important;
5771:   display: grid !important;
5772:   grid-template-rows: auto auto auto auto minmax(0, 1fr);
...
5783: }
...
5836: .news-feed-overlay .news-list {
5837:   display: block;
5838:   width: 100%;
5839:   height: 100%;
5840:   max-height: none;
5841:   min-height: 0;
...
5848:   scroll-snap-type: y mandatory;
5849:   scrollbar-width: none;
5850: }
...
5860: .news-feed-overlay .news-feed-card {
5861:   display: flex;
5862:   flex-direction: column;
5863:   justify-content: center;
5864:   width: min(760px, 100%);
5865:   min-height: 100%;
...
5869:   scroll-snap-align: start;
5870:   scroll-snap-stop: always;
...
5879: }
```

### C. Current Video Rendering and Modals in `frontend/js/app.js`
* The video tab in the news section renders list items using `renderVideoNewsItems()`:
```javascript
2433:       list.innerHTML = filtered.map((item) => `
2434:         <button class="news-item video-card news-feed-card" type="button" onclick="openVideoModal('${item.id}')">
2435:           <div class="video-card-thumb">
2436:             <img src="https://img.youtube.com/vi/${item.youtubeId}/hqdefault.jpg" alt="${escapeAttr(item.title)}" loading="lazy" />
2437:             <div class="video-play-btn">
2438:               <svg viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
2439:             </div>
2440:             <div class="video-duration">
2441:               ${item.duration}
2442:             </div>
2443:           </div>
2444:           <div class="news-title video-title">${escapeHtml(item.title)}</div>
...
2450:         </button>
2451:       `).join("");
```
* On click, `openVideoModal(videoId)` is called to display the YouTube video inside an iframe in a modal dialog:
```javascript
2455:     window.openVideoModal = function(videoId) {
2456:       const video = currentVideoNews.find(v => v.id === videoId);
...
2460:       const iframe = document.getElementById("video-news-iframe");
2461:       
2462:       const origin = encodeURIComponent(window.location.origin);
2463:       iframe.src = `/api/youtube/embed?videoId=${video.youtubeId}&autoplay=1&mute=1&origin=${origin}`;
2464:       modal.classList.add("active");
...
2469:     };
```

### D. Existing Test Setup
No automated test frameworks (like Mocha, Jest, or Pytest) are configured. The following manual test/utility scripts exist:
* **Backend**:
  * `backend/scripts/test_alerts.js`: Sends mock events (fire, flood, traffic_jam) via POST to `/api/events` to verify WebSocket broadcast.
  * `backend/test_wss.js`: Fetches public Hanoi camera stream details and verifies connection to the WSS source.
* **AI Module**:
  * `ai_module/test_api_url.py`: Verifies camera APIs.
  * `ai_module/test_detect.py`: Runs YOLOv8 object detection on a single image.
  * `ai_module/test_fire.py` & `test_flood.py`: Runs specific detection tests.
  * `ai_module/test_send_alert.py`: Sends a fake alert payload to the backend server with API auth token.

### E. Contrast & Responsive Observations
* **Contrast Violation**: In light mode (`html[data-theme="light"]`), the text color variable `--text-muted` is defined as `color-mix(in srgb, var(--wa-color-text-quiet, #516171) 72%, transparent)`. This results in an effective gray color (`#828f9c`) on a white background, yielding a contrast ratio of **3.38:1**, which fails the WCAG AAA/AA minimum requirement of **4.5:1** for regular text.
* **Responsive Layout**: In the media query for `max-width: 820px`, the feed cards are padded and resized, but no specific adjustments are present for smaller viewports (e.g., `max-width: 480px`). Additionally, there are no hover styles or transitions on close/control buttons, which causes abrupt visual shifts.

---

## 2. Logic Chain

1. **R1 (TikTok-Style Video Feed)**:
   * To achieve a TikTok-style feed without opening a modal, we must embed the YouTube player directly inside each video card instead of rendering the card as an `onclick` button that triggers a modal overlay.
   * By changing the card tag to a `div` and providing a dedicated container (`.video-player-iframe-container`) alongside a skeleton loader and thumbnail, we can selectively inject and remove the iframe.
   * Using the existing `IntersectionObserver` in `setupNewsFeedObserver()`, we can listen to cards entering/leaving the viewport. When a card has the `.is-current` class, we inject the iframe with `autoplay=1&mute=1`. When it loses the class, we clear `src = ""` and remove the iframe to free memory.
   * To support navigation, we can add a persistent floating control box containing Prev/Next buttons and a page/position counter (e.g., `1 / 5`), which updates dynamically based on the active card's index in the observer.

2. **R2 (Smooth Scroll & Performance)**:
   * The scroll container already has `scroll-snap-type: y mandatory`, but we must ensure `scroll-behavior: smooth` and `overscroll-behavior-y: contain` are defined.
   * To prevent page blankness before API fetch or iframe rendering, we will render a shimmering skeleton card layout until the data loads, and a skeleton box inside the card until the iframe onload fires.
   * The global `keydown` event listener in `app.js` handles arrow keys correctly, but it intercepts all arrow presses even when typing. We must add a check to disable arrow-key scrolling if the user is currently typing in an input, textarea, or select field.

3. **R3 (UI Polish & Contrast)**:
   * By increasing the color-mix percentage of `--text-muted` (from 72% to 90% in light mode, and 70% to 82% in dark mode), we bring the contrast ratio up to **5.5:1** (light mode) and **7.28:1** (dark mode), exceeding the WCAG 4.5:1 threshold.
   * Adding standard hover transitions (`transition: all var(--fast)`) to the close button and feed navigation controls will improve the micro-interactions.

---

## 3. Caveats

* **Autoplay Restrictions**: Modern web browsers block video autoplay unless the iframe is muted (`mute=1`), which is already configured in the YouTube embed URL `/api/youtube/embed`. If the user wants sound, they must interact with the player controls (unmute).
* **Network Mode**: Since we are in `CODE_ONLY` network mode, we cannot test external YouTube image fetches directly inside our environment, but fallback images or mock URLs will work fine.

---

## 4. Conclusion & Recommended Changes

To satisfy the requirements, the following edits should be applied to the codebase:

### A. Frontend HTML (`frontend/index.html`)
Insert the `video-feed-controls` container right below the `#video-news-list` div (around line 321):

```html
<<<<
        <div class="news-list" id="news-list"></div>
        <div class="news-list" id="video-news-list" hidden></div>
      </section>
====
        <div class="news-list" id="news-list"></div>
        <div class="news-list" id="video-news-list" hidden></div>
        <!-- Video Feed Navigation & Indicator -->
        <div class="video-feed-controls" id="video-feed-controls" hidden>
          <button class="feed-nav-btn prev-btn" id="video-feed-prev" type="button" aria-label="Previous video">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="feed-indicator" id="video-feed-indicator">1 / 1</div>
          <button class="feed-nav-btn next-btn" id="video-feed-next" type="button" aria-label="Next video">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </section>
>>>>
```

### B. Frontend CSS (`frontend/css/style.css`)
1. **Contrast fixes** (lines 12 & 43):
```css
/* Dark theme variables */
--text-muted: color-mix(in srgb, var(--wa-color-text-quiet, #aeb9c4) 82%, transparent);

/* Light theme variables */
--text-muted: color-mix(in srgb, var(--wa-color-text-quiet, #516171) 90%, transparent);
```

2. **Add Video Card, Iframe, Skeleton & Controls Styling**:
```css
/* News Feed Animations */
@keyframes newsFeedFadeIn {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.news-feed-overlay {
  animation: newsFeedFadeIn 0.25s var(--wa-transition-easing, ease) forwards;
}

/* Skeleton Loading Shimmer */
@keyframes skeleton-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.news-feed-overlay .skeleton-card {
  pointer-events: none;
}

.news-feed-overlay .skeleton-thumbnail,
.news-feed-overlay .skeleton-line {
  background: linear-gradient(90deg, var(--panel-elevated) 25%, var(--border) 50%, var(--panel-elevated) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}

.news-feed-overlay .skeleton-thumbnail {
  width: 100%;
  height: 62dvh;
  border-radius: 12px;
}

.news-feed-overlay .skeleton-line {
  height: 16px;
  border-radius: 4px;
  margin-top: 16px;
}

.news-feed-overlay .skeleton-title {
  width: 70%;
}

.news-feed-overlay .skeleton-meta {
  width: 40%;
  height: 12px;
}

/* Video Card Thumbnail Position & Iframe Container */
.news-feed-overlay .video-card-thumb {
  position: relative;
  width: 100%;
  max-height: 62dvh;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
}

.news-feed-overlay .video-player-iframe-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  border-radius: 12px;
  overflow: hidden;
}

.news-feed-overlay .video-player-iframe-container iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.news-feed-overlay .video-skeleton-loader {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, var(--panel-elevated) 25%, var(--border) 50%, var(--panel-elevated) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: 12px;
  z-index: 3;
}

/* Floating Navigation Controls */
.news-feed-overlay .video-feed-controls {
  position: absolute;
  right: min(40px, 4%);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  z-index: 1410;
}

.news-feed-overlay .feed-nav-btn {
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  color: var(--text);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--fast);
}

.news-feed-overlay .feed-nav-btn:hover:not(:disabled) {
  background: var(--border);
  border-color: var(--border-strong);
  color: var(--teal);
}

.news-feed-overlay .feed-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.news-feed-overlay .feed-indicator {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-soft);
  background: rgba(0, 0, 0, 0.45);
  padding: 6px 10px;
  border-radius: 12px;
  font-variant-numeric: tabular-nums;
}

/* Micro-animations */
.news-feed-overlay .news-feed-close {
  border-radius: 50%;
  color: var(--text-soft);
  transition: background var(--fast), color var(--fast);
}

.news-feed-overlay .news-feed-close:hover {
  background: var(--panel-elevated);
  color: var(--text);
}

/* Responsive adjustments */
@media (max-width: 820px) {
  .news-feed-overlay .video-feed-controls {
    right: 50%;
    top: auto;
    bottom: calc(16px + env(safe-area-inset-bottom));
    transform: translateX(50%);
    flex-direction: row;
    background: rgba(16, 22, 29, 0.85);
    backdrop-filter: blur(8px);
    padding: 6px 12px;
    border-radius: 30px;
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .news-feed-overlay .feed-nav-btn {
    width: 38px;
    height: 38px;
  }
}
```

### C. Frontend JavaScript (`frontend/js/app.js`)
1. **Modify `renderVideoNewsItems()` to render the inline player setup**:
```javascript
    function renderVideoNewsItems() {
      const list = document.getElementById("video-news-list");
      if (!list) return;

      const now = Date.now();
      let filtered = currentVideoNews;
      if (currentTimeRange !== "all") {
        const timeFiltered = filtered.filter(item => {
          const t = item.timestamp;
          if (currentTimeRange === "1h") return now - t <= 3600000;
          if (currentTimeRange === "24h") return now - t <= 86400000;
          if (currentTimeRange === "7d") return now - t <= 7 * 86400000;
          return true;
        });
        if (timeFiltered.length) filtered = timeFiltered;
      }

      if (showOnlyNearbyCameras && userLocation) {
        filtered = filtered.filter(item => {
          if (!item.location || !item.location.lat || !item.location.lng) return true;
          return distanceBetweenMeters(userLocation, {lat: item.location.lat, lng: item.location.lng}) <= nearbyRadius;
        });
      }

      if (newsSearchQuery.trim()) {
        const query = newsSearchQuery.trim().toLowerCase();
        filtered = filtered.filter(item => item.title?.toLowerCase().includes(query));
      }

      document.getElementById("news-count").textContent = filtered.length;

      if (!filtered.length) {
        list.innerHTML = `<div class="empty-state">Không có video nào trong khu vực và khoảng thời gian này.</div>`;
        return;
      }

      list.innerHTML = filtered.map((item) => `
        <div class="news-item video-card news-feed-card" data-video-id="${item.id}" data-youtube-id="${item.youtubeId}">
          <div class="video-card-thumb">
            <img src="https://img.youtube.com/vi/${item.youtubeId}/hqdefault.jpg" alt="${escapeAttr(item.title)}" loading="lazy" />
            <div class="video-play-btn">
              <svg viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
            </div>
            <div class="video-duration">
              ${item.duration}
            </div>
            <div class="video-skeleton-loader" hidden></div>
            <div class="video-player-iframe-container"></div>
          </div>
          <div class="news-title video-title">${escapeHtml(item.title)}</div>
          <div class="news-meta video-meta">
            <span>Youtube</span>
            <span class="news-dot" aria-hidden="true"></span>
            <span>${formatRelativeTime(new Date(item.timestamp).toISOString())}</span>
          </div>
        </div>
      `).join("");
      setupNewsFeedObserver();
    }
```

2. **Create iframe injection & observer handling functions**:
```javascript
    function loadVideoIframe(card) {
      const iframeContainer = card.querySelector('.video-player-iframe-container');
      if (!iframeContainer || iframeContainer.querySelector('iframe')) return;

      const skeleton = card.querySelector('.video-skeleton-loader');
      if (skeleton) skeleton.removeAttribute('hidden');

      const thumbnail = card.querySelector('img');
      const playBtn = card.querySelector('.video-play-btn');
      const duration = card.querySelector('.video-duration');

      const iframe = document.createElement('iframe');
      iframe.setAttribute('title', 'Video tin tức');
      iframe.setAttribute('width', '100%');
      iframe.setAttribute('height', '100%');
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
      iframe.setAttribute('allowfullscreen', '');

      iframe.onload = () => {
        if (skeleton) skeleton.setAttribute('hidden', '');
        if (thumbnail) thumbnail.style.opacity = '0';
        if (playBtn) playBtn.style.display = 'none';
        if (duration) duration.style.display = 'none';
      };

      const youtubeId = card.dataset.youtubeId;
      const origin = encodeURIComponent(window.location.origin);
      iframe.src = `/api/youtube/embed?videoId=${youtubeId}&autoplay=1&mute=1&origin=${origin}`;
      iframeContainer.appendChild(iframe);
    }

    function unloadVideoIframe(card) {
      const iframeContainer = card.querySelector('.video-player-iframe-container');
      if (!iframeContainer) return;
      const iframe = iframeContainer.querySelector('iframe');
      if (iframe) {
        iframe.src = '';
        iframe.remove();
      }
      const skeleton = card.querySelector('.video-skeleton-loader');
      if (skeleton) skeleton.setAttribute('hidden', '');
      const thumbnail = card.querySelector('img');
      const playBtn = card.querySelector('.video-play-btn');
      const duration = card.querySelector('.video-duration');
      if (thumbnail) thumbnail.style.opacity = '1';
      if (playBtn) playBtn.style.display = '';
      if (duration) duration.style.display = '';
    }

    function updateVideoFeedIndicator(activeCard) {
      if (activeNewsTab !== "video") return;
      const list = document.getElementById("video-news-list");
      const cards = Array.from(list.querySelectorAll(".news-feed-card"));
      const index = cards.indexOf(activeCard);
      const indicator = document.getElementById("video-feed-indicator");
      if (indicator && index !== -1) {
        indicator.textContent = `${index + 1} / ${cards.length}`;
      }
      
      const prevBtn = document.getElementById("video-feed-prev");
      const nextBtn = document.getElementById("video-feed-next");
      if (prevBtn) prevBtn.disabled = index === 0;
      if (nextBtn) nextBtn.disabled = index === cards.length - 1;
    }
```

3. **Update `setupNewsFeedObserver()`**:
```javascript
    function setupNewsFeedObserver() {
      const section = document.getElementById("news-section");
      if (!section || section.hidden) return;

      newsFeedObserver?.disconnect();
      const list = document.getElementById(activeNewsTab === "video" ? "video-news-list" : "news-list");
      if (!list) return;

      const cards = list.querySelectorAll(".news-feed-card");
      if (!("IntersectionObserver" in window)) {
        if (cards[0]) {
          cards[0].classList.add("is-current");
          if (activeNewsTab === "video") {
            loadVideoIframe(cards[0]);
            updateVideoFeedIndicator(cards[0]);
          }
        }
        return;
      }

      newsFeedObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const isIntersecting = entry.isIntersecting && entry.intersectionRatio >= 0.6;
          entry.target.classList.toggle("is-current", isIntersecting);
          if (isIntersecting) {
            if (activeNewsTab === "video") {
              loadVideoIframe(entry.target);
              updateVideoFeedIndicator(entry.target);
            }
          } else {
            if (activeNewsTab === "video") {
              unloadVideoIframe(entry.target);
            }
          }
        });
      }, { root: list, threshold: [0.6] });

      cards.forEach((card) => newsFeedObserver.observe(card));
    }
```

4. **Modify `loadVideoNews()` to support skeleton loaders**:
```javascript
    async function loadVideoNews(options = {}) {
      try {
        const list = document.getElementById("video-news-list");
        if (list && activeNewsTab === "video") {
          list.innerHTML = Array(3).fill(0).map(() => `
            <div class="news-item video-card news-feed-card skeleton-card">
              <div class="video-card-thumb skeleton-thumbnail"></div>
              <div class="skeleton-line skeleton-title"></div>
              <div class="skeleton-line skeleton-meta"></div>
            </div>
          `).join("");
        }
        const params = new URLSearchParams();
        if (options.refresh) params.set("refresh", "1");
        const json = await fetchJsonOrNull("/api/news/videos?" + params.toString());
        if (json && json.videos) {
          currentVideoNews = json.videos;
          if (activeNewsTab === "video") applyNewsFilterAndRender();
        }
      } catch (err) {
        console.error("Failed to load video news", err);
      }
    }
```

5. **Modify Arrow keys listener check to avoid text input interception**:
```javascript
    document.addEventListener("keydown", (event) => {
      const section = document.getElementById("news-section");
      if (!section || section.hidden) return;

      // Skip arrow keys action when typing in form controls
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setWorkspacePanel("cameras");
      } else if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        moveNewsFeed(1);
      } else if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        moveNewsFeed(-1);
      }
    });
```

6. **Bind the click events for Prev/Next buttons** in the initialization block (e.g. after line 2984):
```javascript
    document.getElementById("video-feed-prev")?.addEventListener("click", () => {
      moveNewsFeed(-1);
    });
    document.getElementById("video-feed-next")?.addEventListener("click", () => {
      moveNewsFeed(1);
    });
```

---

## 5. Verification Method

### A. How to Run the Environment
1. Start the Node.js backend:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
2. Start the AI python detector:
   ```bash
   cd ai_module
   source venv/bin/activate
   pip install -r requirements.txt
   python detector_api.py
   ```
3. Open browser at `http://localhost:3000`.

### B. Manual Verification of requirements
* **Video Feed (R1)**:
  * Click on the "Tin tức tình huống" button in the workspace tabs to open the News Feed.
  * Click "Video" tab. Check that the cards snap-scroll vertically.
  * Verify that a YouTube iframe is injected inside the card container when it snaps to the viewport.
  * Scroll away from the card and verify (via inspect element) that the iframe element is destroyed (src set to `""` and element removed) to preserve memory.
  * Verify the floating indicator shows "1 / N" and updates correctly as you scroll.
  * Click the "Prev" and "Next" buttons and confirm they scroll the feed smoothly.
* **Performance (R2)**:
  * Check that 3 skeleton cards shimmer when initially loading the video tab.
  * Focus on the news list and press the `Up` and `Down` arrow keys. Check that cards scroll snap correctly.
  * Type inside the `#news-search-input` field and press `Up` or `Down` arrow keys. Confirm the feed does NOT scroll, and cursor moves within the input box normally.
* **UI Polish (R3)**:
  * Switch to Light mode. Inspect the `.news-meta` text and verify that it uses the corrected, higher-contrast `--text-muted` color, making it easily readable (contrast ratio > 4.5:1).
  * Hover over the close "X" button and verify it transitions smoothly from quiet gray to active white/black background.
