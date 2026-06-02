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
    const CAMERA_SOURCES = {
      hcm: {
        endpoint: "/api/cameras/hcm",
        fallbackEndpoint: "/api/cameras",
        label: "TP.HCM",
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
      },
      hanoi: {
        endpoint: "/api/cameras/hanoi",
        fallbackEndpoint: "/api/cameras/hanoi",
        label: "Hà Nội",
        center: [21.0285, 105.8542],
        zoom: 12,
      },
    };
    const ALERT_TYPES = {
      traffic_jam: { label: "Traffic jam", shortLabel: "Traffic", color: "traffic_jam" },
      fire: { label: "Fire detected", shortLabel: "Fire", color: "fire" },
      flood: { label: "Flood warning", shortLabel: "Flood", color: "flood" },
      normal: { label: "Normal", shortLabel: "Normal", color: "normal" },
    };
    const CP1252 = {
      0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
      0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
      0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
      0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
      0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
      0x017e: 0x9e, 0x0178: 0x9f,
    };

    const API_BASE = window.location.protocol === "file:" || ["4173", "5173"].includes(window.location.port)
      ? "http://localhost:3000"
      : "";
    const AUTH_SESSION_KEY = "smart-alert-auth-session";
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
    let activeCameraId = null;
    let activeCameraSource = new URLSearchParams(window.location.search).get("city") === "hanoi" ? "hanoi" : "hcm";
    let activeWorkspacePanel = "cameras";
    let streamRefreshTimer = null;
    let tileLayer = null;
    let statsRange = "24h";
    let nearbyRadius = 3000;
    let nearbyNotificationsEnabled = false;
    let activeNewsCategory = "all";
    let userLocation = null;
    let geoWatchId = null;

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
      };
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' + (icons[type] || icons.camera) + "</svg>";
    }

    function looksMojibaked(text) {
      return Array.from(text).some((char) => {
        const code = char.codePointAt(0);
        return code === 0xc2 || code === 0xc3 || code === 0xc4 || code === 0xc6 ||
          code === 0xe1 || code === 0xbb || code === 0xba || code === 0x2026;
      });
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

    function formatTime(value, withSeconds = true) {
      const date = value ? new Date(value) : new Date();
      if (Number.isNaN(date.getTime())) return "--:--";
      return date.toLocaleTimeString(navigator.language || "vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: withSeconds ? "2-digit" : undefined,
      });
    }

    function formatDateTime(value) {
      const date = value ? new Date(value) : new Date();
      if (Number.isNaN(date.getTime())) return "Unknown time";
      return date.toLocaleString(navigator.language || "vi-VN", {
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

    async function fetchJsonOrNull(url) {
      const res = await fetch(apiUrl(url));
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
    }

    function logout() {
      localStorage.removeItem(AUTH_SESSION_KEY);
      window.location.href = "login.html";
    }

    function updateClock() {
      document.getElementById("operations-clock").textContent =
        "Live operations - " + formatDateTime(new Date());
      document.getElementById("last-sync").textContent = formatTime(new Date());
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
        map.fitBounds(cluster.getBounds().pad(0.16), { maxZoom: 15, animate: true });
      } else if (typeof cluster.spiderfy === "function" && map.getZoom() >= 15) {
        cluster.spiderfy();
      }
    }

    function getAlertMeta(type) {
      return ALERT_TYPES[type] || { label: maybeRepairMojibake(type || "Alert"), shortLabel: "Alert", color: "normal" };
    }

    function buildNormalPopup(cam) {
      const id = escapeAttr(cam.camera_id);
      return `
        <div class="popup-content">
          <div class="popup-heading">
            <div class="popup-icon">${iconSvg("camera")}</div>
            <div>
              <div class="popup-title">${escapeHtml(cam.name)}</div>
              <div class="popup-meta">${escapeHtml(cam.location?.address || "No address")}</div>
            </div>
          </div>
          <div class="popup-badge">Normal</div>
          <button class="popup-action" type="button" data-camera-id="${id}">
            ${iconSvg("play")}
            Watch live
          </button>
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
              <div class="popup-title">${escapeHtml(alertData.camera_name || "Selected camera")}</div>
              <div class="popup-meta">${formatDateTime(alertData.timestamp)}</div>
            </div>
          </div>
          <div class="popup-badge ${meta.color}">${escapeHtml(meta.label)}</div>
          ${imgTag}
          <button class="popup-action" type="button" data-camera-id="${cameraId}">
            ${iconSvg("play")}
            Watch live
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
        black: "Black frame",
        error: "Error",
        live: "Live",
        offline: "Error",
        stale: "Stale frame",
        timeout: "Timeout",
        unchecked: "Unchecked",
      }[status] || "Unchecked";
    }

    function isHealthIssue(status) {
      return ["black", "error", "offline", "stale", "timeout"].includes(status);
    }

    function getCameraHealthCopy(cam) {
      if (cam.data?.stream_type === "wss_video" && cam.healthStatus === "unchecked") {
        return "Realtime WSS source";
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
      populateEmergencyCameraSelect();
    }

    function updateCameraMarkerVisibility(cameraId) {
      const cam = cameras.get(cameraId);
      if (!cam?.marker) return;
      const shouldShow = !routeCameraIds || routeCameraIds.has(cameraId);
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
      const clearButton = document.getElementById("route-filter-clear");
      if (clearButton) clearButton.hidden = !routeCameraIds;
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
      if (!cam) return;

      const activeAlert = getDominantAlertForCamera(cameraId);
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
      updateIncidentFocus(alertData);
    }

    function clearMarkerAlert(clearData) {
      activeAlerts.delete(activeAlertKey(clearData.camera_id, clearData.event_type));
      renderCameraAlertState(clearData.camera_id, { blink: false, openPopup: false });
      updateIncidentFocus(clearData);
    }

    function refreshStatistics() {
      const counts = { fire: 0, flood: 0, traffic_jam: 0 };
      const byCamera = new Map();

      statsEvents.forEach((event) => {
        if (counts[event.event_type] !== undefined) counts[event.event_type] += 1;
        const key = event.camera_id || "unknown";
        const current = byCamera.get(key) || { count: 0, name: event.camera_name || key };
        current.count += 1;
        byCamera.set(key, current);
      });

      document.getElementById("stat-fire").textContent = counts.fire;
      document.getElementById("stat-flood").textContent = counts.flood;
      document.getElementById("stat-traffic").textContent = counts.traffic_jam;
      document.getElementById("analytics-total").textContent = statsEvents.length;
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
        document.getElementById("metric-last-alert").textContent = "None";
        document.getElementById("incident-focus-copy").textContent =
          "No active incidents on the map. Historical alerts remain available for reports and statistics.";
        return;
      }

      const focusAlert = alertData?.active === false ? getLatestActiveAlert() : (alertData || getLatestActiveAlert());
      const meta = getAlertMeta(focusAlert.event_type);
      document.getElementById("metric-last-alert").textContent = meta.shortLabel;
      document.getElementById("incident-focus-copy").textContent =
        meta.label + " at " + maybeRepairMojibake(focusAlert.camera_name || focusAlert.camera_id) + " around " + formatTime(focusAlert.last_seen || focusAlert.timestamp, false) + ".";
    }

    function queueKey(cameraId, eventType) {
      return cameraId + "::" + eventType;
    }

    function getQueueStatusLabel(status) {
      return {
        new: "New",
        in_progress: "In progress",
        confirmed: "Confirmed",
        false_alarm: "False alarm",
        resolved: "Resolved",
      }[status] || "New";
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

    function renderEmptyAlerts(message = "Waiting for incoming detections from camera modules.") {
      const log = document.getElementById("alert-log");
      log.innerHTML = `
        <div class="empty-state">
          ${iconSvg("alert")}
          <div class="empty-title">No alert history</div>
          <div class="empty-copy">${escapeHtml(message)}</div>
        </div>
      `;
      document.getElementById("alert-count").textContent = alerts.length;
    }

    function addAlertRow(alertData) {
      const log = document.getElementById("alert-log");
      log.querySelectorAll(".empty-state").forEach((el) => el.remove());
      const meta = getAlertMeta(alertData.event_type);

      const row = document.createElement("div");
      const queueStatus = alertData.queue_status || getQueueStatus(alertData.camera_id, alertData.event_type);
      row.className = "alert-row";
      row.dataset.cameraId = alertData.camera_id;
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
          <span class="alert-severity severity-${escapeAttr(alertData.severity || "medium")}">${escapeHtml(alertData.severity || "medium")}</span>
          <select class="alert-queue-select" data-camera-id="${escapeAttr(alertData.camera_id)}" data-event-type="${escapeAttr(alertData.event_type)}" aria-label="Alert queue status">
            ${renderQueueStatusOptions(queueStatus)}
          </select>
        </div>
      `;

      row.addEventListener("click", (event) => {
        if (event.target.closest(".alert-queue-select")) return;
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
          <div class="empty-title">No ${escapeHtml(meta.shortLabel.toLowerCase())} alerts</div>
          <div class="empty-copy">Switch filters to review other incident types.</div>
        `;
        log.appendChild(empty);
      }
    }

    function openVideoModal(camId) {
      closeVideoModal();
      const cam = cameras.get(camId);
      const camName = cam ? maybeRepairMojibake(cam.data.name) : "Camera";
      const shell = document.querySelector(".video-shell");
      const stream = document.getElementById("video-stream");
      const snapshotUrl = cam?.data?.snapshot_url;
      const streamUrl = cam?.data?.stream_url;
      const streamType = cam?.data?.stream_type || "";
      const isSnapshotStream = cam?.data?.stream_type === "snapshot" || Boolean(snapshotUrl);
      const isWssStream = streamType === "wss_video";
      const sourceUrl = snapshotUrl || streamUrl || ("http://localhost:5000/video_feed/" + encodeURIComponent(camId));

      document.getElementById("modal-cam-name").textContent = camName;
      document.getElementById("stream-placeholder-title").textContent = isWssStream
        ? "Realtime WSS source detected"
        : isSnapshotStream ? "Connecting to live camera" : "Waiting for stream";
      document.getElementById("stream-placeholder-copy").textContent = isWssStream
        ? "Hanoi exposes this camera as a WebSocket video stream. The app can list and inspect it, but needs a decoder/proxy before browser playback."
        : isSnapshotStream
        ? "Live frames are loading through the local camera proxy."
        : "The AI video proxy will appear here when the camera feed is available.";
      shell.classList.remove("stream-offline");
      stream.onload = () => shell.classList.remove("stream-offline");
      stream.onerror = () => {
        shell.classList.add("stream-offline");
        document.getElementById("stream-placeholder-title").textContent = "Stream source unavailable";
        document.getElementById("stream-placeholder-copy").textContent = isSnapshotStream
          ? "The traffic portal did not return a frame for this camera."
          : "Start the AI proxy on localhost:5000 to view the processed camera feed.";
      };

      if (isWssStream) {
        shell.classList.add("stream-offline");
        stream.src = "";
      } else if (isSnapshotStream) {
        const loadFrame = () => {
          const joiner = sourceUrl.includes("?") ? "&" : "?";
          stream.src = sourceUrl + joiner + "ts=" + Date.now();
        };
        loadFrame();
        streamRefreshTimer = window.setInterval(loadFrame, 2000);
      } else {
        stream.src = sourceUrl;
      }

      loadCameraHistory(camId);
      document.getElementById("video-modal").classList.add("active");
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
      document.getElementById("video-modal").classList.remove("active");
      if (streamRefreshTimer) {
        window.clearInterval(streamRefreshTimer);
        streamRefreshTimer = null;
      }
      const stream = document.getElementById("video-stream");
      stream.onload = null;
      stream.onerror = null;
      stream.src = "";
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
          const position = await getCurrentPosition();
          payload.lat = position.coords.latitude;
          payload.lng = position.coords.longitude;
          userLocation = { lat: payload.lat, lng: payload.lng };
          updateNearbyStatus();
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
      toggle.textContent = nearbyNotificationsEnabled ? "Location alerts enabled" : "Enable location alerts";

      if (message) {
        status.textContent = message;
        return;
      }

      if (!nearbyNotificationsEnabled) {
        status.textContent = "Off. Choose a radius and enable alerts to get notified near your position.";
        return;
      }

      status.textContent = userLocation
        ? "Watching for incidents within " + formatDistance(nearbyRadius) + " of your position."
        : "Waiting for location permission...";
    }

    async function toggleNearbyNotifications() {
      if (nearbyNotificationsEnabled) {
        nearbyNotificationsEnabled = false;
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
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission !== "granted") {
          updateNearbyStatus("Notification permission was not granted.");
          return;
        }

        const position = await getCurrentPosition();
        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        nearbyNotificationsEnabled = true;
        if (navigator.geolocation && geoWatchId === null) {
          geoWatchId = navigator.geolocation.watchPosition((pos) => {
            userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            updateNearbyStatus();
          });
        }
        updateNearbyStatus();
        checkNearbyActiveAlerts();
      } catch (_err) {
        updateNearbyStatus("Location permission is needed to send nearby alerts.");
      }
    }

    function notifyNearbyAlert(alertData) {
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
      const body = meta.label + " near " + maybeRepairMojibake(alertData.camera_name || alertData.camera_id) + ", about " + formatDistance(distance) + " away.";
      updateNearbyStatus(body);
      try {
        new Notification("Smart Alert nearby", {
          body,
          tag: key,
        });
      } catch (_err) {}
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
      document.querySelectorAll("[data-workspace-panel]").forEach((panel) => {
        panel.hidden = mapOnlyRequested
          ? panel.dataset.workspacePanel !== "cameras"
          : panel.dataset.workspacePanel !== activeWorkspacePanel;
      });

      if (activeWorkspacePanel === "cameras" || activeWorkspacePanel === "map") {
        renderCameraList();
        setTimeout(() => map.invalidateSize(), 80);
      }
      if (activeWorkspacePanel === "alerts") applyFilter();
      if (activeWorkspacePanel === "news") loadNews();
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
      setTimeout(() => map.invalidateSize(), 120);
    }

    function toggleMapOnlyMode() {
      setWorkspacePanel(mapOnlyMode ? "cameras" : "map");
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
      const workerText = (status?.activeWorkers || 0) + "/" + (config.concurrency || 0) + " workers";
      const cameraText = lastRun ? lastRun.processed + "/" + lastRun.cameras + " cameras" : "No scan yet";
      const detectorText = config.detectorConfigured
        ? "external detector"
        : config.mockDetections
          ? "demo detector"
          : "no detector configured";

      stateEl.textContent = running
        ? scanning
          ? "AI scanner running"
          : "AI scanner waiting"
        : "AI scanner idle";
      detailEl.textContent = workerText + " | " + cameraText + " | " + detectorText;
      toggle.textContent = running ? "Stop scan" : "Start scan";
      toggle.classList.toggle("enabled", running);
    }

    async function loadScannerStatus() {
      const status = await fetchJsonOrNull("/api/scanner/status");
      if (status) renderScannerStatus(status);
    }

    async function loadCameraHealth() {
      if (activeCameraSource === "hanoi") {
        updateHealthSummaryUi({ total: cameras.size, live: 0, issues: 0, unchecked: cameras.size });
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
        updateHealthSummaryUi({ total: cameras.size, live: 0, issues: 0, unchecked: cameras.size });
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
      if (activeCameraSource === "hanoi") {
        renderScannerStatus({
          running: false,
          config: {},
          lastRun: { processed: 0, cameras: cameras.size },
        });
        if (toggle) {
          const previous = toggle.textContent;
          toggle.textContent = "Needs decoder";
          window.setTimeout(() => { toggle.textContent = previous || "Start scan"; }, 1400);
        }
        return;
      }
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
            concurrency: 4,
            intervalMs: 10000,
            source: "hcm",
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

      if (!items.length) {
        renderEmptyNews("No matching headlines are available right now.");
        return;
      }

      list.innerHTML = items.map((item) => `
        <a class="news-item" href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">
          <div class="news-title">${escapeHtml(item.title)}</div>
          ${item.summary ? `<div class="news-summary"><span class="news-summary-label">Summary:</span> ${escapeHtml(item.summary)}</div>` : ""}
          <div class="news-meta">
            <span class="news-category">${escapeHtml(item.category || "news")}</span>
            <span class="news-source">${escapeHtml(item.source || "News")}</span>
            <span class="news-dot" aria-hidden="true"></span>
            <span>${escapeHtml(formatRelativeTime(item.published_at))}</span>
          </div>
        </a>
      `).join("");
    }

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
        renderNewsItems(json.news || []);
      } catch (_err) {
        renderEmptyNews("News is unavailable. Try refresh again in a moment.");
      } finally {
        if (refreshButton) refreshButton.disabled = false;
      }
    }

    async function loadHistoricalEvents() {
      try {
        const json = await fetchJsonOrNull("/api/events?limit=50");
        if (!json) {
          renderEmptyAlerts("Event history is unavailable. Live alerts will still appear when received.");
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
        renderEmptyAlerts("Event history is unavailable. Live alerts will still appear when received.");
      }
    }

    async function loadActiveAlerts() {
      try {
        const json = await fetchJsonOrNull("/api/events/active");
        activeAlerts.clear();
        (json?.alerts || []).forEach((alertData) => {
          if (!cameras.has(alertData.camera_id)) return;
          activeAlerts.set(activeAlertKey(alertData.camera_id, alertData.event_type), alertData);
        });
        cameras.forEach((_cam, cameraId) => renderCameraAlertState(cameraId, { blink: false, openPopup: false }));
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
      (json.queue || []).forEach((item) => {
        alertQueue.set(queueKey(item.camera_id, item.event_type), item);
      });
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

    function heatColor(intensity) {
      if (intensity >= 0.8) return "#ff5b63";
      if (intensity >= 0.55) return "#f6b84b";
      if (intensity >= 0.3) return "#f7db6a";
      return "#31d6c0";
    }

    function renderTrafficHeatmap(points = []) {
      if (!trafficHeatLayer) return;
      trafficHeatLayer.clearLayers();
      if (!trafficHeatVisible) return;

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
      routeCameraIds = null;
      if (chatRouteLayer) {
        map.removeLayer(chatRouteLayer);
        chatRouteLayer = null;
      }
      chatRouteMarkers.forEach((marker) => map.removeLayer(marker));
      chatRouteMarkers = [];
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
      map.fitBounds(bounds.pad(0.22), { maxZoom: 15, animate: true });
    }

    async function init() {
      applyTheme(getCurrentTheme(), { persist: false });
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
      await loadHistoricalEvents();
      await loadStatisticsEvents();
      await loadActiveAlerts();
      await loadAlertQueue();
      await loadTrafficHeatmap();
    }

    document.getElementById("camera-search").addEventListener("input", renderCameraList);
    document.querySelectorAll("[data-camera-source]").forEach((btn) => {
      btn.addEventListener("click", () => setCameraSource(btn.dataset.cameraSource));
    });
    document.getElementById("fit-map-btn").addEventListener("click", fitMapToCameras);
    document.getElementById("heatmap-toggle").addEventListener("click", toggleTrafficHeatmap);
    document.getElementById("map-only-toggle").addEventListener("click", toggleMapOnlyMode);
    document.getElementById("route-filter-clear").addEventListener("click", clearRouteCameraFilter);
    document.getElementById("theme-toggle").addEventListener("click", () => {
      applyTheme(getCurrentTheme() === "light" ? "dark" : "light");
    });

    document.getElementById("emergency-open").addEventListener("click", openEmergencyModal);
    document.getElementById("emergency-close").addEventListener("click", closeEmergencyModal);
    document.getElementById("emergency-cancel").addEventListener("click", closeEmergencyModal);
    document.getElementById("emergency-form").addEventListener("submit", submitEmergencyReport);
    document.getElementById("nearby-toggle").addEventListener("click", toggleNearbyNotifications);
    document.getElementById("scanner-toggle").addEventListener("click", toggleScanner);
    document.getElementById("health-check").addEventListener("click", refreshCameraHealth);
    document.getElementById("news-refresh").addEventListener("click", () => loadNews({ refresh: true }));
    document.getElementById("account-logout").addEventListener("click", logout);

    document.querySelectorAll("[data-workspace-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setWorkspacePanel(btn.dataset.workspaceTab));
    });

    renderAuthState();
    setWorkspacePanel("cameras");

    document.querySelectorAll("[data-workspace-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setWorkspacePanel(btn.dataset.workspaceTab));
    });

    document.querySelectorAll(".news-tab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        document.querySelectorAll(".news-tab").forEach((item) => item.classList.remove("active"));
        btn.classList.add("active");
        activeNewsCategory = btn.dataset.newsCategory || "all";
        await loadNews();
      });
    });

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

    document.addEventListener("click", (event) => {
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
        closeEmergencyModal();
      }
    });

    if (window.io) {
      const socket = API_BASE
        ? io(API_BASE, { transports: ["websocket", "polling"] })
        : io({ transports: ["websocket", "polling"] });
      socket.on("connect", () => setConnection(true, "Live"));
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

    setInterval(() => loadNews(), 10 * 60 * 1000);
    setInterval(loadScannerStatus, 5000);
    setInterval(loadTrafficHeatmap, 30000);
    init();

// --- Chat Widget Logic ---
let chatRouteLayer = null;
let chatRouteMarkers = [];

document.querySelector('#chat-panel .chat-header h3').textContent = 'AI Route Assistant';
document.querySelector('#chat-body .chat-message.ai').textContent = 'Hello! I can help you plan a route. Where are you going?';
document.getElementById('chat-input').placeholder = 'Type a question or destination...';
document.getElementById('btn-force-route').title = 'Route to this destination';
document.querySelector('#chat-form button[type="submit"]').textContent = 'Send';

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
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

let forceRouteFlag = false;
document.getElementById('btn-force-route')?.addEventListener('click', () => {
  forceRouteFlag = true;
  document.getElementById('chat-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
});

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
      if (chatRouteLayer) map.removeLayer(chatRouteLayer);
      chatRouteMarkers.forEach(m => map.removeLayer(m));
      chatRouteMarkers = [];

      chatRouteLayer = L.polyline(data.route, { color: '#31d6c0', weight: 6, opacity: 0.8 }).addTo(map);
      
      const startMarker = L.circleMarker(data.startPoint, { color: '#fff', fillColor: '#3b82f6', fillOpacity: 1, radius: 6 }).addTo(map);
      const endMarker = L.circleMarker(data.endPoint, { color: '#fff', fillColor: '#ef4444', fillOpacity: 1, radius: 6 }).addTo(map);
      
      chatRouteMarkers.push(startMarker, endMarker);
      applyRouteCameraFilter(data.route, data.route_cameras || []);
      map.fitBounds(chatRouteLayer.getBounds(), { padding: [50, 50] });
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
  const workspace = document.getElementById("camera-workspace");
  const collapsed = section.classList.toggle("collapsed");
  workspace?.classList.toggle("camera-list-collapsed", collapsed);
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
  closeBtn.addEventListener("click", removeToast);
  setTimeout(removeToast, 6000);
}

document.querySelectorAll(".cam-filter-chip").forEach(chip => {
  chip.addEventListener("click", (e) => {
    document.querySelectorAll(".cam-filter-chip").forEach(c => c.classList.remove("active"));
    e.target.classList.add("active");
    renderCameraList();
  });
});
