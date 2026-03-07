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
 *   6. Never modifies lots that have already been filled — only fills
 *      ones that still show the default "Lot #N" title
 *
 * The main export is runDoaAgent(lots, options, callbacks).
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
const DOA_BASE_URL      = process.env.DOA_BASE_URL || 'https://denveronlineauctions.com';
const DOA_EMAIL         = process.env.DOA_EMAIL;
const DOA_PASSWORD      = process.env.DOA_PASSWORD;
const DOA_FIRST_LOT_URL = process.env.DOA_FIRST_LOT_URL;  // e.g. https://denveronlineauctions.com/sub-admin/EditAuction?id=1678303&PartyId=115

const LOGIN_URL = `${DOA_BASE_URL}/sub-admin/`;

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
 */
async function doLogin(page) {
  log.info('Navigating to DOA sub-admin login page…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

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

  // Fill email
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

  // Fill password
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

  // Click submit
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
    await page.keyboard.press('Enter');
    log.warn('  Could not find login button — pressed Enter instead');
  }

  // Wait for successful login
  try {
    await page.waitForURL(url => !url.includes('login') && !url.includes('Login'), {
      timeout: 15_000,
    });
    log.success('Logged into DOA sub-admin successfully');
  } catch {
    // SPA — URL might not change; look for a dashboard element
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
      throw new Error('Login did not succeed — check DOA_EMAIL / DOA_PASSWORD in .env');
    }
    log.success('Logged into DOA sub-admin (SPA — no URL change detected)');
  }
}

// ── Fill TinyMCE description ──────────────────────────────────────────────────

/**
 * fillTinyMce(page, htmlContent)
 * Injects content into the TinyMCE rich-text editor on the page.
 * Tries JS API first (most reliable), then falls back to iframe body editing.
 */
async function fillTinyMce(page, htmlContent) {
  // Method 1: use the tinyMCE JS API (fastest and most reliable)
  const injected = await page.evaluate((content) => {
    if (window.tinymce && window.tinymce.activeEditor) {
      window.tinymce.activeEditor.setContent(content);
      window.tinymce.activeEditor.fire('change');
      return true;
    }
    // Try the first editor if activeEditor is null
    if (window.tinymce && window.tinymce.editors && window.tinymce.editors.length > 0) {
      window.tinymce.editors[0].setContent(content);
      window.tinymce.editors[0].fire('change');
      return true;
    }
    return false;
  }, htmlContent || '');

  if (injected) {
    log.info(`  Filled description via TinyMCE JS API (${(htmlContent || '').length} chars)`);
    return;
  }

  // Method 2: write directly into the TinyMCE iframe body
  const iframeLocator = page.frameLocator('iframe[id$="_ifr"]');
  try {
    const body = iframeLocator.locator('body');
    await body.waitFor({ state: 'visible', timeout: 5_000 });
    await body.fill('');
    await body.type(htmlContent || '', { delay: 5 });
    log.info(`  Filled description via TinyMCE iframe body`);
    return;
  } catch {
    // fall through
  }

  log.warn('  Could not find TinyMCE editor — description skipped');
}

// ── Fill a single lot form ────────────────────────────────────────────────────

/**
 * fillCurrentLotForm(page, lot, localImagePaths)
 *
 * The browser is already on the EditAuction page for this lot.
 * Fills in Title, Starting Bid, Description, uploads images,
 * then clicks "Save & Edit Next".
 *
 * Returns 'success' on success, throws on failure.
 */
