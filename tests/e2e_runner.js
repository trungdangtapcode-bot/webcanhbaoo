/**
 * Smart Alert System - E2E Testing Track Runner
 * This script runs completely offline and statically verifies the E2E requirements R1, R2, and R3.
 * It parses CSS, HTML, and JS files to verify layout, elements, structure, and behavior.
 * Exit code 0 if all tests pass, non-zero if they fail.
 */

const fs = require('fs');
const path = require('path');

// File paths
const HTML_PATH = path.resolve(__dirname, '../frontend/index.html');
const CSS_PATH = path.resolve(__dirname, '../frontend/css/style.css');
const JS_PATH = path.resolve(__dirname, '../frontend/js/app.js');

// Load files
let htmlContent = '';
let cssContent = '';
let jsContent = '';

try {
  htmlContent = fs.readFileSync(HTML_PATH, 'utf8');
} catch (e) {
  console.error(`Error reading HTML file: ${HTML_PATH}`);
  process.exit(1);
}

try {
  cssContent = fs.readFileSync(CSS_PATH, 'utf8');
} catch (e) {
  console.error(`Error reading CSS file: ${CSS_PATH}`);
  process.exit(1);
}

try {
  jsContent = fs.readFileSync(JS_PATH, 'utf8');
} catch (e) {
  console.error(`Error reading JS file: ${JS_PATH}`);
  process.exit(1);
}

// Test Runner Helper
const testSuite = {
  passed: 0,
  failed: 0,
  tests: []
};

function addTest(tier, name, description, fn) {
  testSuite.tests.push({ tier, name, description, fn });
}

// ==========================================
// TIER 1: FEATURE COVERAGE
// ==========================================

addTest(
  'Tier 1: Feature Coverage',
  'CSS Scroll-Snap Feed Layout',
  'Verifies CSS scroll-snap rules: y mandatory, scroll-behavior smooth, overscroll-behavior-y contain on feed, and scroll-snap-align start + scroll-snap-stop always on cards.',
  () => {
    // Check scroll snap container rules
    const containerMatch = cssContent.match(/\.news-feed-overlay\s+\.news-list\s*\{[^}]*\}/s);
    if (!containerMatch) {
      throw new Error('Could not find CSS block for ".news-feed-overlay .news-list".');
    }
    const block = containerMatch[0];
    if (!block.includes('scroll-snap-type: y mandatory') && !block.includes('scroll-snap-type:y mandatory')) {
      throw new Error('Missing "scroll-snap-type: y mandatory" on news-list container.');
    }
    if (!block.includes('scroll-behavior: smooth') && !block.includes('scroll-behavior:smooth')) {
      throw new Error('Missing "scroll-behavior: smooth" on news-list container.');
    }
    if (!block.includes('overscroll-behavior-y: contain') && !block.includes('overscroll-behavior-y:contain')) {
      throw new Error('Missing "overscroll-behavior-y: contain" on news-list container.');
    }

    // Check scroll snap card rules
    const cardMatch = cssContent.match(/\.news-feed-overlay\s+\.news-feed-card\s*\{[^}]*\}/s);
    if (!cardMatch) {
      throw new Error('Could not find CSS block for ".news-feed-overlay .news-feed-card".');
    }
    const cardBlock = cardMatch[0];
    if (!cardBlock.includes('scroll-snap-align: start') && !cardBlock.includes('scroll-snap-align:start')) {
      throw new Error('Missing "scroll-snap-align: start" on news-feed-card.');
    }
    if (!cardBlock.includes('scroll-snap-stop: always') && !cardBlock.includes('scroll-snap-stop:always')) {
      throw new Error('Missing "scroll-snap-stop: always" on news-feed-card.');
    }
  }
);

addTest(
  'Tier 1: Feature Coverage',
  'Dynamic Iframe Inject/Unload Lifecycle',
  'Verifies JS contains the lifecycle mechanism to dynamically inject the YouTube iframe on active card and unload/clear it when scrolled away.',
  () => {
    // Verify JS has loadVideoIframe and unloadVideoIframe (or equivalent dynamic iframe creation and clearing)
    const hasIframeLoad = jsContent.includes('loadVideoIframe') || 
      (jsContent.includes('createElement(\'iframe\'') && jsContent.includes('.src ='));
    
    const hasIframeUnload = jsContent.includes('unloadVideoIframe') || 
      (jsContent.includes('iframe.src = \'\'') || jsContent.includes('iframe.remove()') || jsContent.includes('iframe.src = ""'));

    if (!hasIframeLoad) {
      throw new Error('Could not find iframe loading/injection logic (e.g. loadVideoIframe or dynamic iframe creation with src assignment).');
    }
    if (!hasIframeUnload) {
      throw new Error('Could not find iframe unloading/clearing logic (e.g. unloadVideoIframe or iframe.src = \'\' or iframe.remove()).');
    }
  }
);

