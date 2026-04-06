/**
 * describer.js — EstateSales Agent · Agent 4
 * ─────────────────────────────────────────────────────────────────────────────
 * Single responsibility: Fill in the description for each uploaded photo.
 *
 * How estatesales.net actually works (confirmed by DOM inspection):
 *   1. Click a photo image → toolbar appears
 *   2. Click the "Description" toolbar button → dialog opens (Picture N)
 *   3. Type the description in the text input
 *   4. Click "Next" → dialog advances to next photo automatically
 *   5. Repeat fill → Next until all photos are described
 *
 * Resume-safe: lots.json tracks `descriptionFilled: true` per lot.
 * If a run is interrupted, re-running clicks the first un-filled photo to resume.
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SESSION_DIR            = path.join(__dirname, 'browser-session');
const ESTATESALES_SIGNIN_URL = 'https://www.estatesales.net/sign-in';

// ── Selectors (confirmed by DOM inspection) ───────────────────────────────────
// Photo images on the listing page (index 0 is logo, photos start at index 1)
const PHOTO_IMG_SELECTOR     = 'img[src*="picturescdn.estatesales.net"]';
// Toolbar button that opens the description dialog (appears after clicking a photo)
const DESCRIPTION_BTN        = 'button[title="Description"]';
// Text input inside the description dialog
const DESCRIPTION_INPUT      = 'mat-dialog-container input.mat-input-element, [role="dialog"] input[type="text"]';
// Next button inside the dialog
const NEXT_BTN               = 'mat-dialog-container button:has-text("Next"), [role="dialog"] button:has-text("Next")';

const LOGIN_SELECTORS = {
  email:    '#email, input[name="email"], input[type="email"]',
  password: '#password, input[name="password"], input[type="password"]',
};

// ── Auth helpers ──────────────────────────────────────────────────────────────
async function needsLogin(page) {
  const url = page.url();
  return url.includes('sign-in') || url.includes('login');
}

async function login(page, email, password) {
  log.info('Session expired — logging into estatesales.net...');
  await page.goto(ESTATESALES_SIGNIN_URL, { waitUntil: 'networkidle', timeout: 60000 });

  await page.locator(LOGIN_SELECTORS.email).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.locator(LOGIN_SELECTORS.email).first().fill(email);
  await page.locator(LOGIN_SELECTORS.password).first().fill(password);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);

  if (await needsLogin(page)) {
    throw new Error('Login failed — check ESTATESALES_EMAIL / ESTATESALES_PASSWORD in .env');
  }
  log.success('Logged in to estatesales.net');
}

// ── Core description loop ─────────────────────────────────────────────────────
/**
 * fillDescriptions(listingUrl, lots, credentials, onProgress)
 *
 * @param {string}   listingUrl  - estatesales.net listing editor URL (photos tab)
 * @param {Array}    lots        - lot objects sorted by lotNumber
 * @param {object}   credentials - { email, password }
 * @param {Function} onProgress  - optional callback(lot) after each description saved
 * @returns {{ succeeded: number, failed: number }}
 */
