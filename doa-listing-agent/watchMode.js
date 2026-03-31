/**
 * watchMode.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Watches a folder for new CSV files and automatically processes them.
 *
 * USAGE:
 *   node agent.js --watch                         Watch ./incoming/ folder
 *   node agent.js --watch --dir ./my-drop-folder  Watch a custom folder
 *
 * HOW IT WORKS:
 *   1. Creates the watch folder if it doesn't exist
 *   2. Polls for new .csv files every 30 seconds
 *   3. When a CSV appears:
 *      - Moves it to ./incoming/processing/ (atomic — prevents double-processing)
 *      - Runs the full lot pipeline on it (same as --force --csv)
 *      - On success: moves to ./incoming/done/YYYY-MM-DD/
 *      - On failure: moves to ./incoming/failed/ with an error sidecar
 *   4. Keeps running and watching for the next file
 *
 * CSV FORMAT:
 *   Same as the standard CSV mode:
 *   lot_number, title, description, images, starting_bid
 *
 * DROP FOLDER WORKFLOW (no manual steps):
 *   1. Export a CSV from Vendor-Zen-Tool
 *   2. Drop it into the ./incoming/ folder (or sync via Google Drive / Dropbox)
 *   3. The agent picks it up automatically within 30 seconds
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs       from 'fs';
import path     from 'path';
import log      from './logger.js';
import { loadCsv, saveProgress } from './csvReader.js';
import { runDoaAgent }           from './doaAgent.js';
import { cleanupAllTemp }        from './imageHandler.js';

const POLL_INTERVAL_MS  = 30_000;  // check every 30 seconds
const DEFAULT_WATCH_DIR = './incoming';

// ── Directory setup ───────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log.info(`  Created folder: ${dir}`);
  }
}

function setupWatchDirs(baseDir) {
  const dirs = {
    base:       baseDir,
    processing: path.join(baseDir, 'processing'),
    done:       path.join(baseDir, 'done'),
    failed:     path.join(baseDir, 'failed'),
  };
  Object.values(dirs).forEach(ensureDir);
  return dirs;
}

// ── Find unprocessed CSV files in the watch directory ─────────────────────────

function findPendingCsvs(baseDir, processingDir) {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir)
    .filter(f => f.toLowerCase().endsWith('.csv'))
    .map(f => path.join(baseDir, f));
}

// ── Process one CSV file ──────────────────────────────────────────────────────

async function processCsv(csvPath, dirs, firstLotUrl) {
  const filename = path.basename(csvPath);
  const procPath = path.join(dirs.processing, filename);

  // Move to processing/ atomically so parallel watchers don't double-process
  try {
    fs.renameSync(csvPath, procPath);
  } catch (err) {
    // Another process already claimed this file — skip it
    log.warn(`  Skipping ${filename} (already claimed): ${err.message}`);
    return;
  }

  log.section(`Watch Mode: Processing ${filename}`);

  const { lots: allLots, firstLotUrl: csvFirstLotUrl } = loadCsv(procPath);
  const lots = allLots.filter(l => l.status !== 'completed');
  // URL priority: from CSV column → from watch mode option → from .env (handled in runDoaAgent)
  const resolvedFirstLotUrl = csvFirstLotUrl || firstLotUrl;

  if (lots.length === 0) {
    log.info(`  All lots in ${filename} already completed — moving to done/`);
    moveToDone(procPath, dirs);
    return;
  }

  log.info(`  ${lots.length} lot(s) to process from ${filename}`);

  cleanupAllTemp();

  const results = [];
  let succeeded = 0;
  let failed = 0;

  try {
    if (resolvedFirstLotUrl) {
      log.info(`  DOA URL: ${resolvedFirstLotUrl}`);
    }

    const agentResult = await runDoaAgent(
      lots,
      { firstLotUrl: resolvedFirstLotUrl },
      {
        onStart: async (lot) => {
          results.push({ lot, status: 'in_progress' });
        },
        onSuccess: async (lot) => {
          const r = results.find(r => r.lot.lot_number === lot.lot_number);
          if (r) r.status = 'completed';
          saveProgress(procPath, lot.lot_number, 'completed');
          succeeded++;
        },
        onFailure: async (lot, err) => {
          const r = results.find(r => r.lot.lot_number === lot.lot_number);
          if (r) { r.status = 'failed'; r.error = err; }
          saveProgress(procPath, lot.lot_number, 'failed');
          failed++;
        },
      }
    );

    if (agentResult.failed === 0) {
      log.success(`  ${filename} complete — ${succeeded} lot(s) posted`);
      moveToDone(procPath, dirs);
    } else {
      log.warn(`  ${filename} had ${failed} failure(s) — moved to failed/`);
      moveToFailed(procPath, dirs, `${failed} lot(s) failed — check progress file to retry`);
    }
  } catch (fatalErr) {
    log.error(`  Fatal error processing ${filename}: ${fatalErr.message}`);
    moveToFailed(procPath, dirs, fatalErr.message);
  }
}

// ── File movement helpers ─────────────────────────────────────────────────────

function moveToDone(csvPath, dirs) {
  const today    = new Date().toISOString().slice(0, 10);
  const doneDir  = path.join(dirs.done, today);
  ensureDir(doneDir);
  const dest = path.join(doneDir, path.basename(csvPath));
  safeMove(csvPath, dest);
  // Also move the progress sidecar
  const prog = csvPath.replace(/\.csv$/i, '.progress.json');
  if (fs.existsSync(prog)) safeMove(prog, prog.replace(dirs.processing, doneDir));
}

function moveToFailed(csvPath, dirs, reason) {
  const dest = path.join(dirs.failed, path.basename(csvPath));
  safeMove(csvPath, dest);
  // Write error note
  const notePath = dest.replace(/\.csv$/i, '.error.txt');
  fs.writeFileSync(notePath, `${new Date().toISOString()}\n${reason}\n`, 'utf8');
  // Move progress sidecar too
  const prog = csvPath.replace(/\.csv$/i, '.progress.json');
  if (fs.existsSync(prog)) {
    safeMove(prog, path.join(dirs.failed, path.basename(prog)));
  }
}

function safeMove(src, dest) {
  try { fs.renameSync(src, dest); }
  catch { try { fs.copyFileSync(src, dest); fs.unlinkSync(src); } catch { /* ignore */ } }
}

