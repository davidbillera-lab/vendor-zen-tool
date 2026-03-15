/**
 * doaAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controls the Chromium browser using Playwright to fill lots on DOA.
 *
 * What it does:
 *   1. Opens a real, visible Chrome browser window (headed mode)
 *   2. Logs into denveronlineauctions.com/sub-admin/
 *   3. Navigates to the first lot's EditAuction page (DOA_FIRST_LOT_URL)
 *   4. For each lot: fills Title, Starting Bid, Description (TinyMCE),
 *      uploads images, then clicks "Save & Edit Next" to advance
 *   5. Takes a screenshot on any error so you can see what went wrong
 *   6. Checks session health before each lot and re-logs in if expired
 *
 * Before your first production run, execute:
 *   node inspect-form.js
 * This prints every form field on DOA's lot page so you can verify the
 * SELECTORS object below matches DOA's actual HTML.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import log from './logger.js';
import { downloadImages, cleanupImages } from './imageHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config from .env ──────────────────────────────────────────────────────────
const DOA_BASE_URL          = process.env.DOA_BASE_URL || 'https://denveronlineauctions.com';
const DOA_EMAIL             = process.env.DOA_EMAIL;
const DOA_PASSWORD          = process.env.DOA_PASSWORD;
const DOA_FIRST_LOT_URL_ENV = process.env.DOA_FIRST_LOT_URL;

const LOGIN_URL = `${DOA_BASE_URL}/sub-admin/`;

// ── Selector configuration ────────────────────────────────────────────────────
//
// These are tried IN ORDER. The first one that matches an element on the page
// is used. If DOA changes their HTML and things break, run:
//   node inspect-form.js
// ...to see the real field names, then update the arrays below.
//
// Why arrays instead of a single selector:
//   DOA's platform may change between versions. Having fallbacks means a minor
//   DOM change doesn't kill the entire run — it gracefully tries the next option.
//
const SELECTORS = {
  // ── Login page ──────────────────────────────────────────────────────────────
  loginEmail: [
    'input[name="email"]',
    'input[type="email"]',
    'input[name="username"]',
    'input[id*="email"]',
    'input[placeholder*="email" i]',
  ],
  loginPassword: [
    'input[name="password"]',
    'input[type="password"]',
    'input[id*="password"]',
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
    // Elements present after a successful login — used to verify we're in
    'a:has-text("Auction")',
    '[class*="dashboard"]',
    '[class*="admin-nav"]',
    'nav',
  ],

  // ── Lot edit form ───────────────────────────────────────────────────────────
  //
  // RUN: node inspect-form.js
  // Then compare these to what the inspector prints and update if needed.
  //
  lotTitle: [
    'input[name="title"]',
    'input[name="lot_title"]',
    'input[name="Title"]',
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
  lotFileUpload: [
    'input[type="file"]',
    'input[name*="image"]',
    'input[name*="photo"]',
    'input[accept*="image"]',
  ],
  uploadConfirmation: [
    // Appears after images are uploaded — used to know when it's safe to save
    '.upload-success',
    '.image-preview',
    '[class*="thumb"]',
    '[class*="preview"]',
    '.uploaded',
    '[class*="uploaded"]',
  ],
  saveAndNext: [
    // Primary save button — advances to next lot automatically
    'button:has-text("Save & Edit Next")',
    'input[value*="Save & Edit Next" i]',
  ],
  saveOnly: [
    // Fallback if "Save & Edit Next" is not present (e.g., last lot)
    'button:has-text("Save")',
    'input[type="submit"]',
    'button[type="submit"]',
  ],
};

// ── How long to wait for upload confirmation (ms) ─────────────────────────────
// Increase this if DOA is slow to process images (large files, slow server)
const UPLOAD_CONFIRM_TIMEOUT_MS = 45_000;

// ── How long before declaring a page navigation "too slow" ───────────────────
const NAV_TIMEOUT_MS = 30_000;

// ── Screenshot helper ─────────────────────────────────────────────────────────

async function takeScreenshot(page, label) {
  try {
    const screenshotsDir = log.getScreenshotsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename  = path.join(screenshotsDir, `${label}-${timestamp}.png`);
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
 * Returns the first locator from the array that has at least one matching element,
 * or null if none match.
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

/**
 * doLogin(page)
 * Navigates to the DOA sub-admin login page, fills credentials, submits.
 * Throws a clear error if login doesn't succeed — this is a fatal failure.
 */
