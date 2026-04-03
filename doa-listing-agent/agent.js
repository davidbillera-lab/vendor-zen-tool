/**
 * agent.js
 * -----------------------------------------------------------------------------
 * DOA Listing Agent -- main entry point.
 *
 * MODES:
 *
 *   -- CSV + Zip mode (RECOMMENDED) -----------------------------------------
 *   node agent.js --csv lots.csv --zip images.zip         Full run
 *   node agent.js --csv lots.csv --zip images.zip --test  First 3 lots only
 *   node agent.js --csv lots.csv --zip images.zip --force Skip confirmation
 *   node agent.js --csv lots.csv --zip images.zip --lot 5 Single lot only
 *
 *   -- Zip-only mode (uses DOA's AI dropdown for titles) ---------------------
 *   node agent.js --zip images.zip                        Full run
 *   node agent.js --zip images.zip --force                Skip confirmation
 *
 *   -- Supabase mode (pulls directly from Vendor-Zen-Tool database) ----------
 *   node agent.js --supabase                              All pending lots
 *   node agent.js --supabase --batch <id>                 One batch
 *   node agent.js --supabase --list-batches               Show available batches
 *   node agent.js --supabase --batch <id> --test          First 3 lots only
 *   node agent.js --supabase --force                      Skip confirmation
 *
 *   -- Watch mode (auto-process CSVs dropped in a folder) -------------------
 *   node agent.js --watch                                 Watch ./incoming/
 *   node agent.js --watch --dir ./my-folder               Watch custom folder
 *
 *   -- CSV-only mode (CSV with image URLs -- original behavior) --------------
 *   node agent.js --csv lots.csv                          All pending lots
 *   node agent.js --csv lots.csv --test                   First 3 lots only
 *   node agent.js --csv lots.csv --dry-run                Preview only
 *   node agent.js --csv lots.csv --lot 5                  Single lot
 *   node agent.js --csv lots.csv --force                  Skip confirmation
 *
 * REQUIRED .env (all modes):
 *   DOA_EMAIL=your-login@email.com
 *   DOA_PASSWORD=your-doa-password
 *   DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=...
 * -----------------------------------------------------------------------------
 */

import 'dotenv/config';
import readline from 'readline';
import chalk    from 'chalk';
import log      from './logger.js';
import { loadCsv, saveProgress }                from './csvReader.js';
import { runDoaAgent }                          from './doaAgent.js';
import { cleanupAllTemp }                       from './imageHandler.js';
import { extractZip, cleanupExtracted }         from './zipHandler.js';
import {
  loadFromSupabase,
  getFirstLotUrlForBatch,
  listBatches,
  updateLotStatus,
  checkSupabaseEnv,
} from './supabaseReader.js';
import { startWatchMode } from './watchMode.js';

// -- Parse CLI flags ----------------------------------------------------------

const args = process.argv.slice(2);

const zipIdx   = args.indexOf('--zip');
const zipFile  = zipIdx !== -1 ? args[zipIdx + 1] : null;

const csvIdx   = args.indexOf('--csv');
const csvFile  = csvIdx !== -1 ? args[csvIdx + 1] : null;

const lotIdx   = args.indexOf('--lot');
const lotFlag  = lotIdx !== -1 ? parseInt(args[lotIdx + 1], 10) : null;

const batchIdx = args.indexOf('--batch');
const batchId  = batchIdx !== -1 ? args[batchIdx + 1] : null;

const dirIdx   = args.indexOf('--dir');
const watchDir = dirIdx !== -1 ? args[dirIdx + 1] : './incoming';

const urlIdx      = args.indexOf('--url');
const cliFirstUrl = urlIdx !== -1 ? args[urlIdx + 1] : null;

const isZip           = !!zipFile;
const isCsv           = !!csvFile;
const isSupabase      = args.includes('--supabase');
const isWatch         = args.includes('--watch');
const listBatchesFlag = args.includes('--list-batches');

const flags = {
  test:   args.includes('--test'),
  dryRun: args.includes('--dry-run'),
  force:  args.includes('--force'),
};

// -- Help text ----------------------------------------------------------------

