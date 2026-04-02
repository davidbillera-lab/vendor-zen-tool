/**
 * agent.js — DOA Bulk Upload Agent · Orchestrator
 * ─────────────────────────────────────────────────────────────────────────────
 * Watches C:\Users\david\Desktop\DOA bulk image loader for ZIP files.
 * When a ZIP appears, runs the 5-phase pipeline:
 *
 *   Phase 1: Detect    — find ZIP in watch folder, rename to PROCESSING-
 *   Phase 2: Extract   — unzip, parse lot numbers from filenames
 *   Phase 3: Barcodes  — pull each lot's barcode from DOA's hosted PDF sheet
 *   Phase 4: Upload    — open DOA Bulk Uploader, upload files, click Process
 *   Phase 5: Notify    — send completion email to jsgliquidators@gmail.com
 *
 * File lifecycle:
 *   doa-images-2025-01-15.zip           → detected
 *   PROCESSING-doa-images-2025-01-15.zip → being processed
 *   DONE-doa-images-2025-01-15.zip       → success
 *   FAILED-doa-images-2025-01-15.zip     → failure
 *
 * Usage:
 *   node agent.js           — process any ZIP currently in folder, then exit
 *   node agent.js --watch   — watch folder continuously (Ctrl+C to stop)
 */

import 'dotenv/config';
import fs       from 'fs';
import path     from 'path';
import chokidar from 'chokidar';
import { fileURLToPath } from 'url';

import log from './logger.js';
import { prepareSequencedFiles, cleanupWorkDir } from './barcode.js';
import { uploadToDOA } from './uploader.js';
import { sendCompletionEmail } from './notifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config ─────────────────────────────────────────────────────────────────
const WATCH_FOLDER          = process.env.WATCH_FOLDER            || 'C:\\Users\\david\\OneDrive\\Desktop\\DOA bulk image loader';
const DOA_EMAIL             = process.env.DOA_EMAIL               || '';
const DOA_PASSWORD          = process.env.DOA_PASSWORD            || '';
const DOA_LOGIN_URL         = process.env.DOA_LOGIN_URL           || '';
const DOA_BULK_UPLOADER_URL = process.env.DOA_BULK_UPLOADER_URL   || '';
const DOA_AUCTION_GROUP     = process.env.DOA_AUCTION_GROUP       || '';
// Max lots per upload session — DOA recommends ≤1,000 images; 5 lots is safe default
const BATCH_LOTS            = parseInt(process.env.BATCH_LOTS || '5', 10);

const WATCH_MODE = process.argv.includes('--watch');

// ── Processing lock ─────────────────────────────────────────────────────────
let isProcessing = false;

// ── Rename helpers ──────────────────────────────────────────────────────────
function renameZip(filePath, prefix) {
  const dir  = path.dirname(filePath);
  const base = path.basename(filePath).replace(/^(PROCESSING-|DONE-|FAILED-)/, '');
  const dest = path.join(dir, `${prefix}${base}`);
  try { fs.renameSync(filePath, dest); return dest; }
  catch (err) { log.warn(`Could not rename ZIP: ${err.message}`); return filePath; }
}

