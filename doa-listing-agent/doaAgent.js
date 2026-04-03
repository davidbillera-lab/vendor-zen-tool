/**
 * doaAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controls Chromium via Playwright to fill lots on Denver Online Auctions.
 *
 * WHAT IT DOES (per lot):
 *   1. Navigates to the lot's EditAuction page
 *   2. Uploads the lot's images via the "Drop files here / browse files" widget
 *   3. Waits for images to finish uploading (networkidle + thumbnail check)
 *   4. Clicks "Insert AI title/description" dropdown
 *   5. Selects "Use first six images" (option 2)
 *   6. Waits for the AI to populate the title and description fields
 *   7. Clicks "Save & Edit Next" (or "Save" on the last lot)
 *   8. Repeats for the next lot
 *
 * STEALTH:
 *   Uses playwright-extra + puppeteer-extra-plugin-stealth to mask automation
 *   signals. Also sets --disable-blink-features=AutomationControlled.
 *   Works against Cloudflare Insights (what DOA uses) without any issues.
 *
 * SELECTORS:
 *   Run: node inspect-form.js
 *   This prints every interactive element on the DOA lot page so you can
 *   verify or update the SELECTORS object below if DOA changes their UI.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium }    from 'playwright-extra';
import stealth         from 'puppeteer-extra-plugin-stealth';
import path            from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import log             from './logger.js';

// Apply stealth plugin — masks navigator.webdriver, CDP leaks, and fingerprints
chromium.use(stealth());

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config from .env ──────────────────────────────────────────────────────────
const DOA_BASE_URL          = process.env.DOA_BASE_URL || 'https://denveronlineauctions.com';
const DOA_EMAIL             = process.env.DOA_EMAIL;
const DOA_PASSWORD          = process.env.DOA_PASSWORD;
const DOA_FIRST_LOT_URL_ENV = process.env.DOA_FIRST_LOT_URL;

const LOGIN_URL = `${DOA_BASE_URL}/Account/Login`;  // redirects to sub-admin after auth

// ── Timeouts ──────────────────────────────────────────────────────────────────
const NAV_TIMEOUT_MS            = 30_000;   // page navigation
const UPLOAD_NETWORK_IDLE_MS    = 60_000;   // wait for upload to finish (networkidle)
const AI_GENERATION_TIMEOUT_MS  = 90_000;   // wait for AI to populate title/description
const AI_POLL_INTERVAL_MS       = 2_000;    // how often to check if AI is done
const SAVE_NAV_TIMEOUT_MS       = 25_000;   // wait for Save & Edit Next navigation

// ── Selector configuration ────────────────────────────────────────────────────
//
// Arrays are tried IN ORDER — the first matching element wins.
// If DOA changes their HTML, run:  node inspect-form.js
// ...then update the arrays below to match.
//
const SELECTORS = {

  // ── Login page ──────────────────────────────────────────────────────────────
  // Confirmed selectors from live DOA login page (April 2026).
  // The page has a newsletter popup with input[type="email"] that loads first —
  // always use the specific MainContent IDs to avoid targeting the wrong field.
  loginEmail: [
    '#MainContent_Email',               // confirmed — DOA login form
    'input[name="Email"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[name="username"]',
    'input[placeholder*="email" i]',
  ],
  loginPassword: [
    '#MainContent_Password',            // confirmed — DOA login form
    'input[name="Password"]',
    'input[name="password"]',
    'input[type="password"]',
    'input[placeholder*="password" i]',
  ],
  loginSubmit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Login")',
    'button:has-text("Sign In")',
    'button:has-text("Log In")',
    '.btn-login',
    '#loginBtn',
  ],
  loginSuccess: [
    'a:has-text("Auction")',
    '[class*="dashboard"]',
    '[class*="admin-nav"]',
    'nav',
  ],

  // ── Lot edit form ───────────────────────────────────────────────────────────
  // Confirmed selectors from live DOA EditAuction page (April 2026).
  lotTitle: [
    '#txtTitle',                        // confirmed — DOA lot title field
    'input[name="ctl00$MainContent$txtTitle"]',
    'input[placeholder*="title" i]',
    'input[id*="title" i]',
  ],
  lotStartingBid: [
    'input[name="starting_bid"]',
    'input[name="startingBid"]',
    'input[name="start_bid"]',
    'input[name="startBid"]',
    'input[name="bid"]',
    'input[placeholder*="bid" i]',
    'input[id*="bid" i]',
    'input[id*="starting" i]',
  ],

  // ── Image upload widget ─────────────────────────────────────────────────────
  // DOA uses the Uppy drag-and-drop widget. The file input is intentionally
  // hidden (class: uppy-Dashboard-input, name: files[]). Playwright's
  // setInputFiles() works on hidden inputs — no visibility check needed.
  lotFileUpload: [
    'input.uppy-Dashboard-input',       // confirmed — Uppy widget on DOA
    'input[name="files[]"]',            // Uppy name attribute
    'input[type="file"][accept="image/*"]', // generic fallback
    'input[type="file"]',
  ],

  // Thumbnail elements that appear after a successful upload
  uploadThumbnail: [
    '.uploaded-image',
    '.image-thumb',
    '[class*="uploaded"]',
    '[class*="thumb"]',
    '[class*="preview"]',
    '.image-preview',
    'img[class*="upload"]',
  ],

  // ── AI title/description button and dropdown ────────────────────────────────
  // The button is labeled "Insert AI title/description" with a dropdown arrow.
  // The dropdown has three options; we always want option 2: "Use first six images".
  aiDropdownButton: [
    'button:has-text("Insert AI title/description")',
    'a:has-text("Insert AI title/description")',
    '[class*="ai"]:has-text("Insert")',
    'button[id*="ai" i]',
    'a[id*="ai" i]',
  ],
  aiOptionSixImages: [
    // Text-based selectors for "Use first six images"
    'text="Use first six images"',
    ':text("Use first six images")',
    'a:has-text("Use first six images")',
    'button:has-text("Use first six images")',
    'li:has-text("Use first six images")',
    '[role="menuitem"]:has-text("Use first six images")',
    '.dropdown-item:has-text("Use first six images")',
  ],

  // ── Save buttons ────────────────────────────────────────────────────────────
  // #lnkProcess is DOA's actual "Save & Edit Next" anchor element.
  // The button-based selectors are fallbacks in case the UI changes.
  saveAndNext: [
    '#lnkProcess',                                // ← DOA's real anchor element
    'a[id*="Process" i]',                         // ID variation fallback
    'a:has-text("Save & Edit Next")',
    'button:has-text("Save & Edit Next")',
    'input[value*="Save & Edit Next" i]',
  ],
  saveOnly: [
    // Fallback for the last lot (no "next" to go to)
    '#lnkSave',
    'a[id*="Save" i]:not([id*="Next" i])',
    'button:has-text("Save")',
    'input[type="submit"]',
    'button[type="submit"]',
  ],
};

// ── Screenshot helper ─────────────────────────────────────────────────────────

async function takeScreenshot(page, label) {
  try {
    const dir       = log.getScreenshotsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename  = path.join(dir, `${label}-${timestamp}.png`);
    await page.screenshot({ path: filename, fullPage: true });
    log.warn(`Screenshot saved: ${filename}`);
    return filename;
  } catch (ssErr) {
    log.warn(`Could not save screenshot: ${ssErr.message}`);
    return null;
  }
}

// ── Selector helpers ──────────────────────────────────────────────────────────

/**
 * findFirst(page, selectorArray)
 * Returns the first locator from the array that has at least one matching element.
 * Returns null if none match.
 */