const HELP = `
DOA Listing Agent
---------------------------------------------------------------------
CSV + ZIP MODE (recommended -- titles from CSV, images from zip):
  node agent.js --csv lots.csv --zip images.zip          Full run
  node agent.js --csv lots.csv --zip images.zip --test   First 3 lots
  node agent.js --csv lots.csv --zip images.zip --force  Skip confirm
  node agent.js --csv lots.csv --zip images.zip --lot 5  Single lot

ZIP-ONLY MODE (uses DOA AI dropdown for titles):
  node agent.js --zip images.zip                         Full run
  node agent.js --zip images.zip --force                 Skip confirm

SUPABASE MODE (pulls from Vendor-Zen-Tool automatically):
  node agent.js --supabase                               All pending
  node agent.js --supabase --batch <id>                  One batch
  node agent.js --supabase --list-batches                Show batches
  node agent.js --supabase --batch <id> --test           First 3 lots

WATCH MODE (auto-process CSV files dropped in a folder):
  node agent.js --watch                                  Watch ./incoming/
  node agent.js --watch --dir ./drop-folder              Custom folder

CSV-ONLY MODE (CSV with image URLs -- original behavior):
  node agent.js --csv lots.csv                           All pending
  node agent.js --csv lots.csv --test                    First 3 lots
  node agent.js --csv lots.csv --dry-run                 Preview only
  node agent.js --csv lots.csv --lot 5                   Single lot
---------------------------------------------------------------------

CSV format: lot_number, title, description, starting_bid
  (images column not needed in CSV+Zip mode -- images come from the zip)
`;

// -- Route to the right mode --------------------------------------------------

if (!isCsv && !isZip && !isSupabase && !isWatch) {
  console.log(HELP);
  process.exit(0);
}

checkDOAEnv();

const firstLotUrl = cliFirstUrl || process.env.DOA_FIRST_LOT_URL;

if (isCsv && isZip) {
  // CSV + Zip mode (RECOMMENDED)
  await runCsvZipAgent(csvFile, zipFile, { firstLotUrl, ...flags, lotFlag });

} else if (isZip) {
  // Zip-only mode (uses DOA AI dropdown)
  await runZipAgent(zipFile, { firstLotUrl, ...flags });

} else if (isWatch) {
  // Watch mode
  if (!firstLotUrl) {
    log.warn('DOA_FIRST_LOT_URL not set -- add it to .env before processing CSVs');
  }
  await startWatchMode({ watchDir, firstLotUrl });

} else if (isSupabase && listBatchesFlag) {
  // List batches
  await showBatchList();

} else if (isSupabase) {
  // Supabase mode
  await runSupabaseAgent(batchId, flags);

} else {
  // CSV-only mode (original)
  await runAgent(csvFile, { ...flags, lotFlag });
}

// -- CSV + Zip mode (RECOMMENDED) ---------------------------------------------