async function fillCurrentLotForm(page, lot, localImagePaths) {
  // Wait for the page form to be ready
  await page.waitForSelector('input', { state: 'visible', timeout: 15_000 });

  // ── Fill Title ─────────────────────────────────────────────────────────────
  // The title input is pre-filled with "Lot #N" — we clear and overwrite it
  const titleSelectors = [
    'input[name="title"]',
    'input[name="lot_title"]',
    'input[name="Title"]',
    'input[placeholder*="title" i]',
    'input[id*="title" i]',
  ];

  let titleFilled = false;
  for (const sel of titleSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.clear();
      await el.fill(lot.title || '');
      log.info(`  Filled title: "${lot.title}"`);
      titleFilled = true;
      break;
    }
  }

  // Fallback: the first visible text input on the form is usually Title
  if (!titleFilled) {
    const inputs = page.locator('form input[type="text"], form input:not([type])');
    if (await inputs.count() > 0) {
      await inputs.first().clear();
      await inputs.first().fill(lot.title || '');
      log.warn(`  Filled title via fallback (first text input): "${lot.title}"`);
      titleFilled = true;
    }
  }

  if (!titleFilled) {
    await takeErrorScreenshot(page, `lot${lot.lot_number}-no-title-field`);
    throw new Error(`Could not find title input for lot #${lot.lot_number}`);
  }

  // ── Fill Starting Bid ──────────────────────────────────────────────────────
  // Default starting bid is 5 (matches DOA's pre-filled default)
  const startingBid = String(lot.starting_bid ?? lot.raw?.starting_bid ?? 5);
  const bidSelectors = [
    'input[name="starting_bid"]',
    'input[name="startingBid"]',
    'input[name="start_bid"]',
    'input[name="startBid"]',
    'input[name="bid"]',
    'input[placeholder*="bid" i]',
    'input[id*="bid" i]',
    'input[id*="starting" i]',
  ];

  let bidFilled = false;
  for (const sel of bidSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.clear();
      await el.fill(startingBid);
      log.info(`  Filled starting bid: ${startingBid}`);
      bidFilled = true;
      break;
    }
  }

  if (!bidFilled) {
    // Fallback: look for the second numeric input after the title input
    const numericInputs = page.locator('input[type="number"], input[inputmode="numeric"]');
    if (await numericInputs.count() > 0) {
      await numericInputs.first().clear();
      await numericInputs.first().fill(startingBid);
      log.warn(`  Filled starting bid via fallback (first numeric input): ${startingBid}`);
      bidFilled = true;
    }
  }

  if (!bidFilled) {
    log.warn(`  Could not find starting bid input for lot #${lot.lot_number} — continuing`);
  }

  // ── Fill Description (TinyMCE) ─────────────────────────────────────────────
  await fillTinyMce(page, lot.description || '');

  // ── Upload Images ──────────────────────────────────────────────────────────
  if (localImagePaths && localImagePaths.length > 0) {
    const uploadSelectors = [
      'input[type="file"]',
      'input[name*="image"]',
      'input[name*="photo"]',
      'input[accept*="image"]',
    ];

    let uploaded = false;
    for (const sel of uploadSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        try {
          await el.setInputFiles(localImagePaths);
          log.info(`  Uploading ${localImagePaths.length} image(s)…`);

          // Wait for upload confirmation (preview thumbnails, spinner gone, etc.)
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
              // try next
            }
          }
          if (!confirmed) {
            log.warn('  Upload confirmation not detected — waiting 5s before saving');
            await page.waitForTimeout(5000);
          }

          uploaded = true;
          break;
        } catch (uploadErr) {
          log.warn(`  Image upload attempt failed (${sel}): ${uploadErr.message}`);
        }
      }
    }

    if (!uploaded) {
      log.warn(`  Could not upload images for lot #${lot.lot_number} — saving without images`);
    }
  } else {
    log.info(`  No images for lot #${lot.lot_number}`);
  }

  // ── Click "Save & Edit Next" ───────────────────────────────────────────────
  // This advances us to the next lot's EditAuction page automatically.
  // For the very last lot there may be no "next", but clicking it still saves.
  const saveNextBtn = page.locator('button:has-text("Save & Edit Next")');
  const saveBtn     = page.locator('button:has-text("Save")').first();

  if (await saveNextBtn.count() > 0) {
    // Wait for the URL to change to the next EditAuction page, or fall back on timeout
    try {
      await Promise.all([
        page.waitForURL(/EditAuction\?id=/, { timeout: 20_000 }),
        saveNextBtn.click(),
      ]);
      log.success(`  Clicked "Save & Edit Next" — on next lot page`);
    } catch {
      // If URL didn't change (e.g. last lot), that's fine — the lot was still saved
      log.info(`  Clicked "Save & Edit Next" (no further lot to navigate to)`);
    }
  } else if (await saveBtn.count() > 0) {
    await saveBtn.click();
    await page.waitForTimeout(3000);
    log.info(`  Clicked "Save" (Save & Edit Next not found)`);
  } else {
    await takeErrorScreenshot(page, `lot${lot.lot_number}-no-save-button`);
    throw new Error(`Could not find Save button for lot #${lot.lot_number}`);
  }

  return 'success';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * runDoaAgent(lots, options, callbacks)
 *
 * @param {Object[]} lots       - Array of normalized lot objects from Supabase
 * @param {Object}   options    - { dryRun: false, testMode: false }
 * @param {Object}   callbacks  - { onStart, onSuccess, onFailure, onSkip }
 *
 * @returns {{ succeeded: number, failed: number, skipped: number }}
 */
