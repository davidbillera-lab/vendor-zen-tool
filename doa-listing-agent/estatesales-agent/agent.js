/**
 * agent.js — EstateSales Photo Upload Agent · Orchestrator
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs the 5-agent pipeline in sequence:
 *
 *   Phase 1: Scraper      — pulls lot titles + image URLs from DOA auction
 *   Phase 2: Downloader   — downloads images from Bunny CDN to local folder
 *   Phase 3: PhotoUploader — uploads photos to estatesales.net in lot order
 *   Phase 4: Describer    — clicks pencil icon, pastes title, saves per photo
 *   Phase 5: Notifier     — sends completion email
 *
 * Each phase saves state to lots.json so any phase can be re-run independently.
 *
 * Usage:
 *   node agent.js --auction <DOA URL> --listing <estatesales URL>  — full pipeline
 *   node agent.js --auction <DOA URL> --scrape-only                — scrape + download only
 *   node agent.js --describe-only --listing <estatesales URL>      — re-run descriptions only
 *   node agent.js --upload-only --listing <estatesales URL>        — re-run photo upload only
 *   node agent.js --dry-run --auction <DOA URL>                    — scrape + download, no upload
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';
import { scrapeAuction, auctionSlugFromUrl } from './scraper.js';
import { downloadLots } from './downloader.js';
import { uploadPhotos } from './photoUploader.js';
import { fillDescriptions } from './describer.js';
import { sendCompletionEmail } from './notifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config from .env ──────────────────────────────────────────────────────────
const ESTATESALES_EMAIL    = process.env.ESTATESALES_EMAIL    || '';
const ESTATESALES_PASSWORD = process.env.ESTATESALES_PASSWORD || '';
const DEFAULT_AUCTION_URL  = process.env.DOA_AUCTION_URL      || '';

// ── Parse CLI flags ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function flagValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const AUCTION_URL    = flagValue('--auction') || DEFAULT_AUCTION_URL;
const LISTING_URL    = flagValue('--listing');
const SCRAPE_ONLY    = args.includes('--scrape-only');
const DESCRIBE_ONLY  = args.includes('--describe-only');
const UPLOAD_ONLY    = args.includes('--upload-only');
const DRY_RUN        = args.includes('--dry-run');

// ── lots.json helpers ─────────────────────────────────────────────────────────
function lotsDir(slug)      { return path.join(__dirname, 'lots', slug); }
function lotsJsonPath(slug) { return path.join(lotsDir(slug), 'lots.json'); }

function saveLots(lots, slug) {
  const dir = lotsDir(slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lotsJsonPath(slug), JSON.stringify(lots, null, 2), 'utf8');
}

function loadLots(slug) {
  const p = lotsJsonPath(slug);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function mostRecentAuctionSlug() {
  const base = path.join(__dirname, 'lots');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base)
    .filter(d => fs.statSync(path.join(base, d)).isDirectory())
    .map(d => ({ name: d, mtime: fs.statSync(path.join(base, d)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs.length > 0 ? dirs[0].name : null;
}

// ── Validation ────────────────────────────────────────────────────────────────
function validateConfig() {
  const errors = [];

  if (!AUCTION_URL && !DESCRIBE_ONLY && !UPLOAD_ONLY) {
    errors.push('Provide --auction <URL> (Denver Online Auctions page)');
  }
  if ((DESCRIBE_ONLY || UPLOAD_ONLY) && !LISTING_URL) {
    errors.push('--describe-only and --upload-only require --listing <URL>');
  }
  if (!SCRAPE_ONLY && !DRY_RUN && LISTING_URL) {
    if (!ESTATESALES_EMAIL)    errors.push('ESTATESALES_EMAIL is not set in .env');
    if (!ESTATESALES_PASSWORD) errors.push('ESTATESALES_PASSWORD is not set in .env');
  }

  if (errors.length) {
    for (const e of errors) log.error(e);
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log.section('EstateSales Photo Upload Agent');

  const mode = DESCRIBE_ONLY ? 'describe-only'
    : UPLOAD_ONLY   ? 'upload-only'
    : SCRAPE_ONLY   ? 'scrape + download only'
    : DRY_RUN       ? 'dry-run'
    : LISTING_URL   ? 'full pipeline'
    : 'scrape + download only';

  log.info(`Mode: ${mode}`);
  validateConfig();

  const credentials = { email: ESTATESALES_EMAIL, password: ESTATESALES_PASSWORD };

  // ── Resolve auction slug and lots ─────────────────────────────────────────
  let lots = null;
  let auctionSlug = null;

  if (DESCRIBE_ONLY || UPLOAD_ONLY) {
    // Re-run mode: load the most recent lots.json
    auctionSlug = mostRecentAuctionSlug();
    if (!auctionSlug) {
      log.error('No auction data found in lots/. Run with --auction <URL> first.');
      process.exit(1);
    }
    lots = loadLots(auctionSlug);
    log.info(`Loaded ${lots.length} lots from: ${auctionSlug}`);

  } else {
    // Phase 1: Scrape
    auctionSlug = auctionSlugFromUrl(AUCTION_URL);
    // Always re-scrape to pick up new lots added since the last run
    log.section('Phase 1: Scraping DOA Auction');
    const freshLots = await scrapeAuction(AUCTION_URL);
    const cached = loadLots(auctionSlug) || [];

    // Merge: preserve uploadedAt/descriptionFilled/imagePath from prior runs
    const cachedMap = new Map(cached.map(l => [l.lotNumber, l]));
    lots = freshLots.map(l => {
      const prior = cachedMap.get(l.lotNumber);
      return prior
        ? { ...l, uploadedAt: prior.uploadedAt, descriptionFilled: prior.descriptionFilled, imagePath: prior.imagePath }
        : l;
    });

    const newCount = lots.filter(l => !l.uploadedAt).length;
    log.success(`Scraped ${lots.length} lots (${newCount} new/pending upload)`);
    saveLots(lots, auctionSlug);

    // Phase 2: Download images
    log.section('Phase 2: Downloading Images');
    const needsDownload = lots.filter(l => !l.imagePath || !fs.existsSync(l.imagePath));

    if (needsDownload.length > 0) {
      await downloadLots(lots, auctionSlug);
      saveLots(lots, auctionSlug);
    } else {
      log.info('All images already downloaded — skipping Phase 2');
    }

    const ready = lots.filter(l => l.imagePath && fs.existsSync(l.imagePath));
    log.info(`Images ready: ${ready.length} / ${lots.length}`);
  }

  if (SCRAPE_ONLY || DRY_RUN) {
    log.section('Done (scrape + download only)');
    log.info(`Lots saved to: lots/${auctionSlug}/lots.json`);
    log.info(`Images saved to: lots/${auctionSlug}/images/`);
    log.info('');
    log.info('To run the full pipeline:');
    log.info(`  node agent.js --auction "${AUCTION_URL}" --listing "<your listing URL>"`);
    process.exit(0);
  }

  if (!LISTING_URL) {
    log.warn('No --listing URL provided — stopping before upload phases.');
    log.info('To upload, add --listing "<your estatesales.net listing editor URL>"');
    process.exit(0);
  }

  // ── Phase 3: Upload photos ────────────────────────────────────────────────
  let uploadResult = { succeeded: 0, failed: 0 };
  if (!DESCRIBE_ONLY) {
    log.section('Phase 3: Uploading Photos to estatesales.net');
    log.info('The browser will open. If login or CAPTCHA appears, handle it manually.');
    log.info('Session is saved — future runs skip login automatically.');

    uploadResult = await uploadPhotos(LISTING_URL, lots, credentials, (lot) => {
      saveLots(lots, auctionSlug); // Save progress after each upload
    });
    saveLots(lots, auctionSlug);
    log.info(`Phase 3 result: ${uploadResult.succeeded} uploaded, ${uploadResult.failed} failed`);
  }

  // ── Phase 4: Fill descriptions ────────────────────────────────────────────
  log.section('Phase 4: Filling Descriptions (pencil icon → paste title → save)');
  const descResult = await fillDescriptions(LISTING_URL, lots, credentials, (lot) => {
    saveLots(lots, auctionSlug); // Save progress after each description
  });
  saveLots(lots, auctionSlug);
  log.info(`Phase 4 result: ${descResult.succeeded} described, ${descResult.failed} failed`);

  // ── Phase 5: Notify ───────────────────────────────────────────────────────
  log.section('Phase 5: Sending Completion Email');
  const totalFailed = uploadResult.failed + descResult.failed;
  await sendCompletionEmail({
    auctionSlug,
    listingUrl: LISTING_URL,
    uploaded:   uploadResult.succeeded,
    described:  descResult.succeeded,
    failed:     totalFailed,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  log.section('Run Complete');
  log.info(`Auction:              ${auctionSlug}`);
  log.info(`Photos uploaded:      ${uploadResult.succeeded}`);
  log.info(`Descriptions filled:  ${descResult.succeeded}`);
  log.info(`Failed:               ${totalFailed}`);
  log.info(`Listing: ${LISTING_URL}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  log.error('Fatal error in agent', err);
  process.exit(1);
});
