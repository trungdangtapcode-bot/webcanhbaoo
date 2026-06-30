# Project: Smart Alert System News Video Upgrade & UI Polish

## Architecture
- **Backend (Express)**: Serves the static assets from `frontend/` and provides the APIs:
  - `/api/news/videos` (returns JSON of news videos)
  - `/api/youtube/embed` (serves the YouTube embedded player page)
- **Frontend (Vanilla HTML/CSS/JS)**:
  - `frontend/index.html`: Contains the sidebar news panel structure.
  - `frontend/css/style.css`: Contains layout, themes (dark/light), scroll-snap rules, and typography.
  - `frontend/js/app.js`: Fetches videos, handles tab changes, renders feed cards, observes viewport intersections, and implements keyboard and button navigation.

## Milestones
| # | Name | Scope | Dependencies | Status | Conversation ID |
|---|------|-------|-------------|--------|-----------------|
| 1 | E2E Test Suite | Build E2E test harness and Tier 1-4 cases for news feed, scroll, contrast, and performance. | None | DONE | 0088b7dd-a3b5-4618-a36c-ef47210729d1 |
| 2 | Core Video & UI Polish (R1-R3) | Implement vertical scroll-snap feed, iframe lazy-loading, smooth scroll/perf, skeleton loaders, keyboard nav, and contrast/UI polish. | M1 | DONE | d5193a5b-7790-4b96-8dbf-40ec2e5fd00f |
| 3 | Integration & Phase 2 | Run full E2E validation and perform adversarial coverage hardening. | M2 | IN_PROGRESS | 44515fec-1c55-4698-a289-a586363da49b |

## Interface Contracts
### Video Card HTML Structure
The video items in `#video-news-list` must be rendered with:
- Tag: `div` (not `button`)
- Classes: `.news-item.video-card.news-feed-card`
- Attributes: `data-video-id`, `data-youtube-id`
- Child containers:
  - `.video-card-thumb` (contains `img`, play button icon, and `.video-player-iframe-container` for iframe injection)
  - `.video-skeleton-loader` (shown while iframe is loading)
  - `.video-player-iframe-container` (initially empty, dynamically populated with `iframe`)

### Scroll State & DOM Classes
- Active Card Class: `.is-current` added by `IntersectionObserver` when the card intersection ratio is >= 60%.
- YouTube embed URL: `/api/youtube/embed?videoId=<youtubeId>&autoplay=1&mute=1&origin=<origin>`

### Control Elements
- Container: `.video-feed-controls` in `index.html`.
- Prev button: `#video-feed-prev`
- Next button: `#video-feed-next`
- Page/Position indicator text: `#video-feed-indicator`

## Code Layout
- `frontend/index.html` - Core markup
- `frontend/css/style.css` - UI layout, themes, animation, and controls
- `frontend/js/app.js` - JS logic, observer, event bindings, and feed state
