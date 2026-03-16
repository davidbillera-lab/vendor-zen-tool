/**
 * agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * DOA Listing Agent — main entry point.
 *
 * MODES:
 *
 *   ── Supabase mode (pulls directly from Vendor-Zen-Tool database) ──────────
 *   node agent.js --supabase                      Process all pending lots
 *   node agent.js --supabase --batch <id>         Process one batch (recommended)
 *   node agent.js --supabase --list-batches       Show available batches
 *   node agent.js --supabase --batch <id> --test  First 3 lots only (safe test)
 *   node agent.js --supabase --force              Skip y/n confirmation
 *
 *   ── Watch mode (auto-process CSVs dropped in a folder) ───────────────────
 *   node agent.js --watch                         Watch ./incoming/ folder
 *   node agent.js --watch --dir ./my-folder       Watch a custom folder
 *
 *   ── CSV mode (original — unchanged) ──────────────────────────────────────
 *   node agent.js --csv lots.csv                  Process all pending lots
 *   node agent.js --csv lots.csv --test           First 3 lots only
 *   node agent.js --csv lots.csv --dry-run        Preview only, no browser
 *   node agent.js --csv lots.csv --lot 5          Single lot
 *   node agent.js --csv lots.csv --force          Skip confirmation
 *
 * REQUIRED .env (all modes):
 *   DOA_EMAIL=your-login@email.com
 *   DOA_PASSWORD=your-doa-password
 *
 * REQUIRED .env (supabase + watch modes):
 *   SUPABASE_URL=https://atgrxqfxysvppqoyvjdd.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...  (Supabase Dashboard → Settings → API)
 *
 * OPTIONAL .env:
 *   DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=...
 *   (In --supabase --batch mode this is pulled from the database automatically)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import readline from 'readline';
import chalk    from 'chalk';
import log      from './logger.js';
import { loadCsv, saveProgress }                from './csvReader.js';
import { runDoaAgent }                          from './doaAgent.js';
import { cleanupAllTemp }                       from './imageHandler.js';
import {
  loadFromSupabase,
  getFirstLotUrlForBatch,
  listBatches,
  updateLotStatus,
  checkSupabaseEnv,
}                                               from './supabaseReader.js';
import { startWatchMode }                       from './watchMode.js';
import { sendCompletionEmail }                  from './notifier.js';

// ── Parse CLI flags ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const csvIdx      = args.indexOf('--csv');
const csvFile     = csvIdx !== -1 ? args[csvIdx + 1] : null;

const lotIdx      = args.indexOf('--lot');
const lotFlag     = lotIdx !== -1 ? parseInt(args[lotIdx + 1], 10) : null;

const batchIdx    = args.indexOf('--batch');
const batchId     = batchIdx !== -1 ? args[batchIdx + 1] : null;

const dirIdx      = args.indexOf('--dir');
const watchDir    = dirIdx !== -1 ? args[dirIdx + 1] : './incoming';

const isSupabase  = args.includes('--supabase');
const isWatch     = args.includes('--watch');
const listBatchesFlag = args.includes('--list-batches');

const flags = {
  test:   args.includes('--test'),
  dryRun: args.includes('--dry-run'),
  force:  args.includes('--force'),
};

// ── Help text ─────────────────────────────────────────────────────────────────

const HELP = chalk.cyan(`
DOA Listing Agent
─────────────────────────────────────────────────────────────────────
SUPABASE MODE (pulls from Vendor-Zen-Tool automatically):
  node agent.js --supabase                      All pending lots
  node agent.js --supabase --batch <id>         One batch (get ID from --list-batches)
  node agent.js --supabase --list-batches       Show all batches with pending lots
  node agent.js --supabase --batch <id> --test  First 3 lots only (safe test)
  node agent.js --supabase --force              Skip confirmation prompt

WATCH MODE (auto-process CSV files dropped in a folder):
  node agent.js --watch                         Watch ./incoming/ folder
  node agent.js --watch --dir ./drop-folder     Watch a custom folder

CSV MODE (manual — original behavior):
  node agent.js --csv lots.csv                  Process all pending lots
  node agent.js --csv lots.csv --test           First 3 lots only
  node agent.js --csv lots.csv --dry-run        Preview, no browser
  node agent.js --csv lots.csv --lot 5          Single lot only
  node agent.js --csv lots.csv --force          Skip confirmation
─────────────────────────────────────────────────────────────────────

CSV format: lot_number, title, description, images, starting_bid
  images: pipe-separated URLs → https://a.jpg|https://b.jpg
`);

// ── Route to the right mode ───────────────────────────────────────────────────

if (!csvFile && !isSupabase && !isWatch) {
  console.log(HELP);
  process.exit(0);
}

checkDOAEnv();  // Always need DOA credentials

if (isWatch) {
  // ── Watch mode ──────────────────────────────────────────────────────────────
  const firstLotUrl = process.env.DOA_FIRST_LOT_URL;
  if (!firstLotUrl) {
    log.warn('DOA_FIRST_LOT_URL not set — you will need it set before any CSV is processed');
    log.warn('Add it to .env: DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=...');
  }
  await startWatchMode({ watchDir, firstLotUrl });

} else if (isSupabase && listBatchesFlag) {
  // ── List batches ────────────────────────────────────────────────────────────
  await showBatchList();

} else if (isSupabase) {
  // ── Supabase mode ───────────────────────────────────────────────────────────
  await runSupabaseAgent(batchId, flags);

} else {
  // ── CSV mode (original) ─────────────────────────────────────────────────────
  await runAgent(csvFile, { ...flags, lotFlag });
}

// ── List batches ──────────────────────────────────────────────────────────────

async function showBatchList() {
  log.section('Available Batches in Vendor-Zen-Tool');

  let batches;
  try {
    batches = await listBatches();
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }

  if (batches.length === 0) {
    log.info('No batches found in Supabase');
    process.exit(0);
  }

  console.log(chalk.cyan('\n' + '─'.repeat(90)));
  console.log(chalk.bold(`  ${'Batch Name / ID'.padEnd(42)} ${'Pending'.padEnd(10)} ${'Done'.padEnd(8)} ${'Failed'}`));
  console.log('  ' + '─'.repeat(82));

  for (const b of batches) {
    const label     = (b.name || b.id).slice(0, 40).padEnd(42);
    const pending   = String(b.doa_pending  ?? '?').padEnd(10);
    const done      = String(b.doa_completed ?? '?').padEnd(8);
    const failed    = String(b.doa_failed   ?? '?');
    const pendingFmt = (b.doa_pending > 0) ? chalk.yellow(pending) : chalk.gray(pending);
    const failedFmt  = (b.doa_failed  > 0) ? chalk.red(failed)    : chalk.gray(failed);
    console.log(`  ${label} ${pendingFmt} ${done} ${failedFmt}`);
    // Show full ID on second line for easy copy-paste
    if (b.name) {
      console.log(chalk.gray(`    ID: ${b.id}`));
    }
  }

  console.log(chalk.cyan('─'.repeat(90)));
  console.log(chalk.white(`\n  To run a batch:`));
  console.log(chalk.white(`    node agent.js --supabase --batch <batch-id>\n`));

  process.exit(0);
}

// ── Supabase mode ─────────────────────────────────────────────────────────────

async function runSupabaseAgent(batchId, options = {}) {
  const { test = false, dryRun = false, force = false } = options;
  const startTime = Date.now();

  log.section('DOA Listing Agent — Supabase Mode');
  log.info(`Source: Vendor-Zen-Tool (Supabase)`);
  log.info(`Batch:  ${batchId || '(all pending lots)'}`);
  log.info(`Mode:   ${dryRun ? 'DRY RUN' : test ? 'TEST (3 lots)' : 'FULL RUN'}`);

  // ── Fetch lots from Supabase ────────────────────────────────────────────────
  let lots, totalRows;
  try {
    ({ lots, totalRows } = await loadFromSupabase(batchId));
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }

  // ── Apply test limit ────────────────────────────────────────────────────────
  if (test) {
    lots = lots.slice(0, 3);
    log.info('TEST MODE: Limited to first 3 lots');
  }

  if (lots.length === 0) {
    log.info('No pending lots found — nothing to do');
    log.info('Check Vendor-Zen-Tool to confirm lots are in "pending" status');
    process.exit(0);
  }

  // ── Preview table ───────────────────────────────────────────────────────────
  printLotTable(lots);

  if (dryRun) {
    log.info('DRY RUN complete — no browser opened');
    process.exit(0);
  }

  // ── Confirmation ────────────────────────────────────────────────────────────
  if (!force) {
    const answer = await ask(chalk.yellow(`Proceed with ${lots.length} lot(s)? (y/n): `));
    if (answer.trim().toLowerCase() !== 'y') {
      log.info('Cancelled');
      process.exit(0);
    }
  } else {
    log.info('--force flag — skipping confirmation');
  }

  // ── Resolve first lot URL ───────────────────────────────────────────────────
  // Priority: 1) from la_batches in Supabase   2) DOA_FIRST_LOT_URL in .env
  let firstLotUrl = null;

  if (batchId) {
    firstLotUrl = await getFirstLotUrlForBatch(batchId);
  }

  if (!firstLotUrl) {
    firstLotUrl = process.env.DOA_FIRST_LOT_URL;
  }

  if (!firstLotUrl) {
    log.error('No first lot URL found. Set one of these:');
    log.error('  1. In Vendor-Zen-Tool: set "DOA First Lot URL" on the batch');
    log.error('  2. In .env: DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=...');
    process.exit(1);
  }

  // ── Run browser automation ──────────────────────────────────────────────────
  cleanupAllTemp();
  log.section('Starting Browser Automation');

  const results = [];
  let agentResult = { succeeded: 0, failed: 0, skipped: 0 };

  try {
    agentResult = await runDoaAgent(
      lots,
      { firstLotUrl },
      {
        onStart: async (lot) => {
          results.push({ lot, status: 'in_progress' });
          await updateLotStatus(lot.id, 'in_progress');
        },
        onSuccess: async (lot) => {
          const r = results.find(r => r.lot.lot_number === lot.lot_number);
          if (r) r.status = 'completed';
          await updateLotStatus(lot.id, 'completed');
        },
        onFailure: async (lot, err) => {
          const r = results.find(r => r.lot.lot_number === lot.lot_number);
          if (r) { r.status = 'failed'; r.error = err; }
          await updateLotStatus(lot.id, 'failed', err?.message || String(err));
        },
      }
    );
  } catch (fatalErr) {
    log.error('Agent stopped due to a fatal error', fatalErr);
    for (const r of results) {
      if (r.status === 'in_progress') {
        r.status = 'failed';
        r.error  = fatalErr;
        await updateLotStatus(r.lot.id, 'failed', fatalErr?.message);
      }
    }
  }

  printSummary(results, agentResult, startTime, log.getRunLogPath());

  // Send email notification — non-blocking, never crashes the agent
  await sendCompletionEmail({
    batchName: batchId || 'Supabase Batch',
    succeeded: agentResult.succeeded,
    failed:    agentResult.failed,
    skipped:   agentResult.skipped,
    duration:  formatDuration(Date.now() - startTime),
    logPath:   log.getRunLogPath(),
    results,
  });

  process.exit(agentResult.failed > 0 ? 1 : 0);
}

// ── CSV mode (original — preserved fully intact) ─────────────────────────────

/**
 * runAgent(csvPath, options)
 * Also exported for use by scheduler.js
 */
