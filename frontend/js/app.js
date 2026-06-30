    const MAP_CENTER = [10.7769, 106.7009];
    const MAP_ZOOM = 13;
    const CITY_VIEWPORT = {
      minLat: 10.35,
      maxLat: 11.15,
      minLng: 106.35,
      maxLng: 107.05,
    };
    const THEME_STORAGE_KEY = "smart-alert-theme";
    const TILE_URLS = {
      dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    };
    const PAGE_PARAMS = new URLSearchParams(window.location.search);
    const FIRE_DEMO_VIDEO_URL = "./assets/demo/perry-fire.webm";
    const FLOOD_DEMO_VIDEO_URL = "./assets/demo/flood-intersection.webm";
    const TRAFFIC_DEMO_VIDEO_URL = "./assets/demo/rush-hour-traffic.webm";
    const CAMERA_SOURCES = {
      hcm: {
        endpoint: "/api/cameras/hcm?include_demo=true",
        fallbackEndpoint: "/api/cameras",
        label: "TP.HCM",
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
      },
      hanoi: {
        endpoint: "/api/cameras/hanoi?include_demo=true",
        fallbackEndpoint: "/api/cameras/hanoi",
        label: "Hà Nội",
        center: [21.0285, 105.8542],
        zoom: 12,
      },
    };
    const DASHBOARD_DEMO_SOURCES = {
      fire: {
        url: FIRE_DEMO_VIDEO_URL,
        cameraId: "DEMO_FIRE_CAM_001",
        cameraName: "Camera mô phỏng — Sự cố cháy",
        eventType: "fire",
        label: "cháy",
        maxAttempts: 24,
      },
      flood: {
        url: FLOOD_DEMO_VIDEO_URL,
        cameraId: "DEMO_FLOOD_CAM_001",
        cameraName: "Camera mô phỏng — Tuyến đường ngập",
        eventType: "flood",
        label: "ngập",
        maxAttempts: 18,
      },
      traffic: {
        url: TRAFFIC_DEMO_VIDEO_URL,
        cameraId: "DEMO_TRAFFIC_CAM_001",
        cameraName: "Camera mô phỏng — Ùn tắc giờ cao điểm",
        eventType: "traffic_jam",
        label: "ùn tắc",
        maxAttempts: 18,
      },
    };
    const ALERT_TYPES = {
      traffic_jam: { label: "Phát hiện ùn tắc giao thông", shortLabel: "Ùn tắc", color: "traffic_jam" },
      fire: { label: "Phát hiện sự cố cháy", shortLabel: "Cháy", color: "fire" },
      flood: { label: "Phát hiện ngập lụt", shortLabel: "Ngập", color: "flood" },
      normal: { label: "Bình thường", shortLabel: "Bình thường", color: "normal" },
    };
    const SEVERITY_LABELS = {
      critical: "Khẩn cấp",
      high: "Nguy hiểm",
      medium: "Cảnh báo",
      low: "Theo dõi",
      normal: "Bình thường",
    };
    const CP1252 = {
      0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
      0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
      0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
      0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
      0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
      0x017e: 0x9e, 0x0178: 0x9f,
    };

    const API_BASE = window.SMART_ALERT_API_BASE || (
      window.location.protocol === "file:" || ["4173", "5173"].includes(window.location.port)
        ? "http://localhost:3000"
        : ""
    );
    const AUTH_SESSION_KEY = "smart-alert-auth-session";
    const NEARBY_ALERTS_STORAGE_KEY = "smart-alert-nearby-alerts-enabled";
    const cameras = new Map();
    const alerts = [];
    const activeAlerts = new Map();
    const alertQueue = new Map();
    const statsEvents = [];
    const notifiedNearbyAlerts = new Set();
    let cameraHealthSummary = { live: 0, issues: 0, unchecked: 0, total: 0 };
    let cameraHealthChecking = false;
    let trafficHeatLayer = null;
    let trafficHeatVisible = true;
    let mapOnlyMode = false;
    let routeCameraIds = null;
    let cameraClusterLayer = null;
    let activeFilter = "all";
    let activeMapIncidentFilter = "all";
    let activeCameraId = null;
    let activeVideoCameraId = null;
    let activeCameraSource = PAGE_PARAMS.get("city") === "hanoi" ? "hanoi" : "hcm";
    let activeWorkspacePanel = "cameras";
    let streamRefreshTimer = null;
    let hanoiStreamRetryTimer = null;
    let hanoiStatusTimer = null;
    let streamSessionId = 0;
    let tileLayer = null;
    let mapToolbarResizeObserver = null;
    let statsRange = "24h";
    let nearbyRadius = 10000;
    let nearbyNotificationsEnabled = false;
    let activeNewsCategory = "all";
    let currentNewsItems = [];
    let newsSearchQuery = "";
    let newsSourceFilter = "all";
    let activeNewsTab = "text";
    let userLocation = null;
    let showOnlyNearbyCameras = true;
    let isFollowMeMode = false;
    let isVoiceAlertEnabled = false;
    let currentTimeRange = "24h";
    let isCameraLayerVisible = true;
    let isAlertLayerVisible = true;
    let geoWatchId = null;
    let userLocationMarker = null;
    
    let currentVideoNews = [];
    let userLocationAccuracyCircle = null;
    let newsMarkers = [];
    let realtimeSocket = null;
    let notificationServiceWorkerRegistration = null;
    let dashboardDemoRunToken = 0;
    let dashboardDemoRunning = false;
    let preferredVietnameseVoice = null;
    let speechRequestId = 0;

    const map = L.map("map", {
      zoomControl: false,
      attributionControl: false,
      maxZoom: 19,
    }).setView(MAP_CENTER, MAP_ZOOM);

    trafficHeatLayer = L.layerGroup().addTo(map);
    if (typeof L.markerClusterGroup === "function") {
      cameraClusterLayer = L.markerClusterGroup({
        disableClusteringAtZoom: 17,
        maxClusterRadius: 46,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: false,
        iconCreateFunction: createCameraClusterIcon,
      }).addTo(map);
      cameraClusterLayer.on("clusterclick", handleCameraClusterClick);
    }
    L.control.zoom({ position: "topright" }).addTo(map);

    L.Control.LocationButton = L.Control.extend({
      onAdd: function(map) {
        var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        container.style.backgroundColor = 'var(--surface)';
        container.style.width = '34px';
        container.style.height = '34px';
        container.style.cursor = 'pointer';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.style.transition = 'background-color var(--fast)';
        container.title = "Lấy vị trí hiện tại của bạn";
        
        container.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text)"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line></svg>`;

        container.onmouseover = function() {
          container.style.backgroundColor = 'var(--surface-hover, #e0e0e0)';
        };
        container.onmouseout = function() {
          container.style.backgroundColor = 'var(--surface)';
        };

        container.onclick = async function(e) {
          e.stopPropagation();
          e.preventDefault();
          try {
             container.style.opacity = '0.5';
             const loc = await requestUserLocation({ focus: true });
             if (loc) {
               map.flyTo([loc.lat, loc.lng], 15);
             }
          } catch(err) {
             console.error("Location error", err);
          } finally {
             container.style.opacity = '1';
          }
        }
        return container;
      }
    });
    new L.Control.LocationButton({ position: 'topright' }).addTo(map);
    setMapTiles(getCurrentTheme());

    function getCurrentTheme() {
      return document.documentElement.dataset.theme === "light" ? "light" : "dark";
    }

    function setMapTiles(theme) {
      if (tileLayer) map.removeLayer(tileLayer);
      tileLayer = L.tileLayer(TILE_URLS[theme], {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);
    }

    function updateThemeButton(theme) {
      const button = document.getElementById("theme-toggle");
      if (!button) return;
      const nextTheme = theme === "light" ? "dark" : "light";
      button.setAttribute("aria-label", "Switch to " + nextTheme + " mode");
      button.setAttribute("title", "Switch to " + nextTheme + " mode");
      button.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
    }

    function applyTheme(theme, options = {}) {
      const nextTheme = theme === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = nextTheme;
      if (typeof window.syncWebAwesomeTheme === "function") {
        window.syncWebAwesomeTheme(nextTheme);
      }
      updateThemeButton(nextTheme);
      setMapTiles(nextTheme);
      if (options.persist !== false) {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        } catch (_err) {}
      }
    }

    function iconSvg(type) {
      const icons = {
        camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-7Z" stroke="currentColor" stroke-width="1.8"/><path d="M9.4 6 10.9 4h2.2l1.5 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" stroke="currentColor" stroke-width="1.8"/>',
        play: '<path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/>',
        traffic_jam: '<path d="M6.2 16.8h11.6M7.6 11h8.8l1.4 3.7H6.2L7.6 11Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.2 16.8v1.5M15.8 16.8v1.5M8.8 8.3h6.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.8 14.6h.01M15.2 14.6h.01" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
        fire: '<path d="M12.2 21c3.5 0 6-2.4 6-5.8 0-2.4-1.3-4.2-3.2-5.8.1 1.7-.7 2.8-1.8 3.5.1-3.1-1.2-5.5-3.8-7.9.2 3.8-3.6 5.2-3.6 9.8 0 3.6 2.7 6.2 6.4 6.2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 18.6c1.4 0 2.4-.9 2.4-2.2 0-1-.6-1.8-1.4-2.5-.1 1-.6 1.6-1.2 2-.2-.9-.7-1.8-1.6-2.6.1 2-1.1 2.7-1.1 4.1 0 1.1.9 2.2 2.9 2.2Z" fill="currentColor" opacity=".2"/>',
        flood: '<path d="M4 9.5c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 14c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 18.5c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        news: '<path d="M5 5.5h10.5A2.5 2.5 0 0 1 18 8v10.5H6.5A2.5 2.5 0 0 1 4 16V6.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.8"/><path d="M18 9h1a1 1 0 0 1 1 1v6.5a2 2 0 0 1-2 2M8 10h6M8 13h6M8 16h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        alert: '<path d="M12 3.5 21 20H3L12 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v4.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 17.2h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
        close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      };
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' + (icons[type] || icons.camera) + "</svg>";
    }

    function looksMojibaked(text) {
      return /(?:[ÃÂÄÆ][\u0080-\u00ff]|á[º»]|â€)/.test(String(text || ""));
    }

    function cameraDotId(cameraId) {
      return "cam-dot-" + encodeURIComponent(cameraId);
    }

    function activeAlertKey(cameraId, eventType) {
      return cameraId + "::" + eventType;
    }

    function severityRank(severity) {
      return { critical: 4, high: 3, medium: 2, low: 1 }[severity] || 0;
    }

    function getDominantAlertForCamera(cameraId) {
      return Array.from(activeAlerts.values())
        .filter((alert) => alert.camera_id === cameraId)
        .sort((a, b) => {
          const severityDiff = severityRank(b.severity) - severityRank(a.severity);
          if (severityDiff) return severityDiff;
          return new Date(b.last_seen || b.timestamp) - new Date(a.last_seen || a.timestamp);
        })[0] || null;
    }

    function getLatestActiveAlert() {
      return Array.from(activeAlerts.values())
        .sort((a, b) => new Date(b.last_seen || b.timestamp) - new Date(a.last_seen || a.timestamp))[0] || null;
    }

    function cameraMatchesMapIncidentFilter(cameraId) {
      if (activeMapIncidentFilter === "all") return true;
      return Array.from(activeAlerts.values()).some((alert) =>
        alert.camera_id === cameraId && alert.event_type === activeMapIncidentFilter
      );
    }

    function cameraMatchesNearbyFilter(cameraId) {
      if (!showOnlyNearbyCameras || !userLocation) return true;
      const cam = cameras.get(cameraId);
      if (!cam?.data?.location?.lat || !cam?.data?.location?.lng) return false;
      const dist = distanceBetweenMeters(userLocation, { lat: cam.data.location.lat, lng: cam.data.location.lng });
      return dist <= nearbyRadius;
    }

    function getVisibleMapCameraCount() {
      return Array.from(cameras.keys()).filter((cameraId) => {
        const matchesRoute = !routeCameraIds || routeCameraIds.has(cameraId);
        return matchesRoute && cameraMatchesMapIncidentFilter(cameraId) && cameraMatchesNearbyFilter(cameraId);
      }).length;
    }

    function updateMapEmptyState(visibleCount = getVisibleMapCameraCount()) {
      const empty = document.getElementById("map-empty-filter");
      if (!empty) return;
      empty.hidden = activeMapIncidentFilter === "all" || visibleCount > 0;
    }

    function syncMapOverlayOffsets() {
      const toolbar = document.querySelector(".map-toolbar");
      const mapContainer = document.querySelector(".map-container");
      const empty = document.getElementById("map-empty-filter");
      if (!toolbar || !mapContainer || !empty) return;

      const toolbarRect = toolbar.getBoundingClientRect();
      const mapRect = mapContainer.getBoundingClientRect();
      const safeTop = Math.max(96, Math.ceil(toolbarRect.bottom - mapRect.top + 12));
      empty.style.setProperty("--map-empty-safe-top", safeTop + "px");
    }

    function observeMapToolbarLayout() {
      const toolbar = document.querySelector(".map-toolbar");
      if (!toolbar) return;
      syncMapOverlayOffsets();
      if (typeof ResizeObserver === "function") {
        mapToolbarResizeObserver = new ResizeObserver(syncMapOverlayOffsets);
        mapToolbarResizeObserver.observe(toolbar);
      }
      window.addEventListener("resize", syncMapOverlayOffsets, { passive: true });
    }

    function maybeRepairMojibake(value) {
      const text = String(value ?? "");
      if (!looksMojibaked(text)) return text;
      try {
        const bytes = [];
        for (const char of text) {
          const code = char.codePointAt(0);
          if (code <= 0xff) bytes.push(code);
          else if (CP1252[code]) bytes.push(CP1252[code]);
          else return text;
        }
        return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
      } catch (_err) {
        return text;
      }
    }

    function escapeHtml(value) {
      return maybeRepairMojibake(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char]);
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/`/g, "&#096;");
    }

    function escapeCssSelector(value) {
      if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
      return String(value).replace(/["\\]/g, "\\$&");
    }

    function formatTime(value, withSeconds = true) {
      const date = value ? new Date(value) : new Date();
      if (Number.isNaN(date.getTime())) return "--:--";
      return date.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: withSeconds ? "2-digit" : undefined,
      });
    }

    function formatDateTime(value) {
      const date = value ? new Date(value) : new Date();
      if (Number.isNaN(date.getTime())) return "Không rõ thời gian";
      return date.toLocaleString("vi-VN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    function apiUrl(path) {
      if (/^https?:\/\//i.test(path)) return path;
      return API_BASE + path;
    }

    async function fetchJsonOrNull(url, options = {}) {
      const res = await fetch(apiUrl(url), options);
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) return null;
      return res.json();
    }

    async function postJsonOrNull(url, body = {}) {
      const res = await fetch(apiUrl(url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) return null;
      return res.json();
    }

    function toDateTimeLocalValue(date) {
      const pad = (value) => String(value).padStart(2, "0");
      return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
      ].join("-") + "T" + [pad(date.getHours()), pad(date.getMinutes())].join(":");
    }

    function getStatsWindow() {
      const now = new Date();
      if (statsRange === "all") return {};
      if (statsRange === "custom") {
        const fromValue = document.getElementById("stats-from")?.value;
        const toValue = document.getElementById("stats-to")?.value;
        const from = fromValue ? new Date(fromValue) : null;
        const to = toValue ? new Date(toValue) : null;
        return {
          from: from && !Number.isNaN(from.getTime()) ? from : null,
          to: to && !Number.isNaN(to.getTime()) ? to : null,
        };
      }

      const hours = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }[statsRange] || 24;
      return { from: new Date(now.getTime() - hours * 60 * 60 * 1000), to: now };
    }

    function buildStatsQuery() {
      const params = new URLSearchParams({ limit: "1000" });
      const { from, to } = getStatsWindow();
      if (from) params.set("from", from.toISOString());
      if (to) params.set("to", to.toISOString());
      return "/api/events?" + params.toString();
    }

    function normalizeEventForUi(evt) {
      const cam = cameras.get(evt.camera_id)?.data;
      return {
        camera_id: evt.camera_id,
        event_type: evt.event_type,
        severity: evt.severity,
        camera_name: evt.camera_name || (cam ? cam.name : evt.camera_id),
        lat: evt.lat ?? (cam ? cam.location.lat : 0),
        lng: evt.lng ?? (cam ? cam.location.lng : 0),
        timestamp: evt.timestamp,
        last_seen: evt.last_seen,
        metadata: evt.metadata || {},
      };
    }

    function isEventInCurrentStatsRange(evt) {
      const time = new Date(evt.timestamp || evt.last_seen).getTime();
      if (Number.isNaN(time)) return false;
      const { from, to } = getStatsWindow();
      if (from && time < from.getTime()) return false;
      if (to && time > to.getTime()) return false;
      return true;
    }

    function getRangeLabel() {
      if (statsRange === "24h") return "24h";
      if (statsRange === "7d") return "7d";
      if (statsRange === "30d") return "30d";
      if (statsRange === "all") return "All";
      return "Custom";
    }

    function formatDistance(meters) {
      if (!Number.isFinite(meters)) return "unknown";
      if (meters < 1000) return Math.round(meters) + "m";
      return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + "km";
    }

    function distanceBetweenMeters(a, b) {
      const earthRadiusMeters = 6371000;
      const toRad = (value) => (value * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function setConnection(connected, text) {
      const badge = document.getElementById("connection-badge");
      const label = document.getElementById("connection-text");
      badge.className = connected ? "connection-badge connected" : "connection-badge disconnected";
      label.textContent = text;
      badge.title = text;
      badge.setAttribute("aria-label", text);
    }

    function getCurrentUser() {
      try {
        const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
        if (!session?.email) return null;
        return session;
      } catch (_err) {
        return null;
      }
    }

    function renderAuthState() {
      const user = getCurrentUser();
      if (!user) {
        window.location.replace("login.html");
        return;
      }
      document.getElementById("account-user-name").textContent = user.name || user.email;
      const adminLink = document.getElementById("account-admin-link");
      if (adminLink) adminLink.hidden = user.role !== "admin";
    }

    function logout() {
      localStorage.removeItem(AUTH_SESSION_KEY);
      window.location.href = "login.html";
    }

    function updateClock() {
      const now = new Date();
      document.getElementById("operations-clock").textContent =
        "Live operations - " + formatDateTime(now);
      document.getElementById("last-sync").textContent = formatTime(now);
    }

    function setVoiceAlertButtonState(state = "off") {
      const button = document.getElementById("voice-alert-btn");
      const label = document.getElementById("voice-alert-text");
      if (!button || !label) return;

      const enabled = state === "on" || state === "speaking";
      button.classList.toggle("enabled", enabled);
      button.setAttribute("aria-pressed", String(enabled));
      button.title = enabled ? "Tắt cảnh báo bằng giọng nói" : "Bật cảnh báo bằng giọng nói";
      label.textContent = {
        on: "🔊 Đọc cảnh báo",
        speaking: "🔊 Đang đọc…",
        unsupported: "🔇 Không hỗ trợ",
        error: "🔇 Lỗi giọng nói",
        off: "🔇 Im lặng",
      }[state] || "🔇 Im lặng";
    }

    function refreshVietnameseVoice() {
      if (!window.speechSynthesis?.getVoices) return null;
      const voices = window.speechSynthesis.getVoices();
      preferredVietnameseVoice = voices.find((voice) =>
        String(voice.lang || "").toLowerCase() === "vi-vn"
      ) || voices.find((voice) =>
        String(voice.lang || "").toLowerCase().startsWith("vi")
      ) || null;
      return preferredVietnameseVoice;
    }

    function initializeSpeechSynthesis() {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        setVoiceAlertButtonState("unsupported");
        return false;
      }
      refreshVietnameseVoice();
      window.speechSynthesis.addEventListener?.("voiceschanged", refreshVietnameseVoice);
      return true;
    }

    function speakAlert(text, options = {}) {
      if (!isVoiceAlertEnabled) return false;
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        isVoiceAlertEnabled = false;
        setVoiceAlertButtonState("unsupported");
        return false;
      }

      const requestId = ++speechRequestId;
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(String(text || "").trim());
      if (!utterance.text) return false;
      const voice = preferredVietnameseVoice || refreshVietnameseVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || "vi-VN";
      utterance.rate = 0.96;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onstart = () => {
        if (requestId === speechRequestId && isVoiceAlertEnabled) setVoiceAlertButtonState("speaking");
      };
      utterance.onend = () => {
        if (requestId === speechRequestId && isVoiceAlertEnabled) setVoiceAlertButtonState("on");
      };
      utterance.onerror = (event) => {
        if (["canceled", "interrupted"].includes(event.error)) return;
        if (requestId === speechRequestId && isVoiceAlertEnabled) setVoiceAlertButtonState("error");
      };

      synth.cancel();
      if (synth.paused) synth.resume();
      const play = () => {
        if (requestId !== speechRequestId || !isVoiceAlertEnabled) return;
        synth.speak(utterance);
        if (synth.paused) synth.resume();
      };
      if (options.immediate) play();
      else window.setTimeout(play, 60);
      return true;
    }

    function createMarkerIcon(status = "normal") {
      const iconType = status === "normal" ? "camera" : status;
      return L.divIcon({
        html: '<div class="map-marker status-' + status + '">' + iconSvg(iconType) + "</div>",
        className: "",
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -20],
      });
    }

    function createCameraClusterIcon(cluster) {
      const count = cluster.getChildCount();
      const size = count >= 100 ? 58 : count >= 30 ? 50 : 42;
      const level = count >= 100 ? "large" : count >= 30 ? "medium" : "small";
      return L.divIcon({
        html: `<div class="camera-cluster ${level}"><span>${count}</span><small>cams</small></div>`,
        className: "camera-cluster-shell",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    }

    function getMarkerCamera(marker) {
      return cameras.get(marker?.options?.cameraId);
    }

    function buildClusterPopup(markers) {
      const sorted = markers
        .map((marker) => getMarkerCamera(marker))
        .filter(Boolean)
        .sort((a, b) => maybeRepairMojibake(a.data.name).localeCompare(maybeRepairMojibake(b.data.name)));
      const preview = sorted.slice(0, 9);
      const extra = Math.max(sorted.length - preview.length, 0);

      return `
        <div class="cluster-popup">
          <div class="cluster-popup-head">
            <strong>${sorted.length} cameras nearby</strong>
            <span>Click a camera to focus or zoom in for individual markers.</span>
          </div>
          <div class="cluster-camera-list">
            ${preview.map((cam) => `
              <button class="cluster-camera-action" type="button" data-focus-camera-id="${escapeAttr(cam.data.camera_id)}">
                <span>${escapeHtml(cam.data.name)}</span>
                <small>${escapeHtml(getHealthLabel(cam.healthStatus || "unchecked"))}</small>
              </button>
            `).join("")}
            ${extra ? `<div class="cluster-more">+${extra} more cameras in this cluster</div>` : ""}
          </div>
        </div>
      `;
    }

    function handleCameraClusterClick(event) {
      const cluster = event.layer;
      const markers = cluster.getAllChildMarkers();
      L.popup({ maxWidth: 340, closeButton: true })
        .setLatLng(cluster.getLatLng())
        .setContent(buildClusterPopup(markers))
        .openOn(map);

      if (markers.length > 24 && map.getZoom() < 15) {
        map.fitBounds(cluster.getBounds().pad(0.16), { maxZoom: 15, animate: true, paddingTopLeft: [450, 80] });
      } else if (typeof cluster.spiderfy === "function" && map.getZoom() >= 15) {
        cluster.spiderfy();
      }
    }

    function getAlertMeta(type) {
      return ALERT_TYPES[type] || { label: "Cảnh báo chưa xác định", shortLabel: "Cảnh báo", color: "normal" };
    }

    function getSeverityLabel(severity) {
      return SEVERITY_LABELS[String(severity || "medium").toLowerCase()] || "Chưa xác định";
    }

    function buildNormalPopup(cam) {
      const id = escapeAttr(cam.camera_id);
      const isRecordedDemo = cam.source === "simulated_demo" || cam.stream_type === "recorded_demo";
      const demoEventType = cam.metadata?.expected_event_type || "normal";
      const demoLabel = getAlertMeta(demoEventType).shortLabel;
      return `
        <div class="popup-content">
          <div class="popup-heading">
            <div class="popup-icon">${iconSvg("camera")}</div>
            <div>
              <div class="popup-title">${escapeHtml(cam.name)}</div>
              <div class="popup-meta">${escapeHtml(cam.location?.address || "Chưa có địa chỉ")}</div>
            </div>
          </div>
          <div class="popup-badge ${isRecordedDemo ? escapeAttr(demoEventType) : ""}">${isRecordedDemo ? `Mô phỏng ${escapeHtml(demoLabel.toLowerCase())}` : "Bình thường"}</div>
          <button class="popup-action" type="button" data-camera-id="${id}">
            ${iconSvg("play")}
            ${isRecordedDemo ? "Xem camera mô phỏng" : "Xem trực tiếp"}
          </button>
          ${isRecordedDemo ? `
            <a class="popup-action demo-detect-action" href="./demo.html?incident=${escapeAttr(demoEventType === "traffic_jam" ? "traffic" : demoEventType)}&autoplayDemo=1">
              ${iconSvg("alert")}
              Chạy nhận diện AI
            </a>
          ` : ""}
        </div>
      `;
    }

    function buildAlertPopup(alertData) {
      const meta = getAlertMeta(alertData.event_type);
      const cameraId = escapeAttr(alertData.camera_id);
      const imgTag = alertData.image_base64
        ? `<img class="popup-image" src="${alertData.image_base64.startsWith("data:") ? alertData.image_base64 : `data:image/jpeg;base64,${alertData.image_base64}`}" alt="Detection snapshot" />`
        : "";

      return `
        <div class="popup-content">
          <div class="popup-heading">
            <div class="popup-icon">${iconSvg(alertData.event_type)}</div>
            <div>
              <div class="popup-title">${escapeHtml(alertData.camera_name || "Camera được chọn")}</div>
              <div class="popup-meta">${formatDateTime(alertData.timestamp)}</div>
            </div>
          </div>
          <div class="popup-badge ${meta.color}">${escapeHtml(meta.label)}</div>
          ${imgTag}
          <button class="popup-action" type="button" data-camera-id="${cameraId}">
            ${iconSvg("play")}
            Xem camera
          </button>
        </div>
      `;
    }

    function addCameraMarker(cam) {
      const marker = L.marker([cam.location.lat, cam.location.lng], {
        icon: createMarkerIcon("normal"),
        cameraId: cam.camera_id,
      });

      marker.bindPopup(buildNormalPopup(cam));
      cameras.set(cam.camera_id, {
        data: cam,
        marker,
        status: "normal",
        health: null,
        healthStatus: "unchecked",
      });
      updateCameraMarkerVisibility(cam.camera_id);
    }

    function clearCameraMarkers() {
      if (cameraClusterLayer) {
        cameraClusterLayer.clearLayers();
      } else {
        cameras.forEach((cam) => {
          if (cam.marker && map.hasLayer(cam.marker)) map.removeLayer(cam.marker);
        });
      }
      cameras.clear();
      activeCameraId = null;
      routeCameraIds = null;
      cameraHealthSummary = { live: 0, issues: 0, unchecked: 0, total: 0 };
    }

    function updateCameraSourceTabs() {
      document.querySelectorAll("[data-camera-source]").forEach((button) => {
        const isActive = button.dataset.cameraSource === activeCameraSource;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    }

    async function loadCameraDataset(options = {}) {
      const config = CAMERA_SOURCES[activeCameraSource] || CAMERA_SOURCES.hcm;
      updateCameraSourceTabs();
      clearCameraMarkers();
      renderCameraList();

      let json = await fetchJsonOrNull(config.endpoint);
      if ((!json || !(json.cameras || []).length) && config.fallbackEndpoint !== config.endpoint) {
        json = await fetchJsonOrNull(config.fallbackEndpoint);
      }
      if (!json) throw new Error("Camera API unavailable");

      (json.cameras || []).forEach((cam) => addCameraMarker(cam));
      syncIncidentDemoPanel();
      renderCameraList();
      updateHealthSummaryUi({ total: cameras.size, live: 0, issues: 0, unchecked: cameras.size });

      if (options.fit !== false) {
        if (cameras.size) fitMapToCameras();
        else map.flyTo(config.center, config.zoom);
      }
      return json;
    }

    async function setCameraSource(source) {
      if (!CAMERA_SOURCES[source] || source === activeCameraSource) return;
      activeCameraSource = source;
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("city", source);
        window.history.replaceState({}, "", url);
      } catch (_err) {}
      document.getElementById("incident-focus-count").textContent = "0";
      document.getElementById("incident-focus-copy").textContent = "Loading " + CAMERA_SOURCES[source].label + " cameras.";
      await loadCameraDataset({ fit: true });
      await loadCameraHealth();
      await loadActiveAlerts();
    }

    function getHealthLabel(status) {
      return {
        black: "Mất hình",
        error: "Lỗi",
        live: "Đang hoạt động",
        offline: "Không khả dụng",
        stale: "Hình ảnh đã cũ",
        timeout: "Quá thời gian",
        unchecked: "Chưa kiểm tra",
      }[status] || "Chưa kiểm tra";
    }

    function isHealthIssue(status) {
      return ["black", "error", "offline", "stale", "timeout"].includes(status);
    }

    function getCameraHealthCopy(cam) {
      if (cam.data?.stream_type === "recorded_demo" || cam.data?.source === "simulated_demo") {
        return "Camera mô phỏng · video sẵn sàng";
      }
      if (cam.data?.stream_type === "wss_video" && cam.healthStatus === "unchecked") {
        return "Nguồn camera thời gian thực";
      }
      const status = cam.healthStatus || "unchecked";
      const checkedAt = cam.health?.checked_at ? " - " + formatTime(cam.health.checked_at, false) : "";
      const response = cam.health?.response_ms ? " - " + cam.health.response_ms + "ms" : "";
      return getHealthLabel(status) + checkedAt + response;
    }

    function updateHealthSummaryUi(summary = cameraHealthSummary) {
      const total = summary.total || cameras.size;
      const live = summary.live || 0;
      const issues = summary.issues ?? summary.offline ?? 0;
      cameraHealthSummary = {
        total,
        live,
        issues,
        black: summary.black || 0,
        error: summary.error || 0,
        stale: summary.stale || 0,
        timeout: summary.timeout || 0,
        unchecked: Number.isFinite(summary.unchecked) && summary.total
          ? summary.unchecked
          : Math.max(total - live - issues, 0),
      };

      const liveEl = document.getElementById("health-live-count");
      const offlineEl = document.getElementById("health-offline-count");
      const uncheckedEl = document.getElementById("health-unchecked-count");
      if (liveEl) liveEl.textContent = cameraHealthSummary.live;
      if (offlineEl) offlineEl.textContent = cameraHealthSummary.issues;
      if (uncheckedEl) uncheckedEl.textContent = cameraHealthSummary.unchecked;
      document.getElementById("metric-active").textContent =
        cameraHealthSummary.live || cameraHealthSummary.total || cameras.size;
    }

    function applyCameraHealth(healthItems = []) {
      healthItems.forEach((item) => {
        const cam = cameras.get(item.camera_id);
        if (!cam) return;
        cam.health = item;
        cam.healthStatus = item.status || "unchecked";
        if (cam.status === "normal") updateCameraDot(item.camera_id, cam.healthStatus);
      });
    }

    function renderCameraList() {
      const list = document.getElementById("camera-list");
      const query = document.getElementById("camera-search").value.trim().toLowerCase();
      const activeFilterEl = document.querySelector(".cam-filter-chip.active");
      const filterMode = activeFilterEl ? activeFilterEl.dataset.filter : "all";
      list.innerHTML = "";
      let rendered = 0;

      cameras.forEach((cam, id) => {
        if (routeCameraIds && !routeCameraIds.has(id)) return;
        if (filterMode === "alerts" && cam.status === "normal") return;
        if (filterMode === "live" && cam.healthStatus !== "live") return;
        if (filterMode === "offline" && !isHealthIssue(cam.healthStatus)) return;
        if (filterMode === "unchecked" && cam.healthStatus !== "unchecked") return;

        const searchable = [cam.data.name, cam.data.location?.address].map(maybeRepairMojibake).join(" ").toLowerCase();
        if (query && !searchable.includes(query)) return;

        const item = document.createElement("div");
        item.className = "camera-item" + (activeCameraId === id ? " active" : "");
        item.id = "cam-item-" + id;
        item.innerHTML = `
          <button class="camera-main" type="button" data-focus-camera-id="${escapeAttr(id)}">
            <span class="camera-status-dot" id="${cameraDotId(id)}"></span>
            <span class="camera-info">
              <span class="camera-name">${escapeHtml(cam.data.name)}</span>
              <span class="camera-id ${escapeAttr(cam.healthStatus || "unchecked")}">${escapeHtml(getCameraHealthCopy(cam))}</span>
            </span>
          </button>
          <button class="camera-watch" type="button" title="Watch live" aria-label="Watch live" data-camera-id="${escapeAttr(id)}">
            ${iconSvg("play")}
          </button>
        `;
        list.appendChild(item);
        updateCameraDot(id, cam.status === "normal" ? cam.healthStatus : cam.status);
        rendered += 1;
      });

      if (!rendered) {
        list.innerHTML = `
          <div class="empty-state">
            ${iconSvg("camera")}
            <div class="empty-title">No cameras found</div>
            <div class="empty-copy">Try another camera name or area.</div>
          </div>
        `;
      }

      document.getElementById("camera-count").textContent = routeCameraIds ? `${rendered}/${cameras.size}` : cameras.size;
      document.getElementById("stat-cameras").textContent = cameras.size;
      updateHealthSummaryUi(cameraHealthSummary);
    }

    function updateCameraMarkerVisibility(cameraId) {
      const cam = cameras.get(cameraId);
      if (!cam?.marker) return;
      const matchesRoute = !routeCameraIds || routeCameraIds.has(cameraId);
      
      const hasAlert = !!getDominantAlertForCamera(cameraId);
      let layerVisible = false;
      if (isCameraLayerVisible) layerVisible = true;
      if (hasAlert && isAlertLayerVisible) layerVisible = true;
      
      const shouldShow = layerVisible && matchesRoute && cameraMatchesMapIncidentFilter(cameraId) && cameraMatchesNearbyFilter(cameraId);
      if (cameraClusterLayer) {
        const isClustered = cameraClusterLayer.hasLayer(cam.marker);
        if (shouldShow && !isClustered) cameraClusterLayer.addLayer(cam.marker);
        if (!shouldShow && isClustered) cameraClusterLayer.removeLayer(cam.marker);
        return;
      }

      const isOnMap = map.hasLayer(cam.marker);
      if (shouldShow && !isOnMap) cam.marker.addTo(map);
      if (!shouldShow && isOnMap) map.removeLayer(cam.marker);
    }

    function refreshCameraMarkerVisibility() {
      cameras.forEach((_cam, cameraId) => updateCameraMarkerVisibility(cameraId));
      renderCameraList();
      updateMapFilterSummary();
      if (activeMapIncidentFilter !== "all") renderTrafficHeatmap([]);
      const clearButton = document.getElementById("route-filter-clear");
      if (clearButton) clearButton.hidden = !routeCameraIds;
    }

    function updateMapFilterSummary() {
      const summary = document.getElementById("map-filter-count");
      if (!summary) return;
      if (activeMapIncidentFilter === "all") {
        summary.textContent = routeCameraIds ? "Camera trong tuyến" : "Tất cả camera";
        return;
      }
      const visibleCount = Array.from(cameras.keys()).filter((cameraId) => {
        const matchesRoute = !routeCameraIds || routeCameraIds.has(cameraId);
        return matchesRoute && cameraMatchesMapIncidentFilter(cameraId) && cameraMatchesNearbyFilter(cameraId);
      }).length;
      const labels = {
        traffic_jam: "tắc đường",
        flood: "ngập",
        fire: "cháy",
      };
      summary.textContent = `${visibleCount} camera ${labels[activeMapIncidentFilter] || "có sự cố"}`;
    }

    function updateMapFilterSummary() {
      const summary = document.getElementById("map-filter-count");
      const visibleCount = getVisibleMapCameraCount();
      updateMapEmptyState(visibleCount);
      if (!summary) return;
      if (activeMapIncidentFilter === "all") {
        summary.textContent = routeCameraIds ? "Camera trong tuyến" : "Tất cả camera";
        return;
      }
      const labels = {
        traffic_jam: "tắc đường",
        flood: "ngập",
        fire: "cháy",
      };
      summary.textContent = `${visibleCount} camera ${labels[activeMapIncidentFilter] || "có sự cố"}`;
    }

    function setMapIncidentFilter(filter) {
      activeMapIncidentFilter = ["all", "traffic_jam", "flood", "fire"].includes(filter) ? filter : "all";
      document.querySelectorAll("[data-map-incident-filter]").forEach((button) => {
        const isActive = button.dataset.mapIncidentFilter === activeMapIncidentFilter;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      refreshCameraMarkerVisibility();
      loadTrafficHeatmap();
    }

    function normalizeMapFilterLabels() {
      const labels = {
        all: "Tất cả",
        traffic_jam: "Tắc đường",
        flood: "Ngập",
        fire: "Cháy",
      };
      document.querySelectorAll("[data-map-incident-filter]").forEach((button) => {
        button.textContent = labels[button.dataset.mapIncidentFilter] || button.textContent;
      });
      updateMapFilterSummary();
    }

    function focusCamera(cameraId, zoom = 16) {
      const cam = cameras.get(cameraId);
      if (!cam) return;
      activeCameraId = cameraId;
      renderCameraList();
      if (cameraClusterLayer && cameraClusterLayer.hasLayer(cam.marker)) {
        cameraClusterLayer.zoomToShowLayer(cam.marker, () => {
          cam.marker.openPopup();
        });
      } else {
        map.flyTo([cam.data.location.lat, cam.data.location.lng], zoom, { duration: 0.65 });
        cam.marker.openPopup();
      }
    }

    function updateCameraDot(cameraId, eventType) {
      const dot = document.getElementById(cameraDotId(cameraId));
      const cam = cameras.get(cameraId);
      if (cam && ["normal", "traffic_jam", "fire", "flood"].includes(eventType)) cam.status = eventType;
      if (!dot) return;
      dot.className = "camera-status-dot";
      if (eventType === "traffic_jam") dot.classList.add("alert-traffic");
      else if (eventType === "fire") dot.classList.add("alert-fire");
      else if (eventType === "flood") dot.classList.add("alert-flood");
      else if (eventType === "live") dot.classList.add("health-live");
      else if (isHealthIssue(eventType)) dot.classList.add("health-offline");
      else dot.classList.add("health-unchecked");
      dot.title = ALERT_TYPES[eventType]?.label || getHealthLabel(eventType);
    }

    function refreshCameraClusterIcon(cam) {
      if (cameraClusterLayer && typeof cameraClusterLayer.refreshClusters === "function") {
        cameraClusterLayer.refreshClusters(cam.marker);
      }
    }

    function renderCameraAlertState(cameraId, options = {}) {
      const cam = cameras.get(cameraId);
      if (!cam?.marker) return;

      const dominantAlert = isAlertLayerVisible ? getDominantAlertForCamera(cameraId) : null;
      const markerEl = cam.marker.getElement();
      const activeAlert = dominantAlert;
      if (!activeAlert) {
        cam.marker.setIcon(createMarkerIcon("normal"));
        cam.marker.setPopupContent(buildNormalPopup(cam.data));
        cam.status = "normal";
        updateCameraDot(cameraId, cam.healthStatus || "unchecked");
        refreshCameraClusterIcon(cam);
        return;
      }

      cam.marker.setIcon(createMarkerIcon(activeAlert.event_type));
      cam.status = activeAlert.event_type;
      cam.marker.setPopupContent(buildAlertPopup(activeAlert));
      updateCameraDot(cameraId, activeAlert.event_type);
      refreshCameraClusterIcon(cam);

      const el = cam.marker.getElement();
      if (options.blink !== false && el) {
        const marker = el.querySelector(".map-marker");
        marker?.classList.add("marker-blink");
        setTimeout(() => marker?.classList.remove("marker-blink"), 5400);
      }

      if (options.openPopup !== false) cam.marker.openPopup();
    }

    function updateMarkerAlert(cameraId, alertData, options = {}) {
      activeAlerts.set(activeAlertKey(cameraId, alertData.event_type), alertData);
      renderCameraAlertState(cameraId, options);
      updateCameraMarkerVisibility(cameraId);
      updateMapFilterSummary();
      updateIncidentFocus(alertData);
      if (activeVideoCameraId === cameraId) updateVideoIncidentWatermark(cameraId);
    }

    function clearMarkerAlert(clearData) {
      activeAlerts.delete(activeAlertKey(clearData.camera_id, clearData.event_type));
      renderCameraAlertState(clearData.camera_id, { blink: false, openPopup: false });
      const cam = cameras.get(clearData.camera_id);
      const markerEl = cam?.marker?.getElement?.();
      markerEl?.querySelector(".map-marker")?.classList.remove("marker-blink");
      if (!getDominantAlertForCamera(clearData.camera_id)) cam?.marker?.closePopup?.();
      updateCameraMarkerVisibility(clearData.camera_id);
      updateMapFilterSummary();
      updateIncidentFocus(getLatestActiveAlert());
      if (activeVideoCameraId === clearData.camera_id) updateVideoIncidentWatermark(clearData.camera_id);
    }

    function refreshStatistics() {
      const counts = { fire: 0, flood: 0, traffic_jam: 0 };
      const byCamera = new Map();

      const now = Date.now();
      const filteredStats = currentTimeRange === "all" ? statsEvents : statsEvents.filter(event => {
        const t = new Date(event.timestamp).getTime();
        if (currentTimeRange === "1h") return now - t <= 3600000;
        if (currentTimeRange === "24h") return now - t <= 86400000;
        if (currentTimeRange === "7d") return now - t <= 7 * 86400000;
        return true;
      });

      filteredStats.forEach((event) => {
        if (counts[event.event_type] !== undefined) counts[event.event_type] += 1;
        const key = event.camera_id || "unknown";
        const current = byCamera.get(key) || { count: 0, name: event.camera_name || key };
        current.count += 1;
        byCamera.set(key, current);
      });

      document.getElementById("stat-fire").textContent = counts.fire;
      document.getElementById("stat-flood").textContent = counts.flood;
      document.getElementById("stat-traffic").textContent = counts.traffic_jam;
      document.getElementById("analytics-total").textContent = filteredStats.length;
      document.getElementById("stats-range-label").textContent = getRangeLabel();

      const peak = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      document.getElementById("analytics-peak").textContent =
        peak && peak[1] > 0 ? getAlertMeta(peak[0]).shortLabel : "None";

      const busiest = Array.from(byCamera.values()).sort((a, b) => b.count - a.count)[0];
      document.getElementById("analytics-busiest").textContent =
        busiest ? maybeRepairMojibake(busiest.name) : "None";
      renderIncidentLineChart();
    }

    function getChartWindow() {
      const explicit = getStatsWindow();
      const eventTimes = statsEvents
        .map((event) => new Date(event.timestamp || event.last_seen).getTime())
        .filter((time) => Number.isFinite(time));
      const now = new Date();

      if (explicit.from || explicit.to) {
        const to = explicit.to || now;
        const fallbackHours = statsRange === "7d" ? 24 * 7 : statsRange === "30d" ? 24 * 30 : 24;
        const from = explicit.from || new Date(to.getTime() - fallbackHours * 60 * 60 * 1000);
        return { from, to };
      }

      if (eventTimes.length) {
        const min = Math.min(...eventTimes);
        const max = Math.max(...eventTimes);
        const span = Math.max(max - min, 60 * 60 * 1000);
        return { from: new Date(min), to: new Date(max + span * 0.08) };
      }

      return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
    }

    function formatChartLabel(date, bucketMs) {
      if (bucketMs < 24 * 60 * 60 * 1000) {
        return date.toLocaleTimeString(navigator.language || "vi-VN", { hour: "2-digit", minute: "2-digit" });
      }
      return date.toLocaleDateString(navigator.language || "vi-VN", { day: "2-digit", month: "2-digit" });
    }

    function buildIncidentBuckets() {
      const { from, to } = getChartWindow();
      const fromMs = from.getTime();
      const toMs = Math.max(to.getTime(), fromMs + 60 * 60 * 1000);
      const bucketCount = statsRange === "7d" ? 7 : statsRange === "30d" ? 10 : 12;
      const bucketMs = (toMs - fromMs) / bucketCount;
      const buckets = Array.from({ length: bucketCount }, (_, index) => {
        const start = new Date(fromMs + bucketMs * index);
        return { label: formatChartLabel(start, bucketMs), count: 0 };
      });

      statsEvents.forEach((event) => {
        const time = new Date(event.timestamp || event.last_seen).getTime();
        if (!Number.isFinite(time) || time < fromMs || time > toMs) return;
        const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((time - fromMs) / bucketMs)));
        buckets[index].count += 1;
      });

      return buckets;
    }

    function renderIncidentLineChart() {
      const svg = document.getElementById("incident-line-chart");
      const subtitle = document.getElementById("analytics-chart-subtitle");
      if (!svg || !subtitle) return;

      const buckets = buildIncidentBuckets();
      const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.count));
      const width = 980;
      const height = 280;
      const pad = { top: 28, right: 26, bottom: 46, left: 42 };
      const plotWidth = width - pad.left - pad.right;
      const plotHeight = height - pad.top - pad.bottom;
      const xFor = (index) => pad.left + (plotWidth * index) / Math.max(1, buckets.length - 1);
      const yFor = (value) => pad.top + plotHeight - (plotHeight * value) / maxValue;
      const points = buckets.map((bucket, index) => `${xFor(index).toFixed(1)},${yFor(bucket.count).toFixed(1)}`).join(" ");
      const areaPoints = `${pad.left},${pad.top + plotHeight} ${points} ${pad.left + plotWidth},${pad.top + plotHeight}`;
      const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
      const yTicks = [0, Math.ceil(maxValue / 2), maxValue];

      subtitle.textContent = total ? `${total} incidents in ${getRangeLabel()}` : `No incidents in ${getRangeLabel()}`;
      svg.innerHTML = `
        <defs>
          <linearGradient id="incidentLineFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="rgba(49,214,192,0.28)" />
            <stop offset="100%" stop-color="rgba(49,214,192,0)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
        ${yTicks.map((tick) => `
          <g>
            <line x1="${pad.left}" y1="${yFor(tick).toFixed(1)}" x2="${pad.left + plotWidth}" y2="${yFor(tick).toFixed(1)}" stroke="rgba(110,123,136,0.24)" stroke-width="1" />
            <text x="${pad.left - 12}" y="${(yFor(tick) + 4).toFixed(1)}" fill="currentColor" opacity="0.62" font-size="11" text-anchor="end">${tick}</text>
          </g>
        `).join("")}
        <polyline points="${areaPoints}" fill="url(#incidentLineFill)" stroke="none"></polyline>
        <polyline points="${points}" fill="none" stroke="#31d6c0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
        ${buckets.map((bucket, index) => `
          <circle cx="${xFor(index).toFixed(1)}" cy="${yFor(bucket.count).toFixed(1)}" r="${bucket.count ? 4 : 3}" fill="${bucket.count ? "#31d6c0" : "#344251"}" stroke="rgba(9,13,18,0.9)" stroke-width="2">
            <title>${bucket.label}: ${bucket.count}</title>
          </circle>
        `).join("")}
        ${buckets.map((bucket, index) => index % Math.ceil(buckets.length / 6) === 0 || index === buckets.length - 1 ? `
          <text x="${xFor(index).toFixed(1)}" y="${height - 18}" fill="currentColor" opacity="0.64" font-size="11" text-anchor="middle">${escapeHtml(bucket.label)}</text>
        ` : "").join("")}
      `;
    }

    async function loadStatisticsEvents() {
      try {
        const json = await fetchJsonOrNull(buildStatsQuery());
        statsEvents.length = 0;
        (json?.events || []).forEach((evt) => statsEvents.push(normalizeEventForUi(evt)));
      } catch (_err) {
        statsEvents.length = 0;
      }
      refreshStatistics();
    }

    function recordStatsEvent(alertData) {
      const event = normalizeEventForUi(alertData);
      if (!isEventInCurrentStatsRange(event)) return;
      statsEvents.unshift(event);
      while (statsEvents.length > 1000) statsEvents.pop();
      refreshStatistics();
    }

    function updateIncidentFocus(alertData) {
      const activeCount = activeAlerts.size;
      document.getElementById("incident-focus-count").textContent = activeCount;

      if (!activeCount) {
        document.getElementById("metric-last-alert").textContent = "Không có";
        document.getElementById("incident-focus-copy").textContent =
          "Không có sự cố đang hoạt động trên bản đồ. Bạn vẫn có thể xem cảnh báo cũ trong mục thống kê.";
        return;
      }

      const focusAlert = alertData?.active === false ? getLatestActiveAlert() : (alertData || getLatestActiveAlert());
      const meta = getAlertMeta(focusAlert.event_type);
      document.getElementById("metric-last-alert").textContent = meta.shortLabel;
      document.getElementById("incident-focus-copy").textContent =
        meta.label + " tại " + maybeRepairMojibake(focusAlert.camera_name || focusAlert.camera_id) + " lúc " + formatTime(focusAlert.last_seen || focusAlert.timestamp, false) + ".";
    }

    function queueKey(cameraId, eventType) {
      return cameraId + "::" + eventType;
    }

    function getQueueStatusLabel(status) {
      return {
        new: "Mới",
        in_progress: "Đang xử lý",
        confirmed: "Đã xác minh",
        false_alarm: "Cảnh báo sai",
        resolved: "Đã xử lý",
      }[status] || "Mới";
    }

    function getQueueStatus(cameraId, eventType, fallback = "new") {
      return alertQueue.get(queueKey(cameraId, eventType))?.status || fallback;
    }

    function renderQueueStatusOptions(current) {
      return ["new", "in_progress", "confirmed", "false_alarm", "resolved"]
        .map((status) => `<option value="${status}"${status === current ? " selected" : ""}>${getQueueStatusLabel(status)}</option>`)
        .join("");
    }

    function applyQueueStatusToRows() {
      document.querySelectorAll(".alert-row").forEach((row) => {
        const status = getQueueStatus(row.dataset.cameraId, row.dataset.type, row.dataset.queueStatus || "new");
        row.dataset.queueStatus = status;
        const select = row.querySelector(".alert-queue-select");
        if (select && select.value !== status) select.value = status;
      });
    }

    function renderEmptyAlerts(message = "Đang chờ kết quả nhận diện từ hệ thống camera.") {
      const log = document.getElementById("alert-log");
      log.innerHTML = `
        <div class="empty-state">
          ${iconSvg("alert")}
          <div class="empty-title">Chưa có cảnh báo</div>
          <div class="empty-copy">${escapeHtml(message)}</div>
        </div>
      `;
      document.getElementById("alert-count").textContent = alerts.length;
    }

    function addAlertRow(alertData) {
      const log = document.getElementById("alert-log");
      log.querySelectorAll(".empty-state").forEach((el) => el.remove());
      const meta = getAlertMeta(alertData.event_type);
      const key = queueKey(alertData.camera_id, alertData.event_type);
      const existingRow = log.querySelector(`.alert-row[data-queue-key="${escapeCssSelector(key)}"]`);
      if (existingRow) {
        existingRow.remove();
        const oldIndex = alerts.findIndex((item) => queueKey(item.camera_id, item.event_type) === key);
        if (oldIndex >= 0) alerts.splice(oldIndex, 1);
      }

      const row = document.createElement("div");
      const queueStatus = alertData.queue_status || alertData.status || getQueueStatus(alertData.camera_id, alertData.event_type);
      const canOpenSnapshot = hasAlertSnapshot(alertData);
      row.className = "alert-row";
      if (canOpenSnapshot) row.classList.add("has-snapshot");
      row.dataset.cameraId = alertData.camera_id;
      row.dataset.queueKey = key;
      row.dataset.queueStatus = queueStatus;
      row.dataset.type = alertData.event_type;
      row.innerHTML = `
        <div class="alert-icon">${iconSvg(alertData.event_type)}</div>
        <div class="alert-content">
          <div class="alert-title">${escapeHtml(meta.label)}</div>
          <div class="alert-camera">${escapeHtml(alertData.camera_name || alertData.camera_id)}</div>
          <div class="alert-time">${formatTime(alertData.timestamp)} - ${formatDateTime(alertData.timestamp)}</div>
        </div>
        <div class="alert-actions">
          <span class="alert-severity severity-${escapeAttr(alertData.severity || "medium")}">${escapeHtml(getSeverityLabel(alertData.severity))}</span>
          ${canOpenSnapshot ? `<button class="alert-snapshot-btn" type="button" title="Xem ảnh phát hiện" aria-label="Xem ảnh phát hiện sự cố">${iconSvg("camera")}</button>` : ""}
          <select class="alert-queue-select" data-camera-id="${escapeAttr(alertData.camera_id)}" data-event-type="${escapeAttr(alertData.event_type)}" aria-label="Trạng thái xử lý cảnh báo">
            ${renderQueueStatusOptions(queueStatus)}
          </select>
          <button class="alert-delete-btn" type="button" data-delete-queue="true" data-camera-id="${escapeAttr(alertData.camera_id)}" data-event-type="${escapeAttr(alertData.event_type)}" title="Xóa cảnh báo" aria-label="Xóa cảnh báo">
            ${iconSvg("close")}
          </button>
        </div>
      `;

      row.addEventListener("click", (event) => {
        if (event.target.closest(".alert-queue-select, .alert-delete-btn")) return;
        if (canOpenSnapshot || event.target.closest(".alert-snapshot-btn")) {
          openAlertSnapshot(alertData);
          return;
        }
        const cam = cameras.get(alertData.camera_id);
        if (cam) {
          focusCamera(alertData.camera_id);
        } else if (alertData.lat && alertData.lng) {
          map.flyTo([alertData.lat, alertData.lng], 16);
        }
      });

      log.prepend(row);
      alertQueue.set(queueKey(alertData.camera_id, alertData.event_type), {
        camera_id: alertData.camera_id,
        event_type: alertData.event_type,
        status: queueStatus,
      });
      alerts.unshift(alertData);
      while (log.querySelectorAll(".alert-row").length > 100) {
        log.querySelector(".alert-row:last-of-type")?.remove();
      }

      document.getElementById("alert-count").textContent = alerts.length;
      applyFilter();
    }

    function removeAlertRow(cameraId, eventType) {
      const key = queueKey(cameraId, eventType);
      alertQueue.delete(key);
      const row = document.querySelector(`.alert-row[data-queue-key="${escapeCssSelector(key)}"]`);
      row?.remove();
      const index = alerts.findIndex((item) => item.camera_id === cameraId && item.event_type === eventType);
      if (index >= 0) alerts.splice(index, 1);
      document.getElementById("alert-count").textContent = alerts.length;
      if (!document.querySelectorAll(".alert-row").length) renderEmptyAlerts();
      else applyFilter();
    }

    function applyFilter() {
      const rows = Array.from(document.querySelectorAll(".alert-row"));
      let visible = 0;
      document.querySelectorAll(".filter-empty").forEach((el) => el.remove());

      rows.forEach((row) => {
        const show = activeFilter === "all" || row.dataset.type === activeFilter;
        row.style.display = show ? "" : "none";
        if (show) visible += 1;
      });

      if (!rows.length) {
        renderEmptyAlerts();
        return;
      }

      if (!visible) {
        const log = document.getElementById("alert-log");
        const meta = getAlertMeta(activeFilter);
        const empty = document.createElement("div");
        empty.className = "empty-state filter-empty";
        empty.innerHTML = `
          ${iconSvg("alert")}
          <div class="empty-title">Không có cảnh báo ${escapeHtml(meta.shortLabel.toLowerCase())}</div>
          <div class="empty-copy">Chọn bộ lọc khác để xem các loại sự cố còn lại.</div>
        `;
        log.appendChild(empty);
      }
    }

    function renderIncidentWatermark(elementId, cameraId, alertData) {
      const element = document.getElementById(elementId);
      if (!element) return;
      if (!alertData) {
        element.hidden = true;
        element.className = "incident-watermark";
        element.innerHTML = "";
        return;
      }

      const meta = getAlertMeta(alertData.event_type);
      const simulated = cameras.get(cameraId)?.data?.source === "simulated_demo";
      const confidence = Number(alertData.confidence);
      element.className = `incident-watermark ${escapeAttr(alertData.event_type)}`;
      element.innerHTML = `
        <span class="incident-watermark-kicker">${simulated ? "MÔ PHỎNG · " : ""}AI PHÁT HIỆN</span>
        <strong>${escapeHtml(meta.shortLabel)}</strong>
        ${Number.isFinite(confidence) ? `<span>${Math.round(confidence * 100)}%</span>` : ""}
      `;
      element.hidden = false;
    }

    function updateVideoIncidentWatermark(cameraId = activeVideoCameraId) {
      renderIncidentWatermark(
        "video-incident-watermark",
        cameraId,
        cameraId ? getDominantAlertForCamera(cameraId) : null
      );
    }

    function openVideoModal(camId) {
      closeVideoModal();
      activeVideoCameraId = camId;
      const sessionId = ++streamSessionId;
      const cam = cameras.get(camId);
      const camName = cam ? maybeRepairMojibake(cam.data.name) : "Camera";
      const shell = document.querySelector(".video-shell");
      const stream = document.getElementById("video-stream");
      const recordedDemoStream = document.getElementById("recorded-demo-stream");
      const youtubeStream = document.getElementById("youtube-stream");
      const snapshotUrl = cam?.data?.snapshot_url;
      const streamUrl = cam?.data?.stream_url;
      const youtubeEmbedUrl = getYoutubeEmbedUrl(streamUrl || snapshotUrl);
      const streamType = cam?.data?.stream_type || "";
      const sourceType = cam?.data?.source || "";
      const isRecordedDemo = streamType === "recorded_demo" || sourceType === "simulated_demo";
      const isSnapshotStream = cam?.data?.stream_type === "snapshot" || Boolean(snapshotUrl);
      const snapshotRefreshMs = Number(cam?.data?.metadata?.snapshot_refresh_ms) || (
        sourceType === "user_contribution" ? 5000 : 2000
      );
      const isHanoiRealtime =
        streamType === "wss_video" ||
        sourceType === "hanoi_video_wall" ||
        String(camId || "").startsWith("HANOI_");
      const hanoiProxyUrl = getHanoiProxyUrl(camId);
      const sourceUrl = isHanoiRealtime
        ? hanoiProxyUrl
        : snapshotUrl || streamUrl || ("http://localhost:5000/video_feed/" + encodeURIComponent(camId));
      const liveBadge = document.querySelector("#video-modal .live-badge");
      let hanoiRetryCount = 0;

      document.getElementById("modal-cam-name").textContent = camName;
      if (liveBadge) liveBadge.textContent = isRecordedDemo ? "Nguồn camera mô phỏng" : youtubeEmbedUrl ? "Phát trực tiếp từ YouTube" : isHanoiRealtime ? "Luồng camera Hà Nội" : "Luồng camera AI";
      document.getElementById("stream-placeholder-title").textContent = isRecordedDemo
        ? "Đang mở camera mô phỏng"
        : youtubeEmbedUrl
        ? "Opening YouTube player"
        : isHanoiRealtime
        ? "Connecting to Hanoi realtime video"
        : isSnapshotStream ? "Connecting to live camera" : "Waiting for stream";
      document.getElementById("stream-placeholder-copy").textContent = isRecordedDemo
        ? "Video có giấy phép được phát lại như một camera mô phỏng để hệ thống AI nhận diện sự cố."
        : youtubeEmbedUrl
        ? "This community camera is shown through the embedded YouTube player."
        : isHanoiRealtime
        ? "The local Hanoi WSS proxy is decoding HEVC video into a browser-friendly MJPEG stream."
        : isSnapshotStream
          ? sourceType === "user_contribution"
          ? "Community camera snapshots refresh automatically."
          : "Live frames are loading through the local camera proxy."
        : "The AI video proxy will appear here when the camera feed is available.";
      shell.classList.remove("stream-offline", "youtube-mode", "recorded-demo-mode");
      if (recordedDemoStream) {
        recordedDemoStream.pause();
        recordedDemoStream.hidden = true;
        recordedDemoStream.removeAttribute("src");
      }
      youtubeStream.hidden = true;
      youtubeStream.src = "";
      stream.onload = () => {
        if (sessionId !== streamSessionId) return;
        shell.classList.remove("stream-offline");
      };
      stream.onerror = () => {
        if (sessionId !== streamSessionId) return;
        shell.classList.add("stream-offline");
        if (isHanoiRealtime) {
          if (hanoiRetryCount < 8) {
            hanoiRetryCount += 1;
            document.getElementById("stream-placeholder-title").textContent = "Starting Hanoi decoder";
            document.getElementById("stream-placeholder-copy").textContent =
              "The backend is connecting to the Hanoi WSS stream. Video will appear when the first frame is decoded.";
            if (hanoiStreamRetryTimer) window.clearTimeout(hanoiStreamRetryTimer);
            hanoiStreamRetryTimer = window.setTimeout(() => {
              if (sessionId !== streamSessionId) return;
              const joiner = sourceUrl.includes("?") ? "&" : "?";
              stream.src = sourceUrl + joiner + "retry=" + hanoiRetryCount + "&ts=" + Date.now();
            }, 2500);
            return;
          }
          document.getElementById("stream-placeholder-title").textContent = "Hanoi stream unavailable";
          document.getElementById("stream-placeholder-copy").textContent =
            "The decoder could not reach this WSS camera yet. Try another Hanoi camera or refresh in a moment.";
          return;
        }
        document.getElementById("stream-placeholder-title").textContent = "Stream source unavailable";
        document.getElementById("stream-placeholder-copy").textContent = isSnapshotStream
          ? "The traffic portal did not return a frame for this camera."
          : "Start the AI proxy on localhost:5000 to view the processed camera feed.";
      };

      if (isRecordedDemo) {
        shell.classList.add("recorded-demo-mode");
        recordedDemoStream.hidden = false;
        recordedDemoStream.src = sourceUrl;
        recordedDemoStream.currentTime = 0;
        recordedDemoStream.play().catch(() => {});
      } else if (youtubeEmbedUrl) {
        shell.classList.add("youtube-mode");
        youtubeStream.hidden = false;
        youtubeStream.src = youtubeEmbedUrl;
      } else if (isHanoiRealtime) {
        prewarmHanoiDecoder(camId, sessionId, stream, sourceUrl);
        watchHanoiDecoderStatus(camId, sessionId, shell, stream, sourceUrl);
      } else if (isSnapshotStream) {
        const loadFrame = () => {
          const joiner = sourceUrl.includes("?") ? "&" : "?";
          stream.src = sourceUrl + joiner + "ts=" + Date.now();
        };
        loadFrame();
        streamRefreshTimer = window.setInterval(loadFrame, Math.max(snapshotRefreshMs, 2000));
      } else {
        stream.src = sourceUrl;
      }

      loadCameraHistory(camId);
      document.getElementById("video-modal").classList.add("active");
      updateVideoIncidentWatermark(camId);
    }

    function watchHanoiDecoderStatus(camId, sessionId, shell, stream, sourceUrl) {
      let checks = 0;
      let reloads = 0;
      let hasBeenLive = false;
      const poll = async () => {
        if (sessionId !== streamSessionId) return;
        checks += 1;
        const json = await fetchJsonOrNull(
          "/api/cameras/hanoi/" + encodeURIComponent(camId) + "/status"
        );
        const status = json?.status || {};
        const hasRecentFrame =
          status.camera_id === camId &&
          status.last_frame_at > 0 &&
          Number(status.latest_age_ms || 0) < 15000;

        if (hasRecentFrame) {
          hasBeenLive = true;
          shell.classList.remove("stream-offline");
          document.getElementById("stream-placeholder-title").textContent = "Live Hanoi stream";
          document.getElementById("stream-placeholder-copy").textContent =
            "Decoded video frames are coming through the backend proxy.";
          hanoiStatusTimer = window.setTimeout(poll, 3500);
          return;
        }

        const latestAgeMs = Number(status.latest_age_ms || 0);
        const isStaleAfterLive = hasBeenLive && latestAgeMs > 15000;
        if (isStaleAfterLive && reloads < 4) {
          reloads += 1;
          shell.classList.remove("stream-offline");
          document.getElementById("stream-placeholder-title").textContent = "Refreshing Hanoi stream";
          document.getElementById("stream-placeholder-copy").textContent =
            "The latest frame is stale, so the dashboard is reconnecting to the decoder.";
          const joiner = sourceUrl.includes("?") ? "&" : "?";
          stream.src = sourceUrl + joiner + "recover=" + reloads + "&ts=" + Date.now();
          hanoiStatusTimer = window.setTimeout(poll, 2500);
          return;
        }

        if (checks === 5) {
          document.getElementById("stream-placeholder-title").textContent = "Still connecting to Hanoi video";
          document.getElementById("stream-placeholder-copy").textContent =
            "The decoder is still waiting for the first HEVC frame. This camera may be busy or slow upstream.";
        }

        if (checks >= 12) {
          shell.classList.add("stream-offline");
          document.getElementById("stream-placeholder-title").textContent = "Hanoi stream is slow";
          document.getElementById("stream-placeholder-copy").textContent =
            "Try closing and opening this camera again, or choose another Hanoi camera while the decoder recovers.";
          return;
        }
        hanoiStatusTimer = window.setTimeout(poll, checks < 4 ? 1200 : 2500);
      };
      hanoiStatusTimer = window.setTimeout(poll, 900);
    }

    async function prewarmHanoiDecoder(camId, sessionId, stream, sourceUrl) {
      await fetchJsonOrNull(
        "/api/cameras/hanoi/" + encodeURIComponent(camId) + "/status?start=true"
      );
      if (sessionId !== streamSessionId) return;
      const joiner = sourceUrl.includes("?") ? "&" : "?";
      stream.src = sourceUrl + joiner + "ts=" + Date.now();
    }

    function getHanoiProxyUrl(camId) {
      const configuredBase = window.HANOI_PROXY_BASE_URL;
      if (configuredBase) {
        return configuredBase.replace(/\/$/, "") + "/hanoi_feed/" + encodeURIComponent(camId);
      }
      return apiUrl("/api/cameras/hanoi/" + encodeURIComponent(camId) + "/mjpeg");
    }

    async function loadCameraHistory(cameraId) {
      const totalEl = document.getElementById("history-total");
      const trafficEl = document.getElementById("history-traffic");
      const volumeEl = document.getElementById("history-volume");
      const stabilityEl = document.getElementById("history-stability");
      if (totalEl) totalEl.textContent = "...";
      if (trafficEl) trafficEl.textContent = "...";
      if (volumeEl) volumeEl.textContent = "--";
      if (stabilityEl) stabilityEl.textContent = getHealthLabel(cameras.get(cameraId)?.healthStatus || "unchecked");

      const json = await fetchJsonOrNull(`/api/cameras/${encodeURIComponent(cameraId)}/history?hours=24`);
      if (!json) {
        if (totalEl) totalEl.textContent = "0";
        if (trafficEl) trafficEl.textContent = "0";
        return;
      }

      const summary = json.summary || {};
      if (totalEl) totalEl.textContent = summary.total || 0;
      if (trafficEl) trafficEl.textContent = summary.counts?.traffic_jam || 0;
      if (volumeEl) volumeEl.textContent = summary.traffic_volume?.avgCount ?? "--";
      if (stabilityEl) stabilityEl.textContent = getHealthLabel(summary.health?.status || cameras.get(cameraId)?.healthStatus || "unchecked");
    }

    function closeVideoModal() {
      streamSessionId += 1;
      document.getElementById("video-modal").classList.remove("active");
      if (streamRefreshTimer) {
        window.clearInterval(streamRefreshTimer);
        streamRefreshTimer = null;
      }
      if (hanoiStreamRetryTimer) {
        window.clearTimeout(hanoiStreamRetryTimer);
        hanoiStreamRetryTimer = null;
      }
      if (hanoiStatusTimer) {
        window.clearTimeout(hanoiStatusTimer);
        hanoiStatusTimer = null;
      }
      const stream = document.getElementById("video-stream");
      const recordedDemoStream = document.getElementById("recorded-demo-stream");
      const youtubeStream = document.getElementById("youtube-stream");
      stream.onload = null;
      stream.onerror = null;
      stream.src = "";
      if (recordedDemoStream) {
        recordedDemoStream.pause();
        recordedDemoStream.removeAttribute("src");
        recordedDemoStream.load();
        recordedDemoStream.hidden = true;
      }
      if (youtubeStream) {
        youtubeStream.src = "";
        youtubeStream.hidden = true;
      }
      document.querySelector(".video-shell")?.classList.remove("youtube-mode", "recorded-demo-mode");
      activeVideoCameraId = null;
      renderIncidentWatermark("video-incident-watermark", null, null);
    }

    function getAlertImageSrc(alertData) {
      const image = alertData?.image_base64 || alertData?.image_url || "";
      if (!image) return "";
      if (/^data:image\//i.test(image) || /^https?:\/\//i.test(image)) return image;
      return `data:image/jpeg;base64,${image}`;
    }

    function hasAlertSnapshot(alertData) {
      return Boolean(getAlertImageSrc(alertData));
    }

    function closeAlertSnapshot() {
      const modal = document.getElementById("alert-snapshot-modal");
      if (!modal) return;
      modal.classList.remove("active");
      const image = document.getElementById("alert-snapshot-image");
      if (image) image.src = "";
      renderIncidentWatermark("snapshot-incident-watermark", null, null);
    }

    function openAlertSnapshot(alertData) {
      const imageSrc = getAlertImageSrc(alertData);
      if (!imageSrc) {
        if (alertData?.camera_id) focusCamera(alertData.camera_id);
        return;
      }

      const meta = getAlertMeta(alertData.event_type);
      const modal = document.getElementById("alert-snapshot-modal");
      if (!modal) return;

      document.getElementById("alert-snapshot-title").textContent = meta.label;
      document.getElementById("alert-snapshot-meta").textContent = `Mức độ: ${getSeverityLabel(alertData.severity)}`;
      document.getElementById("alert-snapshot-camera").textContent = maybeRepairMojibake(alertData.camera_name || alertData.camera_id || "Camera");
      document.getElementById("alert-snapshot-time").textContent = formatDateTime(alertData.timestamp);
      document.getElementById("alert-snapshot-image").src = imageSrc;
      renderIncidentWatermark("snapshot-incident-watermark", alertData.camera_id, alertData);

      const watchButton = document.getElementById("alert-snapshot-watch");
      if (watchButton) {
        watchButton.hidden = !alertData.camera_id;
        watchButton.onclick = () => {
          closeAlertSnapshot();
          openVideoModal(alertData.camera_id);
        };
      }

      modal.classList.add("active");
    }

    function openContributeCameraModal() {
      const form = document.getElementById("contribute-camera-form");
      const status = document.getElementById("contribute-camera-status");
      form.reset();
      updateContributionPrivacyQuestions();
      status.textContent = "Camera proposals are reviewed by the admin before going live.";
      status.classList.remove("error");
      document.getElementById("contribute-camera-modal").classList.add("active");
    }

    function closeContributeCameraModal() {
      document.getElementById("contribute-camera-modal").classList.remove("active");
    }

    function populateEmergencyCameraSelect() {
      const select = document.getElementById("emergency-camera");
      if (!select) return;
      const currentValue = select.value || activeCameraId;
      select.innerHTML = "";
      Array.from(cameras.entries())
        .filter(([id]) => id)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([id, cam]) => {
          const option = document.createElement("option");
          option.value = id;
          option.textContent = maybeRepairMojibake(cam.data.name || id);
          select.appendChild(option);
        });
      if (currentValue && cameras.has(currentValue)) {
        select.value = currentValue;
      } else if (select.options.length) {
        select.selectedIndex = 0;
      }
    }

    function openEmergencyModal() {
      populateEmergencyCameraSelect();
      const select = document.getElementById("emergency-camera");
      if (activeCameraId && cameras.has(activeCameraId)) select.value = activeCameraId;
      document.getElementById("emergency-status").textContent = "Ready to send.";
      document.getElementById("emergency-modal").classList.add("active");
    }

    function closeEmergencyModal() {
      document.getElementById("emergency-modal").classList.remove("active");
    }

    function getCurrentPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Geolocation is not available"));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 9000,
          maximumAge: 30000,
        });
      });
    }

    function getGeolocationBlockMessage() {
      if (!navigator.geolocation) return "Trình duyệt này không hỗ trợ lấy vị trí.";
      if (window.isSecureContext === false) {
        return "Trình duyệt chỉ cho phép lấy vị trí trên HTTPS hoặc localhost.";
      }
      return "";
    }

    function getGeolocationErrorMessage(error) {
      if (error?.code === 1) return "Bạn cần cho phép quyền vị trí để web tự định vị.";
      if (error?.code === 2) return "Không lấy được vị trí hiện tại từ thiết bị.";
      if (error?.code === 3) return "Lấy vị trí quá lâu, hãy thử lại.";
      return error?.message || "Không lấy được vị trí hiện tại.";
    }

    function setLocateButtonState(state, title) {
      const button = document.getElementById("locate-me-btn");
      if (!button) return;
      button.classList.toggle("enabled", showOnlyNearbyCameras);
      button.classList.toggle("loading", state === "loading");
      button.setAttribute("aria-pressed", showOnlyNearbyCameras ? "true" : "false");
      const activeTitle = showOnlyNearbyCameras ? "Tắt lọc quanh vị trí" : (title || "Tìm và hiện camera quanh tôi");
      button.title = activeTitle;
      button.setAttribute("aria-label", activeTitle);
      
      const textSpan = document.getElementById("locate-me-text");
      if (textSpan) {
        textSpan.textContent = showOnlyNearbyCameras ? "📍 Gần tôi" : "🌍 Tất cả";
      }
    }

    function refreshAlertListVisibility() {
      const rows = document.querySelectorAll("#alert-log .alert-row");
      rows.forEach(row => {
        const cameraId = row.dataset.cameraId;
        if (cameraMatchesNearbyFilter(cameraId)) {
          row.style.display = "";
        } else {
          row.style.display = "none";
        }
      });
    }

    function updateUserLocationMarker(location, accuracy = 0) {
      if (!map || !Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)) return;
      const latLng = [location.lat, location.lng];
      if (!userLocationMarker) {
        userLocationMarker = L.marker(latLng, {
          keyboard: false,
          zIndexOffset: 900,
          icon: L.divIcon({
            className: "user-location-marker",
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        }).addTo(map);
        userLocationMarker.bindTooltip("Vị trí hiện tại của bạn", { direction: "top", opacity: 0.92 });
      } else {
        userLocationMarker.setLatLng(latLng);
      }

      const radius = Math.max(20, Math.min(Number(accuracy) || 0, 1500));
      if (!userLocationAccuracyCircle) {
        userLocationAccuracyCircle = L.circle(latLng, {
          radius,
          className: "user-location-accuracy",
          interactive: false,
        }).addTo(map);
      } else {
        userLocationAccuracyCircle.setLatLng(latLng);
        userLocationAccuracyCircle.setRadius(radius);
      }
    }

    function publishUserLocation(location) {
      if (!realtimeSocket || !Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)) return;
      realtimeSocket.emit("update-location", {
        camera_id: "USB_CAM_001",
        lat: location.lat,
        lng: location.lng,
        address: "Vị trí hiện tại từ trình duyệt",
      });
    }

    function applyUserLocation(position, options = {}) {
      const coords = position?.coords || position || {};
      const lat = Number(coords.latitude ?? coords.lat);
      const lng = Number(coords.longitude ?? coords.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      userLocation = { lat, lng };
      updateUserLocationMarker(userLocation, coords.accuracy);
      publishUserLocation(userLocation);
      setLocateButtonState("ready", "Vị trí hiện tại đã sẵn sàng");
      updateNearbyStatus();
      checkNearbyActiveAlerts();
      
      if (showOnlyNearbyCameras) {
        refreshCameraMarkerVisibility();
        applyNewsFilterAndRender();
        refreshAlertListVisibility();
      }

      if (isFollowMeMode) {
        map.panTo([lat, lng]);
      } else if (options.focus) {
        map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 0.65 });
      }
      return userLocation;
    }

    function startUserLocationWatch() {
      if (geoWatchId !== null || !navigator.geolocation) return;
      geoWatchId = navigator.geolocation.watchPosition(
        (position) => applyUserLocation(position),
        (error) => updateNearbyStatus(getGeolocationErrorMessage(error)),
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 15000,
        }
      );
    }

    async function requestUserLocation(options = {}) {
      const blockMessage = getGeolocationBlockMessage();
      if (blockMessage) {
        setLocateButtonState("idle", blockMessage);
        if (!options.silent) updateNearbyStatus(blockMessage);
        return null;
      }

      setLocateButtonState("loading", "Đang lấy vị trí hiện tại...");
      if (!options.silent) updateNearbyStatus("Đang lấy vị trí hiện tại...");
      try {
        const position = await getCurrentPosition();
        const location = applyUserLocation(position, options);
        startUserLocationWatch();
        return location;
      } catch (error) {
        const message = getGeolocationErrorMessage(error);
        setLocateButtonState("idle", message);
        if (!options.silent) updateNearbyStatus(message);
        return null;
      }
    }

    async function submitEmergencyReport(event) {
      event.preventDefault();
      const status = document.getElementById("emergency-status");
      status.textContent = "Sending emergency report...";

      const payload = {
        event_type: document.getElementById("emergency-type").value,
        camera_id: document.getElementById("emergency-camera").value || activeCameraId || undefined,
        note: document.getElementById("emergency-note").value.trim(),
        timestamp: new Date().toISOString(),
      };

      if (document.getElementById("emergency-use-location").checked) {
        try {
          const location = await requestUserLocation({ silent: true });
          if (!location) throw new Error("location_unavailable");
          payload.lat = location.lat;
          payload.lng = location.lng;
        } catch (_err) {
          status.textContent = "Location unavailable. Sending through selected camera...";
        }
      }

      try {
        const res = await fetch(apiUrl("/api/events/emergency"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not send report");
        status.textContent = "Emergency report sent to operators.";
        document.getElementById("emergency-note").value = "";
        setTimeout(closeEmergencyModal, 800);
      } catch (err) {
        status.textContent = err.message || "Could not send emergency report.";
      }
    }

    function extractYoutubeVideoId(value) {
      const input = String(value || "").trim();
      if (!input) return null;
      try {
        const url = new URL(input);
        const host = url.hostname.replace(/^www\./, "").toLowerCase();
        if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
        if (host.endsWith("youtube.com")) {
          const directId = url.searchParams.get("v");
          if (directId) return directId;
          const parts = url.pathname.split("/").filter(Boolean);
          const markerIndex = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
          if (markerIndex >= 0 && parts[markerIndex + 1]) return parts[markerIndex + 1];
        }
      } catch (_err) {
        return null;
      }
      return null;
    }

    function getYoutubeEmbedUrl(value) {
      const videoId = extractYoutubeVideoId(value);
      if (!videoId) return null;
      const params = new URLSearchParams({
        autoplay: "1",
        mute: "1",
        playsinline: "1",
        rel: "0",
        modestbranding: "1",
      });
      return "https://www.youtube.com/embed/" + encodeURIComponent(videoId) + "?" + params.toString();
    }

    function getCheckedValue(name, fallback) {
      return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
    }

    function updateContributionPrivacyQuestions() {
      const publicVisible = getCheckedValue("contribute-public-visible", "yes") === "yes";
      const incidentQuestion = document.getElementById("incident-share-question");
      incidentQuestion.hidden = publicVisible;
      if (publicVisible) {
        const yes = document.querySelector('input[name="contribute-incident-share"][value="yes"]');
        if (yes) yes.checked = true;
      }
    }

    async function fillContributionLocation() {
      const status = document.getElementById("contribute-camera-status");
      status.textContent = "Reading your current location...";
      status.classList.remove("error");
      try {
        const location = await requestUserLocation({ focus: false, silent: true });
        if (!location) throw new Error("location_unavailable");
        const lat = location.lat;
        const lng = location.lng;
        document.getElementById("contribute-camera-lat").value = lat.toFixed(6);
        document.getElementById("contribute-camera-lng").value = lng.toFixed(6);
        status.textContent = "Location filled. Add a name or address before sending.";
      } catch (_err) {
        status.textContent = "Could not read your location. You can type coordinates manually.";
        status.classList.add("error");
      }
    }

    async function submitCameraContribution(event) {
      event.preventDefault();
      const status = document.getElementById("contribute-camera-status");
      status.textContent = "Sending camera proposal...";
      status.classList.remove("error");

      const user = getCurrentUser();
      const publicVisible = getCheckedValue("contribute-public-visible", "yes") === "yes";
      const payload = {
        name: document.getElementById("contribute-camera-name").value.trim(),
        lat: Number(document.getElementById("contribute-camera-lat").value),
        lng: Number(document.getElementById("contribute-camera-lng").value),
        address: document.getElementById("contribute-camera-address").value.trim(),
        snapshot_url: document.getElementById("contribute-camera-snapshot").value.trim(),
        stream_url: document.getElementById("contribute-camera-stream").value.trim(),
        note: document.getElementById("contribute-camera-note").value.trim(),
        contributor_name: user?.name || "User",
        contributor_email: user?.email || "",
        privacy: {
          public_visible: publicVisible,
          incident_share: publicVisible ? true : getCheckedValue("contribute-incident-share", "yes") === "yes",
        },
      };

      if (!payload.name || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
        status.textContent = "Please enter camera name, latitude, and longitude.";
        status.classList.add("error");
        return;
      }

      try {
        const res = await fetch(apiUrl("/api/camera-contributions"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Could not send camera proposal");
        status.textContent = "Camera sent to admin for review.";
        setTimeout(closeContributeCameraModal, 900);
      } catch (err) {
        status.textContent = err.message || "Could not send camera proposal.";
        status.classList.add("error");
      }
    }

    function setNearbyRadius(radius) {
      nearbyRadius = Number(radius) || 3000;
      try {
        localStorage.setItem("smart-alert-nearby-radius", String(nearbyRadius));
      } catch (_err) {}
      document.querySelectorAll(".radius-btn").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.radius) === nearbyRadius);
      });
      document.getElementById("nearby-radius-label").textContent = formatDistance(nearbyRadius);
      updateNearbyStatus();
      checkNearbyActiveAlerts();
    }

    function updateNearbyStatus(message) {
      const status = document.getElementById("nearby-status");
      const toggle = document.getElementById("nearby-toggle");
      toggle.classList.toggle("enabled", nearbyNotificationsEnabled);
      toggle.textContent = nearbyNotificationsEnabled ? "Đang nhận cảnh báo gần tôi" : "Bật thông báo trên thiết bị";

      if (message) {
        status.textContent = message;
        return;
      }

      if (!nearbyNotificationsEnabled) {
        if (userLocation) {
          status.textContent = "Đã lấy vị trí. Bật cảnh báo để nhận sự cố trong phạm vi " + formatDistance(nearbyRadius) + ".";
          return;
        }
        status.textContent = "Off. Choose a radius and enable alerts to get notified near your position.";
        return;
      }

      status.textContent = userLocation
        ? "Thiết bị sẽ báo khi có sự cố trong phạm vi " + formatDistance(nearbyRadius) + "."
        : "Đang chờ quyền truy cập vị trí...";
    }

    function saveNearbyNotificationsPreference(enabled) {
      try {
        localStorage.setItem(NEARBY_ALERTS_STORAGE_KEY, enabled ? "true" : "false");
      } catch (_err) {}
    }

    async function registerNotificationServiceWorker() {
      if (!("serviceWorker" in navigator) || window.location.protocol === "file:") return null;
      if (notificationServiceWorkerRegistration) return notificationServiceWorkerRegistration;
      try {
        notificationServiceWorkerRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        return notificationServiceWorkerRegistration;
      } catch (error) {
        console.warn("Notification service worker is unavailable", error);
        return null;
      }
    }

    async function showDeviceNotification(title, options) {
      if (!("Notification" in window) || Notification.permission !== "granted") return false;
      try {
        const registration = await registerNotificationServiceWorker();
        if (registration?.showNotification) {
          await registration.showNotification(title, options);
          return true;
        }
        new Notification(title, options);
        return true;
      } catch (error) {
        console.warn("Could not show device notification", error);
        return false;
      }
    }

    function restoreNearbyNotificationsPreference() {
      try {
        const saved = localStorage.getItem(NEARBY_ALERTS_STORAGE_KEY) === "true";
        nearbyNotificationsEnabled = saved && "Notification" in window && Notification.permission === "granted";
      } catch (_err) {
        nearbyNotificationsEnabled = false;
      }
      if (nearbyNotificationsEnabled) registerNotificationServiceWorker();
      updateNearbyStatus();
    }

    async function toggleNearbyNotifications() {
      if (nearbyNotificationsEnabled) {
        nearbyNotificationsEnabled = false;
        saveNearbyNotificationsPreference(false);
        if (geoWatchId !== null && navigator.geolocation) {
          navigator.geolocation.clearWatch(geoWatchId);
          geoWatchId = null;
        }
        updateNearbyStatus();
        return;
      }

      if (!("Notification" in window)) {
        updateNearbyStatus("This browser does not support desktop notifications.");
        return;
      }

      try {
        await registerNotificationServiceWorker();
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission !== "granted") {
          saveNearbyNotificationsPreference(false);
          updateNearbyStatus("Bạn cần cho phép thông báo trong trình duyệt để nhận cảnh báo trên thiết bị.");
          return;
        }

        if (!userLocation) {
          const location = await requestUserLocation();
          if (!location) return;
        }
        nearbyNotificationsEnabled = true;
        saveNearbyNotificationsPreference(true);
        startUserLocationWatch();
        updateNearbyStatus();
        checkNearbyActiveAlerts();
      } catch (_err) {
        updateNearbyStatus("Location permission is needed to send nearby alerts.");
      }
    }

    async function notifyNearbyAlert(alertData) {
      if (!nearbyNotificationsEnabled || !userLocation) return;
      const lat = Number(alertData.lat);
      const lng = Number(alertData.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const distance = distanceBetweenMeters(userLocation, { lat, lng });
      if (distance > nearbyRadius) return;

      const key = activeAlertKey(alertData.camera_id, alertData.event_type) + "::" + (alertData.first_seen || alertData.timestamp || "");
      if (notifiedNearbyAlerts.has(key)) return;
      notifiedNearbyAlerts.add(key);

      const meta = getAlertMeta(alertData.event_type);
      const cameraName = maybeRepairMojibake(alertData.camera_name || alertData.camera_id);
      const body = meta.label + " gần " + cameraName + ", cách bạn khoảng " + formatDistance(distance) + ".";
      updateNearbyStatus(body);
      await showDeviceNotification("Cảnh báo sự cố gần bạn", {
        body,
        tag: key,
        renotify: true,
        requireInteraction: alertData.severity === "high" || alertData.severity === "critical",
        data: {
          cameraId: alertData.camera_id || "",
          url: window.location.href,
        },
      });
    }

    function checkNearbyActiveAlerts() {
      activeAlerts.forEach((alertData) => notifyNearbyAlert(alertData));
    }

    function setWorkspacePanel(panelName) {
      const requestedPanel = panelName || "cameras";
      const mapOnlyRequested = requestedPanel === "map";
      activeWorkspacePanel = mapOnlyRequested ? "map" : requestedPanel;
      setMapOnlyMode(mapOnlyRequested);
      document.querySelectorAll("[data-workspace-tab]").forEach((btn) => {
        const active = btn.dataset.workspaceTab === activeWorkspacePanel;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });
      document.querySelectorAll(".sidebar [data-workspace-panel]").forEach((panel) => {
        panel.hidden = mapOnlyRequested || panel.dataset.workspacePanel !== activeWorkspacePanel;
      });

      if (activeWorkspacePanel === "news") {
        openNewsFeed();
      } else {
        closeNewsFeed();
      }

      if (activeWorkspacePanel === "cameras" || activeWorkspacePanel === "map") {
        renderCameraList();
        setTimeout(() => map.invalidateSize(), 80);
      }
      if (activeWorkspacePanel === "alerts") applyFilter();
    }

    function setMapOnlyMode(enabled) {
      mapOnlyMode = Boolean(enabled);
      document.querySelector(".app-shell")?.classList.toggle("map-only", mapOnlyMode);
      const toggle = document.getElementById("map-only-toggle");
      if (toggle) {
        toggle.classList.toggle("enabled", mapOnlyMode);
        toggle.setAttribute("aria-pressed", String(mapOnlyMode));
        toggle.setAttribute("title", mapOnlyMode ? "Show dashboard" : "Map only");
        toggle.setAttribute("aria-label", mapOnlyMode ? "Show dashboard" : "Map only");
      }
      requestAnimationFrame(syncMapOverlayOffsets);
      setTimeout(() => map.invalidateSize(), 120);
    }

    function toggleMapOnlyMode() {
      setWorkspacePanel(mapOnlyMode ? "cameras" : "map");
    }

    function syncIncidentDemoPanel() {
      const panel = document.getElementById("incident-demo-panel");
      if (!panel) return;
      const availableCount = Object.values(DASHBOARD_DEMO_SOURCES)
        .filter((source) => cameras.has(source.cameraId)).length;
      panel.hidden = availableCount === 0;
      const copy = document.getElementById("incident-demo-progress-copy");
      if (copy && !dashboardDemoRunning) {
        copy.textContent = availableCount
          ? `Sẵn sàng · ${availableCount} camera mô phỏng`
          : "Không có camera mô phỏng";
      }
    }

    function setIncidentDemoProgress(copy, tone = "idle") {
      const progress = document.getElementById("incident-demo-progress");
      const label = document.getElementById("incident-demo-progress-copy");
      if (progress) progress.dataset.tone = tone;
      if (label) label.textContent = copy;
    }

    function setIncidentDemoControls(running, activeType = "") {
      dashboardDemoRunning = running;
      document.querySelectorAll("[data-dashboard-demo]").forEach((button) => {
        button.disabled = running;
        button.classList.toggle("running", running && button.dataset.dashboardDemo === activeType);
      });
      const reset = document.getElementById("incident-demo-reset");
      if (reset) reset.disabled = running;
    }

    function waitForDemoVideo(video) {
      return new Promise((resolve, reject) => {
        let timeoutId;
        const cleanup = () => {
          video.removeEventListener("loadeddata", onReady);
          video.removeEventListener("canplay", onReady);
          video.removeEventListener("error", onError);
          window.clearTimeout(timeoutId);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("Không thể tải video camera mô phỏng"));
        };
        video.addEventListener("loadeddata", onReady);
        video.addEventListener("canplay", onReady);
        video.addEventListener("error", onError);
        timeoutId = window.setTimeout(() => {
          cleanup();
          reject(new Error("Video camera mô phỏng phản hồi quá lâu"));
        }, 12000);
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onReady();
      });
    }

    function seekDemoVideo(video, seconds) {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return Promise.resolve();
      const target = Math.min(Math.max(seconds, 0), Math.max(video.duration - 0.12, 0));
      if (Math.abs(video.currentTime - target) < 0.08) return Promise.resolve();
      return new Promise((resolve) => {
        const timeoutId = window.setTimeout(resolve, 1800);
        video.addEventListener("seeked", () => {
          window.clearTimeout(timeoutId);
          resolve();
        }, { once: true });
        video.currentTime = target;
      });
    }

    function captureDashboardDemoFrame(video) {
      const sourceWidth = video.videoWidth || 854;
      const sourceHeight = video.videoHeight || 480;
      const scale = Math.min(1, 960 / sourceWidth);
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(video, 0, 0, width, height);
      return {
        width,
        height,
        image_base64: canvas.toDataURL("image/jpeg", 0.82).split(",")[1],
      };
    }

    async function submitDashboardDemoFrame(source, frame) {
      const camera = cameras.get(source.cameraId)?.data;
      const response = await fetch(apiUrl("/api/scanner/demo-detect"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          camera_id: source.cameraId,
          camera_name: camera?.name || source.cameraName,
          camera_source: "recorded_demo_camera",
          demo_session: "incident-dashboard-v1",
          expected_event_type: source.eventType,
          lat: camera?.location?.lat,
          lng: camera?.location?.lng,
          content_type: "image/jpeg",
          ...frame,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || `Detector HTTP ${response.status}`);
      }
      return payload;
    }

    async function scanDashboardDemoSource(type, token) {
      const source = DASHBOARD_DEMO_SOURCES[type];
      if (!source || !cameras.has(source.cameraId)) {
        throw new Error(`Camera mô phỏng ${source?.label || type} không có trên bản đồ`);
      }

      setIncidentDemoProgress(`Connecting ${source.label} camera…`, "busy");
      focusCamera(source.cameraId, 15);

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = source.url;
      video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(video);

      try {
        video.load();
        await waitForDemoVideo(video);
        video.pause();

        for (let attempt = 0; attempt < source.maxAttempts; attempt += 1) {
          if (token !== dashboardDemoRunToken) throw new Error("Demo cancelled");
          const stepSeconds = type === "fire" ? 4 : type === "flood" ? 2 : 1;
          const duration = Number.isFinite(video.duration) ? Math.max(video.duration - 0.12, 0.12) : 60;
          await seekDemoVideo(video, (attempt * stepSeconds) % duration);
          setIncidentDemoProgress(
            `AI scanning ${source.label} camera · frame ${attempt + 1}/${source.maxAttempts}`,
            "busy"
          );
          const payload = await submitDashboardDemoFrame(source, captureDashboardDemoFrame(video));
          const detected = (payload.detections || []).some((item) => item.event_type === source.eventType);
          if (detected) {
            await new Promise((resolve) => window.setTimeout(resolve, 350));
            focusCamera(source.cameraId, 16);
            setIncidentDemoProgress(`Đã phát hiện ${source.label} · dashboard đã cảnh báo`, "ok");
            return payload;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 260));
        }
      } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
      }

      throw new Error(`Chưa phát hiện sự cố ${source.label} trong video camera mô phỏng`);
    }

    function removeDemoEventsFromUi(cameraIds) {
      const idSet = new Set(cameraIds);
      Array.from(activeAlerts.entries()).forEach(([key, alertData]) => {
        if (idSet.has(alertData.camera_id)) activeAlerts.delete(key);
      });
      for (let index = statsEvents.length - 1; index >= 0; index -= 1) {
        if (idSet.has(statsEvents[index].camera_id)) statsEvents.splice(index, 1);
      }
      cameraIds.forEach((cameraId) => {
        renderCameraAlertState(cameraId, { blink: false, openPopup: false });
        updateCameraMarkerVisibility(cameraId);
      });
      refreshStatistics();
      updateIncidentFocus(getLatestActiveAlert());
      renderCameraList();
    }

    async function resetDashboardIncidentDemo(cameraId = "", options = {}) {
      if (dashboardDemoRunning) return false;
      const body = cameraId ? { camera_id: cameraId } : {};
      const result = await postJsonOrNull("/api/scanner/demo-reset", body);
      if (!result?.success) throw new Error("Không thể đặt lại các sự cố mô phỏng");
      const cameraIds = cameraId
        ? [cameraId]
        : Object.values(DASHBOARD_DEMO_SOURCES).map((source) => source.cameraId);
      removeDemoEventsFromUi(cameraIds);
      await loadAlertQueue();
      if (!options.silent) setIncidentDemoProgress("Đã đặt lại · các camera đang bình thường", "idle");
      return true;
    }

    async function runDashboardIncidentDemo(requestedType) {
      if (dashboardDemoRunning) return;
      const types = requestedType === "all" ? ["fire", "flood", "traffic"] : [requestedType];
      const invalidType = types.find((type) => !DASHBOARD_DEMO_SOURCES[type]);
      if (invalidType) return;

      try {
        if (requestedType === "all") {
          await resetDashboardIncidentDemo("", { silent: true });
        } else {
          await resetDashboardIncidentDemo(DASHBOARD_DEMO_SOURCES[requestedType].cameraId, { silent: true });
        }
        const token = ++dashboardDemoRunToken;
        setIncidentDemoControls(true, requestedType);
        for (const type of types) {
          await scanDashboardDemoSource(type, token);
        }
        const copy = requestedType === "all"
          ? "Hoàn tất · 3 sự cố đã kích hoạt cảnh báo"
          : `Hoàn tất · camera ${DASHBOARD_DEMO_SOURCES[requestedType].label} đang cảnh báo`;
        setIncidentDemoProgress(copy, "ok");
      } catch (err) {
        setIncidentDemoProgress(err.message || "Incident demo failed", "error");
      } finally {
        setIncidentDemoControls(false);
      }
    }

    function renderScannerStatus(status) {
      const stateEl = document.getElementById("scanner-state");
      const detailEl = document.getElementById("scanner-detail");
      const toggle = document.getElementById("scanner-toggle");
      if (!stateEl || !detailEl || !toggle) return;

      const config = status?.config || {};
      const lastRun = status?.lastRun;
      const running = Boolean(status?.running);
      const scanning = Boolean(status?.scanning);
      const workerText = (status?.activeWorkers || 0) + "/" + (config.concurrency || 0) + " luồng xử lý";
      const cameraText = lastRun ? lastRun.processed + "/" + lastRun.cameras + " camera" : "Chưa quét";
      const detectorText = config.detectorConfigured
        ? "bộ nhận diện AI"
        : config.mockDetections
          ? "bộ nhận diện mô phỏng"
          : "chưa cấu hình bộ nhận diện";

      stateEl.textContent = running
        ? scanning
          ? "Bộ quét AI đang hoạt động"
          : "Bộ quét AI đang chờ"
        : "Bộ quét AI đang nghỉ";
      detailEl.textContent = workerText + " | " + cameraText + " | " + detectorText;
      toggle.textContent = running ? "Dừng quét" : "Bắt đầu quét";
      toggle.classList.toggle("enabled", running);
    }

    async function loadScannerStatus() {
      const status = await fetchJsonOrNull("/api/scanner/status");
      if (status) renderScannerStatus(status);
    }

    async function loadCameraHealth() {
      if (activeCameraSource === "hanoi") {
        let demoLive = 0;
        cameras.forEach((cam) => {
          if (cam.data?.stream_type !== "recorded_demo" && cam.data?.source !== "simulated_demo") return;
          cam.healthStatus = "live";
          cam.health = { status: "live", checked_at: new Date().toISOString() };
          demoLive += 1;
        });
        updateHealthSummaryUi({
          total: cameras.size,
          live: demoLive,
          issues: 0,
          unchecked: Math.max(cameras.size - demoLive, 0),
        });
        renderCameraList();
        return;
      }
      const json = await fetchJsonOrNull("/api/cameras/health?limit=all");
      if (!json) {
        updateHealthSummaryUi();
        return;
      }
      applyCameraHealth(json.cameras || []);
      updateHealthSummaryUi(json.summary);
      renderCameraList();
    }

    async function refreshCameraHealth() {
      if (cameraHealthChecking) return;
      const button = document.getElementById("health-check");
      if (activeCameraSource === "hanoi") {
        const demoLive = Array.from(cameras.values()).filter((cam) =>
          cam.data?.stream_type === "recorded_demo" || cam.data?.source === "simulated_demo"
        ).length;
        updateHealthSummaryUi({
          total: cameras.size,
          live: demoLive,
          issues: 0,
          unchecked: Math.max(cameras.size - demoLive, 0),
        });
        if (button) {
          const previous = button.textContent;
          button.textContent = "WSS only";
          window.setTimeout(() => { button.textContent = previous || "Check health"; }, 1200);
        }
        return;
      }
      const unchecked = Array.from(cameras.entries())
        .filter(([_id, cam]) => cam.healthStatus === "unchecked")
        .slice(0, 60)
        .map(([id]) => id);
      const cameraIds = unchecked.length
        ? unchecked
        : Array.from(cameras.keys()).slice(0, 60);

      cameraHealthChecking = true;
      if (button) {
        button.disabled = true;
        button.textContent = "Checking...";
      }
      try {
        const json = await postJsonOrNull("/api/cameras/health/check", {
          camera_ids: cameraIds,
          concurrency: 6,
        });
        if (json) {
          applyCameraHealth(json.results || []);
          updateHealthSummaryUi(json.summary);
          renderCameraList();
        }
      } finally {
        cameraHealthChecking = false;
        if (button) {
          button.disabled = false;
          button.textContent = "Check health";
        }
      }
    }

    async function toggleScanner() {
      const toggle = document.getElementById("scanner-toggle");
      const status = await fetchJsonOrNull("/api/scanner/status");
      if (!status) {
        renderScannerStatus({
          running: false,
          config: {},
          lastRun: { processed: 0, cameras: 0 },
        });
        return;
      }

      toggle.disabled = true;
      try {
        const next = status.running
          ? await postJsonOrNull("/api/scanner/stop")
          : await postJsonOrNull("/api/scanner/start", {
            cameraLimit: Math.min(Math.max(cameras.size || 60, 1), 60),
            concurrency: activeCameraSource === "hanoi" ? 2 : 4,
            intervalMs: activeCameraSource === "hanoi" ? 15000 : 10000,
            source: activeCameraSource,
          });
        if (next) renderScannerStatus(next);
      } finally {
        toggle.disabled = false;
      }
    }

    function playBeep(type) {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      const context = playBeep.context || new (window.AudioContext || window.webkitAudioContext)();
      playBeep.context = context;
      const osc = context.createOscillator();
      const gain = context.createGain();
      const freqs = { fire: 880, flood: 523, traffic_jam: 660 };
      osc.connect(gain);
      gain.connect(context.destination);
      osc.frequency.value = freqs[type] || 660;
      osc.type = "sine";
      gain.gain.value = 0.12;
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45);
      osc.start();
      osc.stop(context.currentTime + 0.45);
    }

    function formatRelativeTime(value) {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return "Recent";
      const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
      if (seconds < 60) return "Just now";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + "m ago";
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + "h ago";
      const days = Math.floor(hours / 24);
      if (days < 7) return days + "d ago";
      return formatDateTime(value);
    }

    function renderEmptyNews(message = "Fetching storm, fire, and traffic headlines.") {
      const list = document.getElementById("news-list");
      if (!list) return;
      list.innerHTML = `
        <div class="empty-state">
          ${iconSvg("news")}
          <div class="empty-title">No news loaded</div>
          <div class="empty-copy">${escapeHtml(message)}</div>
        </div>
      `;
      document.getElementById("news-count").textContent = "0";
    }

    function renderNewsItems(items) {
      const list = document.getElementById("news-list");
      if (!list) return;
      document.getElementById("news-count").textContent = items.length;

      newsMarkers.forEach((m) => {
        if (map.hasLayer(m)) map.removeLayer(m);
      });
      newsMarkers = [];

      if (!items.length) {
        renderEmptyNews("No matching headlines are available right now.");
        return;
      }

      items.forEach((item) => {
        if (item.location && item.location.lat && item.location.lng) {
          const marker = L.marker([item.location.lat, item.location.lng], {
            icon: L.divIcon({
              className: "map-marker status-normal",
              html: iconSvg("news"),
              iconSize: [28, 28],
              iconAnchor: [14, 14],
            }),
            zIndexOffset: 500,
          });
          
          marker.bindPopup(`
            <div class="popup-title">${escapeHtml(item.title)}</div>
            <div class="popup-address">${escapeHtml(item.location.name || item.source)}</div>
            <div class="popup-meta" style="margin-top: 6px;">
              <a href="${escapeAttr(item.url)}" target="_blank" style="color: var(--primary); text-decoration: none; font-weight: 500;">Xem bài báo</a>
            </div>
          `);
          
          marker.addTo(map);
          newsMarkers.push(marker);
        }
      });

      list.innerHTML = items.map((item) => `
        <a class="news-item news-feed-card" href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">
          <div class="news-feed-card-content">
            <div class="news-meta">
              <span class="news-category">${escapeHtml(item.category || "news")}</span>
              <span class="news-source">${escapeHtml(item.source || "News")}</span>
              <span class="news-dot" aria-hidden="true"></span>
              <span>${escapeHtml(formatRelativeTime(item.published_at))}</span>
            </div>
            <div class="news-title">${escapeHtml(item.title)}</div>
            ${item.summary ? `<div class="news-summary">${escapeHtml(item.summary)}</div>` : ""}
            <span class="news-read-source">Đọc bài gốc ↗</span>
          </div>
        </a>
      `).join("");
      setupNewsFeedObserver();
    }

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
        const indicator = document.getElementById("video-feed-indicator");
        if (indicator) indicator.textContent = "0 / 0";
        const prevBtn = document.getElementById("video-feed-prev");
        const nextBtn = document.getElementById("video-feed-next");
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
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
      requestAnimationFrame(() => {
        const firstCard = list.querySelector(".video-card");
        if (!firstCard) return;
        firstCard.classList.add("is-current");
        currentTargetIndex = 0;
        loadVideoIframe(firstCard);
        updateVideoFeedIndicator(firstCard);
      });
    }

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

      const revealPlayer = () => {
        if (skeleton) skeleton.setAttribute('hidden', '');
        if (thumbnail) thumbnail.style.opacity = '0';
        if (playBtn) playBtn.style.display = 'none';
        if (duration) duration.style.display = 'none';
      };
      const revealFallback = window.setTimeout(revealPlayer, 2200);
      iframe.onload = () => {
        window.clearTimeout(revealFallback);
        revealPlayer();
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
      if (!list) return;
      const cards = Array.from(list.querySelectorAll(".news-feed-card"));
      const index = cards.indexOf(activeCard);
      const indicator = document.getElementById("video-feed-indicator");
      if (indicator && index !== -1) {
        indicator.textContent = `${index + 1} / ${cards.length}`;
      }
      
      const prevBtn = document.getElementById("video-feed-prev");
      const nextBtn = document.getElementById("video-feed-next");
      if (prevBtn) prevBtn.disabled = index === -1 || index === 0;
      if (nextBtn) nextBtn.disabled = index === -1 || index >= cards.length - 1;
    }

    function unloadAllVideoIframes() {
      const list = document.getElementById("video-news-list");
      if (!list) return;
      const cards = list.querySelectorAll(".news-feed-card");
      cards.forEach(card => unloadVideoIframe(card));
    }

    function updateFeedControlsVisibility() {
      const controls = document.getElementById("video-feed-controls");
      if (!controls) return;
      const section = document.getElementById("news-section");
      if (section && !section.hidden && activeNewsTab === "video") {
        controls.removeAttribute("hidden");
      } else {
        controls.setAttribute("hidden", "");
      }
    }

    window.openNewsVideoModal = function(videoId) {
      const video = currentVideoNews.find(v => v.id === videoId);
      if (!video) return;

      const modal = document.getElementById("video-news-modal");
      const iframe = document.getElementById("video-news-iframe");
      
      const origin = encodeURIComponent(window.location.origin);
      iframe.src = `/api/youtube/embed?videoId=${video.youtubeId}&autoplay=1&mute=1&origin=${origin}`;
      modal.classList.add("active");
      
      if (video.location && video.location.lat && video.location.lng) {
        map.flyTo([video.location.lat, video.location.lng], 16, { duration: 1.5 });
      }
    };

    async function loadNews(options = {}) {
      const refreshButton = document.getElementById("news-refresh");
      const count = document.getElementById("news-count");
      try {
        if (refreshButton) refreshButton.disabled = true;
        if (count) count.textContent = "...";
        const params = new URLSearchParams({
          category: activeNewsCategory,
          limit: "18",
        });
        if (options.refresh) params.set("refresh", "1");
        const json = await fetchJsonOrNull("/api/news?" + params.toString());
        if (!json) throw new Error("News API unavailable");
        currentNewsItems = json.news || [];
        updateNewsSources(currentNewsItems);
        applyNewsFilterAndRender();
      } catch (_err) {
        renderEmptyNews("News is unavailable. Try refresh again in a moment.");
      } finally {
        if (refreshButton) refreshButton.disabled = false;
      }
    }

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
        if (!json || !json.videos) {
          throw new Error("Failed to load video news or videos array missing");
        }
        currentVideoNews = json.videos;
        if (activeNewsTab === "video") applyNewsFilterAndRender();
      } catch (err) {
        console.error("Failed to load video news", err);
        currentVideoNews = [];
        applyNewsFilterAndRender();
      }
    }

    function updateNewsSources(items) {
      const select = document.getElementById("news-source-filter");
      if (!select) return;
      const currentVal = select.value;
      const sources = new Set(items.map(i => i.source).filter(Boolean));
      let html = '<option value="all">All Sources</option>';
      Array.from(sources).sort().forEach(src => {
        html += `<option value="${escapeAttr(src)}">${escapeHtml(src)}</option>`;
      });
      select.innerHTML = html;
      if (sources.has(currentVal)) {
        select.value = currentVal;
      } else {
        newsSourceFilter = "all";
      }
    }

    function applyNewsFilterAndRender() {
      let filtered = currentNewsItems;
      if (newsSourceFilter !== "all") {
        filtered = filtered.filter(item => item.source === newsSourceFilter);
      }
      if (newsSearchQuery.trim() !== "") {
        const query = newsSearchQuery.toLowerCase();
        filtered = filtered.filter(item => 
          (item.title && item.title.toLowerCase().includes(query)) ||
          (item.summary && item.summary.toLowerCase().includes(query))
        );
      }
      if (currentTimeRange !== "all") {
        const now = Date.now();
        filtered = filtered.filter(item => {
          const t = new Date(item.pubDate || item.timestamp || now).getTime();
          if (currentTimeRange === "1h") return now - t <= 3600000;
          if (currentTimeRange === "24h") return now - t <= 86400000;
          if (currentTimeRange === "7d") return now - t <= 7 * 86400000;
          return true;
        });
      }
      if (showOnlyNearbyCameras && userLocation) {
        filtered = filtered.filter(item => {
          if (!item.location || !item.location.lat || !item.location.lng) return false;
          return distanceBetweenMeters(userLocation, {lat: item.location.lat, lng: item.location.lng}) <= nearbyRadius;
        });
      }
      
      if (activeNewsTab === "text") {
        unloadAllVideoIframes();
        document.getElementById("news-list").hidden = false;
        document.getElementById("video-news-list").hidden = true;
        document.getElementById("news-tabs").style.display = "flex";
        updateFeedControlsVisibility();
        renderNewsItems(filtered);
      } else {
        document.getElementById("news-list").hidden = true;
        document.getElementById("video-news-list").hidden = false;
        document.getElementById("news-tabs").style.display = "none";
        updateFeedControlsVisibility();
        renderVideoNewsItems();
      }
    }

    let newsFeedPreviousFocus = null;
    let newsFeedObserver = null;
    let currentTargetIndex = 0;

    function setupNewsFeedObserver() {
      const section = document.getElementById("news-section");
      if (!section || section.hidden) return;

      newsFeedObserver?.disconnect();
      const list = document.getElementById(activeNewsTab === "video" ? "video-news-list" : "news-list");
      if (!list) return;

      const cards = Array.from(list.querySelectorAll(".news-feed-card"));
      const foundIdx = cards.findIndex(c => c.classList.contains("is-current"));
      currentTargetIndex = foundIdx >= 0 ? foundIdx : 0;

      if (!("IntersectionObserver" in window)) {
        if (cards[0]) {
          cards[0].classList.add("is-current");
          currentTargetIndex = 0;
          if (activeNewsTab === "video") {
            loadVideoIframe(cards[0]);
            updateVideoFeedIndicator(cards[0]);
          }
        }
        return;
      }

      newsFeedObserver = new IntersectionObserver((entries) => {
        const activeEntry = entries
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio > 0)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!activeEntry) return;

        cards.forEach((card) => {
          const isCurrent = card === activeEntry.target;
          card.classList.toggle("is-current", isCurrent);
          if (activeNewsTab === "video" && !isCurrent) unloadVideoIframe(card);
        });
        currentTargetIndex = cards.indexOf(activeEntry.target);
        if (activeNewsTab === "video") {
          loadVideoIframe(activeEntry.target);
          updateVideoFeedIndicator(activeEntry.target);
        }
      }, { root: list, threshold: [0, 0.35, 0.6] });

      cards.forEach((card) => newsFeedObserver.observe(card));
    }

    function openNewsFeed() {
      const section = document.getElementById("news-section");
      if (!section) return;

      if (section.parentElement !== document.body) document.body.appendChild(section);
      newsFeedPreviousFocus = document.activeElement;
      section.classList.add("news-feed-overlay");
      section.hidden = false;
      document.body.classList.add("news-feed-active");
      loadNews();
      loadVideoNews();
      requestAnimationFrame(() => {
        setupNewsFeedObserver();
        document.getElementById("news-feed-close")?.focus({ preventScroll: true });
        updateFeedControlsVisibility();
      });
    }

    function closeNewsFeed({ restoreFocus = true } = {}) {
      const section = document.getElementById("news-section");
      if (!section || section.hidden) return;

      section.hidden = true;
      document.body.classList.remove("news-feed-active");
      newsFeedObserver?.disconnect();
      unloadAllVideoIframes();
      updateFeedControlsVisibility();
      if (restoreFocus && newsFeedPreviousFocus instanceof HTMLElement) newsFeedPreviousFocus.focus();
    }

    function moveNewsFeed(direction) {
      const list = document.getElementById(activeNewsTab === "video" ? "video-news-list" : "news-list");
      if (!list || list.hidden) return;

      const cards = Array.from(list.querySelectorAll(".news-feed-card"));
      if (!cards.length) return;
      currentTargetIndex = Math.min(cards.length - 1, Math.max(0, currentTargetIndex + direction));
      cards[currentTargetIndex].scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function loadHistoricalEvents() {
      try {
        const json = await fetchJsonOrNull("/api/events?limit=50");
        if (!json) {
          renderEmptyAlerts("Không thể tải lịch sử. Cảnh báo trực tiếp vẫn sẽ xuất hiện khi hệ thống phát hiện sự cố.");
          return;
        }
        const events = (json.events || []).reverse();
        const cameraMap = {};
        cameras.forEach((cam, id) => { cameraMap[id] = cam.data; });

        events.forEach((evt) => {
          const cam = cameraMap[evt.camera_id];
          const alertData = {
            camera_id: evt.camera_id,
            event_type: evt.event_type,
            severity: evt.severity,
            camera_name: cam ? cam.name : evt.camera_id,
            lat: cam ? cam.location.lat : 0,
            lng: cam ? cam.location.lng : 0,
            timestamp: evt.timestamp,
            metadata: evt.metadata || {},
          };
          addAlertRow(alertData);
        });

        if (!events.length) renderEmptyAlerts();
      } catch (err) {
        renderEmptyAlerts("Không thể tải lịch sử. Cảnh báo trực tiếp vẫn sẽ xuất hiện khi hệ thống phát hiện sự cố.");
      }
    }

    async function loadActiveAlerts() {
      try {
        const json = await fetchJsonOrNull("/api/events/active", { cache: "no-store" });
        activeAlerts.clear();
        (json?.alerts || []).forEach((alertData) => {
          if (!cameras.has(alertData.camera_id)) return;
          activeAlerts.set(activeAlertKey(alertData.camera_id, alertData.event_type), alertData);

          const firstSeen = alertData.first_seen || alertData.timestamp;
          const alreadyInStats = statsEvents.some((event) =>
            event.camera_id === alertData.camera_id &&
            event.event_type === alertData.event_type &&
            String(event.timestamp) === String(firstSeen)
          );
          if (!alreadyInStats) {
            statsEvents.unshift(normalizeEventForUi({ ...alertData, timestamp: firstSeen }));
          }
        });
        while (statsEvents.length > 1000) statsEvents.pop();
        cameras.forEach((_cam, cameraId) => renderCameraAlertState(cameraId, { blink: false, openPopup: false }));
        refreshCameraMarkerVisibility();
        refreshStatistics();
        updateIncidentFocus(getLatestActiveAlert());
        checkNearbyActiveAlerts();
      } catch (_err) {
        updateIncidentFocus();
      }
    }

    async function loadAlertQueue() {
      const json = await fetchJsonOrNull("/api/events/queue");
      if (!json) return;
      alertQueue.clear();
      alerts.length = 0;
      document.getElementById("alert-log").innerHTML = "";
      (json.queue || []).forEach((item) => {
        alertQueue.set(queueKey(item.camera_id, item.event_type), item);
        const cam = cameras.get(item.camera_id);
        addAlertRow({
          ...item,
          queue_status: item.status || "new",
          camera_name: item.camera_name || cam?.data?.name || item.camera_id,
          lat: cam?.data?.location?.lat,
          lng: cam?.data?.location?.lng,
          timestamp: item.first_seen || item.updated_at || item.last_seen,
        });
      });
      if (!(json.queue || []).length) renderEmptyAlerts();
      applyQueueStatusToRows();
    }

    async function updateAlertQueueStatus(cameraId, eventType, status) {
      const key = queueKey(cameraId, eventType);
      const previous = alertQueue.get(key) || { camera_id: cameraId, event_type: eventType, status: "new" };
      alertQueue.set(key, { ...previous, status });
      applyQueueStatusToRows();

      const json = await fetch(apiUrl(`/api/events/queue/${encodeURIComponent(cameraId)}/${encodeURIComponent(eventType)}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }).then(async (res) => {
        const type = res.headers.get("content-type") || "";
        return res.ok && type.includes("application/json") ? res.json() : null;
      }).catch(() => null);

      if (json?.item) {
        alertQueue.set(key, json.item);
        applyQueueStatusToRows();
      }
    }

    async function deleteAlertQueueItem(cameraId, eventType) {
      const key = queueKey(cameraId, eventType);
      const previous = alertQueue.get(key);
      removeAlertRow(cameraId, eventType);

      const ok = await fetch(apiUrl(`/api/events/queue/${encodeURIComponent(cameraId)}/${encodeURIComponent(eventType)}`), {
        method: "DELETE",
      }).then((res) => res.ok).catch(() => false);

      if (!ok && previous) {
        alertQueue.set(key, previous);
        addAlertRow({ ...previous, queue_status: previous.status || "new" });
      }
    }

    function heatColor(intensity) {
      if (intensity >= 0.8) return "#ff5b63";
      if (intensity >= 0.55) return "#f6b84b";
      if (intensity >= 0.3) return "#f7db6a";
      return "#31d6c0";
    }

    function renderTrafficHeatmap(points = []) {
      if (!trafficHeatLayer) return;
      trafficHeatLayer.clearLayers();
      if (!trafficHeatVisible || activeMapIncidentFilter !== "all") return;

      points.forEach((point) => {
        const intensity = Math.max(0.1, Math.min(Number(point.intensity) || 0.1, 1));
        const marker = L.circleMarker([point.lat, point.lng], {
          radius: 12 + intensity * 28,
          color: heatColor(intensity),
          fillColor: heatColor(intensity),
          fillOpacity: 0.13 + intensity * 0.22,
          opacity: 0.55,
          weight: 1,
        });
        marker.bindTooltip(
          `${escapeHtml(point.camera_name || point.camera_id)}<br>${escapeHtml(point.level || "NORMAL")} - ${escapeHtml(point.avgCount ?? 0)} vehicles`,
          { direction: "top", opacity: 0.92 }
        );
        marker.addTo(trafficHeatLayer);
      });
    }

    async function loadTrafficHeatmap() {
      const json = await fetchJsonOrNull("/api/traffic/heatmap");
      renderTrafficHeatmap(json?.points || []);
    }

    function toggleTrafficHeatmap() {
      trafficHeatVisible = !trafficHeatVisible;
      const button = document.getElementById("heatmap-toggle");
      button?.classList.toggle("enabled", trafficHeatVisible);
      button?.setAttribute("aria-pressed", String(trafficHeatVisible));
      loadTrafficHeatmap();
    }

    function findCameraIdsNearRoute(route, maxDistanceMeters = 280) {
      const ids = new Set();
      cameras.forEach((cam, cameraId) => {
        const location = cam.data.location;
        if (!location) return;
        const nearRoute = route.some((point) =>
          distanceBetweenMeters(
            { lat: Number(location.lat), lng: Number(location.lng) },
            { lat: Number(point[0]), lng: Number(point[1]) }
          ) <= maxDistanceMeters
        );
        if (nearRoute) ids.add(cameraId);
      });
      return ids;
    }

    function applyRouteCameraFilter(route, routeCameras = []) {
      const ids = new Set((routeCameras || []).map((camera) => camera.camera_id).filter(Boolean));
      if (!ids.size) {
        findCameraIdsNearRoute(route).forEach((cameraId) => ids.add(cameraId));
      }
      routeCameraIds = ids.size ? ids : null;
      refreshCameraMarkerVisibility();
      const count = routeCameraIds ? routeCameraIds.size : cameras.size;
      document.getElementById("incident-focus-count").textContent = count;
      document.getElementById("incident-focus-copy").textContent =
        `Route view is active. Showing ${count} cameras near the selected route; all other cameras are hidden for clarity.`;
    }

    function clearRouteCameraFilter() {
      if (isNavigating) stopNavigation();
      routeCameraIds = null;
      clearChatRouteVisuals();
      const panel = document.getElementById('route-directions-panel');
      if (panel) panel.hidden = true;
      document.querySelector('.app-shell')?.classList.remove('route-details-open');
      refreshCameraMarkerVisibility();
      updateIncidentFocus(getLatestActiveAlert());
    }

    function fitMapToCameras() {
      const cameraPoints = Array.from(cameras.entries())
        .filter(([cameraId]) => !routeCameraIds || routeCameraIds.has(cameraId))
        .map(([_cameraId, cam]) => cam)
        .map((cam) => [cam.data.location.lat, cam.data.location.lng])
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
      const cityPoints = cameraPoints.filter(([lat, lng]) =>
        lat >= CITY_VIEWPORT.minLat &&
        lat <= CITY_VIEWPORT.maxLat &&
        lng >= CITY_VIEWPORT.minLng &&
        lng <= CITY_VIEWPORT.maxLng
      );
      const points = cityPoints.length >= 3 ? cityPoints : cameraPoints;

      if (!points.length) {
        map.flyTo(MAP_CENTER, MAP_ZOOM);
        return;
      }
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds.pad(0.22), { maxZoom: 15, animate: true, paddingTopLeft: [450, 80] });
    }

    async function init() {
      applyTheme(getCurrentTheme(), { persist: false });
      initializeSpeechSynthesis();
      observeMapToolbarLayout();
      normalizeMapFilterLabels();
      renderEmptyAlerts();
      renderEmptyNews();
      updateClock();
      setInterval(updateClock, 1000);
      const now = new Date();
      document.getElementById("stats-to").value = toDateTimeLocalValue(now);
      document.getElementById("stats-from").value = toDateTimeLocalValue(new Date(now.getTime() - 24 * 60 * 60 * 1000));
      try {
        const savedRadius = Number(localStorage.getItem("smart-alert-nearby-radius"));
        if (savedRadius) nearbyRadius = savedRadius;
      } catch (_err) {}
      setNearbyRadius(nearbyRadius);
      restoreNearbyNotificationsPreference();
      registerNotificationServiceWorker();

      try {
        await loadCameraDataset({ fit: false });
      } catch (err) {
        [
          { camera_id: "CAM_001", name: "Nguyen Hue - Le Loi", location: { lat: 10.7739, lng: 106.7030, address: "District 1" } },
          { camera_id: "CAM_002", name: "Dien Bien Phu - Hai Ba Trung", location: { lat: 10.7865, lng: 106.6953, address: "District 3" } },
          { camera_id: "CAM_003", name: "Binh Trieu Bridge", location: { lat: 10.8231, lng: 106.7114, address: "Thu Duc" } },
        ].forEach((cam) => addCameraMarker(cam));
      }

      renderCameraList();
      fitMapToCameras();
      await loadCameraHealth();
      await loadScannerStatus();
      await loadNews();
      await loadVideoNews();
      await loadAlertQueue();
      await loadStatisticsEvents();
      await loadActiveAlerts();
      await loadTrafficHeatmap();
      requestUserLocation({ focus: false }).catch(() => {});
    }

    navigator.serviceWorker?.addEventListener("message", (event) => {
      if (event.data?.type !== "OPEN_NEARBY_ALERT") return;
      setWorkspacePanel("alerts");
      if (event.data.cameraId) focusCamera(event.data.cameraId);
    });

    document.getElementById("camera-search").addEventListener("input", renderCameraList);
    document.querySelectorAll("[data-camera-source]").forEach((btn) => {
      btn.addEventListener("click", () => setCameraSource(btn.dataset.cameraSource));
    });
    document.getElementById("fit-map-btn").addEventListener("click", fitMapToCameras);

    map.on("dragstart", () => {
      if (isFollowMeMode) {
        isFollowMeMode = false;
        const btn = document.getElementById("follow-me-btn");
        const textSpan = document.getElementById("follow-me-text");
        if (btn) btn.classList.remove("enabled");
        if (textSpan) textSpan.textContent = "🚗 Lái xe";
      }
    });

    document.getElementById("follow-me-btn")?.addEventListener("click", () => {
      isFollowMeMode = !isFollowMeMode;
      const btn = document.getElementById("follow-me-btn");
      const textSpan = document.getElementById("follow-me-text");
      if (isFollowMeMode) {
        btn.classList.add("enabled");
        if (textSpan) textSpan.textContent = "🚗 Đang bám theo";
        if (userLocation) map.flyTo([userLocation.lat, userLocation.lng], 16);
      } else {
        btn.classList.remove("enabled");
        if (textSpan) textSpan.textContent = "🚗 Lái xe";
      }
    });

    document.getElementById("voice-alert-btn")?.addEventListener("click", () => {
      if (!initializeSpeechSynthesis()) return;
      isVoiceAlertEnabled = !isVoiceAlertEnabled;
      if (!isVoiceAlertEnabled) {
        speechRequestId += 1;
        window.speechSynthesis.cancel();
        setVoiceAlertButtonState("off");
        return;
      }
      setVoiceAlertButtonState("on");
      speakAlert("Đã bật cảnh báo bằng giọng nói.", { immediate: true });
    });

    document.getElementById("locate-me-btn").addEventListener("click", async () => {
      const btn = document.getElementById("locate-me-btn");
      if (showOnlyNearbyCameras) {
        showOnlyNearbyCameras = false;
        refreshCameraMarkerVisibility();
        applyNewsFilterAndRender();
        refreshAlertListVisibility();
        setLocateButtonState("ready");
      } else {
        try {
          const loc = await requestUserLocation({ focus: true });
          if (loc) {
            showOnlyNearbyCameras = true;
            refreshCameraMarkerVisibility();
            applyNewsFilterAndRender();
            refreshAlertListVisibility();
            setLocateButtonState("ready");
          }
        } catch (err) {
          // Fallback or ignore
        }
      }
    });

    document.getElementById("layer-camera-btn")?.addEventListener("click", () => {
      isCameraLayerVisible = !isCameraLayerVisible;
      const btn = document.getElementById("layer-camera-btn");
      if (isCameraLayerVisible) btn.classList.add("enabled");
      else btn.classList.remove("enabled");
      refreshCameraMarkerVisibility();
    });

    document.getElementById("news-type-text-btn")?.addEventListener("click", (e) => {
      activeNewsTab = "text";
      e.target.classList.add("active");
      document.getElementById("news-type-video-btn").classList.remove("active");
      applyNewsFilterAndRender();
    });

    document.getElementById("news-type-video-btn")?.addEventListener("click", (e) => {
      activeNewsTab = "video";
      e.target.classList.add("active");
      document.getElementById("news-type-text-btn").classList.remove("active");
      applyNewsFilterAndRender();
    });

    document.getElementById("video-news-close")?.addEventListener("click", () => {
      document.getElementById("video-news-modal").classList.remove("active");
      document.getElementById("video-news-iframe").src = ""; // Stop video
    });

    document.getElementById("layer-alert-btn")?.addEventListener("click", () => {
      isAlertLayerVisible = !isAlertLayerVisible;
      const btn = document.getElementById("layer-alert-btn");
      if (isAlertLayerVisible) btn.classList.add("enabled");
      else btn.classList.remove("enabled");
      cameras.forEach((_cam, cameraId) => renderCameraAlertState(cameraId));
      refreshCameraMarkerVisibility();
    });

    document.getElementById("time-range-select")?.addEventListener("change", (e) => {
      currentTimeRange = e.target.value;
      refreshStatistics();
      applyNewsFilterAndRender();
    });

    document.getElementById("heatmap-toggle").addEventListener("click", toggleTrafficHeatmap);
    document.getElementById("map-only-toggle").addEventListener("click", toggleMapOnlyMode);
    document.getElementById("route-filter-clear").addEventListener("click", clearRouteCameraFilter);
    document.getElementById("theme-toggle").addEventListener("click", () => {
      applyTheme(getCurrentTheme() === "light" ? "dark" : "light");
    });

    document.getElementById("alert-snapshot-close")?.addEventListener("click", closeAlertSnapshot);
    document.getElementById("emergency-open").addEventListener("click", openEmergencyModal);
    document.getElementById("emergency-close").addEventListener("click", closeEmergencyModal);
    document.getElementById("emergency-cancel").addEventListener("click", closeEmergencyModal);
    document.getElementById("emergency-form").addEventListener("submit", submitEmergencyReport);
    document.getElementById("contribute-camera-open").addEventListener("click", openContributeCameraModal);
    document.getElementById("contribute-camera-close").addEventListener("click", closeContributeCameraModal);
    document.getElementById("contribute-camera-cancel").addEventListener("click", closeContributeCameraModal);
    document.getElementById("contribute-use-location").addEventListener("click", fillContributionLocation);
    document.getElementById("contribute-camera-form").addEventListener("submit", submitCameraContribution);
    document.querySelectorAll('input[name="contribute-public-visible"]').forEach((input) => {
      input.addEventListener("change", updateContributionPrivacyQuestions);
    });
    document.getElementById("nearby-toggle").addEventListener("click", toggleNearbyNotifications);
    document.getElementById("scanner-toggle").addEventListener("click", toggleScanner);
    document.querySelectorAll("[data-dashboard-demo]").forEach((button) => {
      button.addEventListener("click", () => runDashboardIncidentDemo(button.dataset.dashboardDemo));
    });
    document.getElementById("incident-demo-reset")?.addEventListener("click", async () => {
      try {
        await resetDashboardIncidentDemo();
      } catch (err) {
        setIncidentDemoProgress(err.message || "Could not reset demo incidents", "error");
      }
    });
    document.getElementById("health-check").addEventListener("click", refreshCameraHealth);
    document.getElementById("news-refresh").addEventListener("click", () => {
      loadNews({ refresh: true });
      loadVideoNews({ refresh: true });
    });
    document.getElementById("news-feed-close")?.addEventListener("click", () => {
      setWorkspacePanel("cameras");
    });
    document.addEventListener("keydown", (event) => {
      const section = document.getElementById("news-section");
      if (!section || section.hidden) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setWorkspacePanel("cameras");
        return;
      }

      // Skip arrow keys action when typing or interacting with form controls/buttons
      if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(document.activeElement.tagName)) return;

      if (activeNewsTab === "video") {
        if (event.key === "ArrowDown" || event.key === "PageDown") {
          event.preventDefault();
          moveNewsFeed(1);
        } else if (event.key === "ArrowUp" || event.key === "PageUp") {
          event.preventDefault();
          moveNewsFeed(-1);
        }
      }
    });

    document.getElementById("video-feed-prev")?.addEventListener("click", () => {
      moveNewsFeed(-1);
    });
    document.getElementById("video-feed-next")?.addEventListener("click", () => {
      moveNewsFeed(1);
    });
    document.getElementById("account-logout").addEventListener("click", logout);

    document.querySelectorAll("[data-workspace-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setWorkspacePanel(btn.dataset.workspaceTab));
    });

    renderAuthState();
    setWorkspacePanel("cameras");

    document.querySelectorAll("#news-tabs .news-tab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        document.querySelectorAll("#news-tabs .news-tab").forEach((item) => item.classList.remove("active"));
        btn.classList.add("active");
        activeNewsCategory = btn.dataset.newsCategory || "all";
        await loadNews();
        await loadVideoNews();
      });
    });

    const newsSearchInput = document.getElementById("news-search-input");
    if (newsSearchInput) {
      newsSearchInput.addEventListener("input", (e) => {
        newsSearchQuery = e.target.value;
        applyNewsFilterAndRender();
      });
    }

    const newsSourceSelect = document.getElementById("news-source-filter");
    if (newsSourceSelect) {
      newsSourceSelect.addEventListener("change", (e) => {
        newsSourceFilter = e.target.value;
        applyNewsFilterAndRender();
      });
    }

    document.querySelectorAll(".radius-btn").forEach((btn) => {
      btn.addEventListener("click", () => setNearbyRadius(Number(btn.dataset.radius)));
    });

    document.querySelectorAll(".range-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        document.querySelectorAll(".range-btn").forEach((item) => item.classList.remove("active"));
        btn.classList.add("active");
        statsRange = btn.dataset.range;
        document.getElementById("custom-range").classList.toggle("active", statsRange === "custom");
        await loadStatisticsEvents();
      });
    });

    ["stats-from", "stats-to"].forEach((id) => {
      document.getElementById(id).addEventListener("change", async () => {
        if (statsRange === "custom") await loadStatisticsEvents();
      });
    });

    document.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-btn").forEach((item) => item.classList.remove("active"));
        btn.classList.add("active");
        activeFilter = btn.dataset.filter;
        applyFilter();
      });
    });

    document.querySelectorAll("[data-map-incident-filter]").forEach((btn) => {
      btn.addEventListener("click", () => setMapIncidentFilter(btn.dataset.mapIncidentFilter));
    });

    document.addEventListener("click", (event) => {
      const deleteButton = event.target.closest(".alert-delete-btn");
      if (deleteButton?.dataset.deleteQueue) {
        event.preventDefault();
        event.stopPropagation();
        deleteAlertQueueItem(deleteButton.dataset.cameraId, deleteButton.dataset.eventType);
        return;
      }

      const focusButton = event.target.closest("[data-focus-camera-id]");
      if (focusButton?.dataset.focusCameraId) {
        event.preventDefault();
        if (!mapOnlyMode) setWorkspacePanel("cameras");
        focusCamera(focusButton.dataset.focusCameraId);
        return;
      }

      const watch = event.target.closest(".camera-watch, .popup-action");
      if (watch?.dataset.cameraId) {
        event.preventDefault();
        event.stopPropagation();
        openVideoModal(watch.dataset.cameraId);
      }
    });

    document.addEventListener("change", (event) => {
      const select = event.target.closest(".alert-queue-select");
      if (!select) return;
      event.stopPropagation();
      updateAlertQueueStatus(select.dataset.cameraId, select.dataset.eventType, select.value);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeVideoModal();
        closeAlertSnapshot();
        closeEmergencyModal();
        closeContributeCameraModal();
      }
    });

    if (window.io) {
      const socket = API_BASE
        ? io(API_BASE, { transports: ["websocket", "polling"] })
        : io({ transports: ["websocket", "polling"] });
      realtimeSocket = socket;
      socket.on("connect", () => {
        setConnection(true, "Live");
        if (userLocation) publishUserLocation(userLocation);
      });
      socket.on("disconnect", () => setConnection(false, "Offline"));
      socket.on("alert", (data) => {
        if (data.queue_status) {
          alertQueue.set(queueKey(data.camera_id, data.event_type), {
            camera_id: data.camera_id,
            event_type: data.event_type,
            status: data.queue_status,
          });
        }
        updateMarkerAlert(data.camera_id, data);
        addAlertRow(data);
        recordStatsEvent(data);
        notifyNearbyAlert(data);
        playBeep(data.event_type);
        if (data.severity !== "normal") {
          showToast(data);
        }
        const spokenLabels = {
          fire: "cháy",
          flood: "ngập lụt",
          traffic_jam: "ùn tắc giao thông",
        };
        const spokenLabel = spokenLabels[data.event_type] || getAlertMeta(data.event_type).shortLabel;
        const cameraName = maybeRepairMojibake(data.camera_name || data.camera_id || "camera");
        speakAlert(`Cảnh báo. Phát hiện ${spokenLabel} tại ${cameraName}.`);
      });
      socket.on("alert_update", (data) => {
        if (data.queue_status) {
          alertQueue.set(queueKey(data.camera_id, data.event_type), {
            camera_id: data.camera_id,
            event_type: data.event_type,
            status: data.queue_status,
          });
          applyQueueStatusToRows();
        }
        updateMarkerAlert(data.camera_id, data, { blink: false, openPopup: false });
        notifyNearbyAlert(data);
      });
      socket.on("alert_cleared", (data) => {
        if (data.queue_status) {
          alertQueue.set(queueKey(data.camera_id, data.event_type), {
            camera_id: data.camera_id,
            event_type: data.event_type,
            status: data.queue_status,
          });
          applyQueueStatusToRows();
        }
        clearMarkerAlert(data);
      });
      socket.on("traffic_volume_update", () => loadTrafficHeatmap());
    } else {
      setConnection(false, "Preview");
    }

    setInterval(() => {
      loadNews();
      loadVideoNews();
    }, 10 * 60 * 1000);
    setInterval(loadScannerStatus, 5000);
    setInterval(loadTrafficHeatmap, 30000);
    init();