async function doLogin(page) {
  log.info('Navigating to DOA sub-admin login page…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

  // Fill email
  const emailField = await findFirst(page, SELECTORS.loginEmail);
  if (!emailField) {
    await takeScreenshot(page, 'login-no-email-field');
    throw new Error(
      'FATAL: Could not find the email/username input on DOA\'s login page.\n' +
      '  This usually means DOA changed their login page, or the URL is wrong.\n' +
      `  Check that DOA_BASE_URL="${DOA_BASE_URL}" in your .env is correct.`
    );
  }
  await emailField.locator.fill(DOA_EMAIL);
  log.info(`  Filled email (selector: ${emailField.selector})`);

  // Fill password
  const passField = await findFirst(page, SELECTORS.loginPassword);
  if (!passField) {
    await takeScreenshot(page, 'login-no-password-field');
    throw new Error('FATAL: Could not find the password input on DOA\'s login page.');
  }
  await passField.locator.fill(DOA_PASSWORD);
  log.info('  Filled password');

  // Submit
  const submitBtn = await findFirst(page, SELECTORS.loginSubmit);
  if (submitBtn) {
    await submitBtn.locator.click();
    log.info(`  Clicked login button (selector: ${submitBtn.selector})`);
  } else {
    // Last resort — press Enter
    await page.keyboard.press('Enter');
    log.warn('  Could not find login button — pressed Enter instead');
  }

  // Verify login succeeded
  // Allow up to 15s for redirect or SPA state change
  await page.waitForTimeout(2000);

  const currentUrl = page.url();
  const onLoginPage = currentUrl.includes('login') || currentUrl.includes('Login') ||
                      currentUrl === LOGIN_URL || currentUrl === LOGIN_URL + 'login';

  if (onLoginPage) {
    // Still on login page — check if there's an error message visible
    const errorText = await page.locator('[class*="error"], [class*="alert"], .alert').first().textContent().catch(() => '');
    await takeScreenshot(page, 'login-failed');
    throw new Error(
      `FATAL: Login failed — still on login page after submitting.\n` +
      `  Error message on page: "${errorText.trim() || '(none visible)'}"\n` +
      `  Check DOA_EMAIL and DOA_PASSWORD in your .env file.`
    );
  }

  log.success('Logged into DOA sub-admin successfully');
}

/**
 * isSessionAlive(page)
 * Returns true if the current browser context is still authenticated.
 * Used before each lot to catch session expiration mid-batch.
 *
 * How it works: navigates to the sub-admin root and checks whether we land
 * on a login page or a dashboard page. Does NOT consume the lot edit page.
 */
async function isSessionAlive(page) {
  const currentUrl = page.url();
  // If we're already on the login page, session is definitely dead
  if (currentUrl.includes('login') || currentUrl.includes('Login')) return false;
  // If we're on an EditAuction page, we're good
  if (currentUrl.includes('EditAuction')) return true;

  // For other URLs, do a lightweight check: look for a dashboard element
  const dashEl = await findFirst(page, SELECTORS.loginSuccess);
  return dashEl !== null;
}

// ── DOM health check ──────────────────────────────────────────────────────────

/**
 * runHealthCheck(page, firstLotUrl)
 * Called once before the batch starts. Navigates to the first lot page and
 * verifies that at least the title field exists. If the form looks completely
 * different from what we expect, we halt before wasting time on 200 lots.
 *
 * Returns: { healthy: true } on pass, throws on critical failure.
 */
async function runHealthCheck(page, firstLotUrl) {
  log.section('Pre-run DOM Health Check');
  log.info(`Checking lot form at: ${firstLotUrl}`);

  await page.goto(firstLotUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(2000); // let TinyMCE init

  const titleField = await findFirst(page, SELECTORS.lotTitle);
  const saveBtn    = await findFirst(page, [...SELECTORS.saveAndNext, ...SELECTORS.saveOnly]);

  const issues = [];
  if (!titleField) issues.push('Title input not found — update SELECTORS.lotTitle in doaAgent.js');
  if (!saveBtn)    issues.push('Save button not found — update SELECTORS.saveAndNext or SELECTORS.saveOnly in doaAgent.js');

  // Check TinyMCE
  const tinymceReady = await page.evaluate(() =>
    !!(window.tinymce && (window.tinymce.activeEditor || (window.tinymce.editors && window.tinymce.editors.length > 0)))
  );
  if (!tinymceReady) {
    log.warn('  TinyMCE not detected — description will use plain textarea fallback');
  } else {
    log.info('  TinyMCE editor confirmed present');
  }

  // Check file upload
  const fileInput = await findFirst(page, SELECTORS.lotFileUpload);
  if (!fileInput) {
    log.warn('  No <input type="file"> found — image uploads may fail');
    log.warn('  Run: node inspect-form.js to see all elements on this page');
  } else {
    log.info(`  File upload input confirmed (selector: ${fileInput.selector})`);
  }

  if (issues.length > 0) {
    await takeScreenshot(page, 'health-check-failed');
    const msg = issues.map(i => `  • ${i}`).join('\n');
    throw new Error(
      `FATAL: Pre-run health check failed. The lot edit form looks different than expected.\n` +
      `${msg}\n\n` +
      `  Run: node inspect-form.js to discover the actual selectors, then update doaAgent.js.\n` +
      `  A screenshot was saved to logs/screenshots/`
    );
  }

  log.success(`Health check passed — title field: "${titleField.selector}", save button: "${saveBtn.selector}"`);
  return { healthy: true };
}

// ── Fill TinyMCE description ──────────────────────────────────────────────────

/**
 * fillTinyMce(page, htmlContent)
 * Injects content into the TinyMCE rich-text editor.
 *
 * Method 1: TinyMCE JS API — most reliable, works regardless of editor rendering
 * Method 2: Write directly into TinyMCE's iframe body — fallback for older TinyMCE
 * Method 3: Plain textarea — if TinyMCE is not present at all
 */
async function fillTinyMce(page, htmlContent) {
  const content = htmlContent || '';

  // Method 1: TinyMCE JS API
  const injected = await page.evaluate((c) => {
    if (!window.tinymce) return false;
    const editor = window.tinymce.activeEditor ||
                   (window.tinymce.editors && window.tinymce.editors[0]);
    if (!editor) return false;
    editor.setContent(c);
    editor.fire('change');
    return true;
  }, content);

  if (injected) {
    log.info(`  Filled description via TinyMCE JS API (${content.length} chars)`);
    return;
  }

  // Method 2: TinyMCE iframe body
  try {
    const body = page.frameLocator('iframe[id$="_ifr"]').locator('body');
    await body.waitFor({ state: 'visible', timeout: 5_000 });
    await body.fill('');
    await body.type(content, { delay: 5 });
    log.info('  Filled description via TinyMCE iframe body');
    return;
  } catch { /* fall through */ }

  // Method 3: Plain textarea (if no TinyMCE at all)
  const textarea = await findFirst(page, ['textarea[name="description"]', 'textarea[name="Description"]', 'textarea']);
  if (textarea) {
    await textarea.locator.fill(content);
    log.info('  Filled description via plain textarea (TinyMCE not present)');
    return;
  }

  log.warn('  Could not find description field — description skipped for this lot');
}

// ── Fill a single lot form ────────────────────────────────────────────────────

/**
 * fillCurrentLotForm(page, lot, localImagePaths, currentPageUrl)
 *
 * The browser must already be on the correct EditAuction page before calling this.
 * Fills Title, Starting Bid, Description, uploads images, then saves.
 *
 * Returns the URL of the next page (for recovery if the next lot fails).
 */
async function fillCurrentLotForm(page, lot, localImagePaths, currentPageUrl) {
  // Sanity check — make sure we're on an edit form, not a login redirect
  if (page.url().includes('login') || page.url().includes('Login')) {
    throw new Error(`Session expired — redirected to login page while processing lot #${lot.lot_number}`);
  }

  // Wait for the form to be interactive
  await page.waitForSelector('input', { state: 'visible', timeout: 15_000 });

  // ── Title ───────────────────────────────────────────────────────────────────
  const titleEl = await findFirst(page, SELECTORS.lotTitle);

  if (!titleEl) {
    // Fallback: use the first visible text input (usually Title on DOA forms)
    const inputs = page.locator('form input[type="text"], form input:not([type])');
    if (await inputs.count() > 0) {
      // DOA pre-fills the title field with the lot number (e.g. "Lot # 1").
      // Read the existing value and APPEND our title after it — never clear it.
      const existingFallback = (await inputs.first().inputValue()).trim();
      const appendedFallback = existingFallback
        ? `${existingFallback} ${(lot.title || '').trim()}`
        : (lot.title || '').trim();
      await inputs.first().fill(appendedFallback);
      log.warn(`  Title filled via fallback: "${appendedFallback}"`);
    } else {
      await takeScreenshot(page, `lot${lot.lot_number}-no-title-field`);
      throw new Error(
        `Title input not found for lot #${lot.lot_number}.\n` +
        `  Run: node inspect-form.js to check the current DOA form structure.`
      );
    }
  } else {
    // DOA pre-fills the title field with the lot number (e.g. "Lot # 1").
    // Read the existing value and APPEND our title after it — never clear it.
    const existingTitle = (await titleEl.locator.inputValue()).trim();
    const appendedTitle = existingTitle
      ? `${existingTitle} ${(lot.title || '').trim()}`
      : (lot.title || '').trim();
    await titleEl.locator.fill(appendedTitle);
    log.info(`  Title: "${appendedTitle}"  [preserved lot#: "${existingTitle}"]`);
  }

  // ── Starting Bid ────────────────────────────────────────────────────────────
  // SKIPPED — DOA already has the starting bid pre-configured on each lot.
  // Overwriting it is unnecessary and risks changing values the auctioneer set.
  log.info(`  Starting bid: skipped (DOA default preserved)`);


  // ── Description (TinyMCE) ───────────────────────────────────────────────────
  await fillTinyMce(page, lot.description || '');

  // ── Image Upload ────────────────────────────────────────────────────────────
  if (localImagePaths && localImagePaths.length > 0) {
    const fileInputEl = await findFirst(page, SELECTORS.lotFileUpload);

    if (!fileInputEl) {
      log.warn(`  No file upload input found for lot #${lot.lot_number} — saving without images`);
      log.warn('  Run: node inspect-form.js to check the upload widget on this page');
    } else {
      try {
        // setInputFiles works on hidden file inputs (Playwright bypasses visibility)
        await fileInputEl.locator.setInputFiles(localImagePaths);
        log.info(`  Uploading ${localImagePaths.length} image(s)…`);

        // Wait for DOA to acknowledge the upload
        // This is platform-specific — if uploads appear stuck, increase UPLOAD_CONFIRM_TIMEOUT_MS
        let uploadConfirmed = false;
        const confirmEl = await findFirst(page, SELECTORS.uploadConfirmation);
        if (confirmEl) {
          try {
            await confirmEl.locator.waitFor({ state: 'visible', timeout: UPLOAD_CONFIRM_TIMEOUT_MS });
            log.success(`  Upload confirmed (${confirmEl.selector})`);
            uploadConfirmed = true;
          } catch {
            // Confirmation selector found but didn't become visible in time
          }
        }

        if (!uploadConfirmed) {
          // No confirmation selector worked — wait a fixed time and hope for the best
          // 8 seconds handles most single-image uploads; add 2s per extra image
          const waitMs = 8000 + ((localImagePaths.length - 1) * 2000);
          log.warn(`  Upload confirmation not detected — waiting ${waitMs / 1000}s before saving`);
          await page.waitForTimeout(waitMs);
        }

      } catch (uploadErr) {
        log.warn(`  Image upload failed for lot #${lot.lot_number}: ${uploadErr.message}`);
        log.warn('  Saving lot without images — check screenshots for details');
        await takeScreenshot(page, `lot${lot.lot_number}-upload-failed`);
      }
    }
  } else {
    log.info(`  No images for lot #${lot.lot_number}`);
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  const saveNextEl = await findFirst(page, SELECTORS.saveAndNext);
  const saveFallEl = await findFirst(page, SELECTORS.saveOnly);
  const saveEl = saveNextEl || saveFallEl;

  if (!saveEl) {
    await takeScreenshot(page, `lot${lot.lot_number}-no-save-button`);
    throw new Error(
      `Save button not found for lot #${lot.lot_number}.\n` +
      `  This usually means the page failed to load correctly, or DOA changed their UI.\n` +
      `  Check the screenshot in logs/screenshots/`
    );
  }

  // Capture the URL after clicking save so we know where we ended up
  let nextPageUrl = null;
  try {
    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }),
      saveEl.locator.click(),
    ]);
    nextPageUrl = page.url();
    if (saveNextEl) {
      log.success(`  Saved and advanced to: ${nextPageUrl}`);
    } else {
      log.info(`  Saved (no "Save & Edit Next" — used fallback save button)`);
    }
  } catch {
    // Navigation didn't happen (e.g., last lot, or SPA that doesn't navigate)
    await page.waitForTimeout(3000);
    nextPageUrl = page.url();
    log.info(`  Save clicked — current URL: ${nextPageUrl}`);
  }

  return nextPageUrl;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * runDoaAgent(lots, options, callbacks)
 *
 * @param {Object[]} lots       Array of normalized lot objects
 *   Each lot must have: lot_number, title, description, images (string[]), starting_bid
 *
 * @param {Object}   options
 *   firstLotUrl  {string}  URL of the first EditAuction page (from .env or batch record)
 *   dryRun       {boolean} If true, skip everything after validation (unused here, handled in agent.js)
 *
 * @param {Object}   callbacks
 *   onStart   (lot) => void       Called before processing each lot
 *   onSuccess (lot) => void       Called after a lot is saved successfully
 *   onFailure (lot, err) => void  Called when a lot fails
 *
 * @returns {{ succeeded: number, failed: number, skipped: number }}
 */
