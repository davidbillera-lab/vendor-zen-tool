/**
 * agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * DOA Listing Agent — main entry point.
 *
 * USAGE:
 *   node agent.js --csv lots.csv              Process all pending lots
 *   node agent.js --csv lots.csv --test       Process first 3 lots only
 *   node agent.js --csv lots.csv --dry-run    Preview lots, no browser opened
 *   node agent.js --csv lots.csv --lot 5     Process only lot #5
 *   node agent.js --csv lots.csv --force     Skip the y/n confirmation
 *
 * HOW IT WORKS:
 *   1. Reads lots from your CSV file
 *   2. Skips any lots already marked completed in the progress file
 *   3. Shows a preview table and asks to confirm
 *   4. Opens a browser, logs into DOA, and fills each lot form
 *   5. Saves progress after each lot so a failed run can be resumed
 *
 * REQUIRED .env:
 *   DOA_EMAIL=your-doa-login@email.com
 *   DOA_PASSWORD=your-doa-password
 *   DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=...
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import readline from 'readline';
import chalk    from 'chalk';
import log      from './logger.js';
import { loadCsv, saveProgress } from './csvReader.js';
import { runDoaAgent }           from './doaAgent.js';
import { cleanupAllTemp }        from './imageHandler.js';

// ── Parse CLI flags ───────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const csvIdx  = args.indexOf('--csv');
const csvFile = csvIdx !== -1 ? args[csvIdx + 1] : null;
const lotIdx  = args.indexOf('--lot');
const lotFlag = lotIdx !== -1 ? parseInt(args[lotIdx + 1], 10) : null;
const flags   = {
  test:   args.includes('--test'),
  dryRun: args.includes('--dry-run'),
  force:  args.includes('--force'),
};

// Show help if no CSV provided
if (!csvFile) {
  console.log(chalk.cyan(`
DOA Listing Agent
─────────────────────────────────────────────────────────────
  node agent.js --csv lots.csv              Process all pending lots
  node agent.js --csv lots.csv --test       First 3 lots only (safe test)
  node agent.js --csv lots.csv --dry-run    Preview lots, no browser opened
  node agent.js --csv lots.csv --lot 5     Process only lot #5
  node agent.js --csv lots.csv --force     Skip the y/n confirmation
─────────────────────────────────────────────────────────────

CSV format (first row = headers):
  lot_number, title, description, images, starting_bid

  images: pipe-separated URLs  →  https://a.jpg|https://b.jpg
`));
  process.exit(0);
}

// Pre-flight: check .env is complete before doing anything else
checkEnv();

// Run
await runAgent(csvFile, { ...flags, lotFlag });

// ── Main function (also exported for scheduler) ───────────────────────────────

export async function runAgent(csvPath, options = {}) {
  const { test = false, dryRun = false, force = false, lotFlag = null } = options;
  const startTime = Date.now();

  log.section('DOA Listing Agent — Starting');
  log.info(`CSV:  ${csvPath}`);
  log.info(`Mode: ${dryRun ? 'DRY RUN' : test ? 'TEST (3 lots)' : lotFlag ? `Single lot #${lotFlag}` : 'FULL RUN'}`);

  // ── Load CSV ──────────────────────────────────────────────────────────────
  const { lots: allLots, totalRows } = loadCsv(csvPath);

  // ── Skip completed lots ───────────────────────────────────────────────────
  const completed = allLots.filter(l => l.status === 'completed');
  let   lots      = allLots.filter(l => l.status !== 'completed');

  if (completed.length > 0) {
    log.info(`Skipping ${completed.length} already-completed lot(s)`);
  }

  // ── Apply filters ─────────────────────────────────────────────────────────
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
    log.info(`All ${totalRows} lot(s) are already completed. Nothing to do.`);
    process.exit(0);
  }

  // ── Preview table ─────────────────────────────────────────────────────────
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
  console.log(chalk.white(`  Total: ${lots.length} lot(s) to process  (${completed.length} already done)\n`));

  // ── Dry-run exits here ────────────────────────────────────────────────────
  if (dryRun) {
    log.info('DRY RUN complete — no browser opened, no changes made');
    process.exit(0);
  }

  // ── Confirmation ──────────────────────────────────────────────────────────
  if (!force) {
    const answer = await ask(chalk.yellow(`Proceed with ${lots.length} lot(s)? (y/n): `));
    if (answer.trim().toLowerCase() !== 'y') {
      log.info('Cancelled by user');
      process.exit(0);
    }
  } else {
    log.info('--force flag set — skipping confirmation');
  }

  // ── Clean temp folder from any previous crashed run ───────────────────────
  cleanupAllTemp();

  // ── Validate DOA_FIRST_LOT_URL ────────────────────────────────────────────
  const firstLotUrl = process.env.DOA_FIRST_LOT_URL;
  if (!firstLotUrl) {
    log.error('DOA_FIRST_LOT_URL is not set in your .env file');
    log.error('  Add: DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=XXXXX&PartyId=XXX');
    process.exit(1);
  }

  // ── Run browser automation ────────────────────────────────────────────────
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
    // Mark any in-progress lots as failed
    for (const r of results) {
      if (r.status === 'in_progress') {
        r.status = 'failed';
        r.error  = fatalErr;
        saveProgress(csvPath, r.lot.lot_number, 'failed');
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
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
  console.log(chalk.white(`  Log:      ${log.getRunLogPath()}`));
  if (agentResult.failed > 0) {
    console.log(chalk.yellow(`\n  Tip: Re-run the same command to retry failed lots.`));
    console.log(chalk.yellow(`       Completed lots are automatically skipped.`));
  }
  console.log(chalk.cyan('='.repeat(52) + '\n'));

  process.exit(agentResult.failed > 0 ? 1 : 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * checkEnv()
 * Validates that all required environment variables are set before the agent
 * opens a browser. Prints a clear, human-readable error if anything is missing.
 * This prevents confusing errors mid-run that are actually just missing config.
 */
function checkEnv() {
  const required = {
    DOA_EMAIL:         'Your DOA login email address',
    DOA_PASSWORD:      'Your DOA login password',
    DOA_FIRST_LOT_URL: 'URL of the first lot to edit, e.g. https://denveronlineauctions.com/sub-admin/EditAuction?id=XXXXX&PartyId=XXX',
  };

  const missing = Object.entries(required)
    .filter(([key]) => !process.env[key] || process.env[key].trim() === '')
    .map(([key, description]) => `  ${key}\n    → ${description}`);

  if (missing.length > 0) {
    console.error(chalk.red('\n❌  Missing required .env variables:\n'));
    missing.forEach(m => console.error(chalk.red(m)));
    console.error(chalk.yellow('\n  Open the .env file in your doa-listing-agent folder and fill in the missing values.'));
    console.error(chalk.yellow('  If you don\'t have a .env file, copy .env.example and rename it to .env\n'));
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
