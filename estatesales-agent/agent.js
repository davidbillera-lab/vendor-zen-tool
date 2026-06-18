/**
 * agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * EstateSales.net Upload Agent
 *
 * Phase 1 — DOA Scrape:
 *   Log into Denver Online Auctions → navigate to the auction admin page
 *   (DOA_URL = EditAuction?id=...) → collect every lot link → visit each lot's
 *   edit page and read: title, description, starting bid, and image URLs.
 *
 * Phase 2 — EstateSales Upload:
 *   Log into EstateSales.net → navigate to the sale management page (ES_URL)
 *   → for each scraped lot, open the add-item form, fill all fields, download
 *   and re-upload images, and save.
 *
 * All credentials and URLs are injected via process.env by runAgent.js.
 *
 * EstateSales.net login supports two modes:
 *   A) storageState (preferred for Google-SSO accounts): inject ES_STORAGE_STATE
 *      containing an exported Playwright session JSON string. The agent reuses
 *      the session without touching the login form.
 *   B) Email/password fallback: ES_EMAIL + ES_PASSWORD (may not work for
 *      Google-SSO-only accounts).
 *
 * One-time session capture (operator runs locally, never commit the output):
 *   node -e "const {chromium}=require('playwright'); (async()=>{const b=await chromium.launch({headless:false}); const c=await b.newContext(); const p=await c.newPage(); await p.goto('https://www.estatesales.net/sign-in'); console.log('Log in via Google in the window, then press Enter here'); process.stdin.once('data', async()=>{ const s=await c.storageState(); require('fs').writeFileSync('es-session.json', JSON.stringify(s)); await b.close(); process.exit(0); });})();"
 * Then paste es-session.json contents into VZT Settings
 * (user_estatesales_credentials.estatesales_storage_state).
 * NEVER commit es-session.json.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
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
const ES_STORAGE_STATE   = process.env.ES_STORAGE_STATE;
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY;

const IS_CI              = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const SCREENSHOTS_DIR    = './screenshots';
const IMAGES_DIR         = './downloaded-images';

const NAV_TIMEOUT        = 30_000;
const WAIT_TIMEOUT       = 15_000;

// Stale reservation threshold: a 'reserved' row older than this is LIKELY a dead
// run rather than a live concurrent one. This is used ONLY to label the skip log
// for manual reconciliation — we never auto-reclaim a stale reservation (see
// reserveLot: a dead run may have saved the item on ES before dying, so
// re-uploading risks the exact duplicate the ledger prevents).
const STALE_RESERVATION_MS = 30 * 60 * 1000; // 30 minutes

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

async function updateJobStatus(status, error = null) {
  if (!supabase || !JOB_ID) return;
  const update = { status };
  // completed_at is set for ALL terminal statuses, including partial_failed
  if (status === 'completed' || status === 'failed' || status === 'partial_failed') {
    update.completed_at = new Date().toISOString();
  }
  if (error) update.error_message = String(error).slice(0, 2000);
  const { error: dbErr } = await supabase
    .from('estatesales_jobs')
    .update(update)
    .eq('id', JOB_ID);
  if (dbErr) console.error(`[agent] Could not update job status: ${dbErr.message}`);
  else console.log(`[agent] Job status → ${status}`);
}

async function updateJobFields(fields) {
  if (!supabase || !JOB_ID) return;
  const { error: dbErr } = await supabase
    .from('estatesales_jobs')
    .update(fields)
    .eq('id', JOB_ID);
  if (dbErr) console.error(`[agent] Could not update job fields: ${dbErr.message}`);
}

/**
 * Read the set of DOA lot URLs that have been CONFIRMED uploaded to this
 * EstateSales sale (status = 'uploaded' only). Reserved and failed rows are
 * NOT included so they can be retried or claimed by the current run via
 * reserveLot() rather than silently skipped here.
 *
 * Fails closed: if the ledger can't be read we abort rather than risk
 * uploading duplicates.
 */
async function fetchUploadedLotUrls() {
  if (!supabase) return new Set();
  const { data, error } = await supabase
    .from('estatesales_uploaded_lots')
    .select('lot_url')
    .eq('es_url', ES_URL)
    .eq('status', 'uploaded');
  if (error) throw new Error(`[agent] Could not read uploaded-lots ledger: ${error.message}`);
  return new Set((data || []).map((r) => r.lot_url));
}

/**
 * Atomically claim a lot before uploading it (reserve → upload → confirm pattern).
 *
 * Returns one of:
 *   { claimed: true }                  — we own the row; proceed to upload
 *   { claimed: false, reason: string } — skip this lot (already done or conservatively blocked)
 *
 * Conflict resolution:
 *   - 'uploaded'  row found → already done, skip
 *   - 'reserved'  row found → conservatively skip (never auto-reclaimed, even
 *                             once stale — a dead run may have saved on ES before
 *                             dying; stale rows are flagged for manual reconciliation)
 *   - 'failed'    row found → conservatively skip to avoid duplicate risk
 *
 * Lots without a source_url cannot be keyed in the ledger (no unique key) and
 * should fall through to upload without reservation — dedup is impossible for
 * them and duplicates are the caller's problem.
 */
