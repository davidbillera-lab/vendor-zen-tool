/**
 * agent.js — eBay CSV Queue Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * CLI entry point. Watches a local folder for eBay CSV files and uploads them
 * to eBay Seller Hub on a schedule or on demand.
 *
 * Usage:
 *   node agent.js               — run once (catch-up + current queue), then exit
 *   node agent.js --schedule    — start cron daemon (fires at SCHEDULE_TIME)
 *   node agent.js --watch       — run once then poll every 30 min
 *   node agent.js --count 3     — override MAX_UPLOADS_PER_RUN for this run
 *   node agent.js --dry-run     — log what would upload, no browser launched
 *   node agent.js --retry       — move all failed CSVs back to pending, then run
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';
import {
  ensureQueueFolders,
  scanPending,
  scanProcessing,
  claimFile,
  markDone,
  markFailed,
  retryFailed,
} from './queue.js';
import { runUpload } from './ebayUploader.js';
import { startScheduler } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config from .env ──────────────────────────────────────────────────────────
const QUEUE_DIR          = process.env.EBAY_CSV_QUEUE_DIR
  || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', 'eBay CSV');
const EBAY_EMAIL         = process.env.EBAY_EMAIL    || '';
const EBAY_PASSWORD      = process.env.EBAY_PASSWORD || '';
const MAX_UPLOADS_DEFAULT = parseInt(process.env.MAX_UPLOADS_PER_RUN || '2', 10);
const POLL_INTERVAL_MS   = 30 * 60 * 1000; // 30 minutes

// ── Parse CLI flags ───────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const SCHEDULE = args.includes('--schedule');
const WATCH    = args.includes('--watch');
const DRY_RUN  = args.includes('--dry-run');
const RETRY    = args.includes('--retry');

const countIdx = args.indexOf('--count');
const MAX_UPLOADS = countIdx !== -1 && args[countIdx + 1]
  ? parseInt(args[countIdx + 1], 10)
  : MAX_UPLOADS_DEFAULT;

// ── Validation ────────────────────────────────────────────────────────────────
function validateConfig() {
  const errors = [];
  if (!EBAY_EMAIL)    errors.push('EBAY_EMAIL is not set in .env');
  if (!EBAY_PASSWORD) errors.push('EBAY_PASSWORD is not set in .env');
  if (!QUEUE_DIR)     errors.push('EBAY_CSV_QUEUE_DIR is not set in .env');
  if (errors.length) {
    for (const e of errors) log.error(e);
    if (!DRY_RUN) {
      log.error('Fix the above errors in your .env file, then restart.');
      process.exit(1);
    }
  }
}

// ── Core: process the queue ───────────────────────────────────────────────────
/**
 * runQueue()
 * Scans for pending CSVs, uploads up to MAX_UPLOADS, returns summary stats.
 */
export async function runQueue() {
  log.section('eBay CSV Upload Run');
  log.info(`Queue dir: ${QUEUE_DIR}`);
  log.info(`Max uploads this run: ${MAX_UPLOADS}`);
  if (DRY_RUN) log.warn('DRY RUN mode — no files will actually be uploaded');

  ensureQueueFolders(QUEUE_DIR);

  // Catch-up: anything stuck in processing/ from a previous crashed run
  const stuck = scanProcessing(QUEUE_DIR);
  if (stuck.length > 0) {
    log.warn(`Found ${stuck.length} file(s) stuck in processing/ (previous crash?) — marking as failed`);
    for (const f of stuck) {
      markFailed(f, QUEUE_DIR, 'Found stuck in processing/ on agent startup — assumed failed');
    }
  }

  // Scan for pending CSVs
  const pending = scanPending(QUEUE_DIR);
  if (pending.length === 0) {
    log.info('No pending CSV files found — nothing to do');
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  log.info(`Found ${pending.length} pending file(s) — will upload up to ${MAX_UPLOADS}`);

  const toProcess = pending.slice(0, MAX_UPLOADS);
  let succeeded = 0;
  let failed    = 0;

  for (const csvPath of toProcess) {
    const filename = path.basename(csvPath);
    log.section(`Uploading: ${filename}`);

    // Atomic claim — move to processing/
    const processingPath = claimFile(csvPath, QUEUE_DIR);
    if (!processingPath) {
      log.warn(`Could not claim ${filename} — skipping`);
      continue;
    }

    try {
      const result = await runUpload(processingPath, {
        email:    EBAY_EMAIL,
        password: EBAY_PASSWORD,
        dryRun:   DRY_RUN,
      });

      if (result.success) {
        markDone(processingPath, QUEUE_DIR);
        log.success(`Done: ${filename}${result.jobId ? ` (job ${result.jobId})` : ''}`);
        succeeded++;
      } else {
        markFailed(processingPath, QUEUE_DIR, result.message);
        log.error(`Failed: ${filename} — ${result.message}`);
        failed++;
      }
    } catch (err) {
      markFailed(processingPath, QUEUE_DIR, err.message);
      log.error(`Unexpected error processing ${filename}`, err);
      failed++;
    }
  }

  const skipped = pending.length - toProcess.length;
  log.section('Run complete');
  log.info(`Results: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped (over limit)`);

  return { attempted: toProcess.length, succeeded, failed };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log.section('eBay CSV Queue Agent');
  log.info(`Mode: ${SCHEDULE ? 'scheduled daemon' : WATCH ? 'watch/poll' : 'run-once'}`);
  validateConfig();

  // --retry: move failed back to pending before anything else
  if (RETRY) {
    const count = retryFailed(QUEUE_DIR);
    log.info(`Retry: moved ${count} file(s) from failed/ back to pending/`);
  }

  if (SCHEDULE) {
    // Cron daemon — fires at SCHEDULE_TIME, keeps process alive
    await startScheduler(runQueue);
  } else if (WATCH) {
    // Run once immediately, then poll every 30 min
    await runQueue();
    log.schedule(`Polling every 30 minutes. Press Ctrl+C to stop.`);
    setInterval(async () => {
      log.schedule('Poll interval fired');
      await runQueue();
    }, POLL_INTERVAL_MS);
  } else {
    // Run once, then exit
    await runQueue();
    process.exit(0);
  }
}

main().catch(err => {
  log.error('Fatal error in agent', err);
  process.exit(1);
});