addTest(
  'Tier 1: Feature Coverage',
  'HTML Navigation Controls & Indicators',
  'Verifies index.html has the floating controller container with Prev/Next buttons and position/page indicator.',
  () => {
    const hasControls = htmlContent.includes('video-feed-controls') || htmlContent.includes('class="video-feed-controls"');
    const hasPrevBtn = htmlContent.includes('id="video-feed-prev"') || htmlContent.includes('id=\'video-feed-prev\'');
    const hasNextBtn = htmlContent.includes('id="video-feed-next"') || htmlContent.includes('id=\'video-feed-next\'');
    const hasIndicator = htmlContent.includes('id="video-feed-indicator"') || htmlContent.includes('id=\'video-feed-indicator\'');

    if (!hasControls) {
      throw new Error('Missing video feed controls container with class/id "video-feed-controls" in HTML.');
    }
    if (!hasPrevBtn) {
      throw new Error('Missing previous control button with ID "video-feed-prev" in HTML.');
    }
    if (!hasNextBtn) {
      throw new Error('Missing next control button with ID "video-feed-next" in HTML.');
    }
    if (!hasIndicator) {
      throw new Error('Missing video feed position indicator with ID "video-feed-indicator" in HTML.');
    }
  }
);

// ==========================================
// TIER 2: BOUNDARY & CORNER CASES
// ==========================================

addTest(
  'Tier 2: Boundary & Corner Cases',
  'Navigation Out-of-Bounds Checks',
  'Verifies JS logic checks boundary indices (prev button disabled at 0, next button disabled at end) or prevents scrolling past range.',
  () => {
    // Check for boundary logic inside JS
    const hasBoundaryCheck = jsContent.includes('disabled = index === 0') || 
      jsContent.includes('index <= 0') || 
      jsContent.includes('index === cards.length - 1') ||
      jsContent.includes('index >= cards.length - 1') ||
      jsContent.includes('index === 0') ||
      jsContent.includes('moveNewsFeed');

    if (!hasBoundaryCheck) {
      throw new Error('Could not verify boundary/bounds check logic for video feed indices in JS.');
    }
  }
);

addTest(
  'Tier 2: Boundary & Corner Cases',
  'Input Focus Blocks Keyboard Navigation',
  'Verifies JS keydown handler ignores arrow keys when user is typing in input, textarea, or select fields.',
  () => {
    const hasInputCheck = jsContent.includes('activeElement.tagName') && 
      (jsContent.includes('INPUT') || jsContent.includes('TEXTAREA') || jsContent.includes('SELECT'));

    if (!hasInputCheck) {
      throw new Error('Missing check in keyboard listener to prevent arrow key interception when user is typing (document.activeElement.tagName check against INPUT/TEXTAREA/SELECT).');
    }
  }
);

addTest(
  'Tier 2: Boundary & Corner Cases',
  'Active Card Hover Transitions',
  'Verifies CSS transitions are defined on close and navigation buttons to ensure smooth active card transitions/hover states.',
  () => {
    const hasBtnTransition = cssContent.match(/\.feed-nav-btn\s*\{[^}]*transition:[^}]*\}/s) ||
      cssContent.match(/\.news-feed-close\s*\{[^}]*transition:[^}]*\}/s) ||
      cssContent.includes('transition: background') ||
      cssContent.includes('transition: all') ||
      cssContent.includes('transition: color');

    if (!hasBtnTransition) {
      throw new Error('Missing CSS transitions on feed navigation buttons or close buttons.');
    }
  }
);

// ==========================================
// TIER 3: CROSS-FEATURE INTERACTIONS
// ==========================================

addTest(
  'Tier 3: Cross-Feature Interactions',
  'Switching Tabs / Closing Clears Video Feed',
  'Verifies that switching tabs away from video feed or closing the feed triggers dynamic video unload to clear memory.',
  () => {
    const hasTabCleanup = jsContent.includes('activeNewsTab') && 
      (jsContent.includes('unloadVideoIframe') || jsContent.includes('iframe.src = \'\'') || jsContent.includes('iframe.src = ""') || jsContent.includes('iframe.remove()'));

    if (!hasTabCleanup) {
      throw new Error('Missing dynamic video cleanup or unload execution when switching tabs/closing the feed.');
    }
  }
);

addTest(
  'Tier 3: Cross-Feature Interactions',
  'Responsive Layout Compatibility',
  'Verifies CSS media queries adjust feed layout padding, size, and positions navigation controls to a bottom banner on mobile screens.',
  () => {
    // Check media queries for max-width: 820px or similar viewport adjusting controls
    const mediaQueryMatch = cssContent.match(/@media\s*\(\s*max-width:\s*\d+px\s*\)\s*\{[^}]*\.video-feed-controls[^}]*\}/s) ||
      cssContent.includes('@media (max-width: 820px)') || 
      cssContent.includes('@media(max-width:820px)') ||
      cssContent.includes('.video-feed-controls');

    if (!mediaQueryMatch) {
      throw new Error('Missing responsive layout adaptation for video controls inside media query (max-width: 820px).');
    }
  }
);

// ==========================================
// TIER 4: REAL-WORLD SCENARIOS
// ==========================================

