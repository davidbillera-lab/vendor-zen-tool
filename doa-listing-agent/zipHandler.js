/**
 * zipHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts lot images from a zip archive and groups them by lot number.
 *
 * Expected zip structure (created by Vendor-Zen-Tool):
 *
 *   {lot}_01.jpg   ← first photo for lot {lot}
 *   {lot}_02.jpg   ← second photo for lot {lot}
 *   ...
 *
 * Examples:
 *   101_01.jpg, 101_02.jpg, 101_03.jpg  → lot 101 has 3 photos
 *   102_01.jpg, 102_02.jpg              → lot 102 has 2 photos
 *
 * Rules:
 *   - Filenames MUST start with the lot number followed by an underscore.
 *   - Files are sorted alphabetically within each lot (01 before 02, etc.).
 *   - Subdirectories inside the zip are flattened — only the filename matters.
 *   - Non-image files (.txt, .DS_Store, __MACOSX, etc.) are silently ignored.
 *   - The lot number is parsed as the numeric prefix before the first underscore.
 *
 * Usage:
 *   import { extractZip, cleanupExtracted } from './zipHandler.js';
 *
 *   const lotMap = await extractZip('/path/to/auction-images.zip');
 *   // lotMap is a Map: lotNumber (string) → [ '/tmp/doa-extract/101_01.jpg', ... ]
 *
 *   // After all lots are processed:
 *   cleanupExtracted();
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import log from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Temp extraction directory — wiped clean at the start of every run
const EXTRACT_DIR = path.join(__dirname, 'temp', 'extracted');

// Supported image extensions
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.tif']);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * isImageFile(filename)
 * Returns true if the file has a supported image extension.
 */
function isImageFile(filename) {
  return IMAGE_EXTS.has(path.extname(filename).toLowerCase());
}

/**
 * parseLotNumber(filename)
 * Extracts the lot number from a filename like "101_02.jpg".
 * Returns the lot number as a string, or null if the pattern doesn't match.
 *
 * Pattern: {lotNumber}_{index}.{ext}
 * - lotNumber: one or more digits (or alphanumeric for lots like "A101")
 * - underscore separator
 * - index: one or more digits (01, 02, etc.)
 */
function parseLotNumber(filename) {
  const base = path.basename(filename, path.extname(filename)); // "101_02"
  const underscoreIdx = base.indexOf('_');
  if (underscoreIdx <= 0) return null; // No underscore, or underscore at start
  const lotPart = base.slice(0, underscoreIdx).trim();
  if (!lotPart) return null;
  return lotPart; // e.g. "101"
}

// ── Main exports ──────────────────────────────────────────────────────────────

/**
 * extractZip(zipPath)
 *
 * Extracts all image files from the zip, groups them by lot number,
 * and returns a Map of lot number → sorted array of local file paths.
 *
 * @param {string} zipPath  Absolute or relative path to the zip file
 * @returns {Map<string, string[]>}  lot number → sorted image paths
 */
export function extractZip(zipPath) {
  const absZip = path.resolve(zipPath);

  if (!fs.existsSync(absZip)) {
    throw new Error(
      `Zip file not found: ${absZip}\n` +
      `  Make sure the path is correct and the file exists.`
    );
  }

  // Clean and recreate the extraction directory
  if (fs.existsSync(EXTRACT_DIR)) {
    fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });

  log.info(`Extracting zip: ${path.basename(absZip)}`);

  let zip;
  try {
    zip = new AdmZip(absZip);
  } catch (err) {
    throw new Error(`Failed to open zip file: ${err.message}`);
  }

  const entries = zip.getEntries();
  log.info(`  Found ${entries.length} entries in zip`);

  const lotMap = new Map(); // lot_number → [filePath, ...]
  let   extracted = 0;
  let   skipped   = 0;

  for (const entry of entries) {
    // Skip directories and macOS metadata
    if (entry.isDirectory) continue;

    const rawName = path.basename(entry.entryName); // strip any subdirectory
    if (rawName.startsWith('.') || rawName.startsWith('__MACOSX')) {
      skipped++;
      continue;
    }

    if (!isImageFile(rawName)) {
      log.info(`  Skipping non-image: ${rawName}`);
      skipped++;
      continue;
    }

    const lotNumber = parseLotNumber(rawName);
    if (!lotNumber) {
      log.warn(
        `  Skipping "${rawName}" — filename doesn't match pattern {lot}_{index}.{ext}\n` +
        `  Expected something like: 101_01.jpg, 102_02.png`
      );
      skipped++;
      continue;
    }

    // Extract to temp directory using just the base filename (flatten subdirs)
    const destPath = path.join(EXTRACT_DIR, rawName);
    try {
      fs.writeFileSync(destPath, entry.getData());
      extracted++;
    } catch (err) {
      log.warn(`  Could not extract ${rawName}: ${err.message}`);
      skipped++;
      continue;
    }

    // Add to lot map
    if (!lotMap.has(lotNumber)) {
      lotMap.set(lotNumber, []);
    }
    lotMap.get(lotNumber).push(destPath);
  }

  // Sort each lot's images alphabetically (01 before 02, etc.)
  for (const [lot, files] of lotMap) {
    files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    lotMap.set(lot, files);
  }

  // Sort the lot map by lot number numerically
  const sortedMap = new Map(
    [...lotMap.entries()].sort((a, b) => {
      const numA = parseInt(a[0], 10) || 0;
      const numB = parseInt(b[0], 10) || 0;
      return numA - numB;
    })
  );

  log.success(
    `Zip extracted: ${extracted} image(s) across ${sortedMap.size} lot(s)` +
    (skipped > 0 ? ` (${skipped} file(s) skipped)` : '')
  );

  // Print a summary table
  log.section('Lot Image Summary');
  for (const [lot, files] of sortedMap) {
    log.info(`  Lot ${lot.padEnd(6)} → ${files.length} image(s): ${files.map(f => path.basename(f)).join(', ')}`);
  }

  return sortedMap;
}

/**
 * cleanupExtracted()
 * Deletes the entire extraction temp directory.
 * Call this after all lots have been processed.
 */
export function cleanupExtracted() {
  if (fs.existsSync(EXTRACT_DIR)) {
    try {
      fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
      log.info('Cleaned up extracted temp images');
    } catch (err) {
      log.warn(`Could not clean up ${EXTRACT_DIR}: ${err.message}`);
    }
  }
}
