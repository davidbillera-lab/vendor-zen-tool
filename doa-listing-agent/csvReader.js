/**
 * csvReader.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads lot data from a CSV file and tracks run progress in a sidecar JSON.
 *
 * CSV format (first row must be headers):
 *
 *   lot_number, title, description, images, starting_bid
 *
 *   - lot_number   Required. Used to identify and order lots.
 *   - title        The auction listing title.
 *   - description  HTML or plain text description.
 *   - images       Pipe-separated image URLs: https://a.jpg|https://b.jpg
 *   - starting_bid Optional. Defaults to 5 if omitted.
 *
 * Progress is saved to <csvname>.progress.json alongside the CSV.
 * On rerun, completed lots are skipped automatically. Failed lots are retried.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs   from 'fs';
import path from 'path';
import log  from './logger.js';

// ── CSV parser (no external dependencies) ─────────────────────────────────────

/**
 * parseCsv(text)
 * Minimal RFC 4180-compliant CSV parser.
 * Handles quoted fields (including commas and newlines inside quotes).
 * Returns an array of objects using the first row as column headers.
 */
function parseCsv(text) {
  const lines  = [];
  let   field  = '';
  let   row    = [];
  let   inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch   = text[i];
    const next = text[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }  // escaped quote
      else if (ch === '"')            { inQuote = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')  { inQuote = true; }
      else if (ch === ',')  { row.push(field.trim()); field = ''; }
      else if (ch === '\n') { row.push(field.trim()); lines.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else                  { field += ch; }
    }
  }
  // Push last field/row
  if (field || row.length) { row.push(field.trim()); lines.push(row); }

  if (lines.length < 2) return [];

  const headers = lines[0].map(h => h.toLowerCase().trim());
  return lines.slice(1)
    .filter(cols => cols.some(c => c !== ''))  // skip blank rows
    .map(cols => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim(); });
      return obj;
    });
}

// ── Normalize a CSV row into the standard lot shape ───────────────────────────

function normalizeLot(row, status) {
  // Support common column name variations
  const lotNum = (
    row.lot_number ?? row.lot_num ?? row.lot ?? row.number ?? ''
  ).trim();

  const title = (
    row.title ?? row.lot_title ?? row.item_title ?? row.name ?? ''
  ).trim();

  const description = (
    row.description ?? row.desc ?? row.body ?? row.item_description ?? ''
  ).trim();

  const startingBid = parseFloat(
    row.starting_bid ?? row.start_bid ?? row.bid ?? '5'
  ) || 5;

  // Images: pipe-separated, comma-separated, or a JSON array string
  let rawImages = (row.images ?? row.image_urls ?? row.photos ?? '').trim();
  let images = [];
  if (rawImages.startsWith('[')) {
    try { images = JSON.parse(rawImages); } catch { images = []; }
  } else if (rawImages) {
    images = rawImages.split(/[|]/).map(s => s.trim()).filter(Boolean);
  }

  return { lot_number: lotNum, title, description, images, starting_bid: startingBid, status };
}

// ── Progress sidecar ──────────────────────────────────────────────────────────

function progressPath(csvAbsPath) {
  return csvAbsPath.replace(/\.csv$/i, '.progress.json');
}

function loadProgress(csvAbsPath) {
  const p = progressPath(csvAbsPath);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return {}; }
}

/**
 * saveProgress(csvPath, lotNumber, status)
 * Writes the lot's status to the sidecar JSON file so reruns can skip it.
 * status: 'completed' | 'failed'
 */
export function saveProgress(csvPath, lotNumber, status) {
  const abs      = path.resolve(csvPath);
  const progress = loadProgress(abs);
  progress[String(lotNumber)] = status;
  fs.writeFileSync(progressPath(abs), JSON.stringify(progress, null, 2), 'utf8');
  log.info(`  Progress saved: lot #${lotNumber} → ${status}`);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * loadCsv(csvPath)
 * Reads the CSV, merges progress data, and returns normalized lot objects.
 * Lots already marked 'completed' in the sidecar are returned with that status
 * so the caller can skip them.
 *
 * @param {string} csvPath - Relative or absolute path to the CSV file
 * @returns {{ lots: object[], totalRows: number }}
 */
export function loadCsv(csvPath) {
  const abs = path.resolve(csvPath);

  if (!fs.existsSync(abs)) {
    log.error(`CSV file not found: ${abs}`);
    process.exit(1);
  }

  const text = fs.readFileSync(abs, 'utf8');
  const rows = parseCsv(text);

  if (rows.length === 0) {
    log.warn(`CSV is empty or has only headers: ${path.basename(abs)}`);
    return { lots: [], totalRows: 0 };
  }

  log.info(`Loaded ${rows.length} row(s) from ${path.basename(abs)}`);

  const progress = loadProgress(abs);

  const lots = rows.map(row => {
    const lot    = normalizeLot(row, 'pending');
    const saved  = progress[String(lot.lot_number)];
    lot.status   = saved || 'pending';
    return lot;
  });

  // Sort by lot_number numerically
  lots.sort((a, b) => (parseInt(a.lot_number, 10) || 0) - (parseInt(b.lot_number, 10) || 0));

  return { lots, totalRows: rows.length };
}
