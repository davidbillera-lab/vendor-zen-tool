/**
 * doaAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controls the Chromium browser using Playwright to list lots on DOA.
 *
 * What it does:
 *   1. Opens a real, visible Chrome browser window (headed mode)
 *   2. Logs into denveronlineauctions.com/sub-admin/
 *   3. Navigates to your auction's edit page
 *   4. For each lot: clicks Add Lot, fills title + description, uploads images, saves
 *   5. Skips lots that already appear to be listed (by matching title)
 *   6. Takes a screenshot on any error so you can see exactly what went wrong
 *   7. Never deletes or modifies existing lots — only adds new ones
 *
 * The main export is runDoaAgent(lots, options).
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

// ── Read config from .env ─────────────────────────────────────────────────────
const DOA_BASE_URL   = process.env.DOA_BASE_URL || 'https://denveronlineauctions.com';
const DOA_EMAIL      = process.env.DOA_EMAIL;
const DOA_PASSWORD   = process.env.DOA_PASSWORD;
const DOA_AUCTION_ID = process.env.DOA_AUCTION_ID;

const LOGIN_URL   = `${DOA_BASE_URL}/sub-admin/`;
const AUCTION_URL = `${DOA_BASE_URL}/auction-details?id=${DOA_AUCTION_ID}`;

// ── Screenshot helper ─────────────────────────────────────────────────────────

async function takeErrorScreenshot(page, label) {
  try {
    const screenshotsDir = log.getScreenshotsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename  = path.join(screenshotsDir, `error-${label}-${timestamp}.png`);
    await page.screenshot({ path: filename, fullPage: true });
    log.warn(`Screenshot saved: ${filename}`);
    return filename;
  } catch (ssErr) {
    log.warn(`Could not save screenshot: ${ssErr.message}`);
    return null;
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────

/**
 * doLogin(page)
 * Fills in DOA sub-admin credentials and submits the login form.
 * Waits until navigation confirms a successful login.
 */
async function doLogin(page) {
  log.info('Navigating to DOA sub-admin login page…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Try common selectors for email and password fields
  const emailSelectors = [
    'input[name="email"]',
    'input[type="email"]',
    'input[name="username"]',
    'input[id*="email"]',
    'input[placeholder*="email" i]',
  ];
  const passwordSelectors = [
    'input[name="password"]',
    'input[type="password"]',
    'input[id*="password"]',
    'input[placeholder*="password" i]',
  ];

  // Find and fill email
  let emailFilled = false;
  for (const sel of emailSelectors) {
    if (await page.locator(sel).count() > 0) {
      await page.locator(sel).first().fill(DOA_EMAIL);
      log.info(`  Filled email using selector: ${sel}`);
      emailFilled = true;
      break;
    }
  }
  if (!emailFilled) {
    await takeErrorScreenshot(page, 'login-no-email-field');
    throw new Error('Could not find email input on DOA login page');
  }

  // Find and fill password
  let passFilled = false;
  for (const sel of passwordSelectors) {
    if (await page.locator(sel).count() > 0) {
      await page.locator(sel).first().fill(DOA_PASSWORD);
      log.info(`  Filled password`);
      passFilled = true;
      break;
    }
  }
  if (!passFilled) {
    await takeErrorScreenshot(page, 'login-no-password-field');
    throw new Error('Could not find password input on DOA login page');
  }

  // Click the submit/login button
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Login")',
    'button:has-text("Sign In")',
    'button:has-text("Log In")',
    '.btn-login',
    '#loginBtn',
  ];
  let submitted = false;
  for (const sel of submitSelectors) {
    if (await page.locator(sel).count() > 0) {
      await page.locator(sel).first().click();
      log.info(`  Clicked login button: ${sel}`);
      submitted = true;
      break;
    }
  }
  if (!submitted) {
    // Last resort: press Enter in the password field
    await page.keyboard.press('Enter');
    log.warn('  Could not find login button — pressed Enter instead');
  }

  // Wait for navigation after login (either redirect or dashboard element appearing)
  try {
    await page.waitForURL(url => !url.includes('login') && !url.includes('Login'), {
      timeout: 15_000,
    });
    log.success('Logged into DOA sub-admin successfully');
  } catch {
    // URL might not change if using a SPA; check for a dashboard element instead
    const dashboardSelectors = [
      'a:has-text("Auction")',
      '[class*="dashboard"]',
      '[class*="admin"]',
      'nav',
      '#main-nav',
    ];
    let dashboardFound = false;
    for (const sel of dashboardSelectors) {
      if (await page.locator(sel).count() > 0) {
        dashboardFound = true;
        break;
      }
    }
    if (!dashboardFound) {
      await takeErrorScreenshot(page, 'login-failed');
      throw new Error('Login did not succeed — screenshot saved. Check your DOA_EMAIL / DOA_PASSWORD in .env');
    }
    log.success('Logged into DOA sub-admin (SPA — no URL change detected)');
  }
}