export async function fillDescriptions(listingUrl, lots, { email, password }, onProgress = null) {
  log.section('Agent 4: Description Filler');

  // Only process lots that were successfully uploaded
  const uploadedLots = lots
    .filter(l => l.uploadedAt)
    .sort((a, b) => a.lotNumber - b.lotNumber);

  const alreadyFilled = uploadedLots.filter(l => l.descriptionFilled).length;
  const toFill = uploadedLots.filter(l => !l.descriptionFilled);

  if (alreadyFilled > 0) {
    log.info(`Resuming: ${alreadyFilled} already described, starting from photo ${alreadyFilled + 1}`);
  }
  log.info(`Filling descriptions for ${toFill.length} photos...`);

  if (toFill.length === 0) {
    log.info('All descriptions already filled — skipping Agent 4');
    return { succeeded: 0, failed: 0 };
  }

  let context = null;
  let succeeded = 0;
  let failed = 0;

  try {
    context = await chromium.launchPersistentContext(SESSION_DIR, {
      headless: false,
      slowMo: 80,
      args: ['--start-maximized'],
      viewport: null,
    });

    const page = await context.newPage();

    log.info('Navigating to listing photos page...');
    await page.goto(listingUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    if (await needsLogin(page)) {
      await login(page, email, password);
      await page.goto(listingUrl, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2000);
    } else {
      log.info('Session valid — skipping login');
    }

    // ── Open description dialog on the first un-filled photo ──────────────
    // Photos are at PHOTO_IMG_SELECTOR index 0, 1, 2, ...
    // alreadyFilled tells us which index to start at.
    const photoCount = await page.locator(PHOTO_IMG_SELECTOR).count();
    log.info(`Found ${photoCount} photos on page. Starting at photo index ${alreadyFilled}.`);

    if (photoCount === 0) {
      const shot = path.join(__dirname, 'logs', 'screenshots', `no-photos-${Date.now()}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      log.error(`No photos found on page. Screenshot: ${shot}`);
      return { succeeded: 0, failed: toFill.length };
    }

    // Click the target photo to select it
    const targetPhoto = page.locator(PHOTO_IMG_SELECTOR).nth(alreadyFilled);
    await targetPhoto.scrollIntoViewIfNeeded();
    await targetPhoto.click();
    await page.waitForTimeout(1500);

    // Click the Description button in the toolbar
    const descBtn = page.locator(DESCRIPTION_BTN);
    await descBtn.waitFor({ state: 'visible', timeout: 10000 });
    await descBtn.click();
    await page.waitForTimeout(2000);

    // Confirm dialog opened
    const dialogInput = page.locator(DESCRIPTION_INPUT);
    await dialogInput.waitFor({ state: 'visible', timeout: 10000 });
    log.info('Description dialog opened. Starting fill loop...');

    const editorShot = path.join(__dirname, 'logs', 'screenshots', `editor-open-${Date.now()}.png`);
    await page.screenshot({ path: editorShot }).catch(() => {});
    log.info(`Dialog screenshot: ${editorShot}`);

    // ── Fill → Next loop ──────────────────────────────────────────────────
    for (const lot of toFill) {
      log.info(`Lot ${lot.lotNumber}: "${lot.title.slice(0, 60)}"`);

      try {
        // Clear and fill the description input
        await dialogInput.waitFor({ state: 'visible', timeout: 8000 });
        await dialogInput.clear();
        await dialogInput.fill(lot.title);
        await page.waitForTimeout(400);

        // Click Next to save and advance
        const nextBtn = page.locator(NEXT_BTN);
        await nextBtn.waitFor({ state: 'visible', timeout: 8000 });
        await nextBtn.click();
        await page.waitForTimeout(1200);

        lot.descriptionFilled = true;
        succeeded++;
        if (onProgress) onProgress(lot);
        log.success(`Lot ${lot.lotNumber} described ✓`);

      } catch (err) {
        log.error(`Failed on lot ${lot.lotNumber}: ${err.message}`);
        const shot = path.join(__dirname, 'logs', 'screenshots', `fail-lot${lot.lotNumber}-${Date.now()}.png`);
        await page.screenshot({ path: shot }).catch(() => {});
        // Attempt to advance so we don't get stuck
        await page.locator(NEXT_BTN).click().catch(() => {});
        await page.waitForTimeout(1200);
        failed++;
      }
    }

    const doneShot = path.join(__dirname, 'logs', 'screenshots', `describer-done-${Date.now()}.png`);
    await page.screenshot({ path: doneShot }).catch(() => {});
    log.info(`Final screenshot: ${doneShot}`);

    log.success(`Agent 4 complete: ${succeeded} described, ${failed} failed`);
    return { succeeded, failed };

  } catch (err) {
    log.error('Description filler crashed', err.message);
    return { succeeded, failed: toFill.length - succeeded };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
