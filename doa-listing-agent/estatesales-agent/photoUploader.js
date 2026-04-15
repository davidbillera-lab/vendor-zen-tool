/**
 * photoUploader.js — EstateSales Agent · Agent 3
 * ─────────────────────────────────────────────────────────────────────────────
 * Single responsibility: Upload all downloaded lot images to the estatesales.net
 * listing editor, one at a time, in lot number order.
 *
 * Does NOT fill descriptions — that is Agent 4 (describer.js).
 *
 * After each successful upload, lots.json is updated with `uploadedAt` so that
 * if this run is interrupted, re-running skips already-uploaded photos.
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SESSION_DIR            = path.join(__dirname, 'browser-session');
const ESTATESALES_SIGNIN_URL = 'https://www.estatesales.net/sign-in';

// ── Selectors ─────────────────────────────────────────────────────────────────
// These will be refined after first run if estatesales.net uses different names.
const UPLOAD_SELECTORS = {
  fileInput:  'input[type="file"]',
  uploadZone: '.dropzone, .photo-upload-area, [data-testid="photo-upload"], .upload-photos-area, .add-photo',
  uploadBtn:  'button:has-text("Add Photo"), button:has-text("Upload Photo"), button:has-text("Add Photos"), label:has-text("Add Photo")',
};

const LOGIN_SELECTORS = {
  email:    '#email, input[name="email"], input[type="email"]',
  password: '#password, input[name="password"], input[type="password"]',
  submit:   'button.mat-primary[type="submit"], button[type="submit"]:has-text("Sign In"), button[type="submit"]:has-text("Log In")',
};

// ── Auth helpers ──────────────────────────────────────────────────────────────
async function needsLogin(page) {
  const url = page.url();
  return url.includes('sign-in') || url.includes('login');
}

async function login(page, email, password) {
  log.info('Session expired — logging into estatesales.net...');
  await page.goto(ESTATESALES_SIGNIN_URL, { waitUntil: 'networkidle', timeout: 60000 });

  // Wait for the email field to be visible (Angular may take time to render the form)
  await page.locator(LOGIN_SELECTORS.email).first().waitFor({ state: 'visible', timeout: 30000 });

  await page.locator(LOGIN_SELECTORS.email).first().fill(email);
  await page.locator(LOGIN_SELECTORS.password).first().fill(password);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);

  if (await needsLogin(page)) {
    const screenshotPath = path.join(__dirname, 'logs', 'screenshots', `login-fail-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    throw new Error(`Login failed — still on sign-in page. Check ESTATESALES_EMAIL / ESTATESALES_PASSWORD in .env. Screenshot: ${screenshotPath}`);
  }
  log.success('Logged in to estatesales.net');
}

// ── Core upload logic ─────────────────────────────────────────────────────────
/**
 * uploadPhotos(listingUrl, lots, credentials, onProgress)
 *
 * @param {string} listingUrl - estatesales.net listing editor URL (photos tab)
 * @param {Array}  lots       - lot objects from lots.json, already sorted by lotNumber
 * @param {object} credentials - { email, password }
 * @param {Function} onProgress - optional callback(lot) called after each successful upload
 * @returns {{ succeeded: number, failed: number }}
 */
export async function uploadPhotos(listingUrl, lots, { email, password }, onProgress = null) {
  log.section('Agent 3: Photo Uploader');

  const toUpload = lots.filter(l => l.imagePath && !l.uploadedAt);
  const alreadyDone = lots.filter(l => l.uploadedAt).length;

  if (alreadyDone > 0) log.info(`Skipping ${alreadyDone} already-uploaded photos`);
  log.info(`Uploading ${toUpload.length} photos in lot order...`);

  if (toUpload.length === 0) {
    log.info('All photos already uploaded — skipping Agent 3');
    return { succeeded: 0, failed: 0 };
  }

  let context = null;
  let succeeded = 0;
  let failed = 0;

  try {
    const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
    context = await chromium.launchPersistentContext(SESSION_DIR, {
      headless: isCI,
      slowMo: isCI ? 0 : 80,
      args: isCI ? [] : ['--start-maximized'],
      viewport: isCI ? { width: 1280, height: 720 } : null,
    });

    const page = await context.newPage();

    log.info('Navigating to listing photos page...');
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    if (await needsLogin(page)) {
      await login(page, email, password);
      await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    } else {
      log.info('Session valid — skipping login');
    }

    // Screenshot to show what the editor looks like
    const editorShot = path.join(__dirname, 'logs', 'screenshots', `uploader-start-${Date.now()}.png`);
    await page.screenshot({ path: editorShot }).catch(() => {});
    log.info(`Editor screenshot: ${editorShot}`);

    for (const lot of toUpload) {
      log.info(`Uploading lot ${lot.lotNumber}: ${path.basename(lot.imagePath)}`);

      try {
        // Try to find and click the "Add Photo" button first to reveal file input
        for (const sel of [UPLOAD_SELECTORS.uploadBtn, UPLOAD_SELECTORS.uploadZone]) {
          try {
            const el = page.locator(sel).first();
            if (await el.count() > 0) {
              await el.click();
              await page.waitForTimeout(800);
              break;
            }
          } catch { /* try next */ }
        }

        // Attach the file
        const fileInput = page.locator(UPLOAD_SELECTORS.fileInput).first();
        if (await fileInput.count() === 0) {
          throw new Error('No file input found on page — estatesales.net UI may have changed');
        }
        await fileInput.setInputFiles(lot.imagePath);
        await page.waitForTimeout(2500); // Wait for upload to process

        // Mark as uploaded in the lot object
        lot.uploadedAt = new Date().toISOString();
        succeeded++;

        if (onProgress) onProgress(lot);
        log.success(`Uploaded lot ${lot.lotNumber}`);

      } catch (err) {
        log.error(`Failed to upload lot ${lot.lotNumber}: ${err.message}`);
        const failShot = path.join(__dirname, 'logs', 'screenshots', `upload-fail-${lot.lotNumber}-${Date.now()}.png`);
        await page.screenshot({ path: failShot }).catch(() => {});
        failed++;
      }
    }

    // Final screenshot
    const doneShot = path.join(__dirname, 'logs', 'screenshots', `uploader-done-${Date.now()}.png`);
    await page.screenshot({ path: doneShot }).catch(() => {});

    log.success(`Agent 3 complete: ${succeeded} uploaded, ${failed} failed`);
    return { succeeded, failed };

  } catch (err) {
    log.error('Photo uploader crashed', err);
    return { succeeded, failed: toUpload.length - succeeded };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