// ── Navigate to Auction Edit Page ─────────────────────────────────────────────

async function goToAuctionPage(page) {
  log.info(`Navigating to auction page… (${DOA_AUCTION_SLUG})`);
  await page.goto(AUCTION_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2000); // Let dynamic content settle
  log.success(`On auction edit page: ${AUCTION_URL}`);
}

// ── Scan for existing lot titles ──────────────────────────────────────────────

/**
 * getExistingTitles(page)
 * Reads all visible lot titles from the page to detect duplicates.
 * Returns a Set of title strings (lowercased for comparison).
 */
async function getExistingTitles(page) {
  const titleSelectors = [
    '.lot-title',
    '.item-title',
    '[class*="lot"] [class*="title"]',
    'td.title',
    '.lot-name',
    'h3.lot',
  ];

  const titles = new Set();
  for (const sel of titleSelectors) {
    const elements = await page.locator(sel).allTextContents();
    for (const t of elements) {
      if (t.trim()) titles.add(t.trim().toLowerCase());
    }
  }

  log.info(`Found ${titles.size} existing lot title(s) on the page`);
  return titles;
}

// ── Add a single lot ──────────────────────────────────────────────────────────

/**
 * addLot(page, lot, localImagePaths, existingTitles)
 * Clicks the Add Lot button, fills the form, uploads images, and saves.
 * Returns 'skipped' if the title already exists, 'success' on success, throws on failure.
 */