// --- Chat Widget Logic ---
let chatRouteLayer = null;
let chatRouteMarkers = [];

function clearChatRouteVisuals() {
  if (chatRouteLayer) {
    map.removeLayer(chatRouteLayer);
    chatRouteLayer = null;
  }
  chatRouteMarkers.forEach((marker) => map.removeLayer(marker));
  chatRouteMarkers = [];
}

function createRouteEndpointMarker(point, label, title, tone) {
  const marker = L.marker(point, {
    keyboard: true,
    icon: L.divIcon({
      className: `route-endpoint-marker ${tone}`,
      html: `<span>${label}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    }),
  }).addTo(map);
  marker.bindTooltip(title, {
    permanent: true,
    direction: 'top',
    offset: [0, -12],
    className: 'route-label-tooltip',
  });
  return marker;
}

function addRouteTurnMarkers(steps) {
  const candidates = (steps || []).filter((step) => {
    const type = step?.maneuver?.type;
    return step?.maneuver?.location && !['depart', 'arrive'].includes(type) && Number(step.distance) >= 20;
  });
  const limit = window.innerWidth <= 820 ? 6 : 12;
  const stride = Math.max(1, Math.ceil(candidates.length / limit));

  candidates.filter((_step, index) => index % stride === 0).forEach((step) => {
    const [lng, lat] = step.maneuver.location;
    const marker = L.circleMarker([lat, lng], {
      radius: 5,
      color: '#081311',
      weight: 2,
      fillColor: '#b8fff4',
      fillOpacity: 1,
      pane: 'markerPane',
    }).addTo(map);
    const action = translateManeuver(step.maneuver.type, step.maneuver.modifier);
    const street = step.name ? ` • ${step.name}` : '';
    marker.bindTooltip(`${action}${street} • ${formatDistance(step.distance)}`, {
      direction: 'top',
      className: 'route-step-tooltip',
    });
    marker.on('click', () => map.flyTo([lat, lng], 17, { duration: 0.45 }));
    chatRouteMarkers.push(marker);
  });
}

function renderDetailedRoute(data) {
  clearChatRouteVisuals();

  chatRouteLayer = L.featureGroup().addTo(map);
  L.polyline(data.route, {
    color: '#07110f',
    weight: 11,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
  }).addTo(chatRouteLayer);
  L.polyline(data.route, {
    color: '#31d6c0',
    weight: 6,
    opacity: 1,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(chatRouteLayer);

  chatRouteMarkers.push(
    createRouteEndpointMarker(data.startPoint, 'A', 'Điểm xuất phát', 'start'),
    createRouteEndpointMarker(data.endPoint, 'B', 'Điểm đến', 'end')
  );
  addRouteTurnMarkers(data.steps);

  const isMobile = window.innerWidth <= 820;
  map.fitBounds(chatRouteLayer.getBounds(), {
    animate: true,
    maxZoom: 15,
    paddingTopLeft: isMobile ? [24, 176] : [450, 160],
    paddingBottomRight: isMobile ? [24, Math.round(window.innerHeight * 0.5)] : [380, 110],
  });
}

document.querySelector('#chat-panel .chat-header h3').textContent = 'Trợ lý Chỉ đường AI';
document.querySelector('#chat-body .chat-message.ai').textContent = 'Xin chào! Tôi có thể giúp bạn lập tuyến đường. Bạn muốn đi đâu?';
document.getElementById('chat-input').placeholder = 'Nhập câu hỏi hoặc điểm đến...';
document.getElementById('btn-force-route').title = 'Chỉ đường đến điểm này';
document.querySelector('#chat-form button[type="submit"]').textContent = 'Gửi';

document.getElementById('chat-toggle').addEventListener('click', () => {
  const panel = document.getElementById('chat-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) document.getElementById('chat-input').focus();
});

document.getElementById('chat-close').addEventListener('click', () => {
  document.getElementById('chat-panel').hidden = true;
});

function addChatMessage(text, sender, id = null) {
  const body = document.getElementById('chat-body');
  const msg = document.createElement('div');
  msg.className = `chat-message ${sender}`;
  if (id) msg.id = id;
  // Simple markdown-to-html for bold
  msg.innerHTML = escapeHtml(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  body.appendChild(msg);
  body.scrollTop = body.scrollHeight;
}

function getCurrentLocation() {
  return new Promise((resolve) => {
    if (userLocation) return resolve(userLocation);
    if (typeof requestUserLocation === "function") {
      requestUserLocation({ silent: true }).then(resolve).catch(() => resolve(null));
      return;
    }
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

function formatDistance(m) {
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
}

const maneuverTranslations = {
  'turn-left': 'Rẽ trái',
  'turn-right': 'Rẽ phải',
  'turn-slight left': 'Chếch sang trái',
  'turn-slight right': 'Chếch sang phải',
  'turn-sharp left': 'Rẽ ngoặt sang trái',
  'turn-sharp right': 'Rẽ ngoặt sang phải',
  'turn-straight': 'Đi thẳng',
  'depart-right': 'Xuất phát về hướng bên phải',
  'depart-left': 'Xuất phát về hướng bên trái',
  'depart-straight': 'Xuất phát đi thẳng',
  'arrive-left': 'Điểm đến ở bên trái',
  'arrive-right': 'Điểm đến ở bên phải',
  'arrive-straight': 'Đã đến nơi',
  'roundabout-right': 'Vào vòng xuyến rẽ phải',
  'roundabout-left': 'Vào vòng xuyến rẽ trái',
  'merge-left': 'Nhập làn bên trái',
  'merge-right': 'Nhập làn bên phải'
};

function translateManeuver(type, modifier) {
  const key = `${type}-${modifier}`;
  if (maneuverTranslations[key]) return maneuverTranslations[key];
  if (type === 'depart') return 'Xuất phát';
  if (type === 'arrive') return 'Đã đến nơi';
  if (type === 'roundabout') return 'Vào vòng xuyến';
  if (modifier === 'left') return 'Rẽ trái';
  if (modifier === 'right') return 'Rẽ phải';
  if (modifier === 'straight') return 'Đi thẳng';
  if (type === 'new name') return 'Đi tiếp lên';
  return type + ' ' + (modifier || '');
}

function getManeuverIcon(type, modifier) {
  if (type === 'depart') return '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
  if (type === 'arrive') return '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>';
  if (modifier?.includes('left')) return '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 110 8h-1"/></svg>';
  if (modifier?.includes('right')) return '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l4-4-4-4"/><path d="M19 10H8a4 4 0 100 8h1"/></svg>';
  return '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>'; // straight
}

function renderRouteSteps(steps) {
  const panel = document.getElementById('route-directions-panel');
  const body = document.getElementById('route-directions-body');
  if (!panel || !body) return;
  
  if (!steps || steps.length === 0) {
    panel.hidden = true;
    return;
  }
  
  body.innerHTML = '';
  steps.forEach((step, index) => {
    const maneuver = step.maneuver;
    let nameText = step.name ? `vào <b>${step.name}</b>` : '';
    if (maneuver.type === 'arrive') nameText = '';
    
    let actionText = translateManeuver(maneuver.type, maneuver.modifier);
    
    const div = document.createElement('div');
    div.className = 'direction-step';
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', `${actionText}${step.name ? ` vào ${step.name}` : ''}, ${formatDistance(step.distance || 0)}`);
    div.innerHTML = `
      <div class="direction-icon">${getManeuverIcon(maneuver.type, maneuver.modifier)}</div>
      <div class="direction-text">
        ${actionText} ${nameText}
        ${step.distance > 0 ? `<div class="direction-distance">${formatDistance(step.distance)}</div>` : ''}
      </div>
    `;
    const focusStep = () => {
      const location = step?.maneuver?.location;
      if (!location) return;
      document.querySelectorAll('.direction-step.active').forEach((item) => item.classList.remove('active'));
      div.classList.add('active');
      const [lng, lat] = location;
      map.flyTo([lat, lng], Math.max(map.getZoom(), 17), { duration: 0.45 });
    };
    div.addEventListener('click', focusStep);
    div.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      focusStep();
    });
    body.appendChild(div);
  });
  
  panel.hidden = false;
  document.querySelector('.app-shell')?.classList.add('route-details-open');
}

document.getElementById('close-directions-btn')?.addEventListener('click', () => {
  const panel = document.getElementById('route-directions-panel');
  if (panel) panel.hidden = true;
  document.querySelector('.app-shell')?.classList.remove('route-details-open');
});

let forceRouteFlag = false;
document.getElementById('btn-force-route')?.addEventListener('click', () => {
  forceRouteFlag = true;
  document.getElementById('chat-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
});

let isNavigating = false;
let watchPositionId = null;
let currentRouteSteps = [];
let currentStepIndex = 0;
let navLocationMarker = null;
let lastKnownLocation = null;

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function updateNavigationBanner(overrideDistance) {
  if (currentStepIndex >= currentRouteSteps.length) return;
  const step = currentRouteSteps[currentStepIndex];
  
  const actionText = translateManeuver(step.maneuver.type, step.maneuver.modifier);
  const nameText = step.name ? `vào ${step.name}` : '';
  
  document.getElementById('nav-instruction').textContent = `${actionText} ${nameText}`;
  document.getElementById('nav-next-icon').innerHTML = getManeuverIcon(step.maneuver.type, step.maneuver.modifier);
  
  const dist = overrideDistance !== undefined ? overrideDistance : step.distance;
  document.getElementById('nav-distance').textContent = formatDistance(dist);
}

function handleLocationUpdate(lat, lng) {
  if (!isNavigating) return;
  
  if (!navLocationMarker) {
    navLocationMarker = L.circleMarker([lat, lng], {
      radius: 8,
      fillColor: '#3b82f6',
      color: '#fff',
      weight: 3,
      opacity: 1,
      fillOpacity: 1,
      className: 'user-location-marker'
    }).addTo(map);
  } else {
    navLocationMarker.setLatLng([lat, lng]);
  }
  
  map.panTo([lat, lng], { animate: true });
  
  if (currentStepIndex < currentRouteSteps.length) {
    const step = currentRouteSteps[currentStepIndex];
    const stepLoc = step.maneuver.location;
    const dist = getDistance(lat, lng, stepLoc[1], stepLoc[0]);
    
    if (dist < 30) {
      currentStepIndex++;
    }
    updateNavigationBanner(dist);
  }
  
  if (currentStepIndex >= currentRouteSteps.length) {
    document.getElementById('nav-instruction').textContent = "Đã đến nơi!";
    document.getElementById('nav-distance').textContent = "0 m";
    document.getElementById('nav-next-icon').innerHTML = getManeuverIcon('arrive', '');
    setTimeout(stopNavigation, 5000);
  }
}

function startNavigation() {
  if (!currentRouteSteps || currentRouteSteps.length === 0) return;
  isNavigating = true;
  currentStepIndex = 0;
  
  const dirPanel = document.getElementById('route-directions-panel');
  if (dirPanel) dirPanel.hidden = true;
  document.querySelector('.app-shell')?.classList.remove('route-details-open');
  
  const navBanner = document.getElementById('navigation-banner');
  if (navBanner) navBanner.hidden = false;
  
  if (map.getZoom() < 17) {
    map.setZoom(17);
  }
  
  updateNavigationBanner();
  
  if (navigator.geolocation) {
    watchPositionId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        lastKnownLocation = {lat, lng};
        handleLocationUpdate(lat, lng);
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  }
}

function stopNavigation() {
  isNavigating = false;
  if (watchPositionId !== null) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
  
  const navBanner = document.getElementById('navigation-banner');
  if (navBanner) navBanner.hidden = true;
  
  const dirPanel = document.getElementById('route-directions-panel');
  if (dirPanel) dirPanel.hidden = false;
  document.querySelector('.app-shell')?.classList.add('route-details-open');
  
  if (navLocationMarker) {
    map.removeLayer(navLocationMarker);
    navLocationMarker = null;
  }
}

document.getElementById('start-navigation-btn')?.addEventListener('click', startNavigation);
document.getElementById('nav-stop-btn')?.addEventListener('click', stopNavigation);

document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  const isForceRoute = forceRouteFlag;
  forceRouteFlag = false;

  addChatMessage(message, 'user');
  input.value = '';
  input.disabled = true;
  
  // Show loading indicator
  addChatMessage('Đang suy nghĩ...', 'ai loading', 'chat-loading');

  try {
    const currentLocation = await getCurrentLocation();
    
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, currentLocation, forceRoute: isForceRoute })
    });
    
    // Remove loading indicator
    const loadingEl = document.getElementById('chat-loading');
    if (loadingEl) loadingEl.remove();

    const data = await res.json();
    
    addChatMessage(data.message || data.error || 'Lỗi kết nối', 'ai');

    if (data.type === 'route' && data.route && data.route.length > 0) {
      renderDetailedRoute(data);
      applyRouteCameraFilter(data.route, data.route_cameras || []);
      
      if (data.steps) {
        currentRouteSteps = data.steps;
        renderRouteSteps(data.steps);
      }
      if (window.innerWidth <= 820) {
        document.getElementById('chat-panel').hidden = true;
      }
    }
  } catch (err) {
    addChatMessage('Không thể kết nối đến máy chủ AI.', 'ai');
  } finally {
    input.disabled = false;
    input.focus();
  }
});
document.getElementById("camera-collapse-btn")?.addEventListener("click", (event) => {
  const button = event.currentTarget;
  const section = document.getElementById("camera-section");
  const collapsed = section.classList.toggle("collapsed");
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", collapsed ? "Show camera list" : "Hide camera list");
  button.setAttribute("title", collapsed ? "Show camera list" : "Hide camera list");
  window.setTimeout(() => map.invalidateSize(), 220);
});

function showToast(alertData) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const meta = getAlertMeta(alertData.event_type);
  const toast = document.createElement("div");
  toast.className = "toast-item";
  if (hasAlertSnapshot(alertData)) toast.classList.add("has-snapshot");
  toast.setAttribute("role", "button");
  toast.tabIndex = 0;
  toast.innerHTML = `
    <div class="toast-icon" style="color: var(--${meta.color})">${iconSvg(alertData.event_type)}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(meta.label)}</div>
      <div class="toast-message">${escapeHtml(alertData.camera_name || alertData.camera_id)}</div>
    </div>
    <button class="toast-close" type="button" aria-label="Close alert">
      <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  `;
  container.appendChild(toast);
  
  const closeBtn = toast.querySelector(".toast-close");
  const removeToast = () => {
    toast.classList.add("toast-leaving");
    toast.addEventListener("transitionend", () => toast.remove());
  };
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    removeToast();
  });
  toast.addEventListener("click", () => {
    if (hasAlertSnapshot(alertData)) openAlertSnapshot(alertData);
    else if (alertData.camera_id) focusCamera(alertData.camera_id);
  });
  toast.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (hasAlertSnapshot(alertData)) openAlertSnapshot(alertData);
    else if (alertData.camera_id) focusCamera(alertData.camera_id);
  });
  setTimeout(removeToast, 6000);
}

document.querySelectorAll(".cam-filter-chip").forEach(chip => {
  chip.addEventListener("click", (e) => {
    document.querySelectorAll(".cam-filter-chip").forEach(c => c.classList.remove("active"));
    e.target.classList.add("active");
    renderCameraList();
  });
});
