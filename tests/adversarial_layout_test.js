/**
 * Smart Alert System - Adversarial Verification and Robustness Test Suite
 * This script runs static and dynamic analyses to verify edge cases, keyboard triggers,
 * out-of-bounds index navigation, and mobile responsive layout/IntersectionObserver glitches.
 */

const fs = require('fs');
const path = require('path');

// File paths
const HTML_PATH = path.resolve(__dirname, '../frontend/index.html');
const CSS_PATH = path.resolve(__dirname, '../frontend/css/style.css');
const JS_PATH = path.resolve(__dirname, '../frontend/js/app.js');

// Load files
const htmlContent = fs.readFileSync(HTML_PATH, 'utf8');
const cssContent = fs.readFileSync(CSS_PATH, 'utf8');
const jsContent = fs.readFileSync(JS_PATH, 'utf8');

const testSuite = {
  passed: 0,
  failed: 0,
  tests: []
};

function addTest(name, description, fn) {
  testSuite.tests.push({ name, description, fn });
}

// 1. Mobile Responsive Layout & IntersectionObserver Threshold Bug
addTest(
  'Mobile Landscape & Zoom IntersectionObserver Glitch',
  'Verifies if the IntersectionObserver 0.6 threshold fails on low viewport heights or long card content.',
  () => {
    // Extract the observer threshold from JS
    const thresholdMatch = jsContent.match(/threshold:\s*\[?([0-9.]+)/);
    if (!thresholdMatch) {
      throw new Error('Could not find IntersectionObserver threshold in app.js');
    }
    const threshold = parseFloat(thresholdMatch[1]);
    console.log(`\n  [Observer Threshold] Found threshold: ${threshold}`);

    // Simulation parameters for mobile landscape (e.g. 568x320 or 640x360)
    const viewportHeights = [320, 360];
    const cardPaddingMobile = 56; // 28px top + 28px bottom under max-width: 820px
    const titleHeight = 40; // Approx 2 lines of text
    const metaHeight = 20;

    for (const H of viewportHeights) {
      // Header height under 820px viewport width
      // section-head: 58px, news-type-toggle: 45px, news-filter-toolbar: 45px (news-tabs hidden in video)
      const headerHeight = 58 + 45 + 45; 
      const containerHeight = H - headerHeight; // available height for news-list (L)
      
      // Thumbnail height: aspect-ratio: 16/9, card width is roughly viewport width - 20px
      const cardWidth = 568 - 20; // for 320h viewport width is typically 568
      const rawThumbHeight = cardWidth * (9/16);
      const maxThumbHeight = 0.62 * H; // 62dvh
      const thumbHeight = Math.min(rawThumbHeight, maxThumbHeight);
      
      const cardContentHeight = cardPaddingMobile + thumbHeight + titleHeight + metaHeight;
      const maxVisibleHeight = containerHeight;
      const maxIntersectionRatio = maxVisibleHeight / cardContentHeight;

      console.log(`  [Simulation] H=${H}px -> Available Container Height=${containerHeight}px, Card Height=${cardContentHeight.toFixed(1)}px, Max Intersection Ratio=${maxIntersectionRatio.toFixed(3)}`);

      if (maxIntersectionRatio < threshold) {
        throw new Error(`Glitch confirmed: at viewport height ${H}px, the max intersection ratio (${maxIntersectionRatio.toFixed(3)}) is below the threshold ${threshold}. The video card will NEVER trigger as active (is-current).`);
      }
    }
  }
);

// 2. Keyboard Focus Interception and Escape Key Interference
addTest(
  'Keyboard Escape Interception & Tab Arrow Key Interception',
  'Verifies if keydown event listeners globally intercept Escape or Arrow keys when they shouldn\'t.',
  () => {
    // Find keydown event listeners
    const matches = [...jsContent.matchAll(/document\.addEventListener\(\s*['"]keydown['"]/g)];
    if (matches.length < 2) {
      throw new Error(`Expected at least 2 global keydown listeners in app.js, found ${matches.length}`);
    }

    // Verify if first keydown listener intercepts Escape globally without checking focus state
    const escapeSectionBlock = jsContent.match(/document\.addEventListener\("keydown",\s*\(event\)\s*=>\s*\{([^}]+event\.key\s*===\s*["']Escape["'][^}]+)\}/s);
    if (escapeSectionBlock) {
      const blockContent = escapeSectionBlock[0];
      if (blockContent.includes('setWorkspacePanel("cameras")') && !blockContent.includes('video-news-modal')) {
        console.log('  [Keyboard Interception] Confirmed: Global Escape listener closes news feed even when a modal (e.g. video modal) is active on top of it.');
      }
    }

    // Verify if Arrow key navigation blocks standard button navigation
    const arrowBlock = jsContent.match(/else\s+if\s*\(\s*event\.key\s*===\s*["']ArrowDown["'].*?moveNewsFeed/s);
    if (arrowBlock) {
      const skipCheck = jsContent.includes('["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)');
      const checkButton = jsContent.includes('"BUTTON"');
      if (skipCheck && !checkButton) {
        console.log('  [Keyboard Interception] Confirmed: Arrow keys are intercepted when a BUTTON is focused, breaking accessible tablist keyboard navigation.');
      } else {
        throw new Error('Arrow key check might have changed or does not block buttons.');
      }
    }
  }
);

// 3. Navigation Out-of-Bounds & Empty State Handling
addTest(
  'Out-of-Bounds Navigation & Empty State Interaction',
  'Checks if moveNewsFeed handles empty lists gracefully without throwing JS exceptions.',
  () => {
    // Statically check that moveNewsFeed verifies cards.length
    const moveNewsFeedMatch = jsContent.match(/function\s+moveNewsFeed\s*\(direction\)\s*\{([^}]+)\}/s);
    if (!moveNewsFeedMatch) {
      throw new Error('Could not find moveNewsFeed function in app.js');
    }
    const moveNewsFeedBody = moveNewsFeedMatch[1];
    if (!moveNewsFeedBody.includes('cards.length') || !moveNewsFeedBody.includes('return')) {
      throw new Error('moveNewsFeed does not check if cards exist before attempting to index them.');
    }
    
    // Check if currentIndex out-of-bounds is avoided
    if (!moveNewsFeedBody.includes('Math.min') || !moveNewsFeedBody.includes('Math.max')) {
      throw new Error('moveNewsFeed is missing Math.min/Math.max boundary guards, which could cause out-of-bounds indexing.');
    }
    console.log('  [Navigation Controls] Out-of-bounds checks are statically verified.');
  }
);

// Run verification
console.log('\n=========================================');
console.log('Adversarial Verification Suite Running');
console.log('=========================================\n');

for (const t of testSuite.tests) {
  process.stdout.write(`[RUNNING] ${t.name}... `);
  try {
    t.fn();
    console.log('\x1b[32mPASS\x1b[0m');
    testSuite.passed++;
  } catch (err) {
    console.log('\x1b[31mFAIL\x1b[0m');
    console.log(`          \x1b[33mReason: ${err.message}\x1b[0m`);
    testSuite.failed++;
  }
}

console.log('\n=========================================');
console.log('Adversarial Test Summary:');
console.log(`Passed: \x1b[32m${testSuite.passed}\x1b[0m`);
console.log(`Failed: \x1b[31m${testSuite.failed}\x1b[0m`);
console.log(`Total:  ${testSuite.tests.length}`);
console.log('=========================================\n');

if (testSuite.failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