async function reserveLot(lot, jobUserId) {
  if (!supabase) return { claimed: true }; // no ledger → proceed (no dedup)
  if (!lot.source_url) return { claimed: true }; // can't key without URL → proceed

  const now = new Date().toISOString();

  // Attempt atomic insert
  const { error: insertErr } = await supabase
    .from('estatesales_uploaded_lots')
    .insert({
      user_id:     jobUserId,
      job_id:      JOB_ID || null,
      es_url:      ES_URL,
      lot_url:     lot.source_url,
      lot_number:  lot.lot_number ?? null,
      lot_title:   lot.title ?? null,
      status:      'reserved',
      reserved_at: now,
    });

  if (!insertErr) {
    // Insert succeeded — we own the reservation
    return { claimed: true };
  }

  if (insertErr.code !== '23505') {
    // A real DB error (not a unique violation) — surface it
    throw new Error(`[agent] reserveLot DB error for lot ${lot.lot_number}: ${insertErr.message}`);
  }

  // Unique violation — a row already exists for (es_url, lot_url). Inspect it.
  const { data: existing, error: fetchErr } = await supabase
    .from('estatesales_uploaded_lots')
    .select('status, reserved_at')
    .eq('es_url', ES_URL)
    .eq('lot_url', lot.source_url)
    .single();

  if (fetchErr) {
    throw new Error(`[agent] reserveLot: could not read existing row for lot ${lot.lot_number}: ${fetchErr.message}`);
  }

  if (existing.status === 'uploaded') {
    return { claimed: false, reason: 'already uploaded in a previous run' };
  }

  if (existing.status === 'reserved') {
    // A 'reserved' row means a prior (or concurrent) run claimed this lot but
    // never advanced it to 'uploaded' or 'failed'. We deliberately do NOT
    // auto-reclaim and re-upload it, even once it is "stale". The reservation
    // and the actual ES upload are not atomic: a run can save the item on
    // EstateSales and then die before writing the ledger. The row would look
    // stale, but the item DOES exist on ES — re-uploading creates the exact
    // duplicate the ledger is meant to prevent. Per the governing priority
    // "duplicates are worse than blocked runs", we skip and surface the row for
    // manual operator reconciliation (verify on ES, then clear or mark the
    // ledger row 'uploaded'/'failed' to unblock retry).
    const reservedAt = existing.reserved_at ? new Date(existing.reserved_at).getTime() : 0;
    const age = Date.now() - reservedAt;
    const ageDesc = age >= STALE_RESERVATION_MS
      ? `STALE reservation (${Math.round(age / 60000)}m old) — needs manual reconciliation`
      : `reserved ${Math.round(age / 1000)}s ago (likely a live concurrent run)`;
    console.warn(`[agent]   Skipping lot ${lot.lot_number}: ${ageDesc}. Not re-uploading to avoid duplicates.`);
    return {
      claimed: false,
      reason: `already reserved — not re-uploading to avoid duplicates (${ageDesc})`,
    };
  }

  // status === 'failed' (or any unknown status) — conservatively skip
  return {
    claimed: false,
    reason: `previously failed — not re-uploading to avoid duplicates (status: ${existing.status})`,
  };
}

/**
 * Fatal ledger anomaly: the ES upload succeeded but the ledger could not be
 * trusted afterwards (write error OR our reservation was missing/owned by
 * another run). Carries an explicit flag so the upload loop can hard-stop on
 * ANY such anomaly without fragile message-substring matching.
 */
class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerError';
    this.fatalLedger = true;
  }
}

/**
 * Mark a reserved lot as confirmed-uploaded in the ledger.
 * THROWS on any real DB error — if the ES upload succeeded but we cannot
 * record it, the run must stop rather than risk a future duplicate.
 * A 23505 (unique violation) here would be a bug (we already hold the
 * reservation row) so it is also surfaced as an error.
 */
async function confirmLotUploaded(lot) {
  if (!supabase) return; // no ledger — nothing to record
  if (!lot.source_url) return; // no key — can't update

  // Confirm ONLY the reservation this run owns: require status='reserved' and,
  // when we have a JOB_ID, bind to job_id so we can never confirm another run's
  // row. We then check rows-affected — a zero-row update means our reservation
  // is missing or owned by another run, which is a concurrency/state anomaly and
  // must hard-stop (the upload happened but the ledger cannot be trusted).
  let query = supabase
    .from('estatesales_uploaded_lots')
    .update({ status: 'uploaded', uploaded_at: new Date().toISOString() })
    .eq('es_url', ES_URL)
    .eq('lot_url', lot.source_url)
    .eq('status', 'reserved');
  if (JOB_ID) query = query.eq('job_id', JOB_ID);

  const { data: updated, error } = await query.select();

  if (error) {
    throw new LedgerError(
      `[agent] Lot uploaded to EstateSales but could not record in ledger — manual intervention required. ` +
      `(lot: ${lot.lot_number}, error: ${error.message})`
    );
  }
  if (!updated || updated.length === 0) {
    throw new LedgerError(
      `[agent] Lot uploaded to EstateSales but its ledger reservation was missing or owned by another run — ` +
      `manual intervention required (lot: ${lot.lot_number}). This indicates a concurrency or state error; ` +
      `stopping to avoid masking a possible duplicate.`
    );
  }
}

/**
 * Mark a reserved lot as failed in the ledger (best-effort — does not throw).
 */