// ── Main pipeline ───────────────────────────────────────────────────────────
async function processZip(zipPath) {
  if (isProcessing) {
    log.warn(`Already processing — will pick up ${path.basename(zipPath)} when done`);
    return;
  }
  isProcessing = true;

  const originalBase = path.basename(zipPath).replace(/^(PROCESSING-|DONE-|FAILED-)/, '');
  log.section(`DOA Bulk Upload — ${originalBase}`);

  // Phase 1: rename to PROCESSING
  const processingPath = renameZip(zipPath, 'PROCESSING-');
  log.info(`Phase 1 ✓  Renamed to: ${path.basename(processingPath)}`);

  let workDir = null;
  let lotCount = 0, imageCount = 0, lotsProcessed = 0, success = false;

  try {
    // Validate config
    const errors = [];
    if (!DOA_EMAIL)             errors.push('DOA_EMAIL not set in .env');
    if (!DOA_PASSWORD)          errors.push('DOA_PASSWORD not set in .env');
    if (!DOA_LOGIN_URL)         errors.push('DOA_LOGIN_URL not set in .env');
    if (!DOA_BULK_UPLOADER_URL) errors.push('DOA_BULK_UPLOADER_URL not set in .env');
    if (errors.length) {
      for (const e of errors) log.error(e);
      throw new Error('Missing required .env values — see errors above');
    }

    // Phases 2 + 3: extract ZIP + pull barcodes from DOA PDF
    const result = await prepareSequencedFiles(processingPath);
    workDir    = result.workDir;
    lotCount   = result.lotCount;
    imageCount = result.imageCount;

    // Phase 4: upload + click Process — split into batches of BATCH_LOTS lots
    // Each lot's files = [barcode_00.png, photo_01.jpg, photo_02.jpg, ...]
    // result.filePaths is already sorted: barcode first per lot, then photos
    const allPaths = result.filePaths;

    // Rebuild per-lot file groups so we can batch cleanly
    const lotGroups = {};
    for (const fp of allPaths) {
      const base = path.basename(fp);
      const lotNum = parseInt(base.split('_')[0], 10);
      if (!lotGroups[lotNum]) lotGroups[lotNum] = [];
      lotGroups[lotNum].push(fp);
    }
    const lotNums   = Object.keys(lotGroups).map(Number).sort((a, b) => a - b);
    const batches   = [];
    for (let i = 0; i < lotNums.length; i += BATCH_LOTS) {
      const batchLots  = lotNums.slice(i, i + BATCH_LOTS);
      const batchFiles = batchLots.flatMap(n => lotGroups[n]);
      batches.push({ batchLots, batchFiles });
    }

    log.info(`Uploading ${lotNums.length} lots in ${batches.length} batch(es) of ≤${BATCH_LOTS} lots each`);

    let allSuccess = true;
    for (let b = 0; b < batches.length; b++) {
      const { batchLots, batchFiles } = batches[b];
      log.section(`Phase 4 — Batch ${b + 1}/${batches.length}: lots ${batchLots[0]}–${batchLots[batchLots.length - 1]} (${batchFiles.length} files)`);
      const upload = await uploadToDOA(batchFiles, {
        email:           DOA_EMAIL,
        password:        DOA_PASSWORD,
        loginUrl:        DOA_LOGIN_URL,
        bulkUploaderUrl: DOA_BULK_UPLOADER_URL,
      });
      lotsProcessed += upload.lotsProcessed || batchLots.length;
      if (!upload.success) allSuccess = false;

      // Brief pause between batches so DOA has time to settle
      if (b < batches.length - 1) {
        log.info('Waiting 10s before next batch...');
        await new Promise(r => setTimeout(r, 10000));
      }
    }
    success = allSuccess;

    // Phase 5: email
    log.section('Phase 5: Send Completion Email');
    await sendCompletionEmail({
      zipName:      originalBase,
      auctionGroup: DOA_AUCTION_GROUP || DOA_BULK_UPLOADER_URL,
      lotCount:     lotsProcessed,
      imageCount,
      success,
    });

    if (success) {
      renameZip(processingPath, 'DONE-');
      log.success(`Pipeline complete — DONE-${originalBase}`);
    } else {
      renameZip(processingPath, 'FAILED-');
      log.error(`Pipeline failed — FAILED-${originalBase}`);
    }

  } catch (err) {
    log.error('Pipeline crashed', err);

    await sendCompletionEmail({
      zipName:      originalBase,
      auctionGroup: DOA_AUCTION_GROUP || '(unknown)',
      lotCount:     0,
      imageCount:   0,
      success:      false,
      error:        err.message,
    }).catch(() => {});

    try { renameZip(processingPath, 'FAILED-'); } catch { /* ignore */ }

  } finally {
    if (workDir) cleanupWorkDir(workDir);
    isProcessing = false;
  }
}

// ── Phase 1: Scan watch folder for plain ZIPs ───────────────────────────────
function scanOnce() {
  if (!fs.existsSync(WATCH_FOLDER)) {
    log.warn(`Watch folder does not exist: ${WATCH_FOLDER}`);
    if (!WATCH_MODE) process.exit(1);
    return;
  }

  const zips = fs.readdirSync(WATCH_FOLDER)
    .filter(f => f.endsWith('.zip')
      && !f.startsWith('PROCESSING-')
      && !f.startsWith('DONE-')
      && !f.startsWith('FAILED-'))
    .map(f => path.join(WATCH_FOLDER, f));

  if (zips.length === 0) {
    log.info('No ZIP files found in watch folder.');
    if (!WATCH_MODE) {
      log.info(`Drop a doa-images-*.zip into:\n  ${WATCH_FOLDER}`);
      log.info('Then run: node agent.js');
    }
    return;
  }

  // Process the most recently modified ZIP
  const newest = zips.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  log.info(`Phase 1 ✓  Found ZIP: ${path.basename(newest)}`);
  processZip(newest);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log.section('DOA Bulk Upload Agent');
  log.info(`Watch folder: ${WATCH_FOLDER}`);
  log.info(`Mode: ${WATCH_MODE ? 'watching continuously' : 'run once'}`);

  if (!fs.existsSync(WATCH_FOLDER)) {
    fs.mkdirSync(WATCH_FOLDER, { recursive: true });
    log.info(`Created watch folder: ${WATCH_FOLDER}`);
  }

  scanOnce();

  if (WATCH_MODE) {
    log.info('Watching for new ZIP files... (Ctrl+C to stop)');
    chokidar.watch(WATCH_FOLDER, {
      ignored:          /(^|[/\\])\../,
      ignoreInitial:    true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    }).on('add', (filePath) => {
      if (!filePath.endsWith('.zip')) return;
      if (/(PROCESSING-|DONE-|FAILED-)/.test(path.basename(filePath))) return;
      log.info(`New ZIP detected: ${path.basename(filePath)}`);
      processZip(filePath);
    });
  }
}

main().catch(err => {
  log.error('Fatal error', err);
  process.exit(1);
});
