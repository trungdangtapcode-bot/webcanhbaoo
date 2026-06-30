/**
 * Smart Alert System - Adversarial Verification Test Suite
 * This script verifies edge cases, logical loopholes, and failure modes in the frontend app.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_PATH = path.resolve(__dirname, '../frontend/js/app.js');
let jsCode = fs.readFileSync(JS_PATH, 'utf8');

// Replace let/const with var at the top level to expose them to the sandbox context
let sandboxJsCode = jsCode
  .replace(/\blet\b/g, 'var')
  .replace(/\bconst\b/g, 'var');

// Set up the sandbox with mocks
const L = {
  map: () => ({
    setView: function() { return this; },
    addLayer: function() { return this; },
    removeLayer: function() { return this; },
    hasLayer: () => false,
    on: function() { return this; },
    flyTo: function() { return this; },
    fitBounds: function() { return this; },
    invalidateSize: function() { return this; },
  }),
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
  marker: () => ({
    bindPopup: function() { return this; },
    addTo: function() { return this; },
  }),
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
  
  querySelector(selector) {
    if (selector === '.video-player-iframe-container') {
      let el = this.children.find(c => c.className.includes('video-player-iframe-container'));
      if (!el) {
        el = new MockElement('DIV', '', 'video-player-iframe-container');
        this.appendChild(el);
      }
      return el;
    }
    if (selector === '.video-skeleton-loader') {
      let el = this.children.find(c => c.className.includes('video-skeleton-loader'));
      if (!el) {
        el = new MockElement('DIV', '', 'video-skeleton-loader');
        this.appendChild(el);
      }
      return el;
    }
    if (selector === 'img') return new MockElement('IMG');
    if (selector === '.video-play-btn') return new MockElement('DIV');
    if (selector === '.video-duration') return new MockElement('DIV');
    if (selector === 'iframe') return this.children.find(c => c.tagName === 'IFRAME') || null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '.news-feed-card') {
      return this.children.filter(c => c.className.includes('news-feed-card'));
    }
    return [];
  }
  
  scrollIntoView() {}
  focus() {}
  
  addEventListener(event, handler) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(handler);
  }
}

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
    return new MockElement();
  },
  querySelectorAll: (sel) => {
    if (sel === "[data-workspace-tab]" || sel === ".sidebar [data-workspace-panel]" || sel === ".radius-btn" || sel === ".range-btn" || sel === ".filter-btn" || sel === "[data-map-incident-filter]" || sel === "#news-tabs .news-tab" || sel === 'input[name="contribute-public-visible"]') {
      return [];
    }
    return [];
  },
  addEventListener: (event, handler) => {
    documentMock.listeners[event] = documentMock.listeners[event] || [];
    documentMock.listeners[event].push(handler);
  },
  listeners: {},
  write: () => {},
};

const mockFetch = () => Promise.resolve({
  ok: true,
  headers: { get: () => 'application/json' },
  json: () => Promise.resolve({ videos: [], news: [] })
});

const windowMock = {
  location: {
    protocol: 'http:',
    port: '3000',
    origin: 'http://localhost:3000',
    search: '',
    replace: () => {},
  },
  addEventListener: () => {},
  setTimeout: (fn) => fn(),
  setInterval: () => {},
  navigator: {
    language: 'en',
    serviceWorker: {
      addEventListener: () => {},
      register: () => Promise.resolve({ active: true }),
    }
  },
  localStorage: {
    getItem: (key) => {
      if (key === 'smart-alert-auth-session') {
        return JSON.stringify({ email: 'test@example.com', name: 'Test User', role: 'admin' });
      }
      return null;
    },
    setItem: () => {},
    removeItem: () => {},
  },
  speechSynthesis: {
    speak: () => {},
    cancel: () => {},
    speaking: false,
  },
  SpeechSynthesisUtterance: function() {},
  IntersectionObserver: function(callback) {
    this.observe = () => {};
    this.disconnect = () => {};
  },
  TextDecoder: function() {
    this.decode = () => '';
  },
  URLSearchParams: global.URLSearchParams,
  URL: global.URL,
  fetch: mockFetch,
};

// Create a context
const sandbox = {
  L,
  document: documentMock,
  window: windowMock,
  navigator: windowMock.navigator,
  localStorage: windowMock.localStorage,
  setInterval: windowMock.setInterval,
  setTimeout: windowMock.setTimeout,
  requestAnimationFrame: (fn) => fn(),
  console: console,
  fetch: mockFetch,
  URLSearchParams: global.URLSearchParams,
  URL: global.URL,
  TextDecoder: global.TextDecoder,
  Uint8Array: global.Uint8Array,
  HTMLElement: MockElement,
  IntersectionObserver: windowMock.IntersectionObserver,
};

// Run sandboxJsCode inside context
try {
  vm.createContext(sandbox);
  sandbox.window.CSS = { escape: (s) => s };
  vm.runInContext(sandboxJsCode, sandbox);
} catch (e) {
  console.error("Error executing app.js in sandbox", e);
  process.exit(1);
}

// Perform verification tests
console.log("=========================================");
console.log("Adversarial Verification Suite");
console.log("=========================================\n");

// Test 1: Keyboard triggers - Escape key inside Input controls
(function testKeyboardEscapeHandling() {
  // Set workspace panel to "news" first
  sandbox.setWorkspacePanel("news");
  
  // Case A: Normal element focused, Esc should close news
  documentMock.activeElement = new MockElement('BUTTON');
  const escEventNormal = { key: 'Escape', preventDefault: () => {} };
  
  // Trigger keydown
  if (documentMock.listeners['keydown']) {
    documentMock.listeners['keydown'].forEach(listener => {
      try {
        listener(escEventNormal);
      } catch(e) {}
    });
  }
  const closedNormally = sandbox.activeWorkspacePanel === 'cameras';

  // Reset panel to news
  sandbox.setWorkspacePanel("news");

  // Case B: Input element focused, Esc pressed
  documentMock.activeElement = new MockElement('INPUT');
  const escEventInput = { key: 'Escape', preventDefault: () => {} };
  
  // Trigger keydown
  if (documentMock.listeners['keydown']) {
    documentMock.listeners['keydown'].forEach(listener => {
      try {
        listener(escEventInput);
      } catch (e) {}
    });
  }
  const closedOnInput = sandbox.activeWorkspacePanel === 'cameras';

  if (closedNormally && !closedOnInput) {
    console.log("\x1b[31mREPRODUCED\x1b[0m Gap 1: Escape key ignored on input focus.");
  } else {
    console.log("Test 1 Result: closedNormally =", closedNormally, ", closedOnInput =", closedOnInput);
  }
})();

// Test 2: Rapid Scroll inputs race conditions
(function testRapidNavigationRaceCondition() {
  // Setup active tab as video, and mock active list element
  sandbox.activeNewsTab = 'video';
  const list = getElementById("video-news-list");
  list.hidden = false;
  list.children = [
    new MockElement('DIV', 'card0', 'news-feed-card is-current'),
    new MockElement('DIV', 'card1', 'news-feed-card'),
    new MockElement('DIV', 'card2', 'news-feed-card'),
  ];
  
  // Track which index is scrolled
  let scrolledIndex = -1;
  list.children.forEach((card, idx) => {
    card.scrollIntoView = () => { scrolledIndex = idx; };
  });

  // Call first next (simulates ArrowDown / Next click)
  sandbox.moveNewsFeed(1); // card0 has is-current, should scroll to card1
  const firstScroll = scrolledIndex;

  // Call second next immediately before observer changes is-current
  sandbox.moveNewsFeed(1); // card0 is still the only card with is-current, so it scrolls to card1 again!
  const secondScroll = scrolledIndex;

  if (firstScroll === 1 && secondScroll === 1) {
    console.log("\x1b[31mREPRODUCED\x1b[0m Gap 2: Rapid navigation swallowing.");
  } else {
    console.log("Test 2 Result: firstScroll =", firstScroll, ", secondScroll =", secondScroll);
  }
})();

// Test 3: Empty Video News API response or fetch failure
(function testEmptyVideoNewsSkeletonState() {
  // Set tab to video news
  sandbox.activeNewsTab = 'video';
  
  // Mock fetch to fail (returns null)
  sandbox.fetch = () => Promise.resolve({
    ok: false,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(null)
  });

  // Load video news (this sets the skeleton loader and then fetches)
  const list = getElementById("video-news-list");
  list.innerHTML = "";
  
  sandbox.loadVideoNews().then(() => {
    const hasSkeleton = list.innerHTML.includes("skeleton-card");
    const hasEmptyState = list.innerHTML.includes("Không có video");
    if (hasSkeleton && !hasEmptyState) {
      console.log("\x1b[31mREPRODUCED\x1b[0m Gap 3: Skeleton UI lock.");
    } else {
      console.log("Test 3 Result: hasSkeleton =", hasSkeleton, ", hasEmptyState =", hasEmptyState);
    }
  }).catch((e) => {
    console.log("ERROR", e);
  });
})();

// Test 5: Out of bounds / re-render race condition
(function testIndicatorRaceCondition() {
  // Trigger updateVideoFeedIndicator with an element not in the list (representing an orphaned card)
  const orphanedCard = new MockElement('DIV', 'orphaned', 'news-feed-card');
  const prevBtn = getElementById("video-feed-prev");
  const nextBtn = getElementById("video-feed-next");
  
  // Reset buttons to disabled
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  // Mock list with cards
  const list = getElementById("video-news-list");
  list.children = [
    new MockElement('DIV', 'card0', 'news-feed-card'),
    new MockElement('DIV', 'card1', 'news-feed-card'),
  ];

  // Call update indicator with orphaned card
  sandbox.updateVideoFeedIndicator(orphanedCard);

  // If index is -1, prevBtn.disabled becomes (index === 0) -> false (ENABLED)
  // and nextBtn.disabled becomes (index === cards.length - 1) -> (-1 === 1) -> false (ENABLED)
  if (prevBtn.disabled === false && nextBtn.disabled === false) {
    console.log("\x1b[31mREPRODUCED\x1b[0m Gap 5: Indicator out-of-bounds disables check failure.");
  } else {
    console.log("Test 5 Result: prevBtn.disabled =", prevBtn.disabled, ", nextBtn.disabled =", nextBtn.disabled);
  }
})();
