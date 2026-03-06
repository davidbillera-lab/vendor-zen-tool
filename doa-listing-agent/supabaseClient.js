/**
 * supabaseClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all communication with your Supabase database.
 *
 * What it does:
 *   - Creates a Supabase client using your URL and anon key from .env
 *   - Logs in using your email/password so it can access protected tables
 *   - Reads lots from the denver_batch_rows table (only non-completed ones)
 *   - Figures out which column names your table uses (they vary per project)
 *   - Updates lot status as: pending → in_progress → completed / failed
 *
 * The column detection is the most important part — it checks your actual
 * table structure on first run and maps it to the names the agent expects.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import log from './logger.js';

// ── Connection setup ──────────────────────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  log.error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in your .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Column name mapping ───────────────────────────────────────────────────────
// Your table might use different column names than what the agent expects.
// These are the possible names for each logical field.

const COLUMN_CANDIDATES = {
  title:       ['title', 'lot_title', 'name', 'item_title'],
  description: ['description', 'desc', 'body', 'item_description'],
  images:      ['images', 'image_urls', 'photos', 'image_url', 'imageUrls'],
  lot_number:  ['lot_number', 'lot_num', 'lotNumber', 'lot', 'number'],
  id:          ['id'],
};

// This will be filled in by detectColumns() on the first call
let columnMap = null;

/**
 * detectColumns(sampleRow)
 * Looks at a real row from your table and figures out which column names match.
 * Prints a clear report so you can verify it found the right fields.
 */
function detectColumns(sampleRow) {
  const actualKeys = Object.keys(sampleRow);

  log.section('Column Detection Report');
  log.info(`Columns found in denver_batch_rows: ${actualKeys.join(', ')}`);

  const map = {};
  let allFound = true;

  for (const [field, candidates] of Object.entries(COLUMN_CANDIDATES)) {
    const match = candidates.find(c => actualKeys.includes(c));
    if (match) {
      map[field] = match;
      log.success(`  ${field.padEnd(12)} → "${match}"`);
    } else {
      // ID is always required; others are warnings
      if (field === 'id') {
        log.error(`  ${field.padEnd(12)} → NOT FOUND (required!)`);
        allFound = false;
      } else {
        log.warn(`  ${field.padEnd(12)} → NOT FOUND (will be empty)`);
        map[field] = null;
      }
    }
  }

  if (!allFound) {
    log.error('Critical columns are missing. Check your table structure in Supabase.');
    process.exit(1);
  }

  log.info('Column mapping complete. If anything looks wrong, check your table in Supabase.');
  return map;
}

/**
 * normalizeRow(raw)
 * Takes a raw database row and converts it to the standard format
 * that the rest of the agent expects, regardless of actual column names.
 *
 * Returns an object like:
 *   { id, lot_number, title, description, images: [...], status, raw }
 */
function normalizeRow(raw) {
  const get = field => (columnMap[field] ? raw[columnMap[field]] : null);

  // Parse images — might be a JSON string, an array, or a comma-separated string
  let images = get('images');
  if (typeof images === 'string') {
    try {
      images = JSON.parse(images);
    } catch {
      // Try comma-separated
      images = images.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(images)) {
    images = images ? [images] : [];
  }

  return {
    id:          raw.id,
    lot_number:  get('lot_number') ?? raw.id,
    title:       get('title') ?? '(no title)',
    description: get('description') ?? '',
    images,
    status:      raw.status ?? 'pending',
    raw,          // keep the original in case you need it
  };
}

// ── Authentication ────────────────────────────────────────────────────────────

/**
 * authenticate()
 * Signs in to Supabase using the email/password from .env.
 * Must be called before getLots() or any update functions.
 */
export async function authenticate() {
  const email    = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;

  if (!email || !password) {
    log.warn('SUPABASE_EMAIL / SUPABASE_PASSWORD not set — skipping auth (anon access only)');
    return;
  }

  log.info(`Authenticating with Supabase as ${email}…`);

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    log.warn(`Supabase auth failed (${error.message}) — continuing with anon key access`);
    return;
  }

  log.success('Authenticated with Supabase successfully');
}

// ── Reading lots ──────────────────────────────────────────────────────────────

/**
 * getLots()
 * Fetches all rows from denver_batch_rows where status is NOT 'completed'.
 * Results are ordered by lot_number ascending (or by id if lot_number not found).
 * On the first call, detects column names and prints the mapping report.
 *
 * Returns: array of normalized lot objects
 */
export async function getLots() {
  log.info('Fetching pending lots from Supabase…');

  const { data, error } = await supabase
    .from('denver_batch_rows')
    .select('*')
    .neq('status', 'completed')
    .order('id', { ascending: true });

  if (error) {
    log.error('Failed to fetch lots from Supabase', error);
    throw error;
  }

  if (!data || data.length === 0) {
    log.warn('No pending lots found in denver_batch_rows');
    return [];
  }

  // First run: detect columns from the first row
  if (!columnMap) {
    columnMap = detectColumns(data[0]);
  }

  const lots = data.map(normalizeRow);

  // Sort by lot_number if we have it
  if (columnMap.lot_number) {
    lots.sort((a, b) => {
      const na = parseInt(a.lot_number, 10) || 0;
      const nb = parseInt(b.lot_number, 10) || 0;
      return na - nb;
    });
  }

  log.info(`Loaded ${lots.length} pending lots`);
  return lots;
}

// ── Status updates ────────────────────────────────────────────────────────────

/**
 * updateLotStatus(id, status)
 * Updates a single row's status column.
 * status must be one of: 'pending', 'in_progress', 'completed', 'failed'
 */
export async function updateLotStatus(id, status) {
  const { error } = await supabase
    .from('denver_batch_rows')
    .update({ status })
    .eq('id', id);

  if (error) {
    log.error(`Failed to update status for lot id=${id} to "${status}"`, error);
    throw error;
  }

  log.info(`  Lot id=${id} status → ${status}`);
}

/**
 * markFailed(id, errorMessage)
 * Sets status to 'failed' and tries to save the error message to error_log column.
 * If error_log column doesn't exist, just updates status without crashing.
 */
export async function markFailed(id, errorMessage) {
  // First try with error_log column
  try {
    const { error } = await supabase
      .from('denver_batch_rows')
      .update({ status: 'failed', error_log: String(errorMessage).slice(0, 500) })
      .eq('id', id);

    if (error) throw error;
    log.warn(`Lot id=${id} marked failed: ${errorMessage}`);
  } catch {
    // error_log column might not exist — fall back to status-only update
    try {
      await updateLotStatus(id, 'failed');
      log.warn(`Lot id=${id} marked failed (no error_log column): ${errorMessage}`);
    } catch (fallbackErr) {
      log.error(`Could not mark lot id=${id} as failed at all`, fallbackErr);
    }
  }
}

export default supabase;
