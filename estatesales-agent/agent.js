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

// Optional cap on how many DOA lots to scrape. Set MAX_LOTS=2 to smoke-test the
// EstateSales (Phase 2) path without grinding all ~169 lots. 0/unset = no cap.
const MAX_LOTS           = parseInt(process.env.MAX_LOTS, 10) || 0;

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

// When true, ledger reads/writes are disabled so local smoke tests can never
// touch the production estatesales_uploaded_lots ledger. test-local.js injects a
// fake JOB_ID, which would otherwise write user_id:null rows on real
// (es_url, lot_url) keys and poison the dedup ledger. test-local.js sets
// AGENT_TEST_MODE=true to force this off.
const LEDGER_ENABLED = !!supabase && process.env.AGENT_TEST_MODE !== 'true';

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
  if (!LEDGER_ENABLED) return new Set();
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
  if (!LEDGER_ENABLED) return { claimed: true }; // no ledger → proceed (no dedup)
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
    // A real DB error (not a unique violation). The dedup ledger can no longer be
    // trusted, so fail closed: throw a fatalLedger error to hard-stop the run.
    throw new LedgerError(`[agent] reserveLot DB error for lot ${lot.lot_number}: ${insertErr.message}`);
  }

  // Unique violation — a row already exists for (es_url, lot_url). Inspect it.
  const { data: existing, error: fetchErr } = await supabase
    .from('estatesales_uploaded_lots')
    .select('status, reserved_at')
    .eq('es_url', ES_URL)
    .eq('lot_url', lot.source_url)
    .single();

  if (fetchErr) {
    // Can't read the conflicting row → can't make a safe dedup decision. Fail
    // closed: throw a fatalLedger error to hard-stop the run.
    throw new LedgerError(`[agent] reserveLot: could not read existing row for lot ${lot.lot_number}: ${fetchErr.message}`);
  }

  if (existing.status === 'uploaded') {
    // Truly on ES from a prior run — counts toward lots_uploaded.
    return { claimed: false, alreadyUploaded: true, reason: 'already uploaded in a previous run' };
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
  if (!LEDGER_ENABLED) return; // no ledger — nothing to record
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
  if (!LEDGER_ENABLED || !lot.source_url) return;
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
 * Follows HTTP redirects (CDN/image hosts commonly 301/302 to a signed URL)
 * and accepts any 2xx status, not just 200.
 */
async function downloadImage(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      const { statusCode } = res;

      // Follow redirects (301/302/303/307/308) to the Location target.
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume(); // drain so the socket can be reused
        if (redirectsLeft <= 0) {
          return reject(new Error(`Too many redirects downloading ${url}`));
        }
        const next = new URL(res.headers.location, url).toString();
        return resolve(downloadImage(next, destPath, redirectsLeft - 1));
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} downloading ${url}`));
      }

      const file = fs.createWriteStream(destPath);
      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    });
    req.on('error', (err) => {
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

// ── Phase 1: DOA Scrape ───────────────────────────────────────────────────────

/**
 * scrapeLots(page)
 *
 * Starts at DOA_URL (the first lot's admin edit page, EditAuction?id=NNN),
 * reads each lot's data, then clicks "Save & Edit Next" (#lnkProcess) to
 * advance sequentially until the button is gone (last lot).
 *
 * Returns: Array of { lot_number, title, description, price, imageUrls[] }
 */
async function scrapeLots(page) {
  // DOA_URL is the first lot's admin edit page (EditAuction?id=NNN).
  // We traverse sequentially by clicking "Save & Edit Next" (#lnkProcess)
  // after reading each lot — mirroring the local DOA agent's workflow exactly.
  console.log('[agent] Navigating to first DOA lot...');
  await page.goto(DOA_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await screenshot(page, 'doa-first-lot');

  const lots = [];
  let lotIndex = 0;

  while (true) {
    lotIndex++;
    const currentUrl = page.url();
    console.log(`[agent]   Scraping lot ${lotIndex}: ${currentUrl}`);

    try {
      // Wait for the title field — confirms we're on a lot edit page
      await page.waitForSelector('#txtTitle, input[name*="Title" i]', {
        state: 'visible',
        timeout: WAIT_TIMEOUT,
      }).catch(() => {});

      // Title
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

      // Derive lot number: try title prefix first ("Lot 3 -"), then URL id param
      const titleLotMatch = title.match(/^(?:lot\s*#?\s*)?(\d+)/i);
      const urlIdMatch = currentUrl.match(/[?&](?:id|LotID|lotId|auctionItemId)=(\d+)/i);
      const derivedLotNum = titleLotMatch?.[1] || urlIdMatch?.[1] || String(lotIndex);

      console.log(`[agent]     lot_number=${derivedLotNum} title="${title.slice(0, 60)}" bid=$${price} images=${allImageUrls.length}`);

      lots.push({
        lot_number:  derivedLotNum,
        title:       title || `Lot ${derivedLotNum}`,
        description,
        price,
        imageUrls:   allImageUrls,
        source_url:  currentUrl,
      });
    } catch (err) {
      await screenshot(page, `doa-lot-${lotIndex}-error`);
      console.error(`[agent]   ERROR scraping lot ${lotIndex}: ${err.message} — skipping`);
    }

    // Smoke-test cap: stop scraping once we've collected MAX_LOTS lots.
    if (MAX_LOTS > 0 && lots.length >= MAX_LOTS) {
      console.log(`[agent] MAX_LOTS=${MAX_LOTS} reached — stopping scrape early (smoke-test mode).`);
      break;
    }

    // Advance to the next lot via "Save & Edit Next" (#lnkProcess).
    // Clicking it in read-only mode is safe — no fields were modified,
    // so the server re-saves the same data (no-op for DOA).
    const saveNextEl = await findFirst(page, [
      '#lnkProcess',
      'a[id*="Process" i]',
      'a:has-text("Save & Edit Next")',
      'button:has-text("Save & Edit Next")',
      'input[value*="Save & Edit Next" i]',
    ]);

    if (!saveNextEl) {
      console.log(`[agent] No "Save & Edit Next" button — reached end after ${lotIndex} lot(s).`);
      break;
    }

    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }),
        saveNextEl.click(),
      ]);
    } catch (navErr) {
      console.log(`[agent] Navigation after lot ${lotIndex} timed out (${navErr.message}) — assuming last lot.`);
      break;
    }

    const newUrl = page.url();
    if (newUrl === currentUrl) {
      console.log(`[agent] URL unchanged after "Save & Edit Next" — reached last lot after ${lotIndex} lot(s).`);
      break;
    }
  }

  return lots;
}

// ── Phase 2: EstateSales Upload ───────────────────────────────────────────────

/**
 * uploadLots(page, lots)
 *
 * Logs into EstateSales.net and drives the Sale Wizard › Pictures step, which is
 * a BULK photo uploader (not a per-item form). Three phases:
 *
 *   Step 1 — Bulk upload: for each pending lot, reserveLot() (atomic; conflict →
 *            conservatively skip), download its DOA images, and bulk-upload them
 *            via the "+ UPLOAD" input. Build a flat imageTitles[] so picture
 *            index i maps to the title of the lot that owns that picture.
 *   Step 2 — Caption: open each uploaded picture's editor, paste the owning lot's
 *            title into the description, "Next" until done. A lot is confirmed in
 *            the ledger (confirmLotUploaded) once its images uploaded AND all its
 *            descriptions pasted; otherwise markLotFailed() for retry.
 *
 * The agent NEVER saves the wizard — David clicks "Save and Continue" manually and
 * finishes the rest of the sale setup himself. Ledger confirmation is decoupled
 * from that manual save (see the Pictures-step block below).
 */
async function uploadLots(page, lots) {
  let succeeded = 0;
  let alreadyUploadedCount = 0; // lots confirmed uploaded in a prior run (on ES)
  let blockedCount = 0;         // lots reserved by another run / previously failed — NOT on ES
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
    alreadyUploadedCount += preSkipped;
  }
  if (pending.length === 0) {
    console.log('[agent] All lots already uploaded to this sale — nothing to do.');
    return { succeeded: 0, failed: 0, failedLots: [], skipped: alreadyUploadedCount, blocked: 0 };
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

  // ─────────────────────────────────────────────────────────────────────────
  // EstateSales.net Sale Wizard › Pictures step is a BULK photo uploader, not a
  // per-item form. David's actual flow:
  //   1. Bulk-add every lot's images to the Pictures step (one Upload action).
  //   2. Open each uploaded picture and paste the owning lot's title into the
  //      description, hitting "Next" until done.
  // The agent STOPS there. David hits "Save and Continue" and finishes the rest
  // of the wizard setup manually — the agent must never save the wizard.
  // We upload in lot order and build a flat imageTitles[] so picture index i
  // maps to the title of the lot that owns that picture.
  // ─────────────────────────────────────────────────────────────────────────

  // ── Step 1: Bulk-upload images, per-lot batches ──────────────────────────
  const imageTitles = [];        // flat: imageTitles[pictureIndex] = lot title
  const uploadedLotState = [];   // { lot, startIdx, count } — confirmed once captioned (not on save)
  let thumbCount = await countEsThumbnails(page);

  for (let i = 0; i < pending.length; i++) {
    const lot = pending[i];
    console.log(`\n[agent] Lot ${i + 1}/${pending.length}: "${lot.title.slice(0, 60)}" — reserving + uploading images`);

    // Atomically reserve the lot (race-safe claim; conflict → conservatively skip)
    let reservation;
    try {
      reservation = await reserveLot(lot, jobUserId);
    } catch (reserveErr) {
      // reserveLot throws only on a real ledger DB error (LedgerError, fatalLedger).
      // That breaks the dedup guarantee for every remaining lot, so fail closed and
      // hard-stop the whole run — continuing would risk duplicate uploads.
      await screenshot(page, `es-reserve-error-lot-${i + 1}`);
      console.error(`[agent]   FATAL ledger error reserving lot ${i + 1}: ${reserveErr.message}`);
      throw reserveErr;
    }
    if (!reservation.claimed) {
      console.log(`[agent]   Skipping lot ${i + 1} — ${reservation.reason}`);
      // Only a row already at status 'uploaded' is truly on ES; 'reserved'/'failed'
      // are blocked and must NOT be counted as uploaded (they need reconciliation).
      if (reservation.alreadyUploaded) alreadyUploadedCount++;
      else blockedCount++;
      continue;
    }

    if (!lot.imageUrls || lot.imageUrls.length === 0) {
      const msg = `Lot ${i + 1} has no images to upload`;
      console.warn(`[agent]   WARNING: ${msg}`);
      await markLotFailed(lot);
      failedLots.push({ index: i + 1, title: lot.title, error: msg });
      continue;
    }

    try {
      const uploaded = await uploadLotImages(page, lot, i + 1, thumbCount);
      if (uploaded === 0) {
        const msg = `No images uploaded for lot ${i + 1}`;
        console.warn(`[agent]   WARNING: ${msg}`);
        await markLotFailed(lot);
        failedLots.push({ index: i + 1, title: lot.title, error: msg });
        continue;
      }
      thumbCount += uploaded;
      const startIdx = imageTitles.length;
      for (let k = 0; k < uploaded; k++) imageTitles.push(lot.title);
      uploadedLotState.push({ lot, startIdx, count: uploaded });
      console.log(`[agent]   Uploaded ${uploaded} image(s) for lot ${i + 1}`);
    } catch (err) {
      await screenshot(page, `es-upload-error-lot-${i + 1}`);
      console.error(`[agent]   ERROR uploading images for lot ${i + 1}: ${err.message}`);
      await markLotFailed(lot);
      failedLots.push({ index: i + 1, title: lot.title, error: err.message });
    }
  }

  if (imageTitles.length === 0) {
    console.warn('[agent] No images uploaded for any lot — nothing to caption.');
    return { succeeded, failed: failedLots.length, failedLots, skipped: alreadyUploadedCount, blocked: blockedCount };
  }

  // ── Step 2: Per-image description pass ───────────────────────────────────
  // Open each uploaded picture's editor and paste its owning lot's title into
  // the description, advancing with "Next" until all images are captioned.
  // captionResults[i] = whether picture i's description was set. On a thrown
  // error captionResults stays [] → every lot reads as not-captioned → marked
  // failed (fail-safe: never confirm a lot whose descriptions did not paste).
  let captionResults = [];
  try {
    captionResults = await captionEsImages(page, imageTitles);
    const captioned = captionResults.filter(Boolean).length;
    console.log(`[agent]   Captioned ${captioned}/${imageTitles.length} image(s).`);
  } catch (err) {
    await screenshot(page, 'es-caption-error');
    console.error(`[agent]   ERROR during description pass: ${err.message}`);
  }

  // ── Ledger: confirm lots whose images uploaded AND descriptions pasted ────
  // "uploaded" in the ledger = images on ES + descriptions captioned. Final
  // wizard persistence ("Save and Continue") is David's manual step, decoupled
  // from the ledger — the agent never saves. A ledger anomaly in
  // confirmLotUploaded throws (fatalLedger) and hard-stops the run.
  for (const { lot, startIdx, count } of uploadedLotState) {
    const allCaptioned = count > 0 &&
      Array.from({ length: count }, (_, k) => captionResults[startIdx + k]).every(Boolean);
    if (allCaptioned) {
      await confirmLotUploaded(lot);
      succeeded++;
    } else {
      await markLotFailed(lot);
      failedLots.push({ index: null, title: lot.title,
        error: 'Image description not captioned (agent does not save; left for retry)' });
    }
  }
  console.log(`[agent]   ${succeeded} lot(s) confirmed (images + descriptions). ` +
    `David completes "Save and Continue" manually.`);

  // Job-field accounting is owned by run() (single source of truth) — it folds in
  // alreadyUploaded/blocked counts before writing lots_uploaded/lots_skipped.
  return { succeeded, failed: failedLots.length, failedLots, skipped: alreadyUploadedCount, blocked: blockedCount };
}

/**
 * countEsThumbnails(page)
 *
 * Counts the uploaded picture thumbnails currently shown in the Pictures step's
 * "Images" grid. Used to confirm a batch upload registered (count rises by the
 * number of files sent). Selectors are a resilient cascade — refine against the
 * es-pictures-* / es-image-editor-* screenshots if the count reads 0.
 */
async function countEsThumbnails(page) {
  try {
    return await page.evaluate(() => {
      const selectors = [
        '.image-grid img',
        '[class*="image-list"] img',
        '[class*="picture-list"] img',
        '[class*="thumbnail"] img',
        '[class*="thumbnail"]',
        '[class*="image-card"]',
        'img[src*="estatesales"]',
      ];
      for (const sel of selectors) {
        const n = document.querySelectorAll(sel).length;
        if (n > 0) return n;
      }
      return 0;
    });
  } catch {
    return 0;
  }
}

/**
 * uploadLotImages(page, lot, lotIndex, priorThumbCount)
 *
 * Downloads a lot's images from DOA to temp files, then bulk-uploads them via
 * the Pictures step's "+ UPLOAD" hidden <input type="file" multiple>. Waits for
 * the thumbnail count to rise by the number of files sent (best-effort), then
 * cleans up. Returns the number of files sent (used to map picture index →
 * owning lot title). Throws if no file input can be found.
 */
async function uploadLotImages(page, lot, lotIndex, priorThumbCount) {
  // Download images to local temp files (zero-padded for stable upload order)
  const localPaths = [];
  for (let j = 0; j < lot.imageUrls.length; j++) {
    const url = lot.imageUrls[j];
    const ext = url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
    const seq = String(j + 1).padStart(3, '0');
    const dest = path.join(IMAGES_DIR, `lot-${lot.lot_number}-img-${seq}.${ext}`);
    try {
      await downloadImage(url, dest);
      localPaths.push(dest);
    } catch (err) {
      console.warn(`[agent]   Could not download image ${j + 1} for lot ${lotIndex}: ${err.message}`);
    }
  }
  if (localPaths.length === 0) return 0;

  // Locate the bulk "+ UPLOAD" file input. The visible blue "+ UPLOAD" button
  // proxies to a hidden <input type="file" multiple>; target it directly.
  let fileInput = await findFirst(page, [
    'input[type="file"][multiple]',
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
  ], 5_000);

  // Some Angular uploaders only inject the input after the button is clicked.
  if (!fileInput) {
    const uploadBtn = await findFirst(page, [
      'button:has-text("UPLOAD")',
      'button:has-text("Upload")',
      'a:has-text("UPLOAD")',
      '[class*="upload"] button',
    ], 3_000);
    if (uploadBtn) {
      await uploadBtn.click().catch(() => {});
      fileInput = await findFirst(page, [
        'input[type="file"][multiple]',
        'input[type="file"]',
      ], 3_000);
    }
  }

  if (!fileInput) {
    await screenshot(page, `es-no-file-input-lot-${lotIndex}`);
    throw new Error(
      `[agent] Could not find the "+ UPLOAD" file input on the Pictures step ` +
      `(lot ${lotIndex}). Check screenshot "es-no-file-input-lot-${lotIndex}" and update selectors.`
    );
  }

  await fileInput.setInputFiles(localPaths);

  // Wait for the uploads to register: network settle + thumbnail count rise.
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT }).catch(() => {});
  const target = priorThumbCount + localPaths.length;
  const deadline = Date.now() + 60_000;
  let registered = false;
  while (Date.now() < deadline) {
    if ((await countEsThumbnails(page)) >= target) { registered = true; break; }
    await page.waitForTimeout(1_000);
  }
  if (!registered) {
    // Thumbnails couldn't be counted (selector miss) or upload is slow — give
    // it a final settle. setInputFiles itself succeeded, so proceed best-effort.
    await page.waitForTimeout(2_000).catch(() => {});
  }

  // Clean up temp image files
  for (const p of localPaths) {
    try { fs.unlinkSync(p); } catch { /* non-fatal */ }
  }

  return localPaths.length;
}

/**
 * captionEsImages(page, imageTitles)
 *
 * Opens the first uploaded picture's editor (David's two-step: click the image,
 * then click the orange pencil), then for each picture pastes the owning lot's
 * title (imageTitles[i]) into the description field and advances with "Next"
 * until all pictures are captioned or Next is unavailable. Returns a boolean
 * array results[] (length = imageTitles.length); results[i] = whether picture i's
 * description was set. If Next fails to advance mid-pass, the loop breaks and the
 * remaining entries stay false. Screenshots the editor on first open so the
 * description/Next selectors can be refined against real DOM.
 */
async function captionEsImages(page, imageTitles) {
  const total = imageTitles.length;
  const results = new Array(total).fill(false);

  // Open the first image's editor. David's flow is click the image, then click
  // the orange pencil icon — lead with pencil-specific selectors, then fall back.
  const openEditor = await findFirst(page, [
    '.fa-pencil',
    'i[class*="pencil"]',
    '[aria-label*="edit" i]',
    'button[title*="edit" i]',
    '[class*="image"] [class*="edit"]',
    '.fa-edit',
    '[class*="image-card"]',
    '[class*="thumbnail"]',
    '.image-grid img',
  ], 5_000);
  if (!openEditor) {
    await screenshot(page, 'es-no-image-editor');
    throw new Error('[agent] Could not open the image editor on the Pictures step. Check screenshot "es-no-image-editor".');
  }
  await openEditor.click().catch(() => {});
  await page.waitForTimeout(1_500);
  await screenshot(page, 'es-image-editor-first'); // refine selectors from this

  for (let i = 0; i < total; i++) {
    const ok = await fillEsImageDescription(page, imageTitles[i]);
    results[i] = ok;
    if (!ok) console.warn(`[agent]   WARNING: could not set description for image ${i + 1}/${total}`);

    if (i < total - 1) {
      const advanced = await clickEsNext(page);
      if (!advanced) {
        console.warn(`[agent]   No "Next" available after image ${i + 1}/${total} — ending caption pass early.`);
        break;
      }
      await page.waitForTimeout(800);
    }
  }
  return results;
}

/**
 * fillEsImageDescription(page, text)
 *
 * Sets the image editor's description field via a resilient cascade:
 * plain textarea/input → contenteditable → TinyMCE → raw textarea value.
 * Returns true if any path succeeded.
 */
async function fillEsImageDescription(page, text) {
  const descEl = await findFirst(page, [
    'textarea[name*="description" i]',
    'textarea[id*="description" i]',
    'textarea[placeholder*="description" i]',
    'textarea[placeholder*="caption" i]',
    'input[name*="description" i]',
    'textarea',
  ], 3_000);
  if (descEl) {
    try {
      await descEl.fill('');
      await descEl.fill(text);
      return true;
    } catch { /* fall through to DOM cascade */ }
  }

  return await page.evaluate((t) => {
    const ce = document.querySelector('[contenteditable="true"]');
    if (ce) {
      ce.focus();
      ce.innerHTML = t;
      ce.dispatchEvent(new Event('input', { bubbles: true }));
      ce.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (window.tinymce && window.tinymce.editors && window.tinymce.editors.length > 0) {
      window.tinymce.editors[0].setContent(t);
      return true;
    }
    const ta = document.querySelector(
      'textarea[name*="description" i], textarea[id*="description" i], textarea'
    );
    if (ta) {
      ta.value = t;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }, text).catch(() => false);
}

/**
 * clickEsNext(page)
 *
 * Advances the image editor to the next picture. Returns false if no enabled
 * "Next" control exists (end of the set).
 */
async function clickEsNext(page) {
  const nextEl = await findFirst(page, [
    'button:has-text("Next"):not([disabled])',
    'button[aria-label*="next" i]:not([disabled])',
    '[class*="next"]:not([disabled])',
    'button:has-text(">"):not([disabled])',
  ], 3_000);
  if (!nextEl) return false;
  if (await nextEl.isDisabled().catch(() => false)) return false;
  await nextEl.click().catch(() => {});
  return true;
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
    const { succeeded, failed, failedLots } = uploadResult;
    const skipped = uploadResult.skipped;          // confirmed uploaded in a prior run
    const blocked = uploadResult.blocked ?? 0;     // reserved by another run / previously failed
    // CONFIRMED on ES = newly uploaded this run + already-uploaded in a prior run.
    // Blocked lots are NOT on ES (or unconfirmed) and must never be counted as
    // uploaded — counting them would let a job report success with missing items.
    const confirmedUploaded = succeeded + skipped;
    console.log(
      `\n[agent] Phase 2 complete — ${succeeded} newly uploaded, ` +
      `${skipped} already uploaded (skipped), ${blocked} blocked (needs reconciliation), ` +
      `${failed} failed. (${confirmedUploaded}/${lots.length} confirmed on ES)`
    );
    await updateJobFields({
      lots_uploaded: confirmedUploaded,
      lots_skipped:  skipped,
    });
    const problems = failed + blocked;
    if (problems > 0) {
      const failSummary = failedLots.map(l => `Lot ${l.index ?? '?'}: ${l.error}`).join('; ');
      const blockedNote = blocked > 0
        ? `${blocked} lot(s) blocked (reserved by another run or previously failed — verify on ES, then clear/mark the ledger row to retry)`
        : '';
      const parts = [failSummary, blockedNote].filter(Boolean).join('; ');
      if (confirmedUploaded === 0) {
        throw new Error(`No lots confirmed on ES — ${problems} lot(s) failed/blocked. ${parts}`);
      }
      // Partial success — throw a typed error so the entry point can distinguish
      const partialErr = new Error(`${problems} of ${lots.length} lot(s) not confirmed: ${parts}`);
      partialErr.partial = true;
      partialErr.succeeded = succeeded;
      throw partialErr;
    }

  } catch (err) {
    await screenshot(page, 'error-state');
    throw err;
  } finally {
    await browser.close();
    // Remove the temp dir of downloaded customer photos even on crash —
    // per-file cleanup in uploadLotImages only covers the happy path, so an
    // error mid-run would otherwise leave private images on disk.
    try { fs.rmSync(IMAGES_DIR, { recursive: true, force: true }); } catch { /* non-fatal */ }
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