async function findFirst(page, selectorArray) {
  for (const sel of selectorArray) {
    try {
      if (await page.locator(sel).count() > 0) {
        return { locator: page.locator(sel).first(), selector: sel };
      }
    } catch { /* malformed selector — try next */ }
  }
  return null;
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function doLogin(page) {
  log.info('Navigating to DOA sub-admin login page…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

  const emailField = await findFirst(page, SELECTORS.loginEmail);
  if (!emailField) {
    await takeScreenshot(page, 'login-no-email-field');
    throw new Error(
      'FATAL: Could not find the email input on DOA\'s login page.\n' +
      `  Check DOA_BASE_URL="${DOA_BASE_URL}" in your .env file.`
    );
  }
  await emailField.locator.fill(DOA_EMAIL);

  const passField = await findFirst(page, SELECTORS.loginPassword);
  if (!passField) {
    await takeScreenshot(page, 'login-no-password-field');
    throw new Error('FATAL: Could not find the password input on DOA\'s login page.');
  }
  await passField.locator.fill(DOA_PASSWORD);

  const submitBtn = await findFirst(page, SELECTORS.loginSubmit);
  if (submitBtn) {
    await submitBtn.locator.click();
  } else {
    await page.keyboard.press('Enter');
    log.warn('  Could not find login button — pressed Enter instead');
  }

  await page.waitForTimeout(2500);

  const currentUrl = page.url();
  const onLoginPage = currentUrl.includes('login') || currentUrl.includes('Login') ||
                      currentUrl === LOGIN_URL;

  if (onLoginPage) {
    const errorText = await page.locator('[class*="error"], [class*="alert"]').first()
      .textContent().catch(() => '');
    await takeScreenshot(page, 'login-failed');
    throw new Error(
      `FATAL: Login failed — still on login page after submitting.\n` +
      `  Error on page: "${errorText.trim() || '(none visible)'}"\n` +
      `  Check DOA_EMAIL and DOA_PASSWORD in your .env file.`
    );
  }

  log.success('Logged into DOA sub-admin successfully');
}

async function isSessionAlive(page) {
  const url = page.url();
  if (url.includes('login') || url.includes('Login')) return false;
  if (url.includes('EditAuction')) return true;
  const dashEl = await findFirst(page, SELECTORS.loginSuccess);
  return dashEl !== null;
}

// ── Upload images ─────────────────────────────────────────────────────────────

/**
 * uploadImages(page, imagePaths, lotNumber)
 *
 * Uploads the provided local image files to the DOA lot page.
 * Waits for the upload to complete using networkidle + thumbnail polling.
 */
async function uploadImages(page, imagePaths, lotNumber) {
  if (!imagePaths || imagePaths.length === 0) {
    log.warn(`  Lot #${lotNumber}: No images to upload`);
    return false;
  }

  // Uppy's file input is intentionally hidden — use locator() without a
  // visibility check, then call setInputFiles() directly.
  let fileInputLocator = null;
  for (const sel of SELECTORS.lotFileUpload) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        fileInputLocator = page.locator(sel).first();
        log.info(`  File input found: ${sel}`);
        break;
      }
    } catch { /* try next */ }
  }

  if (!fileInputLocator) {
    log.warn(`  Lot #${lotNumber}: No file upload input found — skipping images`);
    log.warn('  Run: node inspect-form.js to check the upload widget on this page');
    return false;
  }

  log.info(`  Uploading ${imagePaths.length} image(s) for lot #${lotNumber}…`);
  await fileInputLocator.setInputFiles(imagePaths);

  // Wait for network to go quiet (upload requests complete)
  log.info('  Waiting for upload to complete (watching network)…');
  try {
    await page.waitForLoadState('networkidle', { timeout: UPLOAD_NETWORK_IDLE_MS });
    log.success('  Network idle — upload likely complete');
  } catch {
    log.warn('  Network did not go idle within timeout — checking for thumbnails anyway');
  }

  // Double-check: wait for at least one thumbnail to appear
  const thumbEl = await findFirst(page, SELECTORS.uploadThumbnail);
  if (thumbEl) {
    try {
      await thumbEl.locator.waitFor({ state: 'visible', timeout: 15_000 });
      log.success(`  Upload confirmed — thumbnail visible (${thumbEl.selector})`);
      return true;
    } catch {
      log.warn('  Thumbnail selector found but did not become visible — proceeding anyway');
    }
  } else {
    log.warn('  No thumbnail selector matched — upload may still be processing');
    // Give it a few extra seconds as a safety buffer
    await page.waitForTimeout(4_000);
  }

  return true;
}