async function addLot(page, lot, localImagePaths, existingTitles) {
  const titleLower = (lot.title || '').trim().toLowerCase();

  // Duplicate check
  if (existingTitles.has(titleLower)) {
    log.warn(`Lot #${lot.lot_number} "${lot.title}" already exists on page — skipping`);
    return 'skipped';
  }

  // ── Click "Add Lot" / "New Lot" / "+" button ──────────────────────────────
  const addButtonSelectors = [
    'button:has-text("Add Lot")',
    'button:has-text("New Lot")',
    'button:has-text("Add Item")',
    'a:has-text("Add Lot")',
    'a:has-text("New Lot")',
    'button[title*="Add"]',
    'button.add-lot',
    '#addLot',
    '#newLot',
    'button:has-text("+")',
    '[data-action="add-lot"]',
  ];

  let addClicked = false;
  for (const sel of addButtonSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.click();
      log.info(`  Clicked add-lot button: ${sel}`);
      addClicked = true;
      break;
    }
  }

  if (!addClicked) {
    await takeErrorScreenshot(page, `lot${lot.lot_number}-no-add-button`);
    throw new Error(`Could not find an "Add Lot" button for lot #${lot.lot_number}`);
  }

  // Wait for the lot form to appear
  const formSelectors = [
    'form',
    '[class*="modal"]',
    '[class*="dialog"]',
    '[role="dialog"]',
    '.lot-form',
    '#lotForm',
  ];
  let formFound = false;
  for (const sel of formSelectors) {
    try {
      await page.locator(sel).first().waitFor({ state: 'visible', timeout: 10_000 });
      log.info(`  Lot form appeared: ${sel}`);
      formFound = true;
      break;
    } catch {
      // Try next selector
    }
  }
  if (!formFound) {
    // Maybe the form is inline — just continue and try to find the fields
    log.warn(`  Could not confirm form appeared — proceeding anyway`);
  }

  // ── Fill Title ────────────────────────────────────────────────────────────
  const titleSelectors = [
    'input[name="title"]',
    'input[name="lot_title"]',
    'input[name="name"]',
    'input[placeholder*="title" i]',
    'input[placeholder*="name" i]',
    'input[id*="title"]',
    'input[id*="lot"]',
    '.lot-form input[type="text"]:first-of-type',
  ];

  let titleFilled = false;
  for (const sel of titleSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.fill(lot.title || '');
      log.info(`  Filled title: "${lot.title}"`);
      titleFilled = true;
      break;
    }
  }
  if (!titleFilled) {
    await takeErrorScreenshot(page, `lot${lot.lot_number}-no-title-field`);
    throw new Error(`Could not find title input for lot #${lot.lot_number}`);
  }

  // ── Fill Description ──────────────────────────────────────────────────────
  const descSelectors = [
    'textarea[name="description"]',
    'textarea[name="desc"]',
    'textarea[name="body"]',
    'textarea[id*="description"]',
    'textarea[placeholder*="description" i]',
    '.lot-form textarea',
    'textarea',
  ];

  let descFilled = false;
  for (const sel of descSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.fill(lot.description || '');
      log.info(`  Filled description (${(lot.description || '').length} chars)`);
      descFilled = true;
      break;
    }
  }
  if (!descFilled) {
    log.warn(`  No description field found for lot #${lot.lot_number} — continuing`);
  }

  // ── Upload Images ─────────────────────────────────────────────────────────
  if (localImagePaths && localImagePaths.length > 0) {
    const uploadSelectors = [
      'input[type="file"]',
      'input[name*="image"]',
      'input[name*="photo"]',
      'input[accept*="image"]',
      '[data-upload]',
    ];

    let uploaded = false;
    for (const sel of uploadSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        try {
          await el.setInputFiles(localImagePaths);
          log.info(`  Uploaded ${localImagePaths.length} image(s)`);

          // Wait up to 30s for upload confirmation (spinner disappear, preview appear, etc.)
          const confirmSelectors = [
            '.upload-success',
            '.image-preview',
            '[class*="thumb"]',
            '[class*="preview"]',
            '.uploaded',
          ];
          let confirmed = false;
          for (const cSel of confirmSelectors) {
            try {
              await page.locator(cSel).first().waitFor({ state: 'visible', timeout: 30_000 });
              log.success(`  Upload confirmed: ${cSel}`);
              confirmed = true;
              break;
            } catch {
              // Try next
            }
          }
          if (!confirmed) {
            log.warn('  Could not confirm image upload — waiting 5s before saving');
            await page.waitForTimeout(5000);
          }

          uploaded = true;
          break;
        } catch (uploadErr) {
          log.warn(`  Image upload attempt failed with ${sel}: ${uploadErr.message}`);
        }
      }
    }

    if (!uploaded) {
      log.warn(`  Could not upload images for lot #${lot.lot_number} — saving without images`);
    }
  } else {
    log.info(`  No images for lot #${lot.lot_number}`);
  }

  // ── Click Save / Next / Submit ────────────────────────────────────────────
  const saveSelectors = [
    'button[type="submit"]',
    'button:has-text("Save")',
    'button:has-text("Next")',
    'button:has-text("Submit")',
    'button:has-text("Add")',
    'input[type="submit"]',
    '[data-action="save"]',
    '.btn-save',
    '.btn-primary',
    '#saveBtn',
    '#submitBtn',
  ];

  let saved = false;
  for (const sel of saveSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0 && await btn.isEnabled()) {
      await btn.click();
      log.info(`  Clicked save button: ${sel}`);
      saved = true;
      break;
    }
  }

  if (!saved) {
    await takeErrorScreenshot(page, `lot${lot.lot_number}-no-save-button`);
    throw new Error(`Could not find a Save/Next button for lot #${lot.lot_number}`);
  }

  // Wait for the form to close or page to update
  await page.waitForTimeout(3000);

  // Add the title to our known set so we don't double-check DOA on next lot
  existingTitles.add(titleLower);

  return 'success';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * runDoaAgent(lots, options, callbacks)
 *
 * @param {Object[]} lots       - Array of normalized lot objects from Supabase
 * @param {Object}   options    - { dryRun: false, testMode: false }
 * @param {Object}   callbacks  - { onStart, onSuccess, onFailure, onSkip }
 *   onStart(lot)    - called before processing a lot (use to set status=in_progress)
 *   onSuccess(lot)  - called after successful listing
 *   onFailure(lot, err) - called on error
 *   onSkip(lot)     - called when lot is skipped (duplicate)
 *
 * @returns {{ succeeded: number, failed: number, skipped: number }}
 */