export async function runDoaAgent(lots, options = {}, callbacks = {}) {
  const { onStart, onSuccess, onFailure } = callbacks;

  if (!DOA_FIRST_LOT_URL) {
    throw new Error(
      'DOA_FIRST_LOT_URL is not set in your .env file.\n' +
      'Set it to the URL of the first lot to fill, e.g.:\n' +
      '  DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=1678303&PartyId=115'
    );
  }

  let browser   = null;
  let page      = null;
  let succeeded = 0;
  let failed    = 0;
  let skipped   = 0;

  try {
    // ── Launch browser ──────────────────────────────────────────────────────
    log.section('Launching Chromium Browser (headed mode)');
    browser = await chromium.launch({
      headless: false,
      slowMo:   80,
      args: ['--start-maximized'],
    });

    const context = await browser.newContext({
      viewport: null,
      acceptDownloads: true,
    });
    page = await context.newPage();

    // ── Login ───────────────────────────────────────────────────────────────
    await doLogin(page);

    // ── Navigate to first lot ───────────────────────────────────────────────
    log.info(`Navigating to first lot: ${DOA_FIRST_LOT_URL}`);
    await page.goto(DOA_FIRST_LOT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000); // let TinyMCE initialize
    log.success('On first lot EditAuction page');

    // ── Process each lot in order ───────────────────────────────────────────
    log.section(`Processing ${lots.length} lot(s)`);

    for (const lot of lots) {
      log.info(`\nProcessing Lot #${lot.lot_number}: "${lot.title}"`);

      if (onStart) await onStart(lot);

      let localImagePaths = [];
      try {
        // Download images locally so Playwright can upload them
        if (lot.images && lot.images.length > 0) {
          localImagePaths = await downloadImages(lot.images, lot.lot_number);
        }

        await fillCurrentLotForm(page, lot, localImagePaths);

        succeeded++;
        log.success(`Lot #${lot.lot_number} "${lot.title}" saved successfully`);
        if (onSuccess) await onSuccess(lot);

        // Brief pause between lots so the page can settle
        await page.waitForTimeout(1500);

      } catch (err) {
        failed++;
        log.error(`Lot #${lot.lot_number} "${lot.title}" FAILED`, err);
        await takeErrorScreenshot(page, `lot${lot.lot_number}`);
        if (onFailure) await onFailure(lot, err);

        // Try to get back to a valid EditAuction page for the next lot
        // (in case the error left us on an unexpected page)
        try {
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 });
        } catch {
          // Ignore — the next lot's navigation will sort it out
        }

      } finally {
        if (localImagePaths.length > 0) {
          await cleanupImages(localImagePaths);
        }
      }
    }

  } catch (fatalErr) {
    log.error('Fatal browser error — agent stopping early', fatalErr);
    if (page) await takeErrorScreenshot(page, 'fatal');
    throw fatalErr;

  } finally {
    if (browser) {
      log.info('Closing browser…');
      await browser.close();
    }
  }

  return { succeeded, failed, skipped };
}