// ── Fill title and description from CSV data ─────────────────────────────────

/**
 * fillLotForm(page, lot)
 *
 * Fills the title field and TinyMCE description editor from lot.title and
 * lot.description (sourced from the CSV). If either field is empty the lot
 * is still saved — DOA will just show a blank title/description.
 *
 * Returns true if both fields were written, false if either was skipped.
 */
async function fillLotForm(page, lot) {
  const { lot_number, title, description } = lot;
  let ok = true;

  // ── Title ──────────────────────────────────────────────────────────────────
  if (title && title.trim()) {
    const titleEl = await findFirst(page, SELECTORS.lotTitle);
    if (titleEl) {
      await titleEl.locator.fill(title.trim());
      log.success(`  Title filled: "${title.trim().slice(0, 60)}"`);
    } else {
      log.warn(`  Lot #${lot_number}: title field not found — skipping title`);
      ok = false;
    }
  } else {
    log.warn(`  Lot #${lot_number}: no title in CSV — leaving title blank`);
    ok = false;
  }

  // ── Description (TinyMCE) ──────────────────────────────────────────────────
  // DOA uses TinyMCE as its description editor. The visible textarea is an
  // iframe — we set the content via the TinyMCE JS API instead of typing.
  if (description && description.trim()) {
    try {
      await page.evaluate((desc) => {
        // TinyMCE exposes a global `tinymce` object; setContent() replaces
        // the editor body. Works whether the content is plain text or HTML.
        if (window.tinymce && window.tinymce.activeEditor) {
          window.tinymce.activeEditor.setContent(desc);
        } else if (window.tinymce && window.tinymce.editors && window.tinymce.editors.length > 0) {
          window.tinymce.editors[0].setContent(desc);
        }
      }, description.trim());
      log.success(`  Description filled (${description.trim().length} chars)`);
    } catch (descErr) {
      log.warn(`  Lot #${lot_number}: could not set TinyMCE description — ${descErr.message}`);
      ok = false;
    }
  } else {
    log.warn(`  Lot #${lot_number}: no description in CSV — leaving description blank`);
  }

  return ok;
}