// ── Main watch loop ───────────────────────────────────────────────────────────

/**
 * startWatchMode(options)
 *
 * @param {string}  options.watchDir     Folder to watch (default: ./incoming)
 * @param {string}  options.firstLotUrl  DOA first lot URL (from .env)
 */
export async function startWatchMode({ watchDir = DEFAULT_WATCH_DIR, firstLotUrl } = {}) {
  const absWatchDir = path.resolve(watchDir);
  const dirs        = setupWatchDirs(absWatchDir);

  log.section('Watch Mode — Waiting for CSV files');
  log.info(`  Drop folder:  ${absWatchDir}`);
  log.info(`  DOA URL:      ${firstLotUrl || '(from .env)'}`);
  log.info(`  Poll rate:    every ${POLL_INTERVAL_MS / 1000}s`);
  log.info(`\n  Drop a CSV here to auto-process it:`);
  log.info(`  ${absWatchDir}\n`);

  // Check for files already in processing/ from a previous crashed run
  const stuck = fs.readdirSync(dirs.processing).filter(f => f.endsWith('.csv'));
  if (stuck.length > 0) {
    log.warn(`  Found ${stuck.length} file(s) stuck in processing/ — moving back to incoming/`);
    stuck.forEach(f => {
      try { fs.renameSync(path.join(dirs.processing, f), path.join(absWatchDir, f)); }
      catch { /* ignore */ }
    });
  }

  // Poll loop
  while (true) {
    const pending = findPendingCsvs(absWatchDir, dirs.processing);

    if (pending.length > 0) {
      log.info(`  Found ${pending.length} CSV(s) to process`);
      for (const csvPath of pending) {
        await processCsv(csvPath, dirs, firstLotUrl);
      }
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
