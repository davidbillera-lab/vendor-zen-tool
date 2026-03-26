/**
 * queue.js — eBay CSV Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages a single flat folder (e.g. Desktop\eBay CSV).
 *
 * Drop a CSV in → agent picks it up → renames it when done:
 *   my-listings.csv           ← you drop this here
 *   PROCESSING-my-listings.csv  ← agent is working on it
 *   DONE-my-listings.csv        ← upload succeeded, safe to delete
 *   FAILED-my-listings.csv      ← upload failed, see .error.txt for details
 *
 * The rename to PROCESSING- is atomic and prevents double-processing if
 * the agent runs more than once at the same time.
 */

import fs from 'fs';
import path from 'path';
import log from './logger.js';

/**
 * ensureQueueFolder(baseDir)
 * Creates the watch folder if it doesn't exist yet.
 */
export function ensureQueueFolders(baseDir) {
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    log.info(`Created queue folder: ${baseDir}`);
  }
}

/**
 * scanPending(baseDir)
 * Returns CSV files in the folder that haven't been claimed or finished yet.
 * Sorted newest-first so the most recently downloaded file goes first.
 */
export function scanPending(baseDir) {
  if (!fs.existsSync(baseDir)) return [];

  return fs.readdirSync(baseDir)
    .filter(f => {
      const lower = f.toLowerCase();
      return lower.endsWith('.csv')
        && !lower.startsWith('processing-')
        && !lower.startsWith('done-')
        && !lower.startsWith('failed-');
    })
    .map(f => ({
      name: f,
      path: path.join(baseDir, f),
      mtime: fs.statSync(path.join(baseDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)  // newest first
    .map(f => f.path);
}

/**
 * scanProcessing(baseDir)
 * Returns any PROCESSING- files left over from a previous crashed run.
 */
export function scanProcessing(baseDir) {
  if (!fs.existsSync(baseDir)) return [];

  return fs.readdirSync(baseDir)
    .filter(f => f.toLowerCase().startsWith('processing-') && f.toLowerCase().endsWith('.csv'))
    .map(f => path.join(baseDir, f));
}

/**
 * claimFile(csvPath, baseDir)
 * Atomically renames the CSV to PROCESSING-filename.csv.
 * Returns the new path, or null if the rename fails (already claimed).
 */
export function claimFile(csvPath, baseDir) {
  const filename = path.basename(csvPath);
  const processingPath = path.join(baseDir, `PROCESSING-${filename}`);

  try {
    fs.renameSync(csvPath, processingPath);
    return processingPath;
  } catch (err) {
    log.warn(`Could not claim ${filename} — skipping (${err.message})`);
    return null;
  }
}

/**
 * markDone(csvPath, baseDir)
 * Renames PROCESSING-filename.csv → DONE-filename.csv.
 * You'll see it in the folder — delete it when you're ready for the next one.
 */
export function markDone(csvPath, baseDir) {
  const filename = path.basename(csvPath);
  // Strip the PROCESSING- prefix, add DONE-
  const originalName = filename.replace(/^PROCESSING-/i, '');
  const donePath = path.join(baseDir, `DONE-${originalName}`);

  try {
    fs.renameSync(csvPath, donePath);
    log.success(`Done — renamed to: DONE-${originalName}`);
  } catch (err) {
    log.error(`Could not rename ${filename} to done`, err);
  }
}

/**
 * markFailed(csvPath, baseDir, errorMessage)
 * Renames PROCESSING-filename.csv → FAILED-filename.csv
 * and writes a FAILED-filename.error.txt with details.
 */
export function markFailed(csvPath, baseDir, errorMessage) {
  const filename = path.basename(csvPath);
  const originalName = filename.replace(/^PROCESSING-/i, '');
  const failedPath = path.join(baseDir, `FAILED-${originalName}`);
  const errorPath = path.join(baseDir, `FAILED-${originalName.replace('.csv', '.error.txt')}`);

  try {
    fs.renameSync(csvPath, failedPath);
  } catch (err) {
    log.error(`Could not rename ${filename} to failed`, err);
  }

  try {
    const errorContent = [
      `Failed at: ${new Date().toISOString()}`,
      `File: ${originalName}`,
      `Error: ${errorMessage}`,
    ].join('\n');
    fs.writeFileSync(errorPath, errorContent, 'utf8');
  } catch {
    // Non-fatal
  }

  log.error(`Failed — renamed to: FAILED-${originalName}`);
}

/**
 * retryFailed(baseDir)
 * Strips the FAILED- prefix off any failed CSVs so they get picked up again.
 * Also removes the .error.txt sidecars.
 */
export function retryFailed(baseDir) {
  if (!fs.existsSync(baseDir)) return 0;

  const failedFiles = fs.readdirSync(baseDir)
    .filter(f => f.toLowerCase().startsWith('failed-') && f.toLowerCase().endsWith('.csv'));

  for (const f of failedFiles) {
    const originalName = f.replace(/^FAILED-/i, '');
    const src = path.join(baseDir, f);
    const dst = path.join(baseDir, originalName);
    const errFile = path.join(baseDir, f.replace('.csv', '.error.txt'));

    fs.renameSync(src, dst);
    if (fs.existsSync(errFile)) fs.unlinkSync(errFile);
    log.info(`Reset for retry: ${originalName}`);
  }

  return failedFiles.length;
}