// ── Trigger AI generation ─────────────────────────────────────────────────────

/**
 * triggerAiGeneration(page, lotNumber)
 *
 * Clicks the "Insert AI title/description" dropdown and selects
 * "Use first six images" (option 2).
 *
 * Then waits for the AI to populate the title field (polls until non-empty).
 *
 * Returns true if AI generation succeeded, false if the button wasn't found
 * (in which case the lot will be saved with empty title/description).
 */
async function triggerAiGeneration(page, lotNumber) {
  log.info(`  Triggering AI title/description generation for lot #${lotNumber}…`);

  // Step 1: Click the dropdown button
  const aiBtn = await findFirst(page, SELECTORS.aiDropdownButton);
  if (!aiBtn) {
    log.warn(
      `  "Insert AI title/description" button not found for lot #${lotNumber}.\n` +
      `  Run: node inspect-form.js to discover the correct selector.\n` +
      `  Saving lot with empty title/description.`
    );
    await takeScreenshot(page, `lot${lotNumber}-no-ai-button`);
    return false;
  }

  await aiBtn.locator.click();
  log.info(`  Clicked AI dropdown (selector: ${aiBtn.selector})`);

  // Wait briefly for the dropdown menu to render
  await page.waitForTimeout(600);

  // Step 2: Click "Use first six images"
  const optionBtn = await findFirst(page, SELECTORS.aiOptionSixImages);
  if (!optionBtn) {
    log.warn(
      `  "Use first six images" option not found for lot #${lotNumber}.\n` +
      `  The dropdown may have a different structure. Run: node inspect-form.js\n` +
      `  Attempting to close dropdown and save with empty title/description.`
    );
    await page.keyboard.press('Escape');
    await takeScreenshot(page, `lot${lotNumber}-no-ai-option`);
    return false;
  }

  await optionBtn.locator.click();
  log.info(`  Selected "Use first six images" (selector: ${optionBtn.selector})`);

  // Step 3: Wait for AI to populate the title field
  // Poll the title field until it has content, or until timeout.
  log.info('  Waiting for AI to generate title and description…');

  const titleEl = await findFirst(page, SELECTORS.lotTitle);
  if (!titleEl) {
    log.warn('  Cannot find title field to verify AI completion — waiting fixed 15s');
    await page.waitForTimeout(15_000);
    return true;
  }

  const startTime = Date.now();
  let aiDone = false;

  while (Date.now() - startTime < AI_GENERATION_TIMEOUT_MS) {
    const titleValue = await titleEl.locator.inputValue().catch(() => '');
    if (titleValue && titleValue.trim().length > 3) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      log.success(`  AI generated title in ${elapsed}s: "${titleValue.trim().slice(0, 60)}…"`);
      aiDone = true;
      break;
    }
    await page.waitForTimeout(AI_POLL_INTERVAL_MS);
  }

  if (!aiDone) {
    log.warn(
      `  AI generation timed out after ${AI_GENERATION_TIMEOUT_MS / 1000}s for lot #${lotNumber}.\n` +
      `  The title field is still empty. Saving anyway — you may need to fill it manually.`
    );
    await takeScreenshot(page, `lot${lotNumber}-ai-timeout`);
  }

  // Brief pause to let description field finish populating
  await page.waitForTimeout(1_500);

  return aiDone;
}

// ── Save the lot ──────────────────────────────────────────────────────────────

/**
 * saveLot(page, lotNumber)
 *
 * Clicks "Save & Edit Next" (or "Save" as fallback) and waits for navigation.
 * Returns the URL of the next page.
 */
