/**
 * agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * EstateSales.net Upload Agent
 *
 * Phase 1 — DOA Scrape (public pages, no login):
 *   Load the public auction grid (DOA_URL = /auction/<slug>) and read one lot
 *   per card: the title from the image alt text, and the card's thumbnail URL
 *   rewritten to its full-size original. Requires no DOA account and never
 *   writes to DOA. One photo per lot by design.
 *
 * Phase 2 — EstateSales Upload:
 *   Log into EstateSales.net → navigate to the sale management page (ES_URL)
 *   → for each scraped lot, open the add-item form, fill all fields, download
 *   and re-upload images, and save.
 *
 * All credentials and URLs are injected via process.env by runAgent.js.
 *
 * EstateSales.net login: native email + password on every run.
 *   Requires ESTATESALES_EMAIL + ESTATESALES_PASSWORD, injected by runAgent.js
 *   from the encrypted credentials stored in VZT Settings.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'node:url';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createClient } from '@supabase/supabase-js';

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

// The stealth plugin's spoofs (fake plugins, chrome.runtime mock) are a decade
// of cat-and-mouse and are themselves detectable by modern anti-bot checks —
// reCAPTCHA v3 on the ES sign-in form masked-rejects logins it scores as bots.
// Only use stealth where it's load-bearing: headless CI. A headed local run on
// real Chrome presents a genuine fingerprint that spoofs would only corrupt.
if (IS_CI) chromium.use(StealthPlugin());

// Persistent local browser profile (gitignored). reCAPTCHA v3 scores are
// reputation-based — a cookie-less fresh context every run starts at the
// bottom. Reusing one profile lets the score build across runs.
// Anchored to this file, not the process CWD — launching from the repo root
// would otherwise drop a cookie-bearing profile outside the .gitignore rule.
const CHROME_PROFILE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.chrome-profile');
const SCREENSHOTS_DIR    = './screenshots';
const IMAGES_DIR         = './downloaded-images';

const NAV_TIMEOUT        = 30_000;
const WAIT_TIMEOUT       = 15_000;

// Optional cap on how many DOA lots to scrape. Set MAX_LOTS=2 to smoke-test the
// EstateSales (Phase 2) path without grinding all ~169 lots. 0/unset = no cap.
const MAX_LOTS           = parseInt(process.env.MAX_LOTS, 10) || 0;

// Optional starting lot number, for topping up a sale that was already uploaded.
// When lots are added to a DOA auction after an earlier run, set START_LOT to the
// first NEW lot number and everything below it is skipped, so the photos already
// on EstateSales are not uploaded a second time.
//
// This is the duplicate guard for LOCAL runs specifically: test-local.js sets
// AGENT_TEST_MODE=true, which disables the estatesales_uploaded_lots ledger, so
// nothing else remembers what a previous run uploaded. A ledger-backed run
// (real JOB_ID via runAgent.js) skips duplicates on its own and does not need
// this. 0/unset = start at the first lot.
const START_LOT          = parseInt(process.env.START_LOT, 10) || 0;

// Diagnostic: run Phase 1 only and upload nothing. For checking what the DOA
// scrape actually returns without spending an EstateSales sign-in attempt.
const SCRAPE_ONLY        = process.env.SCRAPE_ONLY === 'true';

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

// AGENT_TEST_MODE disables the ledger so local smoke tests can never touch the
// production estatesales_uploaded_lots ledger. test-local.js injects a fake
// JOB_ID, which would otherwise write user_id:null rows on real (es_url, lot_url)
// keys and poison the dedup ledger. test-local.js sets AGENT_TEST_MODE=true.
const AGENT_TEST_MODE = process.env.AGENT_TEST_MODE === 'true';

// FAIL CLOSED. The dedup ledger is the only thing standing between a real run and
// duplicate uploads (David's rule: duplicates are worse than blocked runs). A
// non-test run with no Supabase client or no JOB_ID would silently run WITHOUT
// dedup — exactly the failure we must never allow. So a real run REQUIRES both;
// abort at startup if either is missing. Only AGENT_TEST_MODE may run ledger-less.
if (!AGENT_TEST_MODE) {
  if (!supabase) {
    console.error('[agent] FATAL: SUPABASE_URL + SUPABASE_SERVICE_KEY are required for a real run.');
    console.error('  Without them the dedup ledger is disabled and the agent could upload duplicates.');
    console.error('  For a local no-ledger smoke test, run via test-local.js (sets AGENT_TEST_MODE=true).');
    process.exit(1);
  }
  if (!JOB_ID) {
    console.error('[agent] FATAL: JOB_ID is required for a real run (scopes the dedup ledger by tenant).');
    console.error('  It is injected by runAgent.js / the job runner. For a local smoke test use test-local.js.');
    process.exit(1);
  }
}

// True only when a real, ledger-backed run is in effect. AGENT_TEST_MODE forces
// it off; the fail-closed guard above guarantees supabase + JOB_ID exist here.
const LEDGER_ENABLED = !!supabase && !AGENT_TEST_MODE;

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
async function fetchUploadedLotUrls(jobUserId) {
  if (!LEDGER_ENABLED) return new Set();
  // Service-role key bypasses RLS — scope by user_id in code so one tenant's
  // ledger never hides another tenant's lots.
  const { data, error } = await supabase
    .from('estatesales_uploaded_lots')
    .select('lot_url')
    .eq('user_id', jobUserId)
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
    .eq('user_id', jobUserId)
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
async function confirmLotUploaded(lot, jobUserId) {
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
    .eq('user_id', jobUserId)
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
async function markLotFailed(lot, jobUserId) {
  if (!LEDGER_ENABLED || !lot.source_url) return;
  let query = supabase
    .from('estatesales_uploaded_lots')
    .update({ status: 'failed' })
    .eq('user_id', jobUserId)
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

// EstateSales.net is an Angular SPA: it renders the sign-in wall WITHOUT
// changing the URL, so URL-based auth checks silently pass when unauthenticated.
// Detect auth state by the DOM instead — a visible password field on a page that
// should be authenticated means we are still walled.
// NOTE: must match the same selector family the login fill uses. The password
// field can sit revealed as type="text" (value visible in plaintext), which a
// bare input[type="password"] check misses — that miss once turned a rejected
// login into a false "success" that surfaced later as "+ UPLOAD not found".
async function onSignInWall(page) {
  const candidates = page.locator(
    '#password-input, #password, input[name="password"], input[type="password"], input[placeholder*="password" i]'
  );
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    if (await candidates.nth(i).isVisible().catch(() => false)) return true;
  }
  // Fallback marker in case the form markup changes: the wall's heading.
  return await page.getByText(/sign in to estatesales/i).first().isVisible().catch(() => false);
}

// Per-image download guards. A hung CDN socket or a runaway response would
// otherwise stall the whole run (no timeout) or fill the disk (no size cap).
const DOWNLOAD_TIMEOUT_MS = 30_000;          // abort a single image after 30s
const DOWNLOAD_MAX_BYTES  = 25 * 1024 * 1024; // 25 MB ceiling per image

/**
 * Download a remote image to a local temp file. Returns the local path.
 * Follows HTTP redirects (CDN/image hosts commonly 301/302 to a signed URL)
 * and accepts any 2xx status, not just 200. Enforces a request timeout and a
 * max-byte ceiling; any failure unlinks the partial file before rejecting.
 */