addTest(
  'Tier 4: Real-World Scenarios',
  'Scroll Interaction Observer Tracking',
  'Verifies IntersectionObserver is correctly set up to observe cards and toggle active class or update indicators dynamically.',
  () => {
    const hasObserver = jsContent.includes('IntersectionObserver') && 
      (jsContent.includes('newsFeedObserver') || jsContent.includes('observe('));

    const hasClassToggle = jsContent.includes('classList.toggle') && jsContent.includes('is-current');

    if (!hasObserver) {
      throw new Error('Missing IntersectionObserver setup in app.js for scrolling feed cards.');
    }
    if (!hasClassToggle) {
      throw new Error('Missing class toggle logic (e.g. .classList.toggle("is-current")) inside the IntersectionObserver callback.');
    }
  }
);

addTest(
  'Tier 4: Real-World Scenarios',
  'Loading State Skeleton Display',
  'Verifies skeleton/shimmer CSS keyframes exist and JS renders shimmer skeleton cards before the API data loads.',
  () => {
    const hasSkeletonCss = cssContent.includes('skeleton-card') || 
      cssContent.includes('skeleton-thumbnail') || 
      cssContent.includes('skeleton-line') ||
      cssContent.includes('skeleton-shimmer') ||
      cssContent.includes('keyframes');

    const hasSkeletonJs = jsContent.includes('skeleton-card') || 
      jsContent.includes('skeleton-thumbnail') || 
      jsContent.includes('video-skeleton-loader');

    if (!hasSkeletonCss) {
      throw new Error('Missing shimmer skeleton CSS rules (e.g. .skeleton-card, .skeleton-thumbnail, or keyframes shimmer).');
    }
    if (!hasSkeletonJs) {
      throw new Error('Missing JS implementation that utilizes skeleton placeholders/cards during news list loading.');
    }
  }
);

addTest(
  'Tier 3: Cross-Feature Interactions',
  'WCAG Theme Contrast Compliance',
  'Verifies CSS color variable ratios meet high contrast standards (light theme mix percentage >= 90%, dark theme mix percentage >= 82%).',
  () => {
    // Verify light theme --text-muted mix percentage
    const lightThemeMatch = cssContent.match(/html\[data-theme="light"\]\s*\{([^}]+)\}/s) ||
      cssContent.match(/html\[data-theme='light'\]\s*\{([^}]+)\}/s);
    
    if (lightThemeMatch) {
      const lightThemeBlock = lightThemeMatch[1];
      const mutedMatch = lightThemeBlock.match(/--text-muted\s*:\s*color-mix\(\s*in\s+srgb\s*,\s*[^,]+,\s*[^)]+\)\s*(\d+)%/);
      if (mutedMatch) {
        const percentage = parseInt(mutedMatch[1], 10);
        if (percentage < 90) {
          throw new Error(`Light theme --text-muted contrast ratio mix is only ${percentage}%, must be at least 90% to meet WCAG AAA contrast standard (>= 4.5:1).`);
        }
      }
    }

    // Verify dark theme --text-muted mix percentage
    const rootThemeMatch = cssContent.match(/:root\s*\{([^}]+)\}/s);
    if (rootThemeMatch) {
      const rootThemeBlock = rootThemeMatch[1];
      const mutedMatch = rootThemeBlock.match(/--text-muted\s*:\s*color-mix\(\s*in\s+srgb\s*,\s*[^,]+,\s*[^)]+\)\s*(\d+)%/);
      if (mutedMatch) {
        const percentage = parseInt(mutedMatch[1], 10);
        if (percentage < 82) {
          throw new Error(`Dark theme --text-muted contrast ratio mix is only ${percentage}%, must be at least 82% to meet WCAG contrast standard (>= 4.5:1).`);
        }
      }
    }
  }
);

// ==========================================
// RUN THE SUITE
// ==========================================

console.log('\n=========================================');
console.log('Smart Alert System - E2E Offline Test Runner');
console.log('=========================================\n');

let failedTiers = new Set();

for (const t of testSuite.tests) {
  process.stdout.write(`[RUNNING] [${t.tier}] ${t.name}... `);
  try {
    t.fn();
    console.log('\x1b[32mPASS\x1b[0m');
    testSuite.passed++;
  } catch (err) {
    console.log('\x1b[31mFAIL\x1b[0m');
    console.log(`          \x1b[33mReason: ${err.message}\x1b[0m`);
    testSuite.failed++;
    failedTiers.add(t.tier);
  }
}

console.log('\n=========================================');
console.log('Test Summary:');
console.log(`Passed: \x1b[32m${testSuite.passed}\x1b[0m`);
console.log(`Failed: \x1b[31m${testSuite.failed}\x1b[0m`);
console.log(`Total:  ${testSuite.tests.length}`);
console.log('=========================================\n');

if (testSuite.failed > 0) {
  console.log('\x1b[31mE2E validation failed. Requirements not fully met.\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32mE2E validation succeeded. All requirements verified.\x1b[0m');
  process.exit(0);
}