async function saveLot(page, lotNumber) {
  const saveNextEl = await findFirst(page, SELECTORS.saveAndNext);
  const saveFallEl = await findFirst(page, SELECTORS.saveOnly);
  const saveEl     = saveNextEl || saveFallEl;

  if (!saveEl) {
    await takeScreenshot(page, `lot${lotNumber}-no-save-button`);
    throw new Error(
      `Save button not found for lot #${lotNumber}.\n` +
      `  Run: node inspect-form.js to check the current DOA form structure.`
    );
  }

  log.info(`  Clicking save (selector: ${saveEl.selector})…`);

  let nextPageUrl = null;

  try {
    // Use Promise.all to catch the navigation triggered by the click.
    // If the element is an anchor that fires a JS event (not a full navigation),
    // the waitForNavigation will time out — that's handled in the catch block.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: SAVE_NAV_TIMEOUT_MS }),
      saveEl.locator.click(),
    ]);
    nextPageUrl = page.url();
    if (saveNextEl) {
      log.success(`  Saved and advanced to: ${nextPageUrl}`);
    } else {
      log.info('  Saved (used fallback save button)');
    }
  } catch {
    // Navigation may not have fired (JS-driven save, or last lot)
    await page.waitForTimeout(3_500);
    nextPageUrl = page.url();
    log.info(`  Save clicked — current URL: ${nextPageUrl}`);
  }

  return nextPageUrl;
}

// ── Process a single lot ──────────────────────────────────────────────────────

/**
 * processLot(page, lot, imagePaths)
 *
 * The browser must already be on the correct EditAuction page.
 *
 * Behaviour depends on whether lot.title / lot.description are populated:
 *
 *   CSV+Zip mode  — lot.title and lot.description come from the CSV.
 *                   fillLotForm() writes them directly; no AI dropdown needed.
 *
 *   Zip-only mode — lot.title and lot.description are empty strings.
 *                   triggerAiGeneration() is called instead to use DOA's AI.
 *
 * Returns the URL of the next page.
 */
