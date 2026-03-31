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
  await page.waitForTimeout(1500);

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
  log.info(`Navigating to Seller Hub upload page...`);
  await page.goto(EBAY_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Check if we got redirected to login
  if (page.url().includes('signin') || page.url().includes('SignIn')) {
    throw new Error('Session expired — redirected to sign-in during upload');
  }

  log.info(`Attaching CSV: ${path.basename(csvFilePath)}`);

  // eBay's file input is usually hidden — use setInputFiles directly
  // Try multiple selector variants for resilience
  const fileInputSelectors = [
    'input[type="file"]',
    'input[accept=".csv"]',
    'input[accept="text/csv"]',
    '#file-upload',
    '[data-testid="file-input"]',
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
    // Take screenshot to help debug
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

  // Set the file
  await fileInputLocator.setInputFiles(csvFilePath);
  await page.waitForTimeout(1000);

  // Click the upload/submit button
  const submitSelectors = [
    'button:has-text("Upload")',
    'button[type="submit"]',
    'input[type="submit"]',
    '[data-testid="upload-btn"]',
    '.upload-btn',
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
    // Some eBay upload pages auto-submit on file select — check for success anyway
    log.warn('No submit button found — upload may have auto-submitted');
  }

  // Wait for eBay to process the upload (up to 30 seconds)
  log.info('Waiting for eBay to confirm upload...');
  await page.waitForTimeout(3000);

  // Check for success indicators
  const successSelectors = [
    '[data-testid="upload-success"]',
    '.upload-success',
    'text=successfully',
    'text=processing',
    'text=uploaded',
    'text=File received',
    'text=job',
  ];

  let jobId = null;
  let successDetected = false;

  for (const sel of successSelectors) {
    try {
      if (await page.locator(sel).count() > 0) {
        successDetected = true;
        break;
      }
    } catch { /* try next */ }
  }

  // Also check if we're now on the uploads list page (another success indicator)
  const finalUrl = page.url();
  if (finalUrl.includes('uploads') || finalUrl.includes('reports')) {
    successDetected = true;
  }

  // Try to extract a job ID from the page text
  try {
    const pageText = await page.textContent('body');
    const jobMatch = pageText.match(/job[:\s#]*(\d{8,})/i);
    if (jobMatch) jobId = jobMatch[1];
  } catch { /* non-fatal */ }

  // Check for error indicators — runs regardless of successDetected.
  // If eBay shows any error alongside a success message, treat as failure
  // so the CSV stays as FAILED- and is never silently marked done.
  const errorSelectors = ['.error-message', '[data-testid="error"]', '[class*="error"]', '[class*="alert-error"]'];
  let errorText = null;
  for (const sel of errorSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        errorText = (await el.textContent() || '').trim() || 'eBay returned an error — check screenshot';
        break;
      }
    } catch { /* try next */ }
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
 * Top-level function — launches browser, logs in, uploads, closes.
 * Returns result object from uploadCSV().
 */
export async function runUpload(csvFilePath, { email, password, dryRun = false }) {
  if (dryRun) {
    log.info(`[DRY RUN] Would upload: ${path.basename(csvFilePath)}`);
    return { success: true, jobId: null, message: 'Dry run — no upload performed' };
  }

  let browser = null;
  try {
    log.info('Launching browser...');
    browser = await chromium.launch({
      headless: false,   // Visible so you can watch/intervene if needed
      slowMo: 80,
      args: ['--start-maximized'],
    });

    const context = await browser.newContext({
      viewport: null,
    });
    const page = await context.newPage();

    // Navigate to eBay home first to set up cookies
    await page.goto(EBAY_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Log in if needed
    if (!(await isLoggedIn(page))) {
      await login(page, email, password);
    } else {
      log.info('Already logged in — skipping sign-in');
    }

    // Upload the CSV
    const result = await uploadCSV(page, csvFilePath);

    await page.waitForTimeout(2000);
    return result;

  } catch (err) {
    log.error('Upload failed', err);
    return { success: false, jobId: null, message: err.message };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