export async function runDoaAgent(lots, options = {}, callbacks = {}) {
  const { onStart, onSuccess, onFailure, onSkip } = callbacks;

  let browser = null;
  let page    = null;
  let succeeded = 0;
  let failed    = 0;
  let skipped   = 0;

  try {
    // ── Launch browser ──────────────────────────────────────────────────────
    log.section('Launching Chromium Browser (headed mode)');
    browser = await chromium.launch({
      headless: false,        // ← You will see the browser window
      slowMo:   100,          // Slight delay between actions — easier to watch
      args: ['--start-maximized'],
    });

    const context = await browser.newContext({
      viewport: null,         // Use the full window size
      acceptDownloads: true,
    });
    page = await context.newPage();

    // ── Login ───────────────────────────────────────────────────────────────
    await doLogin(page);

    // ── Go to auction edit page ─────────────────────────────────────────────
    await goToAuctionPage(page);

    // ── Scan for existing lots (to skip duplicates) ─────────────────────────
    const existingTitles = await getExistingTitles(page);

    // ── Process each lot ────────────────────────────────────────────────────
    log.section(`Processing ${lots.length} lot(s)`);

    for (const lot of lots) {
      log.info(`\nProcessing Lot #${lot.lot_number}: "${lot.title}"`);

      // Notify caller (used to update Supabase status to in_progress)
      if (onStart) await onStart(lot);

      let localImagePaths = [];
      try {
        // Download images first
        if (lot.images && lot.images.length > 0) {
          localImagePaths = await downloadImages(lot.images, lot.lot_number);
        }

        // Add the lot to DOA
        const result = await addLot(page, lot, localImagePaths, existingTitles);

        if (result === 'skipped') {
          skipped++;
          if (onSkip) await onSkip(lot);
        } else {
          succeeded++;
          log.success(`Lot #${lot.lot_number} "${lot.title}" listed successfully`);
          if (onSuccess) await onSuccess(lot);
        }

      } catch (err) {
        failed++;
        log.error(`Lot #${lot.lot_number} "${lot.title}" FAILED`, err);
        await takeErrorScreenshot(page, `lot${lot.lot_number}`);
        if (onFailure) await onFailure(lot, err);

      } finally {
        // Always clean up temp images for this lot
        if (localImagePaths.length > 0) {
          await cleanupImages(localImagePaths);
        }
      }
    }

  } catch (fatalErr) {
    log.error('Fatal browser error — agent stopping early', fatalErr);
    if (page) await takeErrorScreenshot(page, 'fatal');
    // Re-throw so the caller can handle it in the summary
    throw fatalErr;

  } finally {
    if (browser) {
      log.info('Closing browser…');
      await browser.close();
    }
  }

  return { succeeded, failed, skipped };
}