export async function runDoaAgent(lots, options = {}, callbacks = {}) {
  const { firstLotUrl: passedFirstLotUrl } = options;
  const { onStart, onSuccess, onFailure } = callbacks;

  // Resolve first lot URL: per-batch option → .env → error
  const DOA_FIRST_LOT_URL = passedFirstLotUrl || DOA_FIRST_LOT_URL_ENV;
  if (!DOA_FIRST_LOT_URL) {
    throw new Error(
      'FATAL: No first lot URL found.\n' +
      '  Either set DOA_FIRST_LOT_URL in your .env file, or pass firstLotUrl in options.\n' +
      '  Example: DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=1678303&PartyId=115'
    );
  }

  let browser   = null;
  let page      = null;
  let succeeded = 0;
  let failed    = 0;
  let skipped   = 0;

  // Track the URL of the current lot's edit page for recovery after failures
  let currentLotUrl = DOA_FIRST_LOT_URL;

  try {
    // ── Launch browser ────────────────────────────────────────────────────────
    log.section('Launching Chromium (headed mode — you can watch the browser)');
    browser = await chromium.launch({
      headless: false,
      slowMo: 80,        // 80ms between actions — mimics human typing speed
      args: ['--start-maximized'],
    });

    const context = await browser.newContext({ viewport: null, acceptDownloads: true });
    page = await context.newPage();

    // ── Login ─────────────────────────────────────────────────────────────────
    await doLogin(page);

    // ── Pre-run health check ──────────────────────────────────────────────────
    // Verifies the form structure matches our selectors before processing any lots.
    // Halts immediately with a clear error if DOA's form has changed.
    await runHealthCheck(page, DOA_FIRST_LOT_URL);

    // We're on the first lot's page after the health check — ready to process
    log.section(`Starting batch: ${lots.length} lot(s) to process`);

    // ── Batch loop ────────────────────────────────────────────────────────────
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];

      log.info(`\n[${i + 1}/${lots.length}] Lot #${lot.lot_number}: "${lot.title}"`);

      // ── Session health check ────────────────────────────────────────────────
      // DOA sessions can expire mid-batch (PHP apps often have 60-min timeouts).
      // If we detect we've been redirected to the login page, re-authenticate
      // and navigate back to the current lot before continuing.
      if (!await isSessionAlive(page)) {
        log.warn('  Session expired — re-authenticating…');
        await doLogin(page);
        log.info(`  Re-navigating to: ${currentLotUrl}`);
        await page.goto(currentLotUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(2000);
      }

      if (onStart) await onStart(lot);

      let localImagePaths = [];
      try {
        // Download images to local temp folder so Playwright can upload them
        if (lot.images && lot.images.length > 0) {
          localImagePaths = await downloadImages(lot.images, lot.lot_number);
        }

        // Fill the form and save — returns the URL we landed on after saving
        const nextUrl = await fillCurrentLotForm(page, lot, localImagePaths, currentLotUrl);

        // If "Save & Edit Next" worked, nextUrl is the next lot's edit page.
        // We store it so we can return here if the next lot's session check fails.
        if (nextUrl && nextUrl.includes('EditAuction')) {
          currentLotUrl = nextUrl;
        }

        succeeded++;
        if (onSuccess) await onSuccess(lot);

        // Brief pause between lots — lets the page settle and avoids hammering the server
        await page.waitForTimeout(1500);

      } catch (err) {
        failed++;
        const errMsg = err.message || String(err);
        log.error(`Lot #${lot.lot_number} "${lot.title}" FAILED: ${errMsg}`);
        await takeScreenshot(page, `error-lot${lot.lot_number}`);
        if (onFailure) await onFailure(lot, err);

        // Recovery: try to navigate to the next lot directly.
        // If we know currentLotUrl, we attempt to advance past the failed lot
        // by re-navigating. "Save & Edit Next" would have advanced us, but since
        // this lot failed before saving, we have to manually move forward.
        //
        // If the next lot's URL is derivable (DOA uses sequential IDs), we could
        // compute it — but we don't know the mapping. Instead, we stay on the
        // current page and let the next iteration's session check handle recovery.
        //
        // The safest fallback: go back and try to reach a known-good state.
        try {
          const urlBeforeRecovery = page.url();
          if (!urlBeforeRecovery.includes('EditAuction')) {
            await page.goto(currentLotUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await page.waitForTimeout(1500);
            log.info(`  Recovery: re-navigated to ${currentLotUrl}`);
          }
        } catch (recErr) {
          log.warn(`  Recovery navigation failed: ${recErr.message} — next lot will re-check session`);
        }

      } finally {
        // Always clean up downloaded images, even if the lot failed
        if (localImagePaths.length > 0) {
          await cleanupImages(localImagePaths);
        }
      }
    }

  } catch (fatalErr) {
    // Fatal errors (login failure, health check failure, browser crash)
    // These are unrecoverable — log and bubble up to agent.js
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