async function markLotFailed(lot) {
  if (!supabase || !lot.source_url) return;
  let query = supabase
    .from('estatesales_uploaded_lots')
    .update({ status: 'failed' })
    .eq('es_url', ES_URL)
    .eq('lot_url', lot.source_url)
    .eq('status', 'reserved'); // only transition our own reservation
  if (JOB_ID) query = query.eq('job_id', JOB_ID); // bind to this run when we have an owner
  const { error } = await query;
  if (error) {
    console.error(`[agent]   WARNING: could not mark lot ${lot.lot_number} as failed in ledger: ${error.message}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Try a list of selectors in order and return the first one that exists on the page.
 * Returns null if none match within the timeout.
 */
async function findFirst(page, selectors, timeout = 5_000) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'attached', timeout });
      return el;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Download a remote image to a local temp file. Returns the local path.
 */
async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Read the TinyMCE editor content from a page.
 * Returns a plain-text/HTML string or '' if not found.
 */
async function readTinyMceContent(page) {
  try {
    const content = await page.evaluate(() => {
      // Strategy 1: tinymce.get()
      if (window.tinymce) {
        const eds = window.tinymce.editors || window.tinymce.get();
        const ed = Array.isArray(eds) ? eds[0] : eds;
        if (ed && ed.getContent) return ed.getContent({ format: 'text' });
      }
      // Strategy 2: read from the iframe body directly
      const iframe = document.querySelector(
        'iframe[id*="EditorDescription"], iframe[id*="editor_description" i], .tox-edit-area iframe, iframe[id*="tinymce"]'
      );
      if (iframe) {
        try {
          return iframe.contentDocument?.body?.innerText || '';
        } catch { /* cross-origin — skip */ }
      }
      // Strategy 3: hidden textarea that TinyMCE syncs to
      const ta = document.querySelector(
        'textarea[name*="description" i], textarea[id*="description" i], textarea[id*="EditorDescription" i]'
      );
      if (ta && ta.value) return ta.value;
      return '';
    });
    return (content || '').trim();
  } catch {
    return '';
  }
}

/**
 * Detects whether the page is currently showing a validation/error state or has
 * been bounced to the sign-in page. Used as a NEGATIVE gate: even a "positive"
 * signal is rejected if any of these are present, so an error alert or a login
 * redirect can never be mistaken for a successful save (which would silently
 * mark a never-created lot as 'uploaded').
 */
async function hasErrorOrAuthState(page) {
  try {
    // A login redirect means the session dropped — definitely not a save.
    if (/sign-?in|log-?in|login|account\/login/i.test(new URL(page.url()).pathname)) {
      return true;
    }
    return await page.evaluate(() => {
      const sel = [
        '.validation-summary-errors',
        '.field-validation-error',
        '.alert-danger',
        '.alert-error',
        '[class*="error"]:not([class*="success"])',
        '[class*="invalid"]:not([class*="success"])',
      ].join(', ');
      return Array.from(document.querySelectorAll(sel)).some(
        (n) => n.offsetParent !== null && (n.textContent || '').trim().length > 0
      );
    });
  } catch {
    return false;
  }
}

/**
 * After clicking Save, look for a DETERMINISTIC positive signal that the item
 * was actually persisted, while rejecting anything that merely looks like
 * activity. Returns true only on a success signal with NO concurrent error /
 * validation / login-redirect state; false otherwise.
 *
 * Positive signals accepted (first clean one wins):
 *   1. URL navigated away from the add-item form to a non-auth page
 *   2. A success-SPECIFIC toast/message appeared (NOT a bare [role="alert"],
 *      which EstateSales also uses for validation errors)
 *   3. The name/title field cleared (form reset after save)
 */
async function checkSaveConfirmation(page, preSaveUrl) {
  const CONFIRM_TIMEOUT = 8_000;
  const deadline = Date.now() + CONFIRM_TIMEOUT;

  // Signal 1: full navigation away from the add-item form to a non-auth page.
  // Strongest signal — but a redirect to /sign-in must NOT count, and a landing
  // page still showing a validation summary must NOT count.
  try {
    await page.waitForURL(
      (u) =>
        u.href !== preSaveUrl &&
        !/items\/new|add-item|AddItem/i.test(u.pathname) &&
        !/sign-?in|log-?in|login|account\/login/i.test(u.pathname),
      { timeout: CONFIRM_TIMEOUT }
    );
    if (!(await hasErrorOrAuthState(page))) return true;
    return false; // navigated, but to an error/validation state — not a save
  } catch {
    // URL didn't change — try softer signals
  }

  // Signal 2: a success-SPECIFIC confirmation appeared. Scoped to success
  // classes/text only — a bare [role="alert"] or generic "saved" substring is
  // intentionally excluded because EstateSales reuses those for error states.
  if (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      await page.waitForSelector(
        '[class*="alert-success"], [class*="toast-success"], [class*="notification-success"], ' +
        '.alert-success, .Toastify__toast--success, ' +
        '[class*="success"]:has-text("added"), ' +
        '[class*="success"]:has-text("created"), ' +
        '[class*="success"]:has-text("saved")',
        { timeout: remaining }
      );
      if (!(await hasErrorOrAuthState(page))) return true;
      return false;
    } catch {
      // No success-specific toast found
    }
  }

  // Signal 3: title/name field cleared (form reset after successful save) AND
  // no validation error present.
  if (Date.now() < deadline) {
    try {
      const nameField = await findFirst(page, [
        '#Name', '#name', '#ItemName',
        'input[name="Name"]', 'input[name="name"]', 'input[name="ItemName"]',
      ], Math.min(2_000, deadline - Date.now()));
      if (nameField) {
        const val = await nameField.inputValue().catch(() => null);
        if (val !== null && val.trim() === '' && !(await hasErrorOrAuthState(page))) return true;
      }
    } catch {
      // ignore
    }
  }

  return false; // No positive confirmation signal detected
}

// ── Phase 1: DOA Scrape ───────────────────────────────────────────────────────

/**
 * scrapeLots(page)
 *
 * Navigates to the DOA auction admin page (DOA_URL), collects every
 * lot-edit link, then visits each one to read title/description/price/images.
 *
 * Returns: Array of { lot_number, title, description, price, imageUrls[] }
 */
async function scrapeLots(page) {
  console.log('[agent] Navigating to DOA auction page...');
  await page.goto(DOA_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await screenshot(page, 'doa-auction-page');

  // ── Collect lot edit URLs ─────────────────────────────────────────────────
  // The auction admin page lists every lot with a link to its individual edit page.
  // DOA URL pattern for individual lots: /sub-admin/EditLot?id=NNN
  //                               or:   /sub-admin/EditAuction?auctionItemId=NNN
  console.log('[agent] Collecting lot links from auction page...');

  const lotLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const seen = new Set();
    const results = [];
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;
      // Match /sub-admin/EditLot?id= or any href containing "EditLot" or "auctionItemId"
      if (
        /EditLot/i.test(href) ||
        /auctionItemId=/i.test(href) ||
        /LotID=/i.test(href) ||
        /lotId=/i.test(href)
      ) {
        const abs = href.startsWith('http') ? href : `https://denveronlineauctions.com${href.startsWith('/') ? '' : '/'}${href}`;
        if (!seen.has(abs)) {
          seen.add(abs);
          results.push(abs);
        }
      }
    }
    return results;
  });

  // ── Fallback: public auction catalog page ─────────────────────────────────
  // If DOA_URL is the public catalog (/auction/<slug>) rather than the admin
  // page, lots are linked as /auction/<slug>/lot-N-<title-slug> (plus m-/v-
  // media variants, each appearing twice). The catalog is client-side
  // rendered, so wait for the links to appear before collecting.
  let mode = 'admin';
  if (lotLinks.length === 0) {
    console.log('[agent] No admin lot links found — checking for public catalog lot links...');
    await page.waitForSelector('a[href*="lot-"], a[href*="auction-details?id="]', { timeout: WAIT_TIMEOUT }).catch(() => {});
    const publicLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const byLot = new Map(); // lot/item key → href, preferring the plain (non m-/v-) variant
      for (const a of links) {
        const href = a.getAttribute('href');
        if (!href) continue;
        let num;
        let isVariant = false;
        let m = href.match(/\/auction\/[^/]+\/(m-|v-)?lot-(\d+)-/i);
        if (m) {
          num = parseInt(m[2], 10);
          isVariant = Boolean(m[1]);
        } else {
          // Logged-in sessions render catalog tiles as /auction-details?id=<itemId>
          // instead of the anonymous /auction/<slug>/lot-N-<title> format.
          m = href.match(/\/auction-details\?id=(\d+)/i);
          if (!m) continue;
          num = parseInt(m[1], 10);
        }
        const abs = href.startsWith('http') ? href : `https://denveronlineauctions.com${href.startsWith('/') ? '' : '/'}${href}`;
        if (!byLot.has(num) || (byLot.get(num).isVariant && !isVariant)) {
          byLot.set(num, { url: abs, isVariant });
        }
      }
      return Array.from(byLot.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v.url);
    });
    if (publicLinks.length > 0) {
      mode = 'public';
      lotLinks.push(...publicLinks);
    }
  }

  if (lotLinks.length === 0) {
    // Diagnostic: dump what anchors the page actually has so the failure log
    // shows the real link structure (CI may see a different page than local).
    const diag = await page.evaluate(() => {
      const hrefs = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));
      const patterns = {};
      for (const h of hrefs) {
        const key = h.split(/[?#]/)[0].replace(/\d+/g, 'N').slice(0, 100);
        patterns[key] = (patterns[key] || 0) + 1;
      }
      return {
        url: location.href,
        title: document.title,
        anchorCount: hrefs.length,
        patterns,
        sample: hrefs.slice(0, 25),
      };
    }).catch((e) => ({ diagError: String(e) }));
    console.log('[agent] DIAGNOSTIC anchor dump:', JSON.stringify(diag, null, 2));
    await screenshot(page, 'doa-no-lot-links');
    throw new Error(
      `[agent] No lot links found on the DOA auction page.\n` +
      `  URL visited: ${DOA_URL}\n` +
      `  Expected admin links (/EditLot?id= or /auctionItemId=) or public\n` +
      `  catalog links (/auction/<slug>/lot-N-...) in the page.\n` +
      `  Check the screenshot "doa-no-lot-links" to diagnose the actual page structure.`
    );
  }

  console.log(`[agent] Found ${lotLinks.length} lot link(s) on auction page (${mode} mode).`);

  // ── Visit each lot and scrape its data ────────────────────────────────────
  const lots = [];

  for (let i = 0; i < lotLinks.length; i++) {
    const url = lotLinks[i];
    const lotNum = i + 1;
    console.log(`[agent]   Scraping lot ${lotNum}/${lotLinks.length}: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

      if (mode === 'public') {
        // Public lot detail page (verified selectors, 2026-06-11):
        //   title       → #MainContent_labelName  ("Lot #3 <title>")
        //   description → #HiddenlabelDescription
        //   images      → #images-container a.gallery-item hrefs (full-size CDN urls)
        //   bid amount  → not exposed publicly; best-effort text match, defaults to 0
        await page.waitForSelector('#MainContent_labelName', { timeout: WAIT_TIMEOUT }).catch(() => {});
        const data = await page.evaluate(() => {
          const titleRaw = document.querySelector('#MainContent_labelName')?.textContent?.trim() || '';
          const description = (document.querySelector('#HiddenlabelDescription')?.innerText || '').trim();
          const seen = new Set();
          const imageUrls = [];
          for (const a of document.querySelectorAll('#images-container a.gallery-item, a.gallery-item')) {
            const h = a.href;
            if (h && /\.(jpg|jpeg|png|gif|webp)/i.test(h) && !seen.has(h)) {
              seen.add(h);
              imageUrls.push(h);
            }
          }
          if (imageUrls.length === 0) {
            for (const img of document.querySelectorAll('#images-container img, img[src*="b-cdn"]')) {
              const src = (img.src || '').replace('_thumbnail', '');
              if (src && !seen.has(src)) {
                seen.add(src);
                imageUrls.push(src);
              }
            }
          }
          let price = 0;
          const m = document.body.innerText.match(/(?:Current|Starting|Minimum|High)\s+Bid[^$\n]{0,30}\$\s*([\d,]+(?:\.\d+)?)/i);
          if (m) price = parseFloat(m[1].replace(/,/g, '')) || 0;
          return { titleRaw, description, imageUrls, price };
        });

        const urlNum = url.match(/(?:m-|v-)?lot-(\d+)-/i)?.[1];
        // auction-details?id= URLs carry an item id, not a lot number — fall
        // back to the "Lot #N" prefix in the page title, then to the index.
        const titleNum = data.titleRaw.match(/Lot\s*#?\s*(\d+)/i)?.[1];
        const derivedLotNum = urlNum || titleNum || String(lotNum);
        const title = data.titleRaw.replace(/^(?:[MV]\s+)?Lot\s*#?\d+\s*[-–:.]?\s*/i, '').trim() || data.titleRaw;

        console.log(`[agent]     lot_number=${derivedLotNum} title="${title.slice(0, 60)}" bid=$${data.price} images=${data.imageUrls.length}`);

        lots.push({
          lot_number:  derivedLotNum,
          title:       title || `Lot ${derivedLotNum}`,
          description: data.description,
          price:       data.price,
          imageUrls:   data.imageUrls,
          source_url:  url,
        });
        continue;
      }

      // Wait for the title field to appear — confirms we're on a lot edit page
      await page.waitForSelector('#txtTitle, input[name*="Title" i]', {
        state: 'visible',
        timeout: WAIT_TIMEOUT,
      }).catch(() => {});

      // Title — read from confirmed selector #txtTitle
      const titleEl = await findFirst(page, [
        '#txtTitle',
        'input[name="ctl00$MainContent$txtTitle"]',
        'input[id*="Title" i][type="text"]',
        'input[placeholder*="title" i]',
      ]);
      const title = titleEl ? (await titleEl.inputValue().catch(() => '')).trim() : '';

      // Starting bid / price
      const bidEl = await findFirst(page, [
        '#txtStartingBid',
        'input[id*="StartingBid" i]',
        'input[id*="starting" i]',
        'input[name*="starting_bid" i]',
        'input[name*="startingBid" i]',
        'input[name*="bid" i]',
        'input[placeholder*="bid" i]',
      ]);
      const bidRaw = bidEl ? (await bidEl.inputValue().catch(() => '0')).trim() : '0';
      const price = parseFloat(bidRaw.replace(/[^0-9.]/g, '')) || 0;

      // Description — from TinyMCE
      const description = await readTinyMceContent(page);

      // Images — collect src of any uploaded/preview thumbnails on the edit page
      const imageUrls = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll(
          '.uploaded-image img, .image-thumb img, [class*="uploaded"] img, ' +
          '[class*="thumb"] img, .image-preview img, ' +
          '.lot-images img, #images img, [id*="image"] img'
        ));
        const srcs = [];
        const seen = new Set();
        for (const img of imgs) {
          const src = img.src || img.getAttribute('src') || '';
          if (src && !src.includes('data:') && !seen.has(src)) {
            seen.add(src);
            srcs.push(src);
          }
        }
        return srcs;
      });

      // Fall back: any img whose src contains common DOA image path patterns
      let allImageUrls = imageUrls;
      if (allImageUrls.length === 0) {
        allImageUrls = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img[src]'));
          return imgs
            .map(img => img.src)
            .filter(src =>
              src &&
              !src.includes('data:') &&
              !src.includes('logo') &&
              !src.includes('icon') &&
              !src.includes('button') &&
              src.match(/\.(jpg|jpeg|png|gif|webp)/i)
            );
        });
      }

      // Extract lot number from URL or title
      const urlLotMatch = url.match(/[?&](?:id|LotID|lotId|auctionItemId)=(\d+)/i);
      const titleLotMatch = title.match(/^(?:lot\s*#?\s*)?(\d+)/i);
      const derivedLotNum = urlLotMatch?.[1] || titleLotMatch?.[1] || String(lotNum);

      console.log(`[agent]     lot_number=${derivedLotNum} title="${title.slice(0, 60)}" bid=$${price} images=${allImageUrls.length}`);

      lots.push({
        lot_number:  derivedLotNum,
        title:       title || `Lot ${derivedLotNum}`,
        description,
        price,
        imageUrls:   allImageUrls,
        source_url:  url,
      });

    } catch (err) {
      await screenshot(page, `doa-lot-${lotNum}-error`);
      console.error(`[agent]   ERROR scraping lot ${lotNum}: ${err.message} — skipping`);
    }
  }

  return lots;
}

// ── Phase 2: EstateSales Upload ───────────────────────────────────────────────

/**
 * uploadLots(page, lots)
 *
 * Logs into EstateSales.net and uploads each lot from the scraped array.
 * Downloads DOA images to disk, then re-uploads them to EstateSales.net.
 *
 * State machine per lot:
 *   1. reserveLot()   — atomic insert; conflict → conservatively skip (no reclaim)
 *   2. Upload form    — fill fields, images, click Save
 *   3. checkSaveConfirmation() — positive signal required
 *      → signal found  → confirmLotUploaded() (throws on DB error)
 *      → no signal     → markLotFailed()       (best-effort, non-throwing)
 */
async function uploadLots(page, lots) {
  let succeeded = 0;
  let skippedCount = 0;
  const failedLots = [];

  // ── Dedup: skip lots CONFIRMED uploaded to this sale ─────────────────────
  // Only 'uploaded' rows are pre-skipped here; 'reserved' and 'failed' rows
  // are handled per-lot via reserveLot(), which conservatively skips them
  // (no auto-reclaim — see reserveLot for the duplicate-safety reasoning).
  // Lots without a source_url can't be matched against the ledger and are
  // treated as pending (they pass through to upload without dedup).
  const uploadedUrls = await fetchUploadedLotUrls();
  const pending = lots.filter((l) => !l.source_url || !uploadedUrls.has(l.source_url));
  const preSkipped = lots.length - pending.length;
  if (preSkipped > 0) {
    console.log(`[agent] Skipping ${preSkipped} already-confirmed-uploaded lot(s) — ${pending.length} remaining.`);
    skippedCount += preSkipped;
  }
  if (pending.length === 0) {
    console.log('[agent] All lots already uploaded to this sale — nothing to do.');
    return { succeeded: 0, failed: 0, failedLots: [], skipped: skippedCount };
  }

  // user_id for ledger rows (RLS select policy scopes the UI to the owner)
  let jobUserId = null;
  if (supabase && JOB_ID) {
    const { data: jobRow } = await supabase
      .from('estatesales_jobs')
      .select('user_id')
      .eq('id', JOB_ID)
      .single();
    jobUserId = jobRow?.user_id ?? null;
  }

  if (!ES_STORAGE_STATE) {
    console.log('[agent] Logging into EstateSales.net...');
    // Note: /login is a 404 on estatesales.net — the real sign-in route is /sign-in
    await page.goto('https://www.estatesales.net/sign-in', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await screenshot(page, 'es-login-page');

    // EstateSales.net login form
    const emailEl = await findFirst(page, [
      '#email',
      'input[name="email"]',
      'input[type="email"]',
      'input[placeholder*="email" i]',
    ]);
    if (!emailEl) {
      await screenshot(page, 'es-no-email-field');
      throw new Error(
        '[agent] Could not find EstateSales.net email input.\n' +
        '  Check screenshot "es-no-email-field" and update selectors in Phase 2.'
      );
    }
    await emailEl.fill(ES_EMAIL);

    const passEl = await findFirst(page, [
      '#password-input',
      '#password',
      'input[name="password"]',
      'input[type="password"]',
      'input[placeholder*="password" i]',
    ]);
    if (!passEl) throw new Error('[agent] Could not find EstateSales.net password input.');
    await passEl.fill(ES_PASSWORD);

    // The page has several stray type="submit" buttons (Back, clear) — match the
    // visible Sign In button by text before falling back to generic selectors.
    const submitEl = await findFirst(page, [
      'button:has-text("Sign In")',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'button[type="submit"]',
      'input[type="submit"]',
    ]);
    if (!submitEl) throw new Error('[agent] Could not find EstateSales.net submit button.');
    await submitEl.click();
    // Angular SPA — redirect after login is client-side, not a full navigation
    await page.waitForURL((u) => !/sign-?in|log-?in/i.test(u.pathname), { timeout: NAV_TIMEOUT }).catch(() => {});
    await screenshot(page, 'es-after-login');

    // Verify login succeeded — look for a sign we're authenticated
    const currentUrl = page.url();
    if (/\/(sign-?in|log-?in)/i.test(currentUrl)) {
      await screenshot(page, 'es-login-failed');
      throw new Error(
        '[agent] EstateSales.net login appears to have failed — still on login page.\n' +
        '  Check screenshot "es-login-failed". Verify credentials in VZT Settings.'
      );
    }
    console.log('[agent] Logged into EstateSales.net successfully.');
  } else {
    console.log('[agent] Using imported EstateSales.net session (storageState).');
  }

  // Navigate to the sale management page
  console.log('[agent] Navigating to EstateSales.net sale page...');
  await page.goto(ES_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await screenshot(page, 'es-sale-page');

  // When using a storageState session, verify it is still valid after navigation.
  // If the site bounced us to a sign-in page the session has expired.
  if (ES_STORAGE_STATE) {
    const salePageUrl = page.url();
    if (/\/(sign-?in|log-?in)/i.test(salePageUrl)) {
      await screenshot(page, 'es-session-expired');
      throw new Error(
        '[agent] EstateSales.net session expired or invalid — re-export your session from VZT Settings.'
      );
    }
  }

  // ── Prepare temp image dir ───────────────────────────────────────────────
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  // ── Upload each lot ──────────────────────────────────────────────────────
  for (let i = 0; i < pending.length; i++) {
    const lot = pending[i];
    console.log(`\n[agent] Uploading lot ${i + 1}/${pending.length}: "${lot.title.slice(0, 60)}"`);

    // ── Step 1: Atomically reserve the lot (race-safe claim) ──────────────
    let reservation;
    try {
      reservation = await reserveLot(lot, jobUserId);
    } catch (reserveErr) {
      // reserveLot only throws on real DB errors — surface and abort the lot
      await screenshot(page, `es-reserve-error-lot-${i + 1}`);
      console.error(`[agent]   ERROR reserving lot ${i + 1}: ${reserveErr.message}`);
      failedLots.push({ index: i + 1, title: lot.title, error: reserveErr.message });
      continue;
    }

    if (!reservation.claimed) {
      console.log(`[agent]   Skipping lot ${i + 1} — ${reservation.reason}`);
      skippedCount++;
      continue;
    }

    // ── Step 2: Upload the lot to EstateSales ─────────────────────────────
    try {
      // Navigate to the "add item" page.
      // EstateSales.net sale management pages typically have an "Add Item" button
      // or a direct URL like <sale-url>/items/new or <sale-url>/add-item.
      // Try appending common paths, then fall back to clicking a button.
      const addItemUrl = ES_URL.replace(/\/$/, '') + '/items/new';
      await page.goto(addItemUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

      // If the direct URL didn't land on an item form, try clicking an Add Item button
      const onItemForm = await page.locator('#Name, #name, input[name="Name"], input[name="name"]')
        .first()
        .isVisible()
        .catch(() => false);

      if (!onItemForm) {
        // Fall back: navigate back to sale page and click "Add Item"
        await page.goto(ES_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
        const addBtn = await findFirst(page, [
          'a:has-text("Add Item")',
          'button:has-text("Add Item")',
          'a:has-text("Add Listing")',
          'button:has-text("Add Listing")',
          'a:has-text("New Item")',
          'a[href*="add-item"]',
          'a[href*="items/new"]',
          'a[href*="AddItem"]',
          '.add-item-btn',
        ]);
        if (!addBtn) {
          await screenshot(page, `es-no-add-button-lot-${i + 1}`);
          throw new Error(
            `[agent] Could not find "Add Item" button on EstateSales.net sale page.\n` +
            `  Check screenshot "es-no-add-button-lot-${i + 1}" and update selectors.`
          );
        }
        await addBtn.click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
      }

      await screenshot(page, `es-add-item-form-lot-${i + 1}`);

      // Fill item name / title
      const nameEl = await findFirst(page, [
        '#Name',
        '#name',
        '#ItemName',
        'input[name="Name"]',
        'input[name="name"]',
        'input[name="ItemName"]',
        'input[placeholder*="name" i]',
        'input[placeholder*="title" i]',
        'input[id*="name" i]',
        'input[id*="title" i]',
      ]);
      if (nameEl) {
        await nameEl.fill(lot.title);
      } else {
        console.warn(`[agent]   WARNING: Could not find name/title field for lot ${i + 1}`);
      }

      // Fill description
      // EstateSales.net may use a plain textarea or a rich text editor
      const descEl = await findFirst(page, [
        '#Description',
        '#description',
        'textarea[name="Description"]',
        'textarea[name="description"]',
        'textarea[id*="description" i]',
        'textarea[placeholder*="description" i]',
      ], 3_000);

      if (descEl) {
        await descEl.fill(lot.description || lot.title);
      } else {
        // Try TinyMCE / rich text editor
        const tinyFilled = await page.evaluate((desc) => {
          if (window.tinymce && window.tinymce.editors?.length > 0) {
            window.tinymce.editors[0].setContent(desc);
            return true;
          }
          return false;
        }, lot.description || lot.title).catch(() => false);

        if (!tinyFilled) {
          console.warn(`[agent]   WARNING: Could not find description field for lot ${i + 1}`);
        }
      }

      // Fill price
      const priceEl = await findFirst(page, [
        '#Price',
        '#price',
        '#StartingBid',
        'input[name="Price"]',
        'input[name="price"]',
        'input[name="StartingBid"]',
        'input[placeholder*="price" i]',
        'input[placeholder*="bid" i]',
        'input[id*="price" i]',
      ], 3_000);
      if (priceEl) {
        await priceEl.fill(String(lot.price || 1));
      } else {
        console.warn(`[agent]   WARNING: Could not find price field for lot ${i + 1}`);
      }

      // Upload images
      if (lot.imageUrls && lot.imageUrls.length > 0) {
        await uploadImagesToEstateSales(page, lot, i + 1);
      }

      // ── Step 3: Submit and require positive save confirmation ─────────────
      // Match the visible Save/Add Item button by TEXT before falling back to a
      // generic type=submit. The add-item form has stray submit buttons (Back,
      // Clear, Cancel); a generic-first selector could click the wrong one,
      // navigate to a benign page, and false-positive the save confirmation.
      // Mirrors the login block's defensive ordering.
      const saveEl = await findFirst(page, [
        'button:has-text("Save")',
        'button:has-text("Add Item")',
        'button:has-text("Create")',
        'button:has-text("Submit")',
        'button:has-text("Post")',
        'button[type="submit"]',
        'input[type="submit"]',
      ]);
      if (!saveEl) {
        await screenshot(page, `es-no-save-button-lot-${i + 1}`);
        const msg = `Could not find save/submit button for lot ${i + 1}`;
        console.warn(`[agent]   WARNING: ${msg}`);
        await markLotFailed(lot);
        failedLots.push({ index: i + 1, title: lot.title, error: msg });
        continue;
      }

      const preSaveUrl = page.url();
      await saveEl.click();

      // Require a positive confirmation before counting as succeeded
      const confirmed = await checkSaveConfirmation(page, preSaveUrl);
      await screenshot(page, `es-after-save-lot-${i + 1}`);

      if (confirmed) {
        // Positive signal — record in ledger (throws if ledger write fails)
        // This is the hard-stop: uploaded to ES but can't record → run stops.
        await confirmLotUploaded(lot);
        succeeded++;
        console.log(`[agent]   Lot ${i + 1} saved and confirmed: "${lot.title.slice(0, 60)}"`);
        if (succeeded % 5 === 0) {
          await updateJobFields({ lots_uploaded: succeeded, lots_skipped: skippedCount });
        }
      } else {
        // No positive confirmation — mark failed so operator can investigate
        console.warn(`[agent]   WARNING: No save confirmation signal for lot ${i + 1} — marking failed`);
        await markLotFailed(lot);
        failedLots.push({ index: i + 1, title: lot.title, error: 'No positive save confirmation signal after clicking Save' });
      }

    } catch (err) {
      await screenshot(page, `es-error-lot-${i + 1}`);
      console.error(`[agent]   ERROR uploading lot ${i + 1}: ${err.message}`);
      // Any fatal ledger anomaly after a confirmed upload (write error OR a
      // missing/foreign reservation) must hard-stop the run — manual
      // intervention required, do not continue and risk masking a duplicate.
      if (err.fatalLedger) {
        throw err;
      }
      await markLotFailed(lot);
      failedLots.push({ index: i + 1, title: lot.title, error: err.message });
    }
  }

  return { succeeded, failed: failedLots.length, failedLots, skipped: skippedCount };
}

/**
 * uploadImagesToEstateSales(page, lot, lotIndex)
 *
 * Downloads each image from DOA to a temp file, then uploads via the
 * EstateSales.net file input.
 */
async function uploadImagesToEstateSales(page, lot, lotIndex) {
  // Download images to local temp files
  const localPaths = [];
  for (let j = 0; j < lot.imageUrls.length; j++) {
    const url = lot.imageUrls[j];
    const ext = url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
    const dest = path.join(IMAGES_DIR, `lot-${lot.lot_number}-img-${j + 1}.${ext}`);
    try {
      await downloadImage(url, dest);
      localPaths.push(dest);
    } catch (err) {
      console.warn(`[agent]   Could not download image ${j + 1} for lot ${lotIndex}: ${err.message}`);
    }
  }

  if (localPaths.length === 0) return;

  // Find the file input on the EstateSales.net form
  const fileInput = await findFirst(page, [
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
    '#images',
    '#photos',
    'input[name="images"]',
    'input[name="photos"]',
    'input[name="Images"]',
    'input[name="Photos"]',
    'input[id*="image" i][type="file"]',
    'input[id*="photo" i][type="file"]',
  ], 3_000);

  if (fileInput) {
    await fileInput.setInputFiles(localPaths);
    // Wait briefly for any upload progress
    await page.waitForTimeout(2_000).catch(() => {});
    console.log(`[agent]   Uploaded ${localPaths.length} image(s) for lot ${lotIndex}`);
  } else {
    console.warn(`[agent]   WARNING: No file input found for images on lot ${lotIndex} — images not uploaded`);
  }

  // Clean up temp image files
  for (const p of localPaths) {
    try { fs.unlinkSync(p); } catch { /* non-fatal */ }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  if (!DOA_EMAIL || !DOA_PASSWORD || !DOA_URL) {
    throw new Error('DOA_EMAIL, DOA_PASSWORD, and DOA_URL are required');
  }
  if (!ES_URL) {
    throw new Error('ESTATESALES_URL is required');
  }
  if (!ES_STORAGE_STATE && (!ES_EMAIL || !ES_PASSWORD)) {
    throw new Error(
      'EstateSales.net auth is missing. Provide either:\n' +
      '  ES_STORAGE_STATE (exported Playwright session JSON — preferred for Google-SSO accounts), OR\n' +
      '  ESTATESALES_EMAIL + ESTATESALES_PASSWORD (email/password login).\n' +
      'Set credentials in VZT Settings.'
    );
  }

  await updateJobStatus('running');

  // Parse storageState JSON if provided (Google-SSO session import)
  let parsedStorageState;
  if (ES_STORAGE_STATE) {
    try {
      parsedStorageState = JSON.parse(ES_STORAGE_STATE);
    } catch (e) {
      throw new Error('[agent] ES_STORAGE_STATE is not valid session JSON — re-export it from VZT Settings.');
    }
  }

  const browser = await chromium.launch({ headless: IS_CI });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    storageState: parsedStorageState,
  });
  const page = await context.newPage();

  let lots = [];

  try {
    // ── Phase 1: DOA login + scrape ──────────────────────────────────────────
    console.log('\n[agent] ── Phase 1: DOA Scrape ──────────────────────────────');

    console.log('[agent] Logging into DOA...');
    await page.goto('https://denveronlineauctions.com/Account/Login', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    // #MainContent_Email avoids the newsletter popup email input
    await page.fill('#MainContent_Email', DOA_EMAIL);
    await page.fill('#MainContent_Password', DOA_PASSWORD);
    // ASP.NET WebForms login — submit is an <input>, not a <button>
    const doaSubmit = await findFirst(page, [
      '#MainContent_LoginButton',
      'input[type="submit"]',
      'button[type="submit"]',
      'button:has-text("Log in")',
      'input[value="Log in"]',
    ]);
    if (!doaSubmit) throw new Error('[agent] Could not find DOA login submit button.');
    await doaSubmit.click();
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
    await screenshot(page, 'doa-after-login');

    // Verify login
    const afterLoginUrl = page.url();
    if (afterLoginUrl.includes('/Account/Login')) {
      throw new Error(
        '[agent] DOA login failed — still on login page.\n' +
        '  Check screenshot "doa-after-login". Verify DOA credentials in VZT Settings.'
      );
    }
    console.log('[agent] Logged into DOA successfully.');

    lots = await scrapeLots(page);
    console.log(`\n[agent] Phase 1 complete — scraped ${lots.length} lot(s).`);
    await updateJobFields({ lots_scraped: lots.length });

    if (lots.length === 0) {
      throw new Error(
        '[agent] No lots were scraped from DOA.\n' +
        '  Verify the DOA_URL is the auction admin page (EditAuction?id=...).\n' +
        '  Check screenshots for the actual page structure.'
      );
    }

    // ── Phase 2: EstateSales upload ──────────────────────────────────────────
    console.log('\n[agent] ── Phase 2: EstateSales Upload ─────────────────────');
    const uploadResult = await uploadLots(page, lots);
    // On rerun where all lots were already uploaded, report skipped+succeeded
    // so the operator sees "199 of 199" rather than "0 of 199".
    const totalAccountedFor = uploadResult.succeeded + uploadResult.skipped;
    console.log(
      `\n[agent] Phase 2 complete — ${uploadResult.succeeded} newly uploaded, ` +
      `${uploadResult.skipped} already uploaded (skipped), ${uploadResult.failed} failed. ` +
      `(${totalAccountedFor}/${lots.length} total accounted for)`
    );
    await updateJobFields({
      lots_uploaded: uploadResult.succeeded,
      lots_skipped:  uploadResult.skipped,
    });
    if (uploadResult.failed > 0) {
      const summary = uploadResult.failedLots.map(l => `Lot ${l.index}: ${l.error}`).join('; ');
      if (uploadResult.succeeded === 0 && uploadResult.skipped === 0) {
        throw new Error(`All ${uploadResult.failed} lot(s) failed to upload. ${summary}`);
      }
      // Partial success — throw a typed error so the entry point can distinguish
      const partialErr = new Error(`${uploadResult.failed} of ${lots.length - uploadResult.skipped} lot(s) failed: ${summary}`);
      partialErr.partial = true;
      partialErr.succeeded = uploadResult.succeeded;
      throw partialErr;
    }

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
    if (err.partial) {
      console.warn('\n[agent] Partial failure:', err.message);
      // partial_failed is a terminal status and gets completed_at set in updateJobStatus
      await updateJobStatus('partial_failed', err.message);
      process.exit(0);
    }
    console.error('\n[agent] FATAL:', err.message);
    await updateJobStatus('failed', err.message);
    process.exit(1);
  });