async function processLot(page, lot, imagePaths) {
  // Sanity check — make sure we're not on the login page
  if (page.url().includes('login') || page.url().includes('Login')) {
    throw new Error(
      `Session expired — redirected to login while processing lot #${lot.lot_number}`
    );
  }

  // Wait for the form to be interactive — wait for the title field specifically.
  // DOA's form has many hidden ASP.NET inputs; waiting for any 'input' to be
  // visible will always resolve to a hidden field and time out.
  await page.waitForSelector('#txtTitle', { state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(800); // let TinyMCE and Uppy finish initialising

  // 1. Fill title and description
  const hasCsvData = (lot.title && lot.title.trim()) || (lot.description && lot.description.trim());

  if (hasCsvData) {
    // CSV+Zip mode: write title/description directly from CSV data
    await fillLotForm(page, lot);
  } else {
    // Zip-only mode: use DOA's built-in AI dropdown
    await triggerAiGeneration(page, lot.lot_number);
  }

  // 2. Upload images
  await uploadImages(page, imagePaths, lot.lot_number);

  // 3. Save and advance
  const nextUrl = await saveLot(page, lot.lot_number);

  return nextUrl;
}

// ── Pre-run health check ──────────────────────────────────────────────────────

async function runHealthCheck(page, firstLotUrl) {
  log.section('Pre-run DOM Health Check');
  log.info(`Checking lot form at: ${firstLotUrl}`);

  await page.goto(firstLotUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(2_000);

  const issues = [];

  const fileInput = await findFirst(page, SELECTORS.lotFileUpload);
  if (!fileInput) {
    issues.push('File upload input not found — update SELECTORS.lotFileUpload in doaAgent.js');
  } else {
    log.info(`  File upload input: ${fileInput.selector}`);
  }

  const saveBtn = await findFirst(page, [...SELECTORS.saveAndNext, ...SELECTORS.saveOnly]);
  if (!saveBtn) {
    issues.push('Save button not found — update SELECTORS.saveAndNext in doaAgent.js');
  } else {
    log.info(`  Save button: ${saveBtn.selector}`);
  }

  const aiBtn = await findFirst(page, SELECTORS.aiDropdownButton);
  if (!aiBtn) {
    log.warn('  "Insert AI title/description" button not found — will attempt to locate it per lot');
    log.warn('  Run: node inspect-form.js to discover the correct selector');
  } else {
    log.info(`  AI dropdown button: ${aiBtn.selector}`);
  }

  if (issues.length > 0) {
    await takeScreenshot(page, 'health-check-failed');
    const msg = issues.map(i => `  • ${i}`).join('\n');
    throw new Error(
      `FATAL: Pre-run health check failed.\n${msg}\n\n` +
      `  Run: node inspect-form.js to discover the actual selectors.`
    );
  }

  log.success('Health check passed — form structure looks correct');
  return { healthy: true };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * runDoaAgent(lots, options, callbacks)
 *
 * @param {Object[]} lots
 *   Each lot must have: lot_number, images (string[] of local paths or URLs)
 *   Title and description are generated by DOA's AI — no need to pass them.
 *
 * @param {Object} options
 *   firstLotUrl  {string}   URL of the first EditAuction page
 *
 * @param {Object} callbacks
 *   onStart   (lot) => void
 *   onSuccess (lot) => void
 *   onFailure (lot, err) => void
 *
 * @returns {{ succeeded: number, failed: number, skipped: number }}
 */
export async function runDoaAgent(lots, options = {}, callbacks = {}) {
  const { firstLotUrl: passedFirstLotUrl } = options;
  const { onStart, onSuccess, onFailure }  = callbacks;

  const DOA_FIRST_LOT_URL = passedFirstLotUrl || DOA_FIRST_LOT_URL_ENV;
  if (!DOA_FIRST_LOT_URL) {
    throw new Error(
      'FATAL: No first lot URL found.\n' +
      '  Set DOA_FIRST_LOT_URL in your .env file, or pass firstLotUrl in options.\n' +
      '  Example: DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=1678303&PartyId=115'
    );
  }

  let browser   = null;
  let page      = null;
  let succeeded = 0;
  let failed    = 0;
  let skipped   = 0;

  // Track current lot URL for session recovery
  let currentLotUrl = DOA_FIRST_LOT_URL;

  try {
    // ── Launch browser ────────────────────────────────────────────────────────
    log.section('Launching Chromium (headed mode — you can watch the browser)');
    browser = await chromium.launch({
      headless: false,
      slowMo:   80,
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      viewport: null,
      acceptDownloads: true,
      // Realistic user agent for a Windows Chrome browser
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    page = await context.newPage();

    // ── Login ─────────────────────────────────────────────────────────────────
    await doLogin(page);

    // ── Health check ──────────────────────────────────────────────────────────
    await runHealthCheck(page, DOA_FIRST_LOT_URL);

    // We are now on the first lot's page — ready to process
    log.section(`Starting batch: ${lots.length} lot(s) to process`);

    // ── Batch loop ────────────────────────────────────────────────────────────
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];

      log.info(`\n[${i + 1}/${lots.length}] Lot #${lot.lot_number}`);

      // Session check — re-login if expired
      if (!await isSessionAlive(page)) {
        log.warn('  Session expired — re-authenticating…');
        await doLogin(page);
        log.info(`  Re-navigating to: ${currentLotUrl}`);
        await page.goto(currentLotUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(2_000);
      }

      if (onStart) await onStart(lot);

      try {
        // lot.images contains local file paths (from zipHandler) or URLs (from Supabase/CSV)
        const imagePaths = lot.images || [];

        const nextUrl = await processLot(page, lot, imagePaths);

        if (nextUrl && nextUrl.includes('EditAuction')) {
          currentLotUrl = nextUrl;
        }

        succeeded++;
        if (onSuccess) await onSuccess(lot);

        // Brief pause between lots
        await page.waitForTimeout(1_500);

      } catch (err) {
        failed++;
        const errMsg = err.message || String(err);
        log.error(`Lot #${lot.lot_number} FAILED: ${errMsg}`);
        await takeScreenshot(page, `error-lot${lot.lot_number}`);
        if (onFailure) await onFailure(lot, err);

        // Recovery: navigate back to a known-good state
        try {
          if (!page.url().includes('EditAuction')) {
            await page.goto(currentLotUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await page.waitForTimeout(1_500);
            log.info(`  Recovery: re-navigated to ${currentLotUrl}`);
          }
        } catch (recErr) {
          log.warn(`  Recovery navigation failed: ${recErr.message}`);
        }
      }
    }

  } catch (fatalErr) {
    log.error('Fatal error — agent stopping', fatalErr);
    if (page) await takeScreenshot(page, 'fatal-error');
    throw fatalErr;

  } finally {
    if (browser) {
      log.info('\nClosing browser…');
      await browser.close();
    }
  }

  return { succeeded, failed, skipped };
}