async function downloadImage(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      fs.unlink(destPath, () => {});
      reject(err);
    };
    const req = client.get(url, (res) => {
      const { statusCode } = res;

      // Follow redirects (301/302/303/307/308) to the Location target.
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume(); // drain so the socket can be reused
        if (redirectsLeft <= 0) {
          return fail(new Error(`Too many redirects downloading ${url}`));
        }
        const next = new URL(res.headers.location, url).toString();
        settled = true; // hand off to the recursive call; don't unlink here
        return resolve(downloadImage(next, destPath, redirectsLeft - 1));
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        return fail(new Error(`HTTP ${statusCode} downloading ${url}`));
      }

      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > DOWNLOAD_MAX_BYTES) {
          req.destroy();
          fail(new Error(`Image exceeds ${DOWNLOAD_MAX_BYTES} bytes: ${url}`));
        }
      });

      const file = fs.createWriteStream(destPath);
      file.on('error', fail);
      res.pipe(file);
      file.on('finish', () => {
        if (settled) return;
        settled = true;
        file.close();
        resolve(destPath);
      });
    });
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy();
      fail(new Error(`Timed out after ${DOWNLOAD_TIMEOUT_MS}ms downloading ${url}`));
    });
    req.on('error', fail);
  });
}

// ── Phase 1: DOA Scrape ───────────────────────────────────────────────────────

