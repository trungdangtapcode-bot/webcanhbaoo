(function () {
  const FIRE_DEMO_VIDEO_URL = "./assets/demo/perry-fire.webm";
  const FLOOD_DEMO_VIDEO_URL = "./assets/demo/flood-intersection.webm";
  const TRAFFIC_DEMO_VIDEO_URL = "./assets/demo/rush-hour-traffic.webm";
  const DEMO_SOURCES = {
    fire: {
      url: FIRE_DEMO_VIDEO_URL,
      cameraId: "DEMO_FIRE_CAM_001",
      cameraName: "Camera mô phỏng — Sự cố cháy",
      expectedEventType: "fire",
      lat: 21.0314,
      lng: 105.8523,
      label: "Camera mô phỏng cháy",
      attribution: "Footage: BLM Nevada · CC BY 2.0",
      attributionUrl: "https://commons.wikimedia.org/wiki/File:Perry_Fire_Video_(43953516241).webm",
    },
    flood: {
      url: FLOOD_DEMO_VIDEO_URL,
      cameraId: "DEMO_FLOOD_CAM_001",
      cameraName: "Camera mô phỏng — Tuyến đường ngập",
      expectedEventType: "flood",
      lat: 21.0412,
      lng: 105.8346,
      label: "Camera mô phỏng ngập lụt",
      attribution: "Footage: Droodkin · CC BY-SA 4.0",
      attributionUrl: "https://commons.wikimedia.org/wiki/File:Bahrain_Flooding_2024.webm",
    },
    traffic: {
      url: TRAFFIC_DEMO_VIDEO_URL,
      cameraId: "DEMO_TRAFFIC_CAM_001",
      cameraName: "Camera mô phỏng — Ùn tắc giờ cao điểm",
      expectedEventType: "traffic_jam",
      lat: 21.0127,
      lng: 105.8419,
      label: "Camera mô phỏng ùn tắc",
      attribution: "Footage: Taurus Media Technik · CC0 1.0",
      attributionUrl: "https://commons.wikimedia.org/wiki/File:Video_Codec_Test_rush_hour_1080p25.y4m.webm",
    },
  };

  const state = {
    stream: null,
    mode: null,
    videoObjectUrl: null,
    source: null,
    devices: [],
    frames: 0,
    fire: 0,
    flood: 0,
    traffic: 0,
    scanning: false,
    timer: null,
  };

  const els = {
    video: document.getElementById("demo-video"),
    canvas: document.getElementById("demo-canvas"),
    empty: document.getElementById("demo-video-empty"),
    emptyCopy: document.getElementById("demo-video-empty-copy"),
    start: document.getElementById("demo-start-camera"),
    stop: document.getElementById("demo-stop-camera"),
    capture: document.getElementById("demo-capture"),
    startVideos: Array.from(document.querySelectorAll("[data-demo-source]")),
    videoInput: document.getElementById("demo-video-input"),
    useVideo: document.getElementById("demo-use-video"),
    sourceBadge: document.getElementById("demo-source-badge"),
    sourceAttribution: document.getElementById("demo-source-attribution"),
    cameraSelect: document.getElementById("demo-camera-select"),
    interval: document.getElementById("demo-scan-interval"),
    imageInput: document.getElementById("demo-image-input"),
    scanImage: document.getElementById("demo-scan-image"),
    refreshHealth: document.getElementById("demo-refresh-health"),
    clear: document.getElementById("demo-clear-results"),
    results: document.getElementById("demo-results"),
    runState: document.getElementById("demo-run-state"),
    detectorState: document.getElementById("demo-detector-state"),
    aiState: document.getElementById("demo-groq-state"),
    yoloState: document.getElementById("demo-yolo-state"),
    modelState: document.getElementById("demo-model-state"),
    lastScan: document.getElementById("demo-last-scan"),
    frameCount: document.getElementById("demo-frame-count"),
    fireCount: document.getElementById("demo-fire-count"),
    floodCount: document.getElementById("demo-flood-count"),
    trafficCount: document.getElementById("demo-traffic-count"),
    themeToggle: document.getElementById("theme-toggle"),
  };

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (typeof window.syncWebAwesomeTheme === "function") window.syncWebAwesomeTheme(theme);
    try {
      localStorage.setItem("smart-alert-theme", theme);
    } catch (_err) {}
    els.themeToggle?.setAttribute("aria-pressed", String(theme === "light"));
    els.themeToggle?.setAttribute("title", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function formatTime() {
    return new Date().toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function setRunState(label, tone = "idle") {
    els.runState.textContent = label;
    els.runState.dataset.tone = tone;
  }

  function updateStats() {
    els.frameCount.textContent = state.frames;
    els.fireCount.textContent = state.fire;
    els.floodCount.textContent = state.flood;
    els.trafficCount.textContent = state.traffic;
  }

  function setCameraUi(active, mode = null) {
    els.start.disabled = active;
    els.startVideos.forEach((button) => { button.disabled = active; });
    els.stop.disabled = !active;
    els.capture.disabled = !active || state.scanning;
    els.empty.hidden = active;
    els.sourceBadge.hidden = mode !== "video";
    els.emptyCopy.textContent = active ? "" : "Camera is off";
  }

  async function loadDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      els.cameraSelect.innerHTML = '<option value="">No camera API</option>';
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.devices = devices.filter((device) => device.kind === "videoinput");
    els.cameraSelect.innerHTML = state.devices.length
      ? state.devices.map((device, index) => (
        `<option value="${escapeHtml(device.deviceId)}">${escapeHtml(device.label || `USB camera ${index + 1}`)}</option>`
      )).join("")
      : '<option value="">No camera found</option>';
  }

  async function startCamera() {
    stopCamera();
    setRunState("Opening camera", "busy");
    try {
      const deviceId = els.cameraSelect.value;
      const constraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.mode = "camera";
      state.source = {
        cameraId: "USB_CAM_001",
        cameraName: "USB Camera — Local",
        source: "browser_usb_camera",
      };
      els.video.srcObject = state.stream;
      await els.video.play();
      await loadDevices();
      setCameraUi(true, "camera");
      setRunState("Camera live", "ok");
      syncAutoScan();
    } catch (err) {
      setCameraUi(false);
      setRunState("Camera blocked", "error");
      addResult({
        error: "Cannot open USB camera",
        detail: err.message,
      }, true);
    }
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
    }
    state.stream = null;
    els.video.srcObject = null;
    els.video.pause();
    els.video.removeAttribute("src");
    els.video.load();
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    state.videoObjectUrl = null;
    state.mode = null;
    state.source = null;
    clearAutoScan();
    setCameraUi(false);
    setRunState("Idle");
  }

  async function startVideoSource(url, options = {}) {
    stopCamera();
    setRunState("Loading simulation", "busy");
    try {
      state.mode = "video";
      state.videoObjectUrl = options.objectUrl ? url : null;
      state.source = {
        cameraId: options.cameraId || "DEMO_UPLOAD_CAM_001",
        cameraName: options.cameraName || options.name || "Community Demo Camera — Recorded Footage",
        source: "recorded_demo_camera",
        expectedEventType: options.expectedEventType,
        lat: options.lat ?? 10.7769,
        lng: options.lng ?? 106.7009,
      };
      els.video.srcObject = null;
      els.video.src = url;
      els.video.loop = true;
      els.video.muted = true;
      els.video.preload = "auto";
      els.sourceBadge.textContent = `${options.label || "Demo camera"} · recorded footage`;
      if (els.sourceAttribution && options.attribution) {
        els.sourceAttribution.textContent = options.attribution;
        els.sourceAttribution.href = options.attributionUrl || "#";
      }
      setCameraUi(true, "video");
      await new Promise((resolve, reject) => {
        let timeoutId = null;
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("Cannot play the selected video"));
        };
        const cleanup = () => {
          els.video.removeEventListener("loadeddata", onReady);
          els.video.removeEventListener("canplay", onReady);
          els.video.removeEventListener("error", onError);
          if (timeoutId) window.clearTimeout(timeoutId);
        };
        els.video.addEventListener("loadeddata", onReady);
        els.video.addEventListener("canplay", onReady);
        els.video.addEventListener("error", onError);
        els.video.load();
        if (els.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onReady();
        else timeoutId = window.setTimeout(() => reject(new Error("Video loading timed out")), 12000);
      });
      await els.video.play();
      els.interval.value = "2000";
      setRunState("Simulation live", "ok");
      syncAutoScan();
      window.setTimeout(scanFrame, 450);
    } catch (err) {
      stopCamera();
      setRunState("Video unavailable", "error");
      addResult({ error: "Cannot start recorded camera", detail: err.message }, true);
    }
  }

  function startBundledVideo(type = "fire") {
    const source = DEMO_SOURCES[type] || DEMO_SOURCES.fire;
    return startVideoSource(source.url, source);
  }

  function startUploadedVideo() {
    const file = els.videoInput?.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    return startVideoSource(objectUrl, {
      name: `Community Demo Camera — ${file.name}`,
      objectUrl: true,
    });
  }

  function captureFrame() {
    const width = els.video.videoWidth || 1280;
    const height = els.video.videoHeight || 720;
    els.canvas.width = width;
    els.canvas.height = height;
    const ctx = els.canvas.getContext("2d");
    ctx.drawImage(els.video, 0, 0, width, height);
    return {
      width,
      height,
      image_base64: els.canvas.toDataURL("image/jpeg", 0.84).split(",")[1],
    };
  }

  async function submitFrame(frame, source = {}) {
    const response = await fetch("/api/scanner/demo-detect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        camera_id: source.cameraId || "USB_CAM_001",
        camera_name: source.cameraName || "USB Camera — Local",
        camera_source: source.source || "browser_usb_camera",
        demo_session: source.source === "recorded_demo_camera" ? "incident-dashboard-v1" : undefined,
        expected_event_type: source.expectedEventType,
        lat: source.lat,
        lng: source.lng,
        content_type: "image/jpeg",
        ...frame,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    state.frames += 1;
    applyDetectionStats(payload.detections || []);
    els.lastScan.textContent = formatTime();
    updateStats();
    addResult(payload);
  }

  async function scanFrame() {
    if (!state.mode || state.scanning || els.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    state.scanning = true;
    els.capture.disabled = true;
    setRunState("Scanning", "busy");
    try {
      await submitFrame(captureFrame(), state.source || {});
      setRunState("Scan complete", "ok");
    } catch (err) {
      addResult({
        error: "Detector request failed",
        detail: err.message,
      }, true);
      setRunState("Scan failed", "error");
    } finally {
      state.scanning = false;
      els.capture.disabled = !state.mode;
    }
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Cannot read image file"));
      image.src = URL.createObjectURL(file);
    });
  }

  async function scanImageFile() {
    const file = els.imageInput?.files?.[0];
    if (!file || state.scanning) return;
    state.scanning = true;
    els.scanImage.disabled = true;
    setRunState("Scanning image", "busy");
    try {
      const image = await fileToImage(file);
      els.canvas.width = image.naturalWidth || image.width;
      els.canvas.height = image.naturalHeight || image.height;
      const ctx = els.canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, els.canvas.width, els.canvas.height);
      els.empty.hidden = true;
      const frame = {
        width: els.canvas.width,
        height: els.canvas.height,
        image_base64: els.canvas.toDataURL("image/jpeg", 0.9).split(",")[1],
      };
      await submitFrame(frame, {
        cameraId: "uploaded_image_demo",
        cameraName: "Uploaded incident image",
        source: "uploaded_image",
      });
      setRunState("Image scan complete", "ok");
      URL.revokeObjectURL(image.src);
    } catch (err) {
      addResult({
        error: "Image detector request failed",
        detail: err.message,
      }, true);
      setRunState("Image scan failed", "error");
    } finally {
      state.scanning = false;
      els.scanImage.disabled = !els.imageInput?.files?.length;
    }
  }

  function applyDetectionStats(detections) {
    detections.forEach((item) => {
      if (item.event_type === "fire") state.fire += 1;
      if (item.event_type === "flood") state.flood += 1;
      if (item.event_type === "traffic_jam") state.traffic += 1;
    });
  }

  function shouldShowDetection(item) {
    return true; // Always show detections in demo, including traffic_volume
  }

  function detectionClass(type) {
    if (type === "fire") return "fire";
    if (type === "flood" || type === "flood_candidate") return "flood";
    if (type === "traffic_jam" || type === "traffic_volume") return "traffic";
    return "normal";
  }

  function renderDetection(item) {
    const confidence = Number.isFinite(Number(item.confidence))
      ? `${Math.round(Number(item.confidence) * 100)}%`
      : "--";
    const meta = item.metadata || {};
    return `
      <div class="demo-detection ${detectionClass(item.event_type)}">
        <div>
          <strong>${escapeHtml(item.event_type || "unknown")}</strong>
          <span>${escapeHtml(item.severity || "normal")} · ${confidence}</span>
        </div>
        <dl>
          ${item.vehicle_count !== undefined ? `<div><dt>Vehicles</dt><dd>${escapeHtml(item.vehicle_count)}</dd></div>` : ""}
          ${item.water_ratio !== undefined ? `<div><dt>Water</dt><dd>${escapeHtml(item.water_ratio)}</dd></div>` : ""}
          ${meta.detector ? `<div><dt>Detector</dt><dd>${escapeHtml(meta.detector)}</dd></div>` : ""}
        </dl>
      </div>
    `;
  }

  function renderDiagnostic(item) {
    if (item.type !== "flood_candidate") return "";
    const candidate = item.candidate || {};
    const meta = candidate.metadata || {};
    const accepted = item.accepted
      ? "accepted"
      : item.ai_status && item.ai_status !== "ok"
        ? "pending AI"
        : "rejected";
    const confidence = Number.isFinite(Number(candidate.confidence))
      ? `${Math.round(Number(candidate.confidence) * 100)}%`
      : "--";
    return `
      <div class="demo-detection flood">
        <div>
          <strong>flood_candidate</strong>
          <span>${accepted} · ${confidence}</span>
        </div>
        <dl>
          ${candidate.water_ratio !== undefined ? `<div><dt>Water</dt><dd>${escapeHtml(candidate.water_ratio)}</dd></div>` : ""}
          ${meta.bottom_coverage !== undefined ? `<div><dt>Bottom</dt><dd>${escapeHtml(meta.bottom_coverage)}</dd></div>` : ""}
          ${item.ai_status ? `<div><dt>AI</dt><dd>${escapeHtml(item.ai_status)}</dd></div>` : ""}
          ${item.ai_reason ? `<div><dt>Reason</dt><dd>${escapeHtml(item.ai_reason)}</dd></div>` : ""}
        </dl>
      </div>
    `;
  }

  function addResult(payload, isError = false) {
    const empty = els.results.querySelector(".empty-state");
    if (empty) empty.remove();

    const detections = Array.isArray(payload.detections) ? payload.detections : [];
    const visibleDetections = detections.filter(shouldShowDetection);
    const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    const diagnosticHtml = diagnostics.map(renderDiagnostic).filter(Boolean).join("");
    const item = document.createElement("article");
    item.className = "demo-result-item" + (isError ? " error" : "");
    item.innerHTML = `
      <header>
        <div>
          <strong>${isError ? "Error" : `${visibleDetections.length} detection${visibleDetections.length === 1 ? "" : "s"}`}</strong>
          <span>${formatTime()}</span>
        </div>
      </header>
      ${isError
        ? `<p>${escapeHtml(payload.error || "Error")}${payload.detail ? `: ${escapeHtml(payload.detail)}` : ""}</p>`
        : visibleDetections.length || diagnosticHtml
          ? `<div class="demo-detection-list">${visibleDetections.map(renderDetection).join("")}${diagnosticHtml}</div>`
          : '<p>No incident detected in this frame.</p>'}
      <details>
        <summary>JSON</summary>
        <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
      </details>
    `;
    els.results.prepend(item);
  }

  async function refreshHealth() {
    els.detectorState.textContent = "Checking";
    try {
      const response = await fetch("/api/scanner/demo-health");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
      els.detectorState.textContent = payload.status || "OK";
      const aiBackoffSeconds = payload.ai_backoff_seconds ?? payload.groq_backoff_seconds ?? 0;
      const aiEnabled = payload.ai_enabled ?? payload.groq_enabled;
      const aiProvider = payload.ai_provider ? `${payload.ai_provider}` : "AI";
      els.aiState.textContent = aiBackoffSeconds > 0
        ? `Wait ${aiBackoffSeconds}s`
        : aiEnabled ? aiProvider : "Off";
      els.yoloState.textContent = payload.yolo_enabled ? "On" : "Off";
      els.modelState.textContent = payload.ai_model || payload.ai_requested_model || payload.yolo_loaded_weights || payload.yolo_requested_weights || "--";
    } catch (err) {
      els.detectorState.textContent = "Offline";
      els.aiState.textContent = "--";
      els.yoloState.textContent = "--";
      els.modelState.textContent = "--";
      addResult({
        error: "Detector health check failed",
        detail: err.message,
      }, true);
    }
  }

  function clearAutoScan() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }

  function syncAutoScan() {
    clearAutoScan();
    const interval = Number(els.interval.value);
    if (!state.mode || !interval) return;
    state.timer = window.setInterval(scanFrame, interval);
  }

  els.themeToggle?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(current === "light" ? "dark" : "light");
  });
  els.start.addEventListener("click", startCamera);
  els.startVideos.forEach((button) => {
    button.addEventListener("click", () => startBundledVideo(button.dataset.demoSource));
  });
  els.stop.addEventListener("click", stopCamera);
  els.capture.addEventListener("click", scanFrame);
  els.imageInput?.addEventListener("change", () => {
    els.scanImage.disabled = !els.imageInput.files?.length;
  });
  els.videoInput?.addEventListener("change", () => {
    els.useVideo.disabled = !els.videoInput.files?.length;
  });
  els.useVideo?.addEventListener("click", startUploadedVideo);
  els.scanImage?.addEventListener("click", scanImageFile);
  els.cameraSelect.addEventListener("change", () => {
    if (state.stream) startCamera();
  });
  els.interval.addEventListener("change", syncAutoScan);
  els.refreshHealth.addEventListener("click", refreshHealth);
  els.clear.addEventListener("click", () => {
    els.results.innerHTML = `
      <div class="empty-state compact">
        <div class="empty-title">No frames scanned</div>
        <div class="empty-copy">Start the camera and scan a frame.</div>
      </div>
    `;
  });

  setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  updateStats();
  setCameraUi(false);
  loadDevices().catch(() => {
    els.cameraSelect.innerHTML = '<option value="">Camera permission needed</option>';
  });
  refreshHealth();
  const pageParams = new URLSearchParams(window.location.search);
  if (pageParams.get("autoplayDemo") === "1") {
    window.setTimeout(() => startBundledVideo(pageParams.get("incident") || "fire"), 250);
  }
})();
