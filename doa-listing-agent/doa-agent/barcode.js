/**
 * barcode.js — DOA Bulk Upload Agent · Phase 2 + 3
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2: Extract ZIP, group photos by lot number
 * Phase 3: Pull each lot's barcode directly from DOA's hosted PDF sheet
 *           (utility/Code-128-Barcodes-Full-Sheet.pdf) so the barcodes are
 *           100% identical to what DOA's own scanner expects.
 *
 * Barcode files are named {lot}_00.png so they sort alphabetically BEFORE
 * the lot photos ({lot}_01.jpg … {lot}_NN.jpg). DOA processes files in
 * filename-sort order, so the barcode must arrive first.
 *
 * Returns: { filePaths: string[], lotCount: number, imageCount: number, workDir: string }
 */

import fs   from 'fs';
import path from 'path';
import AdmZip  from 'adm-zip';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import log from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const WORK_BASE = path.join(__dirname, 'work');

// ── PDF barcode grid constants (calibrated at 1400×1800 viewport, 96% zoom) ──
// DOA's barcode PDF has 15 barcodes per page in a 3-column × 5-row grid.
const PDF_URL    = 'https://denveronlineauctions.com/sub-admin/utility/Code-128-Barcodes-Full-Sheet.pdf';
const VIEWPORT   = { width: 1400, height: 1800 };
const LOTS_PER_PAGE = 15;
const FIRST_X    = 503;   // left edge of crop for column 0
const COL_W      = 317;   // pixels between column starts
const FIRST_Y    = 133;   // top edge of crop for row 0
const ROW_H      = 278;   // pixels between row starts
const CROP_W     = 165;
const CROP_H     = 200;

/**
 * extractBarcodeFromPDF(browser, lotNumber, outputPath)
 * Screenshots the exact cell for lotNumber from DOA's hosted barcode PDF.
 */
async function extractBarcodeFromPDF(browser, lotNumber, outputPath) {
  const pageNum   = Math.ceil(lotNumber / LOTS_PER_PAGE);
  const posOnPage = (lotNumber - 1) % LOTS_PER_PAGE;
  const row       = Math.floor(posOnPage / 3);
  const col       = posOnPage % 3;
  const x         = FIRST_X + col * COL_W;
  const y         = FIRST_Y + row * ROW_H;

  const ctx  = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();

  try {
    await page.goto(`${PDF_URL}#page=${pageNum}`, { waitUntil: 'load', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000)); // wait for PDF render

    const buf = await page.screenshot({ clip: { x, y, width: CROP_W, height: CROP_H } });
    fs.writeFileSync(outputPath, buf);
  } finally {
    await ctx.close();
  }
}

/**
 * prepareSequencedFiles(zipPath)
 *
 * Phase 2: Extract ZIP → group photos by lot number
 * Phase 3: Pull each barcode from DOA's PDF → name {lot}_00.png
 * Returns sequenced file list ready for upload.
 *
 * @param {string} zipPath  Absolute path to the doa-images-YYYY-MM-DD.zip
 * @returns {{ filePaths: string[], lotCount: number, imageCount: number, workDir: string }}
 */
export async function prepareSequencedFiles(zipPath) {
  // ── Phase 2: Extract ZIP ─────────────────────────────────────────────────
  log.section('Phase 2: Extract ZIP');

  const runId   = Date.now();
  const workDir = path.join(WORK_BASE, `run-${runId}`);
  const imgDir  = path.join(workDir, 'images');
  const barcDir = path.join(workDir, 'barcodes');
  fs.mkdirSync(imgDir,  { recursive: true });
  fs.mkdirSync(barcDir, { recursive: true });

  log.info(`Extracting: ${path.basename(zipPath)}`);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(imgDir, true);

  // Parse filenames: expected {lot_number}_{index}.jpg  e.g. 68_01.jpg
  const entries = fs.readdirSync(imgDir)
    .filter(f => /^\d+_\d+\.(jpg|jpeg|png|webp)$/i.test(f))
    .map(f => {
      const [lotStr, rest] = f.split('_');
      return { file: f, lotNumber: parseInt(lotStr, 10), index: parseInt(rest, 10) };
    })
    .sort((a, b) => a.lotNumber !== b.lotNumber
      ? a.lotNumber - b.lotNumber
      : a.index - b.index);

  if (entries.length === 0) {
    throw new Error('No valid image files found in ZIP. Expected names like "68_01.jpg".');
  }

  const lotNumbers = [...new Set(entries.map(e => e.lotNumber))].sort((a, b) => a - b);
  log.info(`Found ${lotNumbers.length} lots (${lotNumbers[0]}–${lotNumbers[lotNumbers.length - 1]}), ${entries.length} images`);

  if (entries.length > 900) {
    log.warn(`${entries.length} images — DOA recommends ≤1,000 per session. Consider splitting.`);
  }

  // ── Phase 3: Extract barcodes from DOA's PDF ─────────────────────────────
  log.section('Phase 3: Extract Barcodes from DOA PDF');
  log.info(`Fetching ${lotNumbers.length} barcodes from DOA's barcode sheet...`);

  // Must be headless:false — Chrome's PDF viewer only renders inline (not download) in headed mode
  const browser = await chromium.launch({ headless: false });

  try {
    for (const lotNum of lotNumbers) {
      // Named {lot}_00.png — sorts alphabetically before {lot}_01.jpg
      const barcodePath = path.join(barcDir, `${lotNum}_00.png`);
      await extractBarcodeFromPDF(browser, lotNum, barcodePath);
      log.info(`  Barcode extracted: lot ${lotNum}`);
    }
  } finally {
    await browser.close();
  }

  // ── Build sequenced file list ─────────────────────────────────────────────
  // Sort order: {lot}_00.png < {lot}_01.jpg < ... so DOA sees barcode first
  const filePaths = [];
  for (const lotNum of lotNumbers) {
    filePaths.push(path.join(barcDir, `${lotNum}_00.png`));
    const lotPhotos = entries.filter(e => e.lotNumber === lotNum);
    for (const photo of lotPhotos) {
      filePaths.push(path.join(imgDir, photo.file));
    }
  }

  log.success(`Sequence ready: ${lotNumbers.length} barcodes + ${entries.length} photos = ${filePaths.length} total files`);

  return {
    filePaths,
    lotCount:   lotNumbers.length,
    imageCount: entries.length,
    workDir,
  };
}

/**
 * cleanupWorkDir(workDir)
 */
export function cleanupWorkDir(workDir) {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
    log.info(`Cleaned up work directory: ${workDir}`);
  } catch { /* non-fatal */ }
}
