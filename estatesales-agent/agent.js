/**
 * agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * EstateSales.net Upload Agent
 *
 * Phase 1 — DOA Scrape:
 *   Log into Denver Online Auctions → navigate to DOA_URL → scrape lot data
 *   (title, description, price, images).
 *
 * Phase 2 — EstateSales Upload:
 *   Log into EstateSales.net → navigate to ESTATESALES_URL → create/upload
 *   lots with the scraped data.
 *
 * All credentials and URLs are injected via process.env by runAgent.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createClient } from '@supabase/supabase-js';

chromium.use(StealthPlugin());

// ── Config ────────────────────────────────────────────────────────────────────

const JOB_ID             = process.env.JOB_ID;
const DOA_EMAIL          = process.env.DOA_EMAIL;
const DOA_PASSWORD       = process.env.DOA_PASSWORD;
const DOA_URL            = process.env.DOA_URL;
const ES_EMAIL           = process.env.ESTATESALES_EMAIL;
const ES_PASSWORD        = process.env.ESTATESALES_PASSWORD;
const ES_URL             = process.env.ESTATESALES_URL;
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY;

const IS_CI              = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const SCREENSHOTS_DIR    = './screenshots';

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

async function updateJobStatus(status, error = null) {
  if (!supabase || !JOB_ID) return;
  const update = { status, updated_at: new Date().toISOString() };
  if (error) update.error = String(error).slice(0, 2000);
  const { error: dbErr } = await supabase
    .from('estatesales_jobs')
    .update(update)
    .eq('id', JOB_ID);
  if (dbErr) console.error(`[agent] Could not update job status: ${dbErr.message}`);
  else console.log(`[agent] Job status → ${status}`);
}

// ── Screenshot helper ─────────────────────────────────────────────────────────

async function screenshot(page, name) {
  try {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const file = path.join(SCREENSHOTS_DIR, `${Date.now()}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`[agent] Screenshot saved: ${file}`);
  } catch {
    // Non-fatal
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  // Validate inputs
  if (!DOA_EMAIL || !DOA_PASSWORD || !DOA_URL) {
    throw new Error('DOA_EMAIL, DOA_PASSWORD, and DOA_URL are required');
  }
  if (!ES_EMAIL || !ES_PASSWORD || !ES_URL) {
    throw new Error('ESTATESALES_EMAIL, ESTATESALES_PASSWORD, and ESTATESALES_URL are required');
  }

  await updateJobStatus('running');

  const browser = await chromium.launch({ headless: IS_CI });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let lots = [];

  try {
    // ── Phase 1: Scrape lot data from DOA ─────────────────────────────────────
    console.log('\n[agent] ── Phase 1: DOA Scrape ──────────────────────────────');

    console.log('[agent] Logging into DOA...');
    await page.goto('https://denveronlineauctions.com/Account/Login', { waitUntil: 'domcontentloaded' });

    // #MainContent_Email is used specifically to avoid the newsletter popup email input
    await page.fill('#MainContent_Email', DOA_EMAIL);
    await page.fill('#MainContent_Password', DOA_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

    console.log('[agent] Navigating to DOA auction page...');
    await page.goto(DOA_URL, { waitUntil: 'domcontentloaded' });
    await screenshot(page, 'doa-auction-page');

    // TODO: Implement DOA lot scraping
    // The DOA auction page lists lots — scrape each lot's:
    //   - lot_number
    //   - title
    //   - description
    //   - starting_bid
    //   - image URLs
    //
    // Example pattern (update selectors to match actual DOA structure):
    //
    // const lotRows = await page.$$('.lot-row');  // TODO: real selector
    // for (const row of lotRows) {
    //   const title       = await row.$eval('.lot-title', el => el.textContent.trim());
    //   const description = await row.$eval('.lot-desc',  el => el.textContent.trim());
    //   const price       = await row.$eval('.lot-price', el => parseFloat(el.textContent.replace(/[^0-9.]/g, '')));
    //   const images      = await row.$$eval('img', imgs => imgs.map(img => img.src));
    //   lots.push({ title, description, price, images });
    // }

    console.log(`[agent] Scraped ${lots.length} lot(s) from DOA`);

    if (lots.length === 0) {
      throw new Error('No lots scraped from DOA — check the DOA_URL and selectors in agent.js Phase 1');
    }

    // ── Phase 2: Upload lots to EstateSales.net ───────────────────────────────
    console.log('\n[agent] ── Phase 2: EstateSales Upload ─────────────────────');

    console.log('[agent] Logging into EstateSales.net...');
    await page.goto('https://www.estatesales.net/login', { waitUntil: 'domcontentloaded' });

    // TODO: Fill in actual EstateSales.net login selectors
    await page.fill('#email', ES_EMAIL);          // TODO: verify selector
    await page.fill('#password', ES_PASSWORD);    // TODO: verify selector
    await page.click('[type="submit"]');          // TODO: verify selector
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

    console.log('[agent] Navigating to EstateSales.net sale page...');
    await page.goto(ES_URL, { waitUntil: 'domcontentloaded' });
    await screenshot(page, 'estatesales-sale-page');

    // TODO: Implement EstateSales.net lot upload
    // For each scraped lot, navigate to the add-item form and fill in details.
    //
    // Example pattern (update selectors to match actual EstateSales.net structure):
    //
    // for (const lot of lots) {
    //   await page.goto(`${ES_URL}/add-item`);  // TODO: real URL pattern
    //   await page.fill('#item-title',       lot.title);
    //   await page.fill('#item-description', lot.description);
    //   await page.fill('#item-price',       String(lot.price));
    //   // Image upload: download each image and upload via file input
    //   // await uploadImages(page, lot.images);  // TODO: implement
    //   await page.click('[type="submit"]');
    //   await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    //   console.log(`[agent]   Uploaded lot: ${lot.title}`);
    // }

    console.log('[agent] All lots uploaded to EstateSales.net');

  } catch (err) {
    await screenshot(page, 'error-state');
    throw err;
  } finally {
    await browser.close();
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

run()
  .then(async () => {
    await updateJobStatus('completed');
    console.log('\n[agent] Done.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n[agent] FATAL:', err.message);
    await updateJobStatus('failed', err.message);
    process.exit(1);
  });
