/**
 * uploader.js — DOA Bulk Upload Agent · Phase 4
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4: Opens DOA Bulk Image Uploader, uploads the sequenced files
 *          (barcodes interleaved with photos), waits for all uploads to
 *          complete, then clicks "Process Uploaded Images".
 *
 * The "Process Uploaded Images" button is an <a id="lnkProcess"> tag — not
 * a <button> — so it requires the #lnkProcess selector.
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SESSION_DIR = path.join(__dirname, 'browser-session');

// ── Selectors ──────────────────────────────────────────────────────────────
const LOGIN_SELECTORS = {
  email:    'input[type="email"]:visible, input[name="email"]:visible, input[name="username"]:visible',
  password: 'input[type="password"]:visible',
  submit:   'button[type="submit"]:visible, input[type="submit"]:visible',
};

const SELECTORS = {
  compressionToggle: 'input[type="checkbox"][id*="compress"], input[type="checkbox"][name*="compress"], label:has-text("Compression") input',
  aiToggle:          'input[type="checkbox"][id*="openai"], input[type="checkbox"][id*="ai"], label:has-text("OpenAI") input, label:has-text("AI") input',
  fileInput:         'input[type="file"]',
  // DOA renders this as <a id="lnkProcess"> not a <button>
  processBtn:        '#lnkProcess, a:has-text("Process Uploaded Images")',
};

// ── Helpers ────────────────────────────────────────────────────────────────
async function screenshot(page, name) {
  const p = path.join(__dirname, 'logs', 'screenshots', `${name}-${Date.now()}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  log.info(`Screenshot: ${path.basename(p)}`);
  return p;
}

async function needsLogin(page) {
  const url = page.url();
  if (url.includes('login') || url.includes('sign-in') || url.includes('signin')) return true;
  return (await page.locator('input[type="password"]').count()) > 0;
}

async function login(page, email, password) {
  log.info('Logging into DOA...');
  await page.locator(LOGIN_SELECTORS.email).first().fill(email);
  await page.locator(LOGIN_SELECTORS.password).first().fill(password);
  await page.locator(LOGIN_SELECTORS.submit).first().click();
  await page.waitForTimeout(3000);
  if (await needsLogin(page)) {
    await screenshot(page, 'login-failed');
    throw new Error('DOA login failed — check DOA_EMAIL and DOA_PASSWORD in .env');
  }
  log.success('Logged into DOA');
}

async function ensureOn(page, selector, label) {
  try {
    const el = page.locator(selector).first();
    if (await el.count() === 0) { log.warn(`${label} toggle not found — skipping`); return; }
    if (!(await el.isChecked())) { await el.check(); log.info(`${label}: turned ON`); }
    else { log.info(`${label}: already ON`); }
  } catch (err) {
    log.warn(`Could not set ${label}: ${err.message}`);
  }
}

// ── Main export ────────────────────────────────────────────────────────────
/**
 * uploadToDOA(filePaths, config)
 * Phase 4: upload files → wait for completion → click Process
 */