/**
 * scrapeLots(page)
 *
 * Reads the PUBLIC DOA auction grid at DOA_URL (/auction/<slug>) and returns one
 * lot per grid card: the lot's title and its primary photo at full resolution.
 *
 * Why the public grid rather than the admin form:
 *   - No DOA account needed. The old admin walk required a login whose field IDs
 *     DOA renames periodically; that broke this agent twice (see git b21f3b8).
 *   - The admin walk advanced by clicking "Save & Edit Next", which re-saved
 *     every lot of a live auction just to read it. This path never writes to DOA.
 *   - One page load instead of one per lot.
 *
 * Image URLs: the grid serves 300x300 thumbnails named "<id>_thumbnail.jpg".
 * Dropping the "_thumbnail" suffix returns the 1080x1080 original from the same
 * CDN path (verified live 2026-08-15). We always upload the original.
 *
 * Cards are located by the CDN thumbnail URL shape, not by class name: DOA's
 * markup churns, but the xpert.b-cdn.net URL pattern has been stable.
 *
 * Returns: Array of { lot_number, title, description, price, imageUrls[], source_url }
 *   description is '' and price is 0 -- the grid does not carry them, and Phase 2
 *   consumes only title, imageUrls, lot_number and source_url.
 */
async function scrapeLots(page) {
  if (/EditAuction/i.test(DOA_URL || '')) {
    throw new Error(
      '[agent] DOA_URL is an admin EditAuction link, but this agent reads the public auction grid.\n' +
      '  Paste the public auction page instead, e.g.\n' +
      '    https://denveronlineauctions.com/auction/<auction-slug>'
    );
  }

  console.log('[agent] Loading DOA auction grid...');
  await page.goto(DOA_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  // Thumbnails render client-side; wait for at least one before reading the DOM.
  await page.waitForSelector('img[src*="xpert.b-cdn.net"]', { state: 'attached', timeout: WAIT_TIMEOUT })
    .catch(() => {});
  // Wait for the lot ANCHORS too, not just the images. Each lot's dedup key is
  // its permalink; reading while the links are still attaching yields cards with
  // no href, which all collapse to the same key and drop the auction to one lot.
  await page.waitForSelector('a[href*="/lot-"]', { state: 'attached', timeout: WAIT_TIMEOUT })
    .catch(() => {});
  await screenshot(page, 'doa-grid');

  const { cards, noPhoto } = await page.evaluate(() => {
    const out = [];
    const noPhoto = [];
    for (const img of Array.from(document.querySelectorAll('img'))) {
      const src = img.src || '';
      const alt = (img.alt || '').trim();
      // A real lot photo: DOA's CDN, thumbnail variant. Excludes /logos/ art.
      const isLotPhoto = /xpert\.b-cdn\.net/i.test(src) && /_thumbnail\.[a-z]+(\?|$)/i.test(src);

      if (!isLotPhoto) {
        // A lot card whose image is DOA's grey placeholder (/images/300x300.svg)
        // has no photo uploaded yet. Record it so the skip is visible, then
        // leave it out — posting a placeholder to a live listing is worse than
        // posting nothing.
        const lotMatch = alt.match(/lot\s*#?\s*(\d+)/i);
        if (lotMatch) noPhoto.push(parseInt(lotMatch[1], 10));
        continue;
      }

      // Climb to the nearest ancestor that also carries the lot permalink.
      let el = img, href = '';
      for (let i = 0; i < 8 && el; i++) {
        el = el.parentElement;
        const a = el && el.querySelector('a[href*="/lot-"]');
        if (a) { href = a.getAttribute('href') || ''; break; }
      }
      out.push({ alt, src, href });
    }
    return { cards: out, noPhoto };
  });

  console.log(`[agent] Grid: ${cards.length} lot(s) with photos, ${noPhoto.length} without.`);
  if (noPhoto.length) {
    const nums = [...new Set(noPhoto)].sort((a, b) => a - b);
    const contiguous = nums.length > 1 && nums[nums.length - 1] - nums[0] === nums.length - 1;
    const listed = contiguous ? `#${nums[0]}-#${nums[nums.length - 1]}` : nums.map(n => `#${n}`).join(', ');
    console.log(`[agent]   No photo on DOA yet, skipped: ${listed}`);
    console.log(`[agent]   Re-run once those lots have photos to add them.`);
  }

  const lots = [];
  const seen = new Set();
  let skippedBelowStart = 0;
  let cardsWithoutPermalink = 0;

  if (START_LOT > 0) {
    console.log(`[agent] START_LOT=${START_LOT} — skipping lots below #${START_LOT} (top-up run).`);
  }

  for (const card of cards) {
    const title = card.alt;
    if (!title) continue;                       // no title -> not a lot card

    // "<id>_thumbnail.jpg" -> "<id>.jpg" (the full-size original)
    const fullSize = card.src.replace(/_thumbnail(?=\.[a-z]+(\?|$))/i, '');

    // Resolve a permalink ONLY from a non-empty href. new URL('', base) returns
    // the base -- i.e. the grid page URL -- which is identical for every card.
    // Feeding that to the dedup below collapsed an entire 176-lot auction to a
    // single lot, because every card after the first looked like a duplicate.
    let sourceUrl = '';
    if (card.href) {
      try { sourceUrl = new URL(card.href, page.url()).href; } catch { sourceUrl = card.href; }
    } else {
      cardsWithoutPermalink++;
    }

    // Dedup on the lot permalink when there is one, else on the lot's image URL.
    // Both are unique per lot; never key on anything that can repeat.
    const key = sourceUrl || fullSize;
    if (seen.has(key)) continue;
    seen.add(key);

    const lotNum =
      title.match(/lot\s*#?\s*(\d+)/i)?.[1] ??
      card.href.match(/\/lot-(\d+)/i)?.[1] ??
      String(lots.length + 1);

    // Incremental top-up: skip lots below START_LOT so a second run adds only
    // the new items. A lot whose number cannot be parsed is NEVER skipped --
    // silently dropping an item is worse than uploading one twice.
    if (START_LOT > 0) {
      const n = parseInt(lotNum, 10);
      if (Number.isFinite(n) && n < START_LOT) { skippedBelowStart++; continue; }
      if (!Number.isFinite(n)) {
        console.warn(`[agent]   "${title.slice(0, 45)}" has no readable lot number — including it despite START_LOT.`);
      }
    }

    lots.push({
      lot_number:  lotNum,
      title,
      description: '',
      price:       0,
      imageUrls:   [fullSize],
      source_url:  sourceUrl || `${page.url()}#lot-${lotNum}`,
    });

    console.log(`[agent]   lot ${lotNum}: "${title.slice(0, 60)}"`);

    if (MAX_LOTS > 0 && lots.length >= MAX_LOTS) {
      console.log(`[agent] MAX_LOTS=${MAX_LOTS} reached — stopping at ${lots.length} lot(s) (smoke test).`);
      break;
    }
  }

  if (skippedBelowStart > 0) {
    console.log(`[agent] Skipped ${skippedBelowStart} lot(s) below #${START_LOT} (already uploaded in an earlier run).`);
  }
  if (cardsWithoutPermalink > 0) {
    console.log(`[agent] ${cardsWithoutPermalink} card(s) had no lot permalink — keyed on image URL instead.`);
  }

  // A large drop between cards seen and lots kept means the dedup key is
  // colliding. Say so loudly rather than silently uploading a fraction.
  const expected = cards.length - skippedBelowStart;
  if (MAX_LOTS === 0 && lots.length < expected) {
    console.warn(
      `[agent] WARNING: ${expected} lot card(s) available but only ${lots.length} kept — ` +
      `${expected - lots.length} were treated as duplicates. Check the dedup key.`
    );
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

  // ── Resolve the row owner (tenant) FIRST ─────────────────────────────────
  // The agent runs with the Supabase service-role key, which BYPASSES RLS, so
  // every ledger read/write MUST be scoped by user_id here in code — RLS does
  // NOT isolate tenants on this path. Resolve the owner before any ledger read
  // so the dedup fetch below can be owner-scoped too. When the ledger is
  // enabled we MUST resolve a real owner: a row with user_id:null is a "ghost
  // reservation" — invisible to the owner-scoped UI but still occupying the
  // unique (es_url, lot_url) key, silently blocking future runs forever. Fail
  // closed if we can't resolve it. In test mode (LEDGER_ENABLED=false) this
  // whole block is skipped — no ledger writes.
  let jobUserId = null;
  if (LEDGER_ENABLED) {
    if (!JOB_ID) {
      throw new LedgerError('Ledger enabled but JOB_ID is missing — cannot resolve row owner. Aborting to avoid ghost reservations.');
    }
    const { data: jobRow, error: jobErr } = await supabase
      .from('estatesales_jobs')
      .select('user_id')
      .eq('id', JOB_ID)
      .single();
    if (jobErr) {
      throw new LedgerError(`Ledger enabled but job lookup failed (${jobErr.message}) — cannot resolve row owner. Aborting to avoid ghost reservations.`);
    }
    jobUserId = jobRow?.user_id ?? null;
    if (!jobUserId) {
      throw new LedgerError(`Ledger enabled but job ${JOB_ID} has no user_id — cannot resolve row owner. Aborting to avoid ghost reservations.`);
    }
  }

  // ── Dedup: skip lots CONFIRMED uploaded to this sale (by THIS owner) ──────
  // Only 'uploaded' rows are pre-skipped here; 'reserved' and 'failed' rows
  // are handled per-lot via reserveLot(), which conservatively skips them
  // (no auto-reclaim — see reserveLot for the duplicate-safety reasoning).
  // Lots without a source_url can't be matched against the ledger and are
  // treated as pending (they pass through to upload without dedup). Scoped by
  // jobUserId so one tenant's ledger never hides or blocks another's lots.
  const uploadedUrls = await fetchUploadedLotUrls(jobUserId);
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
  // Type like a human — the page runs reCAPTCHA v3, which scores interaction
  // behavior. Instant programmatic fills get the login masked-rejected as
  // "Password was incorrect" even when the credentials are right.
  // Clear first: the persistent profile can autofill/remember the field, and
  // pressSequentially APPENDS at the cursor — it does not replace like fill().
  await emailEl.click();
  await emailEl.fill('');
  await emailEl.pressSequentially(ES_EMAIL, { delay: 55 + Math.floor(Math.random() * 45) });

  const passEl = await findFirst(page, [
    '#password-input',
    '#password',
    'input[name="password"]',
    'input[type="password"]',
    'input[placeholder*="password" i]',
  ]);
  if (!passEl) throw new Error('[agent] Could not find EstateSales.net password input.');
  await passEl.click();
  await passEl.fill('');
  await passEl.pressSequentially(ES_PASSWORD, { delay: 65 + Math.floor(Math.random() * 45) });
  await page.waitForTimeout(600);

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
  // Angular SPA — redirect after login is client-side, not a full navigation.
  // Wait for a definitive outcome: the rejection banner appearing, or leaving
  // the /sign-in route.
  const rejectionBanner = page.getByText(/password was incorrect/i).first();
  await Promise.race([
    rejectionBanner.waitFor({ state: 'visible', timeout: NAV_TIMEOUT }),
    page.waitForURL((u) => !/sign-?in|log-?in/i.test(u.pathname), { timeout: NAV_TIMEOUT }),
  ]).catch(() => {});
  await page.waitForTimeout(2500);
  await screenshot(page, 'es-after-login');

  // ES masks reCAPTCHA v3 bot rejections as credential errors, so this banner
  // means EITHER a wrong password OR a low bot score — surface both hypotheses.
  if (await rejectionBanner.isVisible().catch(() => false)) {
    await screenshot(page, 'es-login-rejected');
    throw new Error(
      '[agent] EstateSales.net rejected the sign-in ("Email Address and/or Password was incorrect"). ' +
      'If these credentials work in a normal browser, this is reCAPTCHA v3 scoring the automated ' +
      'browser as a bot — not a wrong password.'
    );
  }

  // Verify login succeeded via DOM — EstateSales.net is an Angular SPA that can
  // render the sign-in wall without changing the URL, so URL checks are unreliable.
  if (await onSignInWall(page)) {
    await screenshot(page, 'es-login-failed');
    throw new Error(
      '[agent] EstateSales.net login failed — still on the sign-in form after submitting credentials. ' +
      'Reconnect EstateSales in VZT Settings (check email + password).'
    );
  }
  console.log('[agent] Logged into EstateSales.net successfully.');

  // Navigate to the sale management page
  console.log('[agent] Navigating to EstateSales.net sale page...');
  await page.goto(ES_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  // The wizard is client-rendered: domcontentloaded lands on a "Loading..."
  // shell where neither the wall nor the wizard exists yet — checking auth
  // instantly would race the render and always pass. Let the SPA settle first.
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT }).catch(() => {});
  await page.waitForTimeout(1000);
  await screenshot(page, 'es-sale-page');

  // Verify we are authenticated on the sale page. EstateSales.net is an Angular
  // SPA and can silently render the sign-in wall without changing the URL.
  if (await onSignInWall(page)) {
    await screenshot(page, 'es-session-expired');
    throw new Error(
      '[agent] EstateSales.net is showing the sign-in wall on the sale page — not authenticated. ' +
      'Reconnect EstateSales in VZT Settings.'
    );
  }

  // ES silently redirects a dead wizard URL (sale already published/closed) to
  // the account dashboard. Without this check that surfaces later as a
  // misleading per-lot '+ UPLOAD file input not found' error.
  if (!page.url().includes('/sale-wizard/')) {
    await screenshot(page, 'es-wizard-unavailable');
    throw new Error(
      `[agent] EstateSales.net redirected the sale wizard URL to ${page.url()} — ` +
      'the sale is likely already published/closed. Update ESTATESALES_URL to a ' +
      "current sale's wizard Pictures step."
    );
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
      await markLotFailed(lot, jobUserId);
      failedLots.push({ index: i + 1, title: lot.title, error: msg });
      continue;
    }

    try {
      const uploaded = await uploadLotImages(page, lot, i + 1, thumbCount);
      if (uploaded === 0) {
        const msg = `No images uploaded for lot ${i + 1}`;
        console.warn(`[agent]   WARNING: ${msg}`);
        await markLotFailed(lot, jobUserId);
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
      await markLotFailed(lot, jobUserId);
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
      await confirmLotUploaded(lot, jobUserId);
      succeeded++;
    } else {
      await markLotFailed(lot, jobUserId);
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

  // Confirm the uploads actually registered on ES: network settle + thumbnail
  // count rise. We must NOT confirm/caption a lot whose images never landed.
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT }).catch(() => {});
  const target = priorThumbCount + localPaths.length;
  const deadline = Date.now() + 60_000;
  let observed = await countEsThumbnails(page);
  let registered = observed >= target;
  while (!registered && Date.now() < deadline) {
    await page.waitForTimeout(1_000);
    observed = await countEsThumbnails(page);
    registered = observed >= target;
  }

  // Clean up temp image files regardless of outcome.
  for (const p of localPaths) {
    try { fs.unlinkSync(p); } catch { /* non-fatal */ }
  }

  if (!registered) {
    if (observed === 0) {
      // Thumbnail selectors never matched anything — we cannot prove the images
      // landed on ES. Fail closed on real runs: confirming a lot we can't verify
      // risks marking it uploaded when it isn't (missing live items are worse than
      // blocked runs). Only AGENT_TEST_MODE (local smoke test, ledger disabled) is
      // allowed to proceed best-effort so selector work can continue offline.
      await screenshot(page, `es-thumb-unconfirmed-lot-${lotIndex}`);
      if (AGENT_TEST_MODE) {
        console.warn(
          `[agent]   Could not count thumbnails for lot ${lotIndex} (selectors matched 0) ` +
          `— TEST MODE: proceeding best-effort. Refine countEsThumbnails selectors.`
        );
        return localPaths.length;
      }
      throw new Error(
        `[agent] Could not verify image upload for lot ${lotIndex} on ES ` +
        `(thumbnail selectors matched 0 — cannot confirm images landed). Not confirming ` +
        `this lot. Check screenshot "es-thumb-unconfirmed-lot-${lotIndex}" and update ` +
        `countEsThumbnails selectors.`
      );
    }
    // Thumbnails ARE countable (observed > 0) but did not rise to the expected
    // total — the upload did not fully register. Fail the lot so it is never
    // captioned/confirmed as if its images were on ES.
    await screenshot(page, `es-upload-incomplete-lot-${lotIndex}`);
    throw new Error(
      `[agent] Image upload for lot ${lotIndex} did not register on ES ` +
      `(saw ${observed} thumbnail(s), expected >= ${target}). Not confirming this lot.`
    );
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
      // textContent, not innerHTML — lot titles are data, not markup. innerHTML
      // would let a crafted title persist as live HTML on EstateSales.
      ce.textContent = t;
      ce.dispatchEvent(new Event('input', { bubbles: true }));
      ce.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (window.tinymce && window.tinymce.editors && window.tinymce.editors.length > 0) {
      window.tinymce.editors[0].setContent(t, { format: 'text' });
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
 * readEsImageDescription(page)
 *
 * Reads the image editor's current description value (mirror of
 * fillEsImageDescription's selector cascade). Returns a string, or null if no
 * field is present. Used to confirm the editor actually advanced after "Next".
 */
async function readEsImageDescription(page) {
  return await page.evaluate(() => {
    const el = document.querySelector(
      'textarea[name*="description" i], textarea[id*="description" i], ' +
      'textarea[placeholder*="description" i], textarea[placeholder*="caption" i], ' +
      'input[name*="description" i], [contenteditable="true"], textarea'
    );
    if (!el) return null;
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return el.innerHTML;
    return el.value;
  }).catch(() => null);
}

/**
 * clickEsNext(page)
 *
 * Advances the image editor to the next picture. Returns false if no enabled
 * "Next" control exists (end of the set), if the click throws, OR if the editor
 * does not actually advance (description field unchanged) — so the caller never
 * treats a swallowed no-op as a successful advance.
 *
 * Matches only "Next" (Playwright :has-text is case-insensitive → matches
 * "NEXT"); we deliberately do NOT add Continue/Go synonyms because "Continue"
 * collides with the wizard's "SAVE AND CONTINUE" (which the agent must NEVER
 * click — David saves manually).
 */
async function clickEsNext(page) {
  const nextEl = await findFirst(page, [
    'button:has-text("Next"):not([disabled])',
    'button[aria-label*="next" i]:not([disabled])',
    'a[aria-label*="next" i]:not([disabled])',
    'button[class*="next"]:not([disabled])',
    'a[class*="next"]:not([disabled])',
  ], 3_000);
  if (!nextEl) return false;
  if (await nextEl.isDisabled().catch(() => false)) return false;

  // Snapshot the current description so we can confirm the click advanced to a
  // different picture (the just-pasted title vs. the next picture's caption,
  // typically empty on a fresh upload).
  const before = await readEsImageDescription(page);

  try {
    await nextEl.click();
  } catch {
    return false; // do NOT swallow — a failed click means we did not advance
  }

  // Verify advancement: poll briefly for the description field to change.
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if ((await readEsImageDescription(page)) !== before) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  if (!DOA_EMAIL || !DOA_PASSWORD || !DOA_URL) {
    throw new Error('DOA_EMAIL, DOA_PASSWORD, and DOA_URL are required');
  }
  if (!ES_URL) {
    throw new Error('ESTATESALES_URL is required');
  }
  if (!ES_EMAIL || !ES_PASSWORD) {
    throw new Error(
      'EstateSales.net auth is missing. Requires ESTATESALES_EMAIL + ESTATESALES_PASSWORD ' +
      'set in VZT Settings.'
    );
  }

  await updateJobStatus('running');

  // CI: bundled headless Chromium + stealth + masked UA (strips "HeadlessChrome").
  // Local: the machine's REAL Chrome (channel) with a persistent profile and no
  // spoofing at all — a genuine fingerprint + cookie reputation is what passes
  // reCAPTCHA v3 on the ES sign-in form; a hardcoded Chrome/120 UA contradicts
  // the browser's own client hints and reads as a bot.
  let browser = null;
  let context;
  if (IS_CI) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
  } else {
    context = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, {
      headless: false,
      channel: 'chrome',
      viewport: { width: 1280, height: 900 },
    });
  }
  // A persistent context pre-opens one blank page — reuse it rather than
  // leaving an orphan tab open for the whole run.
  const page = context.pages()[0] ?? await context.newPage();

  let lots = [];

  try {
    // ── Phase 1: DOA login + scrape ──────────────────────────────────────────
    console.log('\n[agent] ── Phase 1: DOA Scrape ──────────────────────────────');

    // Phase 1 reads the PUBLIC auction grid (/auction/<slug>). DOA serves lot
    // titles and full-size photos there with no account at all, so this agent
    // no longer logs into DOA on the normal path. That deletes the failure mode
    // which broke it twice: DOA renames its login controls periodically, and
    // this file carried its own independently-drifting copy of that login.
    // The block below now runs ONLY for a legacy admin (EditAuction) URL.
    const DOA_NEEDS_LOGIN = /EditAuction/i.test(DOA_URL || '');

    if (!DOA_NEEDS_LOGIN) {
      console.log('[agent] Public auction grid — no DOA login required.');
    } else {
    console.log('[agent] Legacy admin URL — logging into DOA...');
    await page.goto('https://denveronlineauctions.com/Account/Login', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    // The persistent local profile can still hold a live DOA session from a
    // prior run, in which case /Account/Login redirects straight past the
    // form — only fill it when it actually renders.
    // DOA moved to the "Xpert Online Auctions" platform in July 2026 and renamed
    // the login controls: #MainContent_Email → #username (type="text", labeled
    // "Email or Username"), #MainContent_Password → #Password. Confirmed live
    // 2026-07-17. This agent kept the pre-July selector and so never found the
    // form — it reported "session already active", walked on, then failed the
    // verification below with a contradictory "still on login page".
    //
    // Ordered chain via findFirst, NOT a comma-joined selector: comma-joined
    // + .first() resolves in DOM order, and DOA's login page carries two
    // newsletter signup boxes with name="email" / type="email" that sit earlier
    // in the DOM. That is why no generic email selector appears here.
    //
    // These mirror SELECTORS.loginEmail / loginPassword in
    // doa-listing-agent/doaAgent.js. Both agents log into DOA independently —
    // if DOA's form drifts again, BOTH need updating.
    const DOA_LOGIN_USERNAME = [
      '#username',                                  // confirmed 2026-07-17 (Xpert platform)
      'input[name="ctl00$MainContent$username"]',   // ASP.NET control name
      'input[name$="$username"]',                   // scoped fallback (login form only)
      '#MainContent_Email',                         // legacy pre-2026-07 DOA form
      'input[name="Email"]',
    ];
    const DOA_LOGIN_PASSWORD = [
      '#Password',                                  // confirmed 2026-07-17 (Xpert platform)
      'input[name="ctl00$MainContent$Password"]',   // ASP.NET control name
      'input[name$="$Password"]',                   // scoped fallback (login form only)
      '#MainContent_Password',                      // legacy pre-2026-07 DOA form
      'input[type="password"]',                     // safe: one password input on the login page
    ];

    const doaUserEl = await findFirst(page, DOA_LOGIN_USERNAME, 2_000);
    if (doaUserEl) {
      const doaPassEl = await findFirst(page, DOA_LOGIN_PASSWORD, 2_000);
      if (!doaPassEl) throw new Error('[agent] Found the DOA username field but no password field — DOA login form changed.');
      await doaUserEl.fill(DOA_EMAIL);
      await doaPassEl.fill(DOA_PASSWORD);
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
    } else {
      // Genuinely ambiguous: either a live session, or DOA renamed the fields
      // again. Say so, so the failure below is self-explaining rather than
      // contradictory.
      console.log('[agent] No DOA login form found — assuming an active session.');
      console.log('[agent]   If login verification fails next, DOA likely changed its form again:');
      console.log('[agent]   re-probe the live page for the username/password field IDs.');
    }
    await screenshot(page, 'doa-after-login');

    // Verify login. DOA renders "You are now logged in as ..." ON the
    // /Account/Login URL when a session is already active, so the URL alone
    // can't distinguish success from failure.
    const doaLoggedInMarker = await page.getByText(/logged in as/i).first()
      .isVisible().catch(() => false);
    if (page.url().includes('/Account/Login') && !doaLoggedInMarker) {
      throw new Error(
        '[agent] DOA login failed — still on login page.\n' +
        '  Check screenshot "doa-after-login". Verify DOA credentials in VZT Settings.'
      );
    }
    console.log('[agent] Logged into DOA successfully.');
    }

    lots = await scrapeLots(page);
    console.log(`\n[agent] Phase 1 complete — scraped ${lots.length} lot(s).`);
    await updateJobFields({ lots_scraped: lots.length });

    if (lots.length === 0) {
      throw new Error(
        '[agent] No lots were scraped from DOA.\n' +
        '  Verify DOA_URL is the PUBLIC auction page (/auction/<slug>).\n' +
        '  Check screenshots for the actual page structure.'
      );
    }

    // Diagnostic switch: stop after the scrape and upload nothing. Lets the
    // DOA side be re-run and inspected without another EstateSales sign-in --
    // repeated failed logins there risk locking the account, and ES rejects
    // automated sign-ins via reCAPTCHA v3 rather than by password.
    if (SCRAPE_ONLY) {
      console.log(`\n[agent] SCRAPE_ONLY — stopping after Phase 1. Nothing uploaded.`);
      console.log(`[agent] ${lots.length} lot(s) scraped:`);
      for (const l of lots.slice(0, 15)) {
        console.log(`[agent]   #${l.lot_number}  ${l.imageUrls.length} photo(s)  "${l.title.slice(0, 50)}"`);
      }
      if (lots.length > 15) console.log(`[agent]   ... and ${lots.length - 15} more`);
      return;
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

    // Tell the operator where to resume. Local runs have no ledger, so the only
    // thing standing between a top-up run and duplicate photos is starting above
    // the highest lot already uploaded. Printing it removes the guesswork.
    const highestLot = lots
      .map(l => parseInt(l.lot_number, 10))
      .filter(Number.isFinite)
      .reduce((a, b) => Math.max(a, b), 0);
    if (highestLot > 0 && confirmedUploaded > 0) {
      console.log(
        `\n[agent] Highest lot uploaded: #${highestLot}\n` +
        `[agent]   When this auction gains more lots, run again and enter ${highestLot + 1}\n` +
        `[agent]   at the "Start at lot #" prompt to add only the new ones.`
      );
    }
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
    // Persistent context has no separate browser handle — close whichever exists.
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
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
      // Exit non-zero: a partial failure means some lots did NOT upload. The
      // GitHub Actions run must go red so the "Upload screenshots on failure"
      // step fires (selector debugging) and ops telemetry doesn't read a green
      // run as a clean upload. The estatesales_jobs row carries the precise
      // 'partial_failed' status for the app; the exit code is the CI signal.
      process.exit(1);
    }
    console.error('\n[agent] FATAL:', err.message);
    await updateJobStatus('failed', err.message);
    process.exit(1);
  });
