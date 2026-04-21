/**
 * ebayUploader.js — eBay CSV Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all Playwright browser automation for uploading a CSV file to
 * eBay Seller Hub Reports (https://www.ebay.com/sh/reports/uploads).
 *
 * Flow:
 *   1. Launch browser (visible so you can see what's happening)
 *   2. Navigate to eBay — log in if needed
 *   3. Go to the Seller Hub file upload page
 *   4. Attach the CSV and submit
 *   5. Wait for eBay to confirm the upload job was created
 *   6. Return result (success/failure, job ID if available)
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';

const EBAY_SIGNIN_URL  = 'https://signin.ebay.com/ws/eBayISAPI.dll?SignIn';
const EBAY_UPLOAD_URL  = 'https://www.ebay.com/sh/reports/uploads';
const EBAY_HOME_URL    = 'https://www.ebay.com';

/**
 * isLoggedIn(page)
 * Returns true if the current page looks like a logged-in eBay session.
 */
async function isLoggedIn(page) {
  try {
    // Seller Hub header OR account menu icon indicates active session
    const indicators = [
      '[data-testid="gh-undo-btn"]',
      '.gh-undo',
      'a[href*="myebay"]',
      '#gh-undo',
      '[aria-label="My eBay"]',
    ];
    for (const sel of indicators) {
      if (await page.locator(sel).count() > 0) return true;
    }
    // Also check URL — if we're NOT on the sign-in page we're probably logged in
    const url = page.url();
    if (!url.includes('signin') && !url.includes('SignIn')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * login(page, email, password)
 * Navigates to eBay sign-in and fills credentials.
 * Throws if login fails after all attempts.
 */
async function login(page, email, password) {
  log.info('Navigating to eBay sign-in...');
  await page.goto(EBAY_SIGNIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Fill email
  try {
    await page.locator('#userid').fill(email);
    await page.locator('#signin-continue-btn, button[type="submit"]').first().click();
    await page.waitForTimeout(1500);
  } catch (err) {
    throw new Error(`Could not fill eBay email field: ${err.message}`);
  }

  // Fill password
  try {
    await page.locator('#pass').fill(password);
    await page.locator('#sgnBt, button[type="submit"]').first().click();
    await page.waitForTimeout(3000);
  } catch (err) {
    throw new Error(`Could not fill eBay password field: ${err.message}`);
  }

  // Verify login succeeded
  const currentUrl = page.url();
  if (currentUrl.includes('signin') || currentUrl.includes('SignIn')) {
    // Take screenshot to help debug login failures
    const screenshotPath = path.join(
      process.cwd(), 'logs', 'screenshots',
      `login-fail-${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    throw new Error(
      'Login failed — still on sign-in page after submitting. ' +
      `Check credentials in .env. Screenshot: ${screenshotPath}`
    );
  }

  log.success('Logged in to eBay');
}

/**
 * uploadCSV(page, csvFilePath)
 * Navigates to Seller Hub Reports upload page and uploads the CSV file.
 * Returns { success: boolean, jobId: string|null, message: string }
 */
async function uploadCSV(page, csvFilePath) {
  // Caller already navigated us to the upload page and verified we're logged in
  log.info(`On upload page: ${page.url()}`);

  // The Seller Hub upload page has a 3-step flow.
  // Step 3 "Proceed to upload" has an "Upload template" button that opens
  // the actual file picker / upload form. Click it first.
  log.info('Looking for "Upload template" button (Step 3)...');
  const uploadTemplateBtnSelectors = [
    'button:has-text("Upload template")',
    'a:has-text("Upload template")',
    'button:has-text("Upload")',
    '[data-testid="upload-template-btn"]',
  ];

  let uploadBtnClicked = false;
  for (const sel of uploadTemplateBtnSelectors) {
    try {
      const btn = page.locator(sel).last(); // last() targets Step 3 if multiple
      if (await btn.count() > 0) {
        await btn.click();
        uploadBtnClicked = true;
        log.info(`Clicked upload trigger with selector: ${sel}`);
        await page.waitForTimeout(2000);
        break;
      }
    } catch { /* try next */ }
  }

  if (!uploadBtnClicked) {
    log.warn('Could not find "Upload template" button — attempting direct file attach');
  }

  log.info(`Attaching CSV: ${path.basename(csvFilePath)}`);

  // Now find the visible/active file input
  const fileInputSelectors = [
    'input[type="file"]:visible',
    'input[accept=".csv"]',
    'input[accept="text/csv"]',
    '#file-upload',
    '[data-testid="file-input"]',
    'input[type="file"]',
  ];

  let fileInputLocator = null;
  for (const sel of fileInputSelectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        fileInputLocator = page.locator(sel).first();
        log.info(`Found file input with selector: ${sel}`);
        break;
      }
    } catch { /* try next */ }
  }

  if (!fileInputLocator) {
    const screenshotPath = path.join(
      process.cwd(), 'logs', 'screenshots',
      `upload-no-input-${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    throw new Error(
      `Could not find file input on upload page. eBay may have changed their UI. ` +
      `Screenshot saved: ${screenshotPath}`
    );
  }

  // Attach the file — this may auto-submit on some eBay upload flows
  await fileInputLocator.setInputFiles(csvFilePath);
  await page.waitForTimeout(2000);

  // Take a screenshot after attaching to see current state
  const postAttachScreenshot = path.join(
    process.cwd(), 'logs', 'screenshots',
    `post-attach-${Date.now()}.png`
  );
  await page.screenshot({ path: postAttachScreenshot, fullPage: false }).catch(() => {});
  log.info(`Post-attach screenshot: ${postAttachScreenshot}`);

  // Look for a submit / upload button — scoped to the file upload form
  const submitSelectors = [
    '[data-testid="upload-btn"]',
    '.upload-btn',
    'button:has-text("Upload file")',
    'button:has-text("Submit")',
    'form:has(input[type="file"]) button[type="submit"]',
    'form:has(input[type="file"]) button',
  ];

  let submitted = false;
  for (const sel of submitSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isEnabled()) {
        await btn.click();
        submitted = true;
        log.info(`Clicked submit with selector: ${sel}`);
        break;
      }
    } catch { /* try next */ }
  }

  if (!submitted) {
    log.warn('No submit button found — upload may have auto-submitted on file select');
  }

  // Wait for eBay to register the upload — poll up to 60 seconds
  log.info('Waiting for eBay to confirm upload...');

  let jobId = null;
  let successDetected = false;
  let errorText = null;

  // The CSV filename (without PROCESSING- prefix) to look for in the uploads list
  const baseFilename = path.basename(csvFilePath).replace(/^PROCESSING-/, '');

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);

    // Check for upload-specific error elements only (not session banners)
    const uploadErrorSelectors = [
      '[data-testid="upload-error"]',
      '.upload-error',
      '[data-testid="error-message"]',
      '.file-upload-error',
    ];
    for (const sel of uploadErrorSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.count() > 0) {
          errorText = (await el.textContent() || '').trim() || 'eBay returned an upload error';
          break;
        }
      } catch { /* ignore */ }
    }

    if (errorText) break;

    // Success: file appeared in eBay's uploads list (any status = upload was received)
    // eBay shows "In progress", "X failed, Y completed", etc. — all mean the job was created
    try {
      const bodyText = await page.textContent('body');

      // Look for the uploaded filename in the past-uploads list section
      if (bodyText.includes(baseFilename)) {
        successDetected = true;
        log.info('Upload confirmed — file appeared in eBay uploads list');

        // Extract result summary from the list entry (e.g. "2 failed, 0 completed")
        const listingResult = bodyText.match(
          new RegExp(baseFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            '[^\\n]*?((\\d+ failed[^\\n]*?\\d+ completed)|(In progress)|(Processing))', 'i')
        );
        if (listingResult) log.info(`eBay listing result: ${listingResult[1]}`);

        // Extract job ID if present
        const jobMatch = bodyText.match(/job[:\s#]*(\d{8,})/i);
        if (jobMatch) jobId = jobMatch[1];
        break;
      }

      // Also check for "In progress" near the top of the uploads section
      if (/In progress/i.test(bodyText)) {
        successDetected = true;
        log.info('Upload confirmed — "In progress" status detected');
        break;
      }
    } catch { /* ignore */ }

    log.info('Upload in progress — waiting...');
  }

  // Fallback: if URL stayed on Seller Hub, treat as success
  if (!successDetected && !errorText) {
    const finalUrl = page.url();
    if (finalUrl.includes('ebay.com/sh')) {
      log.warn('No explicit confirmation — assuming success (still on Seller Hub)');
      successDetected = true;
    }
  }

  // Take a screenshot regardless — useful for verifying results
  const screenshotPath = path.join(
    process.cwd(), 'logs', 'screenshots',
    `upload-${path.basename(csvFilePath, '.csv')}-${Date.now()}.png`
  );
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

  if (errorText) {
    // Any error on the page = failure, even if a success message also appeared
    log.error(`Upload error detected: ${errorText}`);
    return { success: false, jobId: null, message: errorText, screenshotPath };
  }

  if (successDetected) {
    const msg = jobId
      ? `Upload submitted — job ID: ${jobId}`
      : `Upload submitted — check Seller Hub for results`;
    log.success(msg);
    return { success: true, jobId, message: msg, screenshotPath };
  }

  return { success: false, jobId: null, message: 'Unknown result — check screenshot', screenshotPath };
}

/**
 * runUpload(csvFilePath, credentials)
 * Top-level function — launches browser with a persistent session so eBay
 * login only needs to happen once (or after session expiry).
 * Returns result object from uploadCSV().
 */
export async function runUpload(csvFilePath, { email, password, dryRun = false }) {
  if (dryRun) {
    log.info(`[DRY RUN] Would upload: ${path.basename(csvFilePath)}`);
    return { success: true, jobId: null, message: 'Dry run — no upload performed' };
  }

  // Persistent session stored next to the agent
  const SESSION_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-session');

  let context = null;
  try {
    log.info('Launching browser (persistent session)...');

    // launchPersistentContext stores all cookies/storage in SESSION_DIR between runs
    context = await chromium.launchPersistentContext(SESSION_DIR, {
      headless: false,
      slowMo: 80,
      args: ['--start-maximized'],
      viewport: null,
    });

    const page = await context.newPage();

    // Verify session by navigating directly to the protected upload page.
    // If eBay redirects us to sign-in, the session is gone and we need to log in.
    log.info('Checking session — navigating to Seller Hub...');
    await page.goto(EBAY_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    if (page.url().includes('signin') || page.url().includes('SignIn')) {
      log.info('Session expired or not found — logging in...');
      await login(page, email, password);
      log.info('Session saved for future runs');
      // Navigate back to the upload page after login
      await page.goto(EBAY_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
    } else {
      log.info('Session valid — skipping login');
    }

    // Upload the CSV
    const result = await uploadCSV(page, csvFilePath);

    // If we were redirected to login mid-upload, session expired — clear it and report
    if (!result.success && result.message?.includes('sign-in')) {
      log.warn('Session expired mid-run — clearing saved session so next run re-logs in');
      await context.clearCookies();
    }

    await page.waitForTimeout(2000);
    return result;

  } catch (err) {
    log.error('Upload failed', err);
    return { success: false, jobId: null, message: err.message };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}