export async function runAgent(csvPath, options = {}) {
  const { test = false, dryRun = false, force = false, lotFlag = null } = options;
  const startTime = Date.now();

  log.section('DOA Listing Agent — CSV Mode');
  log.info(`CSV:  ${csvPath}`);
  log.info(`Mode: ${dryRun ? 'DRY RUN' : test ? 'TEST (3 lots)' : lotFlag ? `Single lot #${lotFlag}` : 'FULL RUN'}`);

  // Load CSV
  const { lots: allLots, totalRows, firstLotUrl: csvFirstLotUrl } = loadCsv(csvPath);

  const completed = allLots.filter(l => l.status === 'completed');
  let   lots      = allLots.filter(l => l.status !== 'completed');

  if (completed.length > 0) {
    log.info(`Skipping ${completed.length} already-completed lot(s)`);
  }

  // Apply lot filter
  if (lotFlag !== null) {
    lots = lots.filter(l => parseInt(l.lot_number, 10) === lotFlag);
    if (lots.length === 0) {
      log.warn(`Lot #${lotFlag} not found or already completed`);
      process.exit(0);
    }
  }

  if (test) {
    lots = lots.slice(0, 3);
    log.info('TEST MODE: Limited to first 3 lots');
  }

  if (lots.length === 0) {
    log.info(`All ${totalRows} lot(s) already completed. Nothing to do.`);
    process.exit(0);
  }

  // Preview
  printLotTable(lots, completed.length);

  if (dryRun) {
    log.info('DRY RUN complete — no browser opened');
    process.exit(0);
  }

  // Confirmation
  if (!force) {
    const answer = await ask(chalk.yellow(`Proceed with ${lots.length} lot(s)? (y/n): `));
    if (answer.trim().toLowerCase() !== 'y') {
      log.info('Cancelled by user');
      process.exit(0);
    }
  } else {
    log.info('--force flag set — skipping confirmation');
  }

  cleanupAllTemp();

  // Resolve first lot URL: CSV column → .env fallback
  const firstLotUrl = csvFirstLotUrl || process.env.DOA_FIRST_LOT_URL;
  if (csvFirstLotUrl) {
    log.info(`  DOA URL from CSV: ${csvFirstLotUrl}`);
  }
  if (!firstLotUrl) {
    log.error('DOA_FIRST_LOT_URL not found. Add it to your .env OR include a doa_first_lot_url column in your CSV.');
    process.exit(1);
  }

  // Run
  log.section('Starting Browser Automation');
  const results = [];
  let agentResult = { succeeded: 0, failed: 0, skipped: 0 };

  try {
    agentResult = await runDoaAgent(
      lots,
      { firstLotUrl },
      {
        onStart: async (lot) => {
          results.push({ lot, status: 'in_progress', error: null });
        },
        onSuccess: async (lot) => {
          const r = results.find(r => r.lot.lot_number === lot.lot_number);
          if (r) r.status = 'completed';
          saveProgress(csvPath, lot.lot_number, 'completed');
        },
        onFailure: async (lot, err) => {
          const r = results.find(r => r.lot.lot_number === lot.lot_number);
          if (r) { r.status = 'failed'; r.error = err; }
          saveProgress(csvPath, lot.lot_number, 'failed');
        },
      }
    );
  } catch (fatalErr) {
    log.error('Agent stopped due to a fatal error', fatalErr);
    for (const r of results) {
      if (r.status === 'in_progress') {
        r.status = 'failed';
        r.error  = fatalErr;
        saveProgress(csvPath, r.lot.lot_number, 'failed');
      }
    }
  }

  printSummary(results, agentResult, startTime, log.getRunLogPath());

  // Send email notification — non-blocking, never crashes the agent
  await sendCompletionEmail({
    batchName: csvPath,
    succeeded: agentResult.succeeded,
    failed:    agentResult.failed,
    skipped:   agentResult.skipped,
    duration:  formatDuration(Date.now() - startTime),
    logPath:   log.getRunLogPath(),
    results,
  });

  process.exit(agentResult.failed > 0 ? 1 : 0);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function printLotTable(lots, alreadyDone = 0) {
  console.log(chalk.cyan('\n' + '─'.repeat(72)));
  console.log(chalk.cyan('  Lots to process:'));
  console.log(chalk.cyan('─'.repeat(72)));
  console.log(chalk.bold(`  ${'Lot #'.padEnd(8)} ${'Title'.padEnd(40)} Images`));
  console.log('  ' + '─'.repeat(62));

  for (const lot of lots) {
    const num   = String(lot.lot_number).padEnd(8);
    const title = (lot.title || '(no title)').slice(0, 38).padEnd(40);
    const imgs  = `${lot.images.length} image${lot.images.length !== 1 ? 's' : ''}`;
    const retry = lot.status === 'failed' ? chalk.yellow(' [retry]') : '';
    console.log(`  ${num} ${title} ${imgs}${retry}`);
  }

  console.log(chalk.cyan('─'.repeat(72)));
  console.log(chalk.white(`  Total: ${lots.length} lot(s) to process${alreadyDone > 0 ? `  (${alreadyDone} already done)` : ''}\n`));
}

function printSummary(results, agentResult, startTime, logPath) {
  const elapsed = formatDuration(Date.now() - startTime);

  console.log(chalk.cyan('\n' + '='.repeat(52)));
  console.log(chalk.cyan('  DOA Listing Agent — Run Complete'));
  console.log(chalk.cyan('='.repeat(52)));

  for (const r of results) {
    const num   = `#${r.lot.lot_number}`.padEnd(6);
    const title = (r.lot.title || '(no title)').slice(0, 42);
    if (r.status === 'completed') {
      console.log(chalk.green(`  ✅ Lot ${num} ${title}`));
    } else if (r.status === 'failed') {
      const msg = r.error ? (r.error.message || String(r.error)).slice(0, 55) : 'Unknown error';
      console.log(chalk.red(`  ❌ Lot ${num} ${title} — ${msg}`));
    } else {
      console.log(chalk.gray(`  ❓ Lot ${num} ${title} — ${r.status}`));
    }
  }

  console.log(chalk.cyan('─'.repeat(52)));
  console.log(chalk.green(`  Success:  ${agentResult.succeeded}`));
  console.log(chalk.red(`  Failed:   ${agentResult.failed}`));
  console.log(chalk.white(`  Duration: ${elapsed}`));
  console.log(chalk.white(`  Log:      ${logPath}`));

  if (agentResult.failed > 0) {
    console.log(chalk.yellow(`\n  Tip: Re-run the same command — completed lots are skipped automatically.`));
  }
  console.log(chalk.cyan('='.repeat(52) + '\n'));
}

function checkDOAEnv() {
  const required = {
    DOA_EMAIL:    'Your DOA login email address',
    DOA_PASSWORD: 'Your DOA login password',
  };

  const missing = Object.entries(required)
    .filter(([key]) => !process.env[key] || process.env[key].trim() === '')
    .map(([key, description]) => `  ${key}\n    → ${description}`);

  if (missing.length > 0) {
    console.error(chalk.red('\n❌  Missing required .env variables:\n'));
    missing.forEach(m => console.error(chalk.red(m)));
    console.error(chalk.yellow('\n  Open doa-listing-agent/.env and fill in the missing values.\n'));
    process.exit(1);
  }
}

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, a => { rl.close(); resolve(a); }));
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
