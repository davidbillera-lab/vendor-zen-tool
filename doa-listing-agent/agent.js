/**
 * agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The main entry point for the DOA Listing Agent.
 * Run this file from the terminal to start the agent.
 *
 * COMMANDS:
 *   node agent.js --run              Run immediately, process all pending lots
 *   node agent.js --test             Process first 3 lots only (safe test run)
 *   node agent.js --dry-run          Show what was found in Supabase, no DOA login
 *   node agent.js --lot 5            Process only lot number 5
 *   node agent.js --run --force      Skip the "Proceed? (y/n)" confirmation
 *   node agent.js --schedule         Start the cron scheduler (see scheduler.js)
 *
 * What this file does:
 *   1. Reads command-line flags
 *   2. Connects to Supabase and fetches pending lots
 *   3. Prints a preview table
 *   4. Asks for confirmation (unless --force)
 *   5. Processes lots and updates Supabase status as it goes
 *   6. Prints a final summary with counts and timing
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import readline from 'readline';
import chalk from 'chalk';
import log from './logger.js';
import { authenticate, getLots, updateLotStatus, markFailed, getFirstLotUrl } from './supabaseClient.js';
import { runDoaAgent } from './doaAgent.js';
import { cleanupAllTemp } from './imageHandler.js';

// ── Parse command-line flags ──────────────────────────────────────────────────

const args   = process.argv.slice(2);
const flags  = {
  run:      args.includes('--run'),
  schedule: args.includes('--schedule'),
  test:     args.includes('--test'),
  dryRun:   args.includes('--dry-run'),
  force:    args.includes('--force'),
  lot:      null,
};

const lotFlagIdx = args.indexOf('--lot');
if (lotFlagIdx !== -1 && args[lotFlagIdx + 1]) {
  flags.lot = parseInt(args[lotFlagIdx + 1], 10);
}

// If no mode flag provided, show help
if (!flags.run && !flags.test && !flags.dryRun && !flags.schedule && flags.lot === null) {
  console.log(chalk.cyan(`
DOA Listing Agent — Usage
─────────────────────────
  node agent.js --run              Process all pending lots
  node agent.js --test             Process first 3 lots only (safe test)
  node agent.js --dry-run          Preview lots without touching DOA
  node agent.js --lot 5            Process only lot #5
  node agent.js --run --force      Skip the y/n confirmation
  node scheduler.js                Start scheduled runs (cron)
─────────────────────────`));
  process.exit(0);
}

// If --schedule flag, hand off to scheduler
if (flags.schedule) {
  const { startScheduler } = await import('./scheduler.js');
  startScheduler();
  // scheduler runs forever, nothing else to do here
} else {
  // Run immediately
  await main();
}

// ── Main run function ─────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  log.section('DOA Listing Agent — Starting');
  log.info(`Mode: ${flags.dryRun ? 'DRY RUN' : flags.test ? 'TEST (3 lots)' : flags.lot ? `Single lot #${flags.lot}` : 'FULL RUN'}`);

  // ── Step 1: Connect to Supabase ───────────────────────────────────────────
  try {
    await authenticate();
  } catch (err) {
    log.error('Cannot connect to Supabase — aborting', err);
    process.exit(1);
  }

  // ── Step 2: Fetch pending lots ────────────────────────────────────────────
  let lots;
  try {
    lots = await getLots();
  } catch (err) {
    log.error('Cannot fetch lots from Supabase — aborting', err);
    process.exit(1);
  }

  if (lots.length === 0) {
    log.info('No pending lots found. Nothing to do.');
    process.exit(0);
  }

  // ── Step 3: Apply filters ─────────────────────────────────────────────────

  // --lot N: filter to just that lot number
  if (flags.lot !== null) {
    lots = lots.filter(l => parseInt(l.lot_number, 10) === flags.lot);
    if (lots.length === 0) {
      log.warn(`No pending lot with number ${flags.lot} found`);
      process.exit(0);
    }
  }

  // --test: only first 3
  if (flags.test) {
    lots = lots.slice(0, 3);
    log.info('TEST MODE: Limiting to first 3 lots');
  }

  // ── Step 4: Print preview table ───────────────────────────────────────────
  console.log(chalk.cyan('\n' + '─'.repeat(70)));
  console.log(chalk.cyan('  Lots ready for DOA:'));
  console.log(chalk.cyan('─'.repeat(70)));
  console.log(
    chalk.bold(
      `  ${'Lot #'.padEnd(8)} ${'Title'.padEnd(35)} ${'Images'.padEnd(10)} Status`
    )
  );
  console.log('  ' + '─'.repeat(66));

  for (const lot of lots) {
    const lotNum  = String(lot.lot_number).padEnd(8);
    const title   = (lot.title || '(no title)').slice(0, 33).padEnd(35);
    const imgStr  = `${lot.images.length} image${lot.images.length !== 1 ? 's' : ''}`.padEnd(10);
    const status  = lot.status;
    console.log(`  ${lotNum} ${title} ${imgStr} ${status}`);
  }

  console.log(chalk.cyan('─'.repeat(70)));
  console.log(chalk.white(`  Total: ${lots.length} lot(s)\n`));

  // ── Step 5: Dry-run exits here ────────────────────────────────────────────
  if (flags.dryRun) {
    log.info('DRY RUN complete — no changes made to DOA or Supabase');
    process.exit(0);
  }

  // ── Step 6: Confirmation prompt (skip with --force) ───────────────────────
  if (!flags.force) {
    const answer = await askQuestion(
      chalk.yellow(`Found ${lots.length} lot(s) ready for DOA. Proceed? (y/n): `)
    );
    if (answer.trim().toLowerCase() !== 'y') {
      log.info('Cancelled by user');
      process.exit(0);
    }
  } else {
    log.info('--force flag set — skipping confirmation');
  }

  // ── Step 7: Clean up any stale temp files from a previous crashed run ─────
  cleanupAllTemp();

  // ── Step 8: Resolve first lot URL (batch DB > .env fallback) ─────────────
  const batchId = lots[0]?.raw?.batch_id || null;
  const firstLotUrl = await getFirstLotUrl(batchId);
  if (firstLotUrl) {
    log.success(`Using per-batch first lot URL from Supabase`);
  } else {
    log.info('No per-batch first lot URL set — will use DOA_FIRST_LOT_URL from .env');
  }

  // ── Step 9: Run the DOA agent ─────────────────────────────────────────────
  log.section('Starting Browser Automation');

  // Track results for the final summary
  const results = [];

  let agentResult = { succeeded: 0, failed: 0, skipped: 0 };

  try {
    agentResult = await runDoaAgent(
      lots,
      { dryRun: false, testMode: flags.test, firstLotUrl },
      {
        // Called before processing each lot — set status to in_progress
        onStart: async (lot) => {
          results.push({ lot, status: 'in_progress', error: null });
          await updateLotStatus(lot.id, 'in_progress');
        },

        // Called after a lot is listed successfully
        onSuccess: async (lot) => {
          const r = results.find(r => r.lot.id === lot.id);
          if (r) r.status = 'completed';
          await updateLotStatus(lot.id, 'completed');
        },

        // Called when a lot fails
        onFailure: async (lot, err) => {
          const r = results.find(r => r.lot.id === lot.id);
          if (r) { r.status = 'failed'; r.error = err; }
          await markFailed(lot.id, err.message || String(err));
        },

        // Called when a lot is skipped (already on DOA)
        onSkip: async (lot) => {
          const r = results.find(r => r.lot.id === lot.id);
          if (r) r.status = 'skipped';
          // Don't change Supabase status — it's still 'pending' for manual review
        },
      }
    );
  } catch (fatalErr) {
    log.error('Agent encountered a fatal error', fatalErr);
    // Mark any lots still showing in_progress as failed
    for (const r of results) {
      if (r.status === 'in_progress') {
        r.status = 'failed';
        r.error  = fatalErr;
        await markFailed(r.lot.id, fatalErr.message || String(fatalErr));
      }
    }
  }

  // ── Step 10: Print final summary ──────────────────────────────────────────
  const durationMs  = Date.now() - startTime;
  const durationStr = formatDuration(durationMs);
  const logPath     = log.getRunLogPath();

  console.log(chalk.cyan('\n' + '='.repeat(50)));
  console.log(chalk.cyan('  DOA Listing Agent — Run Complete'));
  console.log(chalk.cyan('='.repeat(50)));

  for (const r of results) {
    const num   = `#${r.lot.lot_number}`.padEnd(5);
    const title = (r.lot.title || '(no title)').slice(0, 40);
    if (r.status === 'completed') {
      console.log(chalk.green(`  ✅ Lot ${num} - ${title} - Created`));
    } else if (r.status === 'skipped') {
      console.log(chalk.yellow(`  ⏭  Lot ${num} - ${title} - Skipped (already listed)`));
    } else if (r.status === 'failed') {
      const errMsg = r.error ? r.error.message || String(r.error) : 'Unknown error';
      console.log(chalk.red(`  ❌ Lot ${num} - ${title} - Failed: ${errMsg.slice(0, 60)}`));
    } else {
      console.log(chalk.gray(`  ❓ Lot ${num} - ${title} - Status: ${r.status}`));
    }
  }

  console.log(chalk.cyan('─'.repeat(50)));
  console.log(chalk.white(`  Total:    ${lots.length} attempted`));
  console.log(chalk.green(`  Success:  ${agentResult.succeeded}`));
  console.log(chalk.yellow(`  Skipped:  ${agentResult.skipped}`));
  console.log(chalk.red(`  Failed:   ${agentResult.failed}`));
  console.log(chalk.white(`  Duration: ${durationStr}`));
  console.log(chalk.white(`  Log:      ${logPath}`));
  console.log(chalk.cyan('='.repeat(50) + '\n'));

  // Exit with error code if any lots failed (useful for scripting)
  process.exit(agentResult.failed > 0 ? 1 : 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * askQuestion(prompt)
 * Shows a prompt and waits for the user to type a response.
 * Returns the user's input as a string.
 */
function askQuestion(prompt) {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * formatDuration(ms)
 * Converts milliseconds to a human-readable "Xm Ys" string.
 */
function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const minutes  = Math.floor(totalSec / 60);
  const seconds  = totalSec % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// Export main() so scheduler.js can call it directly
export { main as runAgent };