export async function uploadToDOA(filePaths, { email, password, loginUrl, bulkUploaderUrl }) {
  log.section('Phase 4: Upload to DOA + Click Process');
  log.info(`Files to upload: ${filePaths.length}`);

  if (!email || !password)      throw new Error('DOA_EMAIL and DOA_PASSWORD must be set in .env');
  if (!bulkUploaderUrl)         throw new Error('DOA_BULK_UPLOADER_URL must be set in .env');

  let context = null;

  try {
    context = await chromium.launchPersistentContext(SESSION_DIR, {
      headless: false,
      slowMo:   60,
      args:     ['--start-maximized'],
      viewport: null,
    });

    const page = await context.newPage();

    // Navigate to bulk uploader (DOA redirects to login if session expired)
    log.info(`Navigating to: ${bulkUploaderUrl}`);
    await page.goto(bulkUploaderUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    if (await needsLogin(page)) {
      log.info('Session expired — logging in...');
      await login(page, email, password);
      await page.goto(bulkUploaderUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    } else {
      log.info('Session valid — already on uploader page');
    }

    await screenshot(page, '4a-uploader-ready');
    log.info(`On page: ${page.url()}`);

    // Enable toggles
    await ensureOn(page, SELECTORS.compressionToggle, 'Pre-Upload Compression');
    await ensureOn(page, SELECTORS.aiToggle,          'AI Title/Description (OpenAI)');

    await screenshot(page, '4b-before-upload');

    // ── Upload files ─────────────────────────────────────────────────────
    log.info(`Uploading ${filePaths.length} files...`);
    const fileInput = page.locator(SELECTORS.fileInput).first();
    if (await fileInput.count() === 0) {
      await screenshot(page, '4-no-file-input');
      throw new Error('File input not found — DOA page layout may have changed');
    }

    await fileInput.setInputFiles(filePaths);
    log.info('Files queued — waiting for DOA upload to complete...');

    // ── Wait for uploads to finish ────────────────────────────────────────
    const deadline = Date.now() + 12 * 60 * 1000; // 12 min timeout
    let retries = 0;
    let uploadDone = false;

    while (Date.now() < deadline) {
      try {
        await page.waitForTimeout(5000);

        const uploading = await page.locator('text=/uploading/i').count();
        const failed    = await page.locator('text=Upload failed').count();
        const retryBtn  = page.locator('button:has-text("Retry"), a:has-text("Retry")').first();
        const hasRetry  = await retryBtn.count() > 0;

        if (failed > 0 && hasRetry && retries < 3) {
          retries++;
          log.warn(`Upload failure detected — retrying (attempt ${retries})...`);
          await retryBtn.click().catch(() => {});
          await page.waitForTimeout(3000).catch(() => {});
          continue;
        }

        if (uploading > 0) {
          log.info('Still uploading...');
          continue;
        }

        // No "uploading" or retry-able failures — uploads are done
        if (failed > 0) {
          log.warn('Upload finished with some failures — proceeding to Process step');
        } else {
          log.success('All files uploaded');
        }
        uploadDone = true;
        break;
      } catch (pollErr) {
        // Page navigated or closed during polling — treat as upload complete
        log.warn(`Upload poll interrupted (${pollErr.message}) — proceeding to Process step`);
        uploadDone = true;
        break;
      }
    }

    if (!uploadDone) {
      log.warn('Upload wait timed out — proceeding to Process step anyway');
    }

    await screenshot(page, '4c-uploads-done').catch(() => {});

    // ── Click "Process Uploaded Images" ──────────────────────────────────
    log.info('Clicking "Process Uploaded Images"...');
    let processClicked = false;
    try {
      const processBtn = page.locator(SELECTORS.processBtn).first();

      if (await processBtn.count() > 0) {
        await processBtn.click();
        await page.waitForTimeout(4000).catch(() => {});
        log.success('Clicked "Process Uploaded Images" — DOA is now processing');
        await screenshot(page, '4d-processing-started').catch(() => {});
        processClicked = true;
      } else {
        await screenshot(page, '4d-no-process-button').catch(() => {});
        log.warn('"Process Uploaded Images" button not found — check screenshot');
        log.warn('You may need to click it manually in the open browser window.');
        await page.waitForTimeout(30000).catch(() => {}); // give user 30s to click manually
      }
    } catch (btnErr) {
      log.warn(`Process button click failed (${btnErr.message}) — page may have already advanced`);
    }

    const lotsProcessed = filePaths.filter(f => f.includes('barcodes')).length;
    log.success(`Phase 4 complete — ${lotsProcessed} lots sent to DOA (process button ${processClicked ? 'clicked' : 'not found — manual click needed'})`);
    return { success: uploadDone, lotsProcessed };

  } catch (err) {
    log.error('DOA uploader failed', err);
    return { success: false, lotsProcessed: 0 };
  } finally {
    if (context) {
      await new Promise(r => setTimeout(r, 5000)); // brief pause before closing
      await context.close().catch(() => {});
    }
  }
}