async function runCsvZipAgent(csvPath, zipPath, options = {}) {
  const { firstLotUrl, dryRun = false, force = false, test = false, lotFlag = null } = options;
  const startTime = Date.now();

  log.section('DOA Listing Agent -- CSV + Zip Mode (Recommended)');
  log.info(`CSV:  ${csvPath}`);
  log.info(`Zip:  ${zipPath}`);
  log.info(`Mode: ${dryRun ? 'DRY RUN' : test ? 'TEST (3 lots)' : lotFlag ? `Single lot #${lotFlag}` : 'FULL RUN'}`);

  // Load CSV
  const { lots: allLots, totalRows, firstLotUrl: csvFirstLotUrl } = loadCsv(csvPath);

  const completed = allLots.filter(l => l.status === 'completed');
  let   lots      = allLots.filter(l => l.status !== 'completed');

  if (completed.length > 0) {
    log.info(`Skipping ${completed.length} already-completed lot(s)`);
  }

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

  // Extract zip and match images to lots
  let lotMap;
  try {
    lotMap = extractZip(zipPath);
  } catch (err) {
    log.error(`Failed to extract zip: ${err.message}`);
    process.exit(1);
  }

  if (lotMap.size === 0) {
    log.error(
      'No valid lot images found in the zip file.\n' +
      '  Make sure images are named: {lot}_{index}.{ext}\n' +
      '  Examples: 73_01.jpg, 73_02.jpg, 74_01.jpg'
    );
    process.exit(1);
  }

  // Merge zip images into CSV lots by lot_number
  for (const lot of lots) {
    const zipImages = lotMap.get(String(lot.lot_number));
    if (zipImages && zipImages.length > 0) {
      lot.images = zipImages;
    } else {
      log.warn(`  Lot #${lot.lot_number}: no images found in zip -- will upload with no images`);
      lot.images = [];
    }
  }

  // Preview
  printLotTable(lots, completed.length);

  // Resolve first lot URL
  const resolvedUrl = firstLotUrl || csvFirstLotUrl || process.env.DOA_FIRST_LOT_URL;
  if (!resolvedUrl) {
    log.error(
      'No first lot URL found. Set one of these:\n' +
      '  1. In .env: DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=...\n' +
      '  2. Add a doa_first_lot_url column to your CSV (first row only)'
    );
    process.exit(1);
  }
  log.info(`  First lot URL: ${resolvedUrl}`);

  if (dryRun) {
    log.info('DRY RUN complete -- no browser opened');
    cleanupExtracted();
    process.exit(0);
  }

  // Confirmation
  if (!force) {
    const answer = await ask(chalk.yellow(`Proceed with ${lots.length} lot(s)? (y/n): `));
    if (answer.trim().toLowerCase() !== 'y') {
      log.info('Cancelled');
      cleanupExtracted();
      process.exit(0);
    }
  } else {
    log.info('--force flag -- skipping confirmation');
  }

  // Run browser automation
  log.section('Starting Browser Automation');
  const results = [];
  let agentResult = { succeeded: 0, failed: 0, skipped: 0 };

  try {
    agentResult = await runDoaAgent(
      lots,
      { firstLotUrl: resolvedUrl },
      {
        onStart:   async (lot) => { results.push({ lot, status: 'in_progress', error: null }); },
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
      if (r.status === 'in_progress') { r.status = 'failed'; r.error = fatalErr; }
    }
  } finally {
    cleanupExtracted();
  }

  printSummary(results, agentResult, startTime, log.getRunLogPath());
  process.exit(agentResult.failed > 0 ? 1 : 0);
}

// -- Zip-only mode ------------------------------------------------------------

async function runZipAgent(zipPath, options = {}) {
  const { firstLotUrl, dryRun = false, force = false } = options;
  const startTime = Date.now();

  log.section('DOA Listing Agent -- Zip Mode');
  log.info(`Zip:  ${zipPath}`);
  log.info(`Mode: ${dryRun ? 'DRY RUN' : 'FULL RUN'}`);

  let lotMap;
  try {
    lotMap = extractZip(zipPath);
  } catch (err) {
    log.error(`Failed to extract zip: ${err.message}`);
    process.exit(1);
  }

  if (lotMap.size === 0) {
    log.error(
      'No valid lot images found in the zip file.\n' +
      '  Make sure images are named: {lot}_{index}.{ext}\n' +
      '  Examples: 73_01.jpg, 73_02.jpg, 74_01.jpg'
    );
    process.exit(1);
  }

  const lots = [];
  for (const [lotNumber, imagePaths] of lotMap) {
    lots.push({ lot_number: lotNumber, title: '', description: '', images: imagePaths });
  }

  const resolvedUrl = firstLotUrl || process.env.DOA_FIRST_LOT_URL;
  if (!resolvedUrl) {
    log.error(
      'No first lot URL found.\n' +
      '  Set DOA_FIRST_LOT_URL in your .env file, or pass --url <url>'
    );
    process.exit(1);
  }

  printLotTable(lots);
  log.info(`  First lot URL: ${resolvedUrl}`);

  if (dryRun) {
    log.info('DRY RUN complete -- no browser opened');
    cleanupExtracted();
    process.exit(0);
  }

  if (!force) {
    const answer = await ask(chalk.yellow(`Proceed with ${lots.length} lot(s)? (y/n): `));
    if (answer.trim().toLowerCase() !== 'y') {
      log.info('Cancelled');
      cleanupExtracted();
      process.exit(0);
    }
  } else {
    log.info('--force flag -- skipping confirmation');
  }

  log.section('Starting Browser Automation');
  const results = [];
  let agentResult = { succeeded: 0, failed: 0, skipped: 0 };

  try {
    agentResult = await runDoaAgent(
      lots,
      { firstLotUrl: resolvedUrl },
      {
        onStart:   async (lot) => { results.push({ lot, status: 'in_progress', error: null }); },
        onSuccess: async (lot) => {
          const r = results.find(r => r.lot.lot_number === lot.lot_number);
          if (r) r.status = 'completed';
        },
        onFailure: async (lot, err) => {
          const r = results.find(r => r.lot.lot_number === lot.lot_number);
          if (r) { r.status = 'failed'; r.error = err; }
        },
      }
    );
  } catch (fatalErr) {
    log.error('Agent stopped due to a fatal error', fatalErr);
    for (const r of results) {
      if (r.status === 'in_progress') { r.status = 'failed'; r.error = fatalErr; }
    }
  } finally {
    cleanupExtracted();
  }

  printSummary(results, agentResult, startTime, log.getRunLogPath());
  process.exit(agentResult.failed > 0 ? 1 : 0);
}

// -- List batches -------------------------------------------------------------

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

  console.log('\n' + '-'.repeat(90));
  console.log(chalk.bold(`  ${'Batch Name / ID'.padEnd(42)} ${'Pending'.padEnd(10)} ${'Done'.padEnd(8)} ${'Failed'}`));
  console.log('  ' + '-'.repeat(82));

  for (const b of batches) {
    const label   = (b.name || b.id).slice(0, 40).padEnd(42);
    const pending = String(b.doa_pending  ?? '?').padEnd(10);
    const done    = String(b.doa_completed ?? '?').padEnd(8);
    const failed  = String(b.doa_failed   ?? '?');
    console.log(`  ${label} ${pending} ${done} ${failed}`);
    if (b.name) console.log(chalk.gray(`    ID: ${b.id}`));
  }

  console.log('-'.repeat(90));
  console.log(`\n  To run a batch: node agent.js --supabase --batch <batch-id>\n`);
  process.exit(0);
}

// -- Supabase mode ------------------------------------------------------------

async function runSupabaseAgent(batchId, options = {}) {
  const { test = false, dryRun = false, force = false } = options;
  const startTime = Date.now();

  log.section('DOA Listing Agent -- Supabase Mode');
  log.info(`Source: Vendor-Zen-Tool (Supabase)`);
  log.info(`Batch:  ${batchId || '(all pending lots)'}`);
  log.info(`Mode:   ${dryRun ? 'DRY RUN' : test ? 'TEST (3 lots)' : 'FULL RUN'}`);

  let lots, totalRows;
  try {
    ({ lots, totalRows } = await loadFromSupabase(batchId));
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }

  if (test) {
    lots = lots.slice(0, 3);
    log.info('TEST MODE: Limited to first 3 lots');
  }

  if (lots.length === 0) {
    log.info('No pending lots found -- nothing to do');
    process.exit(0);
  }

  printLotTable(lots);

  if (dryRun) {
    log.info('DRY RUN complete -- no browser opened');
    process.exit(0);
  }

  if (!force) {
    const answer = await ask(chalk.yellow(`Proceed with ${lots.length} lot(s)? (y/n): `));
    if (answer.trim().toLowerCase() !== 'y') {
      log.info('Cancelled');
      process.exit(0);
    }
  } else {
    log.info('--force flag -- skipping confirmation');
  }

  let resolvedUrl = null;
  if (batchId) {
    resolvedUrl = await getFirstLotUrlForBatch(batchId);
  }
  if (!resolvedUrl) {
    resolvedUrl = process.env.DOA_FIRST_LOT_URL;
  }
  if (!resolvedUrl) {
    log.error('No first lot URL found. Set DOA_FIRST_LOT_URL in .env or on the batch in Vendor-Zen-Tool.');
    process.exit(1);
  }

  cleanupAllTemp();
  log.section('Starting Browser Automation');

  const results = [];
  let agentResult = { succeeded: 0, failed: 0, skipped: 0 };

  try {
    agentResult = await runDoaAgent(
      lots,
      { firstLotUrl: resolvedUrl },
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
  process.exit(agentResult.failed > 0 ? 1 : 0);
}

// -- CSV-only mode (original -- preserved fully intact) -----------------------

export async function runAgent(csvPath, options = {}) {
  const { test = false, dryRun = false, force = false, lotFlag = null } = options;
  const startTime = Date.now();

  log.section('DOA Listing Agent -- CSV Mode');
  log.info(`CSV:  ${csvPath}`);
  log.info(`Mode: ${dryRun ? 'DRY RUN' : test ? 'TEST (3 lots)' : lotFlag ? `Single lot #${lotFlag}` : 'FULL RUN'}`);

  const { lots: allLots, totalRows, firstLotUrl: csvFirstLotUrl } = loadCsv(csvPath);

  const completed = allLots.filter(l => l.status === 'completed');
  let   lots      = allLots.filter(l => l.status !== 'completed');

  if (completed.length > 0) {
    log.info(`Skipping ${completed.length} already-completed lot(s)`);
  }

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

  printLotTable(lots, completed.length);

  if (dryRun) {
    log.info('DRY RUN complete -- no browser opened');
    process.exit(0);
  }

  if (!force) {
    const answer = await ask(chalk.yellow(`Proceed with ${lots.length} lot(s)? (y/n): `));
    if (answer.trim().toLowerCase() !== 'y') {
      log.info('Cancelled by user');
      process.exit(0);
    }
  } else {
    log.info('--force flag set -- skipping confirmation');
  }

  cleanupAllTemp();

  const resolvedUrl = csvFirstLotUrl || process.env.DOA_FIRST_LOT_URL;
  if (!resolvedUrl) {
    log.error('DOA_FIRST_LOT_URL not found. Add it to your .env OR include a doa_first_lot_url column in your CSV.');
    process.exit(1);
  }

  log.section('Starting Browser Automation');
  const results = [];
  let agentResult = { succeeded: 0, failed: 0, skipped: 0 };

  try {
    agentResult = await runDoaAgent(
      lots,
      { firstLotUrl: resolvedUrl },
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
  process.exit(agentResult.failed > 0 ? 1 : 0);
}

// -- Shared helpers -----------------------------------------------------------

function printLotTable(lots, alreadyDone = 0) {
  console.log('\n' + '-'.repeat(72));
  console.log('  Lots to process:');
  console.log('-'.repeat(72));
  console.log(chalk.bold(`  ${'Lot #'.padEnd(8)} ${'Title'.padEnd(40)} Images`));
  console.log('  ' + '-'.repeat(62));

  for (const lot of lots) {
    const num   = String(lot.lot_number).padEnd(8);
    const title = (lot.title || '(no title)').slice(0, 38).padEnd(40);
    const imgs  = `${(lot.images || []).length} image${(lot.images || []).length !== 1 ? 's' : ''}`;
    const retry = lot.status === 'failed' ? chalk.yellow(' [retry]') : '';
    console.log(`  ${num} ${title} ${imgs}${retry}`);
  }

  console.log('-'.repeat(72));
  console.log(`  Total: ${lots.length} lot(s) to process${alreadyDone > 0 ? `  (${alreadyDone} already done)` : ''}\n`);
}

function printSummary(results, agentResult, startTime, logPath) {
  const elapsed = formatDuration(Date.now() - startTime);

  console.log('\n' + '='.repeat(52));
  console.log('  DOA Listing Agent -- Run Complete');
  console.log('='.repeat(52));

  for (const r of results) {
    const num   = `#${r.lot.lot_number}`.padEnd(6);
    const title = (r.lot.title || '(no title)').slice(0, 42);
    if (r.status === 'completed') {
      console.log(chalk.green(`  OK  Lot ${num} ${title}`));
    } else if (r.status === 'failed') {
      const msg = r.error ? (r.error.message || String(r.error)).slice(0, 55) : 'Unknown error';
      console.log(chalk.red(`  ERR Lot ${num} ${title} -- ${msg}`));
    } else {
      console.log(chalk.gray(`  ??? Lot ${num} ${title} -- ${r.status}`));
    }
  }

  console.log('-'.repeat(52));
  console.log(chalk.green(`  Success:  ${agentResult.succeeded}`));
  console.log(chalk.red(`  Failed:   ${agentResult.failed}`));
  console.log(`  Duration: ${elapsed}`);
  console.log(`  Log:      ${logPath}`);

  if (agentResult.failed > 0) {
    console.log(chalk.yellow(`\n  Tip: Re-run the same command -- completed lots are skipped automatically.`));
  }
  console.log('='.repeat(52) + '\n');
}

function checkDOAEnv() {
  const required = {
    DOA_EMAIL:    'Your DOA login email address',
    DOA_PASSWORD: 'Your DOA login password',
  };

  const missing = Object.entries(required)
    .filter(([key]) => !process.env[key] || process.env[key].trim() === '')
    .map(([key, description]) => `  ${key}\n    -> ${description}`);

  if (missing.length > 0) {
    console.error('\nMissing required .env variables:\n');
    missing.forEach(m => console.error(m));
    console.error('\n  Open doa-listing-agent/.env and fill in the missing values.\n');
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
