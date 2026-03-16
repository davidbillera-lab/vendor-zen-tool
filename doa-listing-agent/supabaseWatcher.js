/**
 * supabaseWatcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Continuously polls Supabase for new pending batches and processes them
 * automatically — no terminal commands needed after startup.
 *
 * USAGE (via pm2, auto-starts on boot):
 *   pm2 start ecosystem.config.cjs   ← one-time setup, never touch again
 *
 * OR manually:
 *   node agent.js --supabase-watch
 *
 * HOW IT WORKS:
 *   1. Every 30 seconds: query denver_batch_rows for pending lots
 *   2. Group into batches
 *   3. Process each batch (same pipeline as --supabase --batch <id>)
 *   4. Update lot status back to Supabase (completed / failed)
 *   5. Sleep and repeat
 *
 * TRIGGERING:
 *   - Upload a CSV on the Lovable dashboard → lots land in denver_batch_rows
 *   - OR click "Run Agent" on the Denver Batches dashboard → Edge Function marks
 *     lots as "pending" → this watcher picks them up within 30 seconds
 * ─────────────────────────────────────────────────────────────────────────────
 */

import log              from './logger.js';
import { runDoaAgent }  from './doaAgent.js';
import { cleanupAllTemp } from './imageHandler.js';
import {
  checkSupabaseEnv,
  loadFromSupabase,
  getFirstLotUrlForBatch,
  updateLotStatus,
  listBatches,
} from './supabaseReader.js';
import { sendCompletionEmail } from './notifier.js';

const POLL_INTERVAL_MS = 30_000; // 30 seconds

// ── Main watch loop ───────────────────────────────────────────────────────────

/**
 * startSupabaseWatchMode()
 *
 * Polls Supabase for pending batches and processes them indefinitely.
 * Called from agent.js when --supabase-watch flag is passed.
 */
export async function startSupabaseWatchMode() {
  checkSupabaseEnv();

  log.section('Supabase Watch Mode — Waiting for pending batches');
  log.info(`  Poll rate:    every ${POLL_INTERVAL_MS / 1000}s`);
  log.info(`  Trigger:      Upload CSV at https://upload-whiz-glide.lovable.app`);
  log.info(`                OR click "Run Agent" on the Denver Batches dashboard`);
  log.info('');

  let iteration = 0;

  while (true) {
    iteration++;

    try {
      await checkForPendingBatches(iteration);
    } catch (err) {
      log.error(`Poll #${iteration} error: ${err.message}`);
      // Non-fatal — keep polling
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ── Poll for pending lots grouped by batch ────────────────────────────────────

async function checkForPendingBatches(iteration) {
  const batches = await listBatches().catch(() => []);
  const pendingBatches = batches.filter(b => b.doa_pending > 0);

  if (pendingBatches.length === 0) {
    if (iteration % 10 === 0) {
      // Log every 5 minutes to show we're alive
      log.info(`  [poll #${iteration}] No pending batches — watching…`);
    }
    return;
  }

  log.section(`Found ${pendingBatches.length} batch(es) with pending lots`);

  for (const batch of pendingBatches) {
    await processBatch(batch.id, batch.name);
  }
}

// ── Process a single batch ────────────────────────────────────────────────────

async function processBatch(batchId, batchName) {
  const label = batchName || batchId.slice(0, 8) + '…';
  log.section(`Processing batch: ${label}`);

  // Fetch pending lots for this batch
  const { lots, totalRows } = await loadFromSupabase(batchId);
  const pendingLots = lots.filter(l => l.status !== 'completed');

  if (pendingLots.length === 0) {
    log.info(`  Batch "${label}" — no pending lots (all completed)`);
    return;
  }

  log.info(`  ${pendingLots.length} lot(s) to process`);

  // Get the DOA first lot URL for this batch (stored in la_batches)
  const firstLotUrl = await getFirstLotUrlForBatch(batchId);
  if (firstLotUrl) {
    log.info(`  DOA URL: ${firstLotUrl}`);
  }

  cleanupAllTemp();

  let succeeded = 0;
  let failed = 0;
  const errors = [];

  try {
    await runDoaAgent(
      pendingLots,
      { firstLotUrl },
      {
        onStart: async (lot) => {
          await updateLotStatus(lot.id, 'in_progress');
          log.info(`  → Lot #${lot.lot_number}: ${lot.title?.slice(0, 60)}`);
        },
        onSuccess: async (lot) => {
          await updateLotStatus(lot.id, 'completed');
          succeeded++;
          log.success(`  ✓ Lot #${lot.lot_number} completed`);
        },
        onFailure: async (lot, err) => {
          await updateLotStatus(lot.id, 'failed', String(err?.message || err));
          failed++;
          errors.push({ lot: lot.lot_number, error: String(err?.message || err) });
          log.error(`  ✗ Lot #${lot.lot_number} failed: ${err?.message || err}`);
        },
      }
    );
  } catch (fatalErr) {
    log.error(`  Fatal error in batch "${label}": ${fatalErr.message}`);
    failed += pendingLots.length - succeeded;
  }

  // Send email notification when batch finishes
  try {
    await sendCompletionEmail({
      batchId,
      batchName: label,
      succeeded,
      failed,
      errors,
    });
  } catch { /* email is optional */ }

  if (failed === 0) {
    log.success(`  Batch "${label}" complete — ${succeeded} lot(s) posted`);
  } else {
    log.warn(`  Batch "${label}" done — ${succeeded} ok, ${failed} failed`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
