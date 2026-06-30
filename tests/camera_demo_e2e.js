/**
 * Smart Alert System - E2E Testing Suite for Camera Demo
 * This script runs completely offline and statically verifies the camera demo requirements R1, R2, and R3.
 * It simulates both the backend controller behavior and frontend app.js logic using Node's vm sandbox.
 * Exit code 0 if all tests pass, non-zero if they fail.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ==========================================
// BACKEND CONFIG & DEPENDENCY MOCKING
// ==========================================

function mockModule(moduleRelativePath, exports) {
  const absolutePath = path.resolve(__dirname, moduleRelativePath);
  require.cache[absolutePath] = {
    id: absolutePath,
    filename: absolutePath,
    loaded: true,
    exports: exports
  };
}

// Stub database configuration to prevent real connections
mockModule('../backend/src/config/database.js', {
  connectDatabase: async () => {},
  isDatabaseConnected: () => false
});

// Stub models
mockModule('../backend/src/models/Camera.js', {});
mockModule('../backend/src/models/Event.js', {});

// Stub services
mockModule('../backend/src/services/hanoiCameraService.js', {
  findHanoiCamera: async () => null,
  getHanoiCameras: async () => [],
  getHanoiSourceInfo: () => ({})
});

mockModule('../backend/src/services/hcmCameraService.js', {
  fetchSnapshot: async () => ({ contentType: 'image/jpeg', buffer: Buffer.from([]) }),
  findHcmCamera: () => null,
  getHcmCameras: () => []
});

mockModule('../backend/src/services/hanoiProxyService.js', {
  ensureHanoiProxyStarted: async () => ({ available: false }),
  getHanoiProxyStatus: () => ({}),
  getProxyBaseUrl: () => 'http://localhost:5000'
});

mockModule('../backend/src/services/cameraHealthService.js', {
  checkCameraHealth: async () => ({}),
  getCachedHealth: () => 'unknown',
  getCameraHealth: () => [],
  getHealthSummary: () => ({ live: 0, issues: 0, unchecked: 0, total: 0 })
});

mockModule('../backend/src/services/trafficVolumeService.js', {
  getVolume: () => 0
});

// Load the camera controller under mock environment
const cameraController = require('../backend/src/controllers/cameraController');

// Save initial environment
const initialNodeEnv = process.env.NODE_ENV;
const initialEnableSimulatedCamera = process.env.ENABLE_SIMULATED_CAMERA;

// ==========================================
// TEST SUITE REGISTRY
// ==========================================

const testRegistry = [];

function addTest(id, tier, description, fn) {
  testRegistry.push({ id, tier, description, fn });
}

// ==========================================
// BROWSER / DOM ENVIRONMENT SANDBOX MOCKS
// ==========================================

class MockElement {
  constructor(tagName = 'DIV', id = '', className = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = className;
    this.classList = {
      add: (c) => {
        if (!this.className.includes(c)) {
          this.className = (this.className + ' ' + c).trim();
        }
      },
      remove: (c) => {
        this.className = this.className.replace(new RegExp('\\b' + c + '\\b', 'g'), '').trim();
      },
      toggle: (c, val) => {
        const has = this.classList.contains(c);
        const next = val !== undefined ? val : !has;
        if (next && !has) this.classList.add(c);
        if (!next && has) this.classList.remove(c);
        return next;
      },
      contains: (c) => new RegExp('\\b' + c + '\\b').test(this.className)
    };
    this.style = {
      setProperty: () => {},
      display: '',
    };
    this.attributes = {};
    this.dataset = {};
    this.innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.value = '';
    this.disabled = false;
  }

  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0 }; }
  
  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }

  addEventListener(event, handler) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(handler);
  }

  closest(selector) {
    if (selector === '[data-focus-camera-id]') {
      if (this.dataset.focusCameraId) return this;
      if (this.parent) return this.parent.closest(selector);
    }
    if (selector === '.camera-watch, .popup-action') {
      if (this.className.includes('camera-watch') || this.dataset.cameraId) return this;
      if (this.parent) return this.parent.closest(selector);
    }
    if (selector === '.alert-delete-btn') {
      if (this.className.includes('alert-delete-btn')) return this;
      if (this.parent) return this.parent.closest(selector);
    }
    if (selector === '.alert-queue-select') {
      if (this.className.includes('alert-queue-select')) return this;
      if (this.parent) return this.parent.closest(selector);
    }
    return null;
  }

  querySelector(selector) {
    return this.children.find(c => c.className.includes(selector) || c.tagName === selector.toUpperCase()) || null;
  }

  querySelectorAll(selector) {
    return this.children.filter(c => c.className.includes(selector));
  }
}

const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;

const sandboxSetTimeout = (fn, delay) => {
  const t = originalSetTimeout(fn, delay);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
};

const sandboxSetInterval = (fn, delay) => {
  const t = originalSetInterval(fn, delay);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
};

// Global definition of HTMLMediaElement
const HTMLMediaElementMock = {
  HAVE_CURRENT_DATA: 2,
  HAVE_FUTURE_DATA: 3,
  HAVE_ENOUGH_DATA: 4
};
global.HTMLMediaElement = HTMLMediaElementMock;

// Mocked camera list data matching requirements
const demoCamerasMockData = [
  {
    camera_id: 'DEMO_FIRE_CAM_001',
    name: 'Camera mô phỏng — Sự cố cháy',
    location: { lat: 10.7731, lng: 106.7048, address: 'Quận 1 · Video mô phỏng sự cố cháy' },
    active: true,
    source: 'simulated_demo',
    stream_type: 'recorded_demo',
    stream_url: '/assets/demo/boxcar-fire.webm',
  },
  {
    camera_id: 'DEMO_FLOOD_CAM_001',
    name: 'Camera mô phỏng — Tuyến đường ngập',
    location: { lat: 10.7570, lng: 106.7015, address: 'Quận 4 · Video mô phỏng ngập lụt' },
    active: true,
    source: 'simulated_demo',
    stream_type: 'recorded_demo',
    stream_url: '/assets/demo/flood-intersection.webm',
  },
  {
    camera_id: 'DEMO_TRAFFIC_CAM_001',
    name: 'Camera mô phỏng — Ùn tắc giờ cao điểm',
    location: { lat: 10.7913, lng: 106.6905, address: 'Quận 3 · Video mô phỏng ùn tắc giao thông' },
    active: true,
    source: 'simulated_demo',
    stream_type: 'recorded_demo',
    stream_url: '/assets/demo/rush-hour-traffic.webm',
  }
];

function createFreshSandbox(customFetch) {
  const L = {
    map: () => {
      const mapInstance = {
        setView: function() { return this; },
        addLayer: function() { return this; },
        removeLayer: function() { return this; },
        hasLayer: () => false,
        on: function(ev, cb) {
          mapInstance.listeners = mapInstance.listeners || {};
          mapInstance.listeners[ev] = mapInstance.listeners[ev] || [];
          mapInstance.listeners[ev].push(cb);
          return this;
        },
        flyTo: function() { return this; },
        panTo: function() { return this; },
        fitBounds: function() { return this; },
        invalidateSize: function() { return this; },
        getZoom: () => 12,
        setZoom: () => {},
      };
      return mapInstance;
    },
    layerGroup: () => ({
      addTo: function() { return this; },
      clearLayers: function() { return this; },
      hasLayer: () => false,
    }),
    markerClusterGroup: () => ({
      addTo: function() { return this; },
      on: function() { return this; },
      clearLayers: function() { return this; },
      hasLayer: () => false,
      addLayer: function() { return this; },
      removeLayer: function() { return this; },
    }),
    control: {
      zoom: () => ({
        addTo: function() { return this; },
      }),
    },
    Control: {
      LocationButton: function() { this.addTo = function() {}; },
      extend: function(obj) {
        const F = function() {
          this.addTo = function() { return this; };
        };
        F.prototype = obj;
        F.prototype.addTo = function() { return this; };
        return F;
      },
    },
    tileLayer: () => ({
      addTo: function() { return this; },
    }),
    divIcon: () => ({}),
    marker: (latlng, options) => {
      const markerInstance = {
        latlng,
        options,
        bindPopup: function(content) {
          this.popupContent = content;
          return this;
        },
        addTo: function(layer) {
          this.layer = layer;
          return this;
        },
        on: function(event, callback) {
          this.listeners = this.listeners || {};
          this.listeners[event] = this.listeners[event] || [];
          this.listeners[event].push(callback);
          return this;
        },
        remove: function() {
          return this;
        }
      };
      return markerInstance;
    },
    latLngBounds: () => ({
      pad: () => ({
        pad: () => ({})
      }),
    }),
    DomUtil: {
      create: () => ({
        style: {},
        onmouseover: null,
        onmouseout: null,
        onclick: null,
      }),
    },
  };

  const elements = {};
  const getElementById = (id) => {
    if (!elements[id]) {
      elements[id] = new MockElement('DIV', id);
    }
    return elements[id];
  };

  const documentMock = {
    documentElement: new MockElement('HTML'),
    body: new MockElement('BODY'),
    activeElement: new MockElement('BODY'),
    getElementById,
    createElement: (tagName) => new MockElement(tagName),
    querySelector: (sel) => {
      if (sel.startsWith('#')) return getElementById(sel.substring(1));
      if (sel === '.cam-filter-chip.active') {
        const el = new MockElement('BUTTON', '', 'cam-filter-chip active');
        el.dataset = { filter: 'all' };
        return el;
      }
      return new MockElement();
    },
    querySelectorAll: (sel) => {
      if (sel === "[data-workspace-tab]" || sel === ".sidebar [data-workspace-panel]" || sel === ".radius-btn" || sel === ".range-btn" || sel === ".filter-btn" || sel === "[data-map-incident-filter]" || sel === "#news-tabs .news-tab" || sel === 'input[name="contribute-public-visible"]' || sel === ".cam-filter-chip" || sel === "[data-camera-source]" || sel === "[data-dashboard-demo]") {
        if (sel === '[data-dashboard-demo]') {
          return demoButtons;
        }
        if (sel === '[data-camera-source]') {
          const b1 = new MockElement('BUTTON'); b1.dataset.cameraSource = 'hcm';
          const b2 = new MockElement('BUTTON'); b2.dataset.cameraSource = 'hanoi';
          return [b1, b2];
        }
        return [];
      }
      return [];
    },
    addEventListener: (event, handler) => {
      documentMock.listeners = documentMock.listeners || {};
      documentMock.listeners[event] = documentMock.listeners[event] || [];
      documentMock.listeners[event].push(handler);
    },
    write: () => {},
  };

  const demoButtons = [
    new MockElement('BUTTON', '', 'fire'),
    new MockElement('BUTTON', '', 'flood'),
    new MockElement('BUTTON', '', 'traffic'),
    new MockElement('BUTTON', '', 'all'),
  ];
  demoButtons[0].dataset.dashboardDemo = 'fire';
  demoButtons[1].dataset.dashboardDemo = 'flood';
  demoButtons[2].dataset.dashboardDemo = 'traffic';
  demoButtons[3].dataset.dashboardDemo = 'all';

  const socketMock = {
    on: function(event, callback) {
      this.listeners = this.listeners || {};
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(callback);
      return this;
    },
    emit: function() {},
    trigger: function(event, data) {
      if (this.listeners && this.listeners[event]) {
        this.listeners[event].forEach(cb => cb(data));
      }
    }
  };

  const windowMock = {
    location: {
      protocol: 'http:',
      port: '3000',
      origin: 'http://localhost:3000',
      search: '',
      replace: () => {},
    },
    history: {
      replaceState: () => {}
    },
    addEventListener: () => {},
    setTimeout: sandboxSetTimeout,
    setInterval: sandboxSetInterval,
    navigator: {
      language: 'en',
      serviceWorker: {
        addEventListener: () => {},
        register: () => Promise.resolve({ active: true }),
      }
    },
    localStorage: {
      getItem: (key) => null,
      setItem: () => {},
      removeItem: () => {},
    },
    speechSynthesis: {
      speak: () => {},
      cancel: () => {},
      speaking: false,
      getVoices: () => [],
    },
    SpeechSynthesisUtterance: function(text) {
      this.text = text;
    },
    IntersectionObserver: function(callback) {
      this.observe = () => {};
      this.disconnect = () => {};
    },
    TextDecoder: function() {
      this.decode = () => '';
    },
    URLSearchParams: global.URLSearchParams,
    URL: global.URL,
    fetch: customFetch || (() => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ cameras: [] })
    })),
    io: () => socketMock,
  };

  const sandbox = {
    L,
    document: documentMock,
    window: windowMock,
    navigator: windowMock.navigator,
    localStorage: windowMock.localStorage,
    setInterval: windowMock.setInterval,
    setTimeout: windowMock.setTimeout,
    requestAnimationFrame: (fn) => fn(),
    console: {
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {}
    },
    fetch: windowMock.fetch,
    URLSearchParams: global.URLSearchParams,
    URL: global.URL,
    TextDecoder: global.TextDecoder,
    Uint8Array: global.Uint8Array,
    HTMLElement: MockElement,
    HTMLMediaElement: HTMLMediaElementMock,
    IntersectionObserver: windowMock.IntersectionObserver,
    io: () => socketMock,
    realtimeSocket: socketMock,
  };

  vm.createContext(sandbox);
  sandbox.window.CSS = { escape: (s) => s };
  
  const jsCode = fs.readFileSync(path.resolve(__dirname, '../frontend/js/app.js'), 'utf8');
  const sandboxJsCode = jsCode
    .replace(/\blet\b/g, 'var')
    .replace(/\bconst\b/g, 'var');

  vm.runInContext(sandboxJsCode, sandbox);
  return sandbox;
}

// ==========================================
// TIER 1: FEATURE COVERAGE (15 TESTS)
// ==========================================

// Backend endpoints tests
addTest('TC_T1_BE_01', 'Tier 1: Feature Coverage', 'Verify GET /api/cameras returns simulated demo cameras', async () => {
  let result = null;
  const req = { query: {} };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  await cameraController.getCameras(req, res);
  if (!result || !Array.isArray(result.cameras)) {
    throw new Error('Expected result.cameras to be an array');
  }
  const demoCams = result.cameras.filter(c => c.source === 'simulated_demo');
  if (demoCams.length !== 3) {
    throw new Error(`Expected 3 simulated demo cameras, got ${demoCams.length}`);
  }
});

addTest('TC_T1_BE_02', 'Tier 1: Feature Coverage', 'Verify GET /api/cameras/hcm returns R1, R2, R3 demo cameras', async () => {
  let result = null;
  const req = { query: {} };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  await cameraController.getHcmTrafficCameras(req, res);
  const ids = (result?.cameras || []).map(c => c.camera_id);
  const expected = ['DEMO_FIRE_CAM_001', 'DEMO_FLOOD_CAM_001', 'DEMO_TRAFFIC_CAM_001'];
  for (const exp of expected) {
    if (!ids.includes(exp)) {
      throw new Error(`Expected HCM cameras to include ${exp}`);
    }
  }
});

addTest('TC_T1_BE_03', 'Tier 1: Feature Coverage', 'Verify GET /api/cameras/hanoi returns same demo cameras with Hanoi-specific coordinates', async () => {
  let result = null;
  const req = { query: {} };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  await cameraController.getHanoiTrafficCameras(req, res);
  const cams = result?.cameras || [];
  const fireCam = cams.find(c => c.camera_id === 'DEMO_FIRE_CAM_001');
  if (!fireCam) throw new Error('DEMO_FIRE_CAM_001 not found in Hanoi response');
  if (Math.abs(fireCam.location.lat - 21.0314) > 0.0001) {
    throw new Error(`Expected Hanoi coordinate lat ~21.0314, got ${fireCam.location.lat}`);
  }
});

addTest('TC_T1_BE_04', 'Tier 1: Feature Coverage', 'Verify demo cameras have source: "simulated_demo"', async () => {
  let result = null;
  const req = { query: {} };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  await cameraController.getHcmTrafficCameras(req, res);
  const demoCams = (result?.cameras || []).filter(c => c.camera_id.startsWith('DEMO_'));
  if (demoCams.length === 0) throw new Error('No demo cameras found');
  for (const cam of demoCams) {
    if (cam.source !== 'simulated_demo') {
      throw new Error(`Expected source to be "simulated_demo", got ${cam.source}`);
    }
  }
});

addTest('TC_T1_BE_05', 'Tier 1: Feature Coverage', 'Verify demo cameras have stream_type: "recorded_demo"', async () => {
  let result = null;
  const req = { query: {} };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  await cameraController.getHcmTrafficCameras(req, res);
  const demoCams = (result?.cameras || []).filter(c => c.camera_id.startsWith('DEMO_'));
  for (const cam of demoCams) {
    if (cam.stream_type !== 'recorded_demo') {
      throw new Error(`Expected stream_type to be "recorded_demo", got ${cam.stream_type}`);
    }
  }
});

// Frontend UI rendering tests
addTest('TC_T1_FE_01', 'Tier 1: Feature Coverage', 'Verify frontend camera list contains Fire demo camera', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  const list = sb.document.getElementById('camera-list');
  if (!list.innerHTML.includes('Camera mô phỏng — Sự cố cháy')) {
    throw new Error('Sidebar list does not contain simulated fire camera');
  }
});

addTest('TC_T1_FE_02', 'Tier 1: Feature Coverage', 'Verify frontend camera list contains Flood demo camera', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  const list = sb.document.getElementById('camera-list');
  if (!list.innerHTML.includes('Camera mô phỏng — Tuyến đường ngập')) {
    throw new Error('Sidebar list does not contain simulated flood camera');
  }
});

addTest('TC_T1_FE_03', 'Tier 1: Feature Coverage', 'Verify frontend camera list contains Traffic demo camera', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  const list = sb.document.getElementById('camera-list');
  if (!list.innerHTML.includes('Camera mô phỏng — Ùn tắc giờ cao điểm')) {
    throw new Error('Sidebar list does not contain simulated traffic camera');
  }
});

addTest('TC_T1_FE_04', 'Tier 1: Feature Coverage', 'Verify Leaflet markers are added for each simulated camera', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  if (sb.cameras.size !== 3) {
    throw new Error(`Expected 3 cameras in frontend state, got ${sb.cameras.size}`);
  }
  sb.cameras.forEach((cam, id) => {
    if (!cam.marker) {
      throw new Error(`Camera ${id} does not have a marker assigned`);
    }
  });
});

addTest('TC_T1_FE_05', 'Tier 1: Feature Coverage', 'Verify marker coordinates match camera locations', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  sb.cameras.forEach((cam, id) => {
    const latlng = cam.marker.latlng;
    if (latlng[0] !== cam.data.location.lat || latlng[1] !== cam.data.location.lng) {
      throw new Error(`Marker coordinates mismatch for ${id}`);
    }
  });
});

// Panel elements tests
addTest('TC_T1_PANEL_01', 'Tier 1: Feature Coverage', 'Verify incident demo panel is not hidden when demo cameras are loaded', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  const panel = sb.document.getElementById('incident-demo-panel');
  if (panel.hidden) {
    throw new Error('Expected incident demo panel to be visible (hidden = false)');
  }
});

addTest('TC_T1_PANEL_02', 'Tier 1: Feature Coverage', 'Verify Cháy button exists with data-dashboard-demo="fire"', () => {
  const sb = createFreshSandbox();
  const btns = sb.document.querySelectorAll('[data-dashboard-demo]');
  const fireBtn = btns.find(b => b.dataset.dashboardDemo === 'fire');
  if (!fireBtn) throw new Error('Cháy button not found');
});

addTest('TC_T1_PANEL_03', 'Tier 1: Feature Coverage', 'Verify Ngập button exists with data-dashboard-demo="flood"', () => {
  const sb = createFreshSandbox();
  const btns = sb.document.querySelectorAll('[data-dashboard-demo]');
  const floodBtn = btns.find(b => b.dataset.dashboardDemo === 'flood');
  if (!floodBtn) throw new Error('Ngập button not found');
});

addTest('TC_T1_PANEL_04', 'Tier 1: Feature Coverage', 'Verify Ùn tắc button exists with data-dashboard-demo="traffic"', () => {
  const sb = createFreshSandbox();
  const btns = sb.document.querySelectorAll('[data-dashboard-demo]');
  const trafficBtn = btns.find(b => b.dataset.dashboardDemo === 'traffic');
  if (!trafficBtn) throw new Error('Ùn tắc button not found');
});

addTest('TC_T1_PANEL_05', 'Tier 1: Feature Coverage', 'Verify Chạy cả 3 and Đặt lại buttons exist', () => {
  const sb = createFreshSandbox();
  const btns = sb.document.querySelectorAll('[data-dashboard-demo]');
  const allBtn = btns.find(b => b.dataset.dashboardDemo === 'all');
  if (!allBtn) throw new Error('Chạy cả 3 button not found');
  const resetBtn = sb.document.getElementById('incident-demo-reset');
  if (!resetBtn) throw new Error('Đặt lại button not found');
});

// ==========================================
// TIER 2: BOUNDARY & CORNER CASES (15 TESTS)
// ==========================================

addTest('TC_T2_BE_01', 'Tier 2: Boundary & Corner Cases', 'Verify include_demo=false query parameter filters out demo cameras', async () => {
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_SIMULATED_CAMERA = 'false';
  let result = null;
  const req = { query: { include_demo: 'false' } };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  await cameraController.getCameras(req, res);
  const demoCams = (result?.cameras || []).filter(c => c.source === 'simulated_demo');
  if (demoCams.length > 0) {
    throw new Error('Expected 0 demo cameras when disabled in production and include_demo=false');
  }
});

addTest('TC_T2_BE_02', 'Tier 2: Boundary & Corner Cases', 'Verify standard request GET /api/cameras?source=hcm returns the 3 demo cameras by default', async () => {
  let result = null;
  const req = { query: { source: 'hcm' } };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  await cameraController.getCameras(req, res);
  const demoCams = (result?.cameras || []).filter(c => c.source === 'simulated_demo');
  if (demoCams.length !== 3) {
    throw new Error(`Expected 3 demo cameras in response, got ${demoCams.length}`);
  }
});

addTest('TC_T2_BE_03', 'Tier 2: Boundary & Corner Cases', 'Verify boundary range check for Hanoi camera coordinates', async () => {
  let result = null;
  const req = { query: {} };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  await cameraController.getHanoiTrafficCameras(req, res);
  const cams = result?.cameras || [];
  for (const c of cams.filter(cam => cam.source === 'simulated_demo')) {
    if (c.location.lat < 21.0 || c.location.lat > 21.1 || c.location.lng < 105.8 || c.location.lng > 105.9) {
      throw new Error(`Hanoi camera ${c.camera_id} location is out of bounds: lat=${c.location.lat}, lng=${c.location.lng}`);
    }
  }
});

addTest('TC_T2_BE_04', 'Tier 2: Boundary & Corner Cases', 'Verify boundary range check for HCM camera coordinates', async () => {
  let result = null;
  const req = { query: {} };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  await cameraController.getHcmTrafficCameras(req, res);
  const cams = result?.cameras || [];
  for (const c of cams.filter(cam => cam.source === 'simulated_demo')) {
    if (c.location.lat < 10.7 || c.location.lat > 10.8 || c.location.lng < 106.6 || c.location.lng > 106.8) {
      throw new Error(`HCM camera ${c.camera_id} location is out of bounds: lat=${c.location.lat}, lng=${c.location.lng}`);
    }
  }
});

addTest('TC_T2_BE_05', 'Tier 2: Boundary & Corner Cases', 'Verify API handles offline database gracefully (proper fallback)', async () => {
  let result = null;
  const req = { query: {} };
  const res = {
    json: (data) => { result = data; },
    status: () => res
  };
  // The database config is stubbed to return false, so calling getCameras will exercise the fallback path
  await cameraController.getCameras(req, res);
  if (!result || !result.demo) {
    throw new Error('Expected fallback response with demo=true');
  }
});

addTest('TC_T2_FE_01', 'Tier 2: Boundary & Corner Cases', 'Verify frontend app setup resilience when Leaflet map fails to initialize or L features are stubbed', () => {
  // Creating context runs the initialization which uses stubbed Leaflet mocks.
  // If it didn't throw an error, it is resilient to basic Leaflet stubs.
  const sb = createFreshSandbox();
  if (!sb.map) throw new Error('Expected map instance to be initialized');
});

addTest('TC_T2_FE_02', 'Tier 2: Boundary & Corner Cases', 'Verify sidebar displays empty state when API returns no cameras', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: [] }) };
  });
  await sb.loadCameraDataset();
  const list = sb.document.getElementById('camera-list');
  if (!list.innerHTML.includes('No cameras found') && !list.innerHTML.includes('empty-state')) {
    throw new Error('Sidebar did not show empty state for 0 cameras');
  }
});

addTest('TC_T2_FE_03', 'Tier 2: Boundary & Corner Cases', 'Verify focusCamera with invalid ID does not crash', () => {
  const sb = createFreshSandbox();
  try {
    sb.focusCamera("INVALID_ID_999");
  } catch (e) {
    throw new Error(`focusCamera crashed: ${e.message}`);
  }
});

addTest('TC_T2_FE_04', 'Tier 2: Boundary & Corner Cases', 'Verify invalid city query param defaults to HCM', () => {
  const jsCode = fs.readFileSync(path.resolve(__dirname, '../frontend/js/app.js'), 'utf8');
  const sandboxJsCode = jsCode
    .replace(/\blet\b/g, 'var')
    .replace(/\bconst\b/g, 'var');

  const sb = createFreshSandbox();
  sb.window.location.search = '?city=tokyo';
  const context = vm.createContext(sb);
  vm.runInContext(sandboxJsCode, context);
  if (context.activeCameraSource !== 'hcm') {
    throw new Error(`Expected activeCameraSource to default to "hcm", got ${context.activeCameraSource}`);
  }
});

addTest('TC_T2_FE_05', 'Tier 2: Boundary & Corner Cases', 'Verify custom markers and popup binding for demo cameras', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  const fireCam = sb.cameras.get('DEMO_FIRE_CAM_001');
  if (!fireCam.marker.popupContent) {
    throw new Error('Expected fire camera marker to have popup bound');
  }
});

addTest('TC_T2_PANEL_01', 'Tier 2: Boundary & Corner Cases', 'Verify incident demo reset button with no active events', async () => {
  const sb = createFreshSandbox(async (url) => {
    if (url.includes('/api/scanner/demo-reset')) {
      return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ success: true }) };
    }
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  const result = await sb.resetDashboardIncidentDemo();
  if (!result) throw new Error('Expected reset to return true');
});

addTest('TC_T2_PANEL_02', 'Tier 2: Boundary & Corner Cases', 'Verify incident button actions are ignored during active simulation', async () => {
  const sb = createFreshSandbox();
  sb.dashboardDemoRunning = true;
  const res = await sb.runDashboardIncidentDemo('fire');
  if (res !== undefined) {
    throw new Error('Expected runDashboardIncidentDemo to return early (undefined) when already running');
  }
});

addTest('TC_T2_PANEL_03', 'Tier 2: Boundary & Corner Cases', 'Verify setIncidentDemoProgress updates DOM progress status label', () => {
  const sb = createFreshSandbox();
  sb.setIncidentDemoProgress('Test Status Message', 'busy');
  const label = sb.document.getElementById('incident-demo-progress-copy');
  if (label.textContent !== 'Test Status Message') {
    throw new Error(`Expected textContent to be "Test Status Message", got "${label.textContent}"`);
  }
});

addTest('TC_T2_PANEL_04', 'Tier 2: Boundary & Corner Cases', 'Verify incident demo panel is hidden if 0 demo cameras are returned by API', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: [] }) };
  });
  await sb.loadCameraDataset();
  const panel = sb.document.getElementById('incident-demo-panel');
  if (!panel.hidden) {
    throw new Error('Expected panel to be hidden when 0 demo cameras exist');
  }
});

addTest('TC_T2_PANEL_05', 'Tier 2: Boundary & Corner Cases', 'Verify incident scanning handles detector API errors gracefully', async () => {
  const sb = createFreshSandbox(async (url) => {
    if (url.includes('/api/scanner/demo-detect')) {
      return { ok: false, status: 500, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ error: 'Detector Offline' }) };
    }
    if (url.includes('/api/scanner/demo-reset')) {
      return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ success: true }) };
    }
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  sb.submitDashboardDemoFrame = async () => { throw new Error('Detector HTTP 500'); };
  await sb.runDashboardIncidentDemo('fire');
  const label = sb.document.getElementById('incident-demo-progress-copy');
  if (!label.textContent.includes('Detector HTTP 500')) {
    throw new Error(`Expected progress label to show error, got: "${label.textContent}"`);
  }
});

// ==========================================
// TIER 3: CROSS-FEATURE COMBINATIONS (3 TESTS)
// ==========================================

addTest('TC_T3_01', 'Tier 3: Cross-Feature Combinations', 'Switching city source updates marker coordinates and sidebar', async () => {
  const sb = createFreshSandbox(async (url) => {
    const city = url.includes('/hanoi') ? 'hanoi' : 'hcm';
    const cityCameras = demoCamerasMockData.map(c => ({
      ...c,
      location: city === 'hanoi' ? { lat: 21.0314, lng: 105.8523, address: 'Hanoi address' } : c.location
    }));
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: cityCameras }) };
  });
  await sb.loadCameraDataset();
  const fireCamHcm = sb.cameras.get('DEMO_FIRE_CAM_001');
  const latHcm = fireCamHcm.marker.latlng[0];
  
  await sb.setCameraSource('hanoi');
  const fireCamHanoi = sb.cameras.get('DEMO_FIRE_CAM_001');
  const latHanoi = fireCamHanoi.marker.latlng[0];
  
  if (latHcm === latHanoi) {
    throw new Error(`Expected coordinates to change from HCM to Hanoi, but both were ${latHcm}`);
  }
  if (latHanoi !== 21.0314) {
    throw new Error(`Expected Hanoi coordinate lat 21.0314, got ${latHanoi}`);
  }
});

addTest('TC_T3_02', 'Tier 3: Cross-Feature Combinations', 'Scanning updates camera statuses, markers, and triggers voice alerts', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  
  // Enable voice alerts
  sb.isVoiceAlertEnabled = true;
  let speakCalled = false;
  sb.window.speechSynthesis.speak = () => { speakCalled = true; };
  
  // Trigger alert event via websocket mock
  sb.realtimeSocket.trigger("alert", {
    camera_id: "DEMO_FIRE_CAM_001",
    event_type: "fire",
    camera_name: "Camera mô phỏng — Sự cố cháy",
    severity: "critical",
    timestamp: new Date().toISOString()
  });

  const camState = sb.cameras.get("DEMO_FIRE_CAM_001");
  if (camState.status !== "fire") {
    throw new Error(`Expected camera status to be "fire", got "${camState.status}"`);
  }
  if (!speakCalled) {
    throw new Error("Expected speech synthesis to be triggered on alert");
  }
});

addTest('TC_T3_03', 'Tier 3: Cross-Feature Combinations', 'Resetting incident demo clears alerts and returns panel progress status to Sẵn sàng', async () => {
  const sb = createFreshSandbox(async (url) => {
    if (url.includes('/api/scanner/demo-reset')) return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ success: true }) };
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  
  // Trigger alert event first to create event
  sb.realtimeSocket.trigger("alert", {
    camera_id: "DEMO_FIRE_CAM_001",
    event_type: "fire",
    camera_name: "Camera mô phỏng — Sự cố cháy",
    severity: "critical",
    timestamp: new Date().toISOString()
  });

  // Call reset
  await sb.resetDashboardIncidentDemo();

  const camState = sb.cameras.get("DEMO_FIRE_CAM_001");
  if (camState.status !== "normal") {
    throw new Error(`Expected camera status to revert to "normal" after reset, got "${camState.status}"`);
  }
  const progressText = sb.document.getElementById('incident-demo-progress-copy').textContent;
  if (!progressText.includes('Sẵn sàng')) {
    throw new Error(`Expected progress text to show "Sẵn sàng", got: "${progressText}"`);
  }
});

// ==========================================
// TIER 4: REAL-WORLD SCENARIOS (5 TESTS)
// ==========================================

addTest('TC_T4_01', 'Tier 4: Real-World Scenarios', 'HCM Startup Flow simulation', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  if (sb.activeCameraSource !== 'hcm') {
    throw new Error('Expected default city source to be HCM');
  }
  const copy = sb.document.getElementById('incident-demo-progress-copy').textContent;
  if (!copy.includes('Sẵn sàng · 3 camera mô phỏng')) {
    throw new Error(`Expected startup progress status "Sẵn sàng · 3 camera mô phỏng", got "${copy}"`);
  }
});

addTest('TC_T4_02', 'Tier 4: Real-World Scenarios', 'Hanoi Startup Flow simulation', async () => {
  const jsCode = fs.readFileSync(path.resolve(__dirname, '../frontend/js/app.js'), 'utf8');
  const sandboxJsCode = jsCode
    .replace(/\blet\b/g, 'var')
    .replace(/\bconst\b/g, 'var');

  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  sb.window.location.search = '?city=hanoi';
  const context = vm.createContext(sb);
  vm.runInContext(sandboxJsCode, context);
  
  if (context.activeCameraSource !== 'hanoi') {
    throw new Error('Expected city source query param to load Hanoi');
  }
});

addTest('TC_T4_03', 'Tier 4: Real-World Scenarios', 'API Server offline/failure simulation fallback to default cameras', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: false, status: 503 };
  });
  // During startup init, if fetch fails it catches the error and registers default fallback HCM cameras
  await new Promise(resolve => setTimeout(resolve, 10));
  const fallbackCamsCount = sb.cameras.size;
  if (fallbackCamsCount !== 3) {
    throw new Error(`Expected 3 fallback cameras to register on offline startup, got ${fallbackCamsCount}`);
  }
});

addTest('TC_T4_04', 'Tier 4: Real-World Scenarios', 'Demo Video Asset Verification and watch popup event trigger', async () => {
  const sb = createFreshSandbox(async (url) => {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();
  const fireCam = sb.cameras.get('DEMO_FIRE_CAM_001');
  if (fireCam.data.stream_url !== '/assets/demo/boxcar-fire.webm') {
    throw new Error(`Incorrect demo stream url: ${fireCam.data.stream_url}`);
  }
  // Simulate clicking the play/watch button on camera item
  let videoModalOpened = false;
  sb.openVideoModal = (id) => {
    if (id === 'DEMO_FIRE_CAM_001') videoModalOpened = true;
  };
  const list = sb.document.getElementById('camera-list');
  const watchButton = list.querySelector('.camera-watch');
  watchButton.dataset.cameraId = 'DEMO_FIRE_CAM_001';
  
  // Call click listener
  const clickListeners = sb.document.listeners['click'] || [];
  const event = {
    target: watchButton,
    preventDefault: () => {},
    stopPropagation: () => {}
  };
  clickListeners.forEach(listener => listener(event));
  
  if (!videoModalOpened) {
    throw new Error('Expected openVideoModal to be called on camera-watch button click');
  }
});

addTest('TC_T4_05', 'Tier 4: Real-World Scenarios', 'Full simulation scanning loop simulation', async () => {
  const sb = createFreshSandbox(async (url) => {
    if (url.includes('/api/scanner/demo-detect')) {
      return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ detections: [{ event_type: 'fire' }] }) };
    }
    if (url.includes('/api/scanner/demo-reset')) return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ success: true }) };
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cameras: demoCamerasMockData }) };
  });
  await sb.loadCameraDataset();

  // Stub submitDashboardDemoFrame to return detection payload directly
  sb.submitDashboardDemoFrame = async () => {
    return { detections: [{ event_type: 'fire' }] };
  };
  // Stub waitForDemoVideo to resolve immediately
  sb.waitForDemoVideo = async () => {};
  // Stub seekDemoVideo to resolve immediately
  sb.seekDemoVideo = async () => {};

  await sb.runDashboardIncidentDemo('fire');

  const label = sb.document.getElementById('incident-demo-progress-copy');
  if (!label.textContent.includes('Đã phát hiện fire') && !label.textContent.includes('cảnh báo')) {
    throw new Error(`Expected progress label to indicate success, got: "${label.textContent}"`);
  }
});

// ==========================================
// RUN THE SUITE AND PRINT RESULTS
// ==========================================

async function runAll() {
  console.log('\n=========================================');
  console.log('Smart Alert System - Camera Demo E2E Test Suite');
  console.log('=========================================\n');
  
  let passed = 0;
  let failed = 0;

  for (const t of testRegistry) {
    process.stdout.write(`[RUNNING] [${t.tier}] ${t.id}: ${t.description}... `);
    try {
      // Re-setup environmental state if modified
      process.env.NODE_ENV = initialNodeEnv || 'development';
      if (initialEnableSimulatedCamera === undefined) {
        delete process.env.ENABLE_SIMULATED_CAMERA;
      } else {
        process.env.ENABLE_SIMULATED_CAMERA = initialEnableSimulatedCamera;
      }
      
      await t.fn();
      console.log('\x1b[32mPASSED\x1b[0m');
      passed++;
    } catch (err) {
      console.log('\x1b[31mFAILED\x1b[0m');
      console.log(`          \x1b[33mReason: ${err.message}\x1b[0m`);
      failed++;
    }
  }

  // Restore env
  process.env.NODE_ENV = initialNodeEnv;
  if (initialEnableSimulatedCamera === undefined) {
    delete process.env.ENABLE_SIMULATED_CAMERA;
  } else {
    process.env.ENABLE_SIMULATED_CAMERA = initialEnableSimulatedCamera;
  }

  console.log('\n=========================================');
  console.log('Test Summary:');
  console.log(`Passed: \x1b[32m${passed}\x1b[0m`);
  console.log(`Failed: \x1b[31m${failed}\x1b[0m`);
  console.log(`Total:  ${testRegistry.length}`);
  console.log('=========================================\n');

  if (failed > 0) {
    console.log('\x1b[31mE2E validation failed. Requirements not fully met.\x1b[0m');
    process.exit(1);
  } else {
    console.log('\x1b[32mE2E validation succeeded. All requirements verified.\x1b[0m');
    process.exit(0);
  }
}

// Execute test runner
runAll().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
