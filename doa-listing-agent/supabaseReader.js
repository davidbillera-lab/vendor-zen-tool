/**
 * supabaseReader.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads lot data directly from the Vendor-Zen-Tool's Supabase database
 * (denver_batch_rows table) and writes status updates back after each lot.
 *
 * Required .env variables:
 *   SUPABASE_URL=https://mwspcagajlkanpfdbuqc.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...  ← from Supabase Dashboard → Settings → API
 *
 * Why service role key?
 *   The denver_batch_rows table uses Row-Level Security (RLS) that restricts
 *   reads to the authenticated user who created the rows. The service role key
 *   bypasses RLS so the agent can read all pending lots regardless of who
 *   created them. Never expose this key in a browser — it is server-only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import log from './logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// ── Internal fetch wrapper ────────────────────────────────────────────────────

function buildHeaders() {
  return {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=minimal',
  };
}

async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...buildHeaders(), ...(options.headers || {}) },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Supabase [${res.status}] ${path}\n  ${body}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Env validation ────────────────────────────────────────────────────────────

export function checkSupabaseEnv() {
  const missing = [];
  if (!SUPABASE_URL)  missing.push('SUPABASE_URL');
  if (!SUPABASE_KEY)  missing.push('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');

  if (missing.length > 0) {
    throw new Error(
      `Missing Supabase credentials in .env:\n` +
      missing.map(m => `  ${m}`).join('\n') + '\n\n' +
      `  Get your service role key:\n` +
      `    Supabase Dashboard → Settings → API → service_role\n` +
      `  Then add to doa-listing-agent/.env:\n` +
      `    SUPABASE_SERVICE_ROLE_KEY=eyJ...`
    );
  }
}

// ── Fetch pending lots from Supabase ──────────────────────────────────────────

/**
 * loadFromSupabase(batchId?)
 *
 * Fetches lots from denver_batch_rows where status is pending, failed, or null.
 * Completed lots are automatically excluded so reruns are safe.
 *
 * @param {string|null} batchId  Optional batch UUID to filter by
 * @returns {{ lots: object[], totalRows: number }}
 */
export async function loadFromSupabase(batchId = null) {
  checkSupabaseEnv();

  let query = '/denver_batch_rows?select=*&order=lot_number';

  if (batchId) {
    query += `&batch_id=eq.${encodeURIComponent(batchId)}`;
    // Fetch all statuses when batch is specified — show them all, filter in-code
    query += '&status=neq.completed';
  } else {
    // Without a batch filter, only fetch pending/failed
    query += '&or=(status.eq.pending,status.eq.failed,status.is.null)';
  }

  log.info(`Fetching lots from Supabase${batchId ? ` (batch: ${batchId.slice(0, 8)}…)` : ''}…`);

  let rows;
  try {
    rows = await sbFetch(query, { method: 'GET' });
  } catch (err) {
    if (err.message.includes('42501') || err.message.includes('permission denied')) {
      throw new Error(
        `Supabase returned a permissions error. This means the SUPABASE_ANON_KEY\n` +
        `  cannot read this table due to Row-Level Security (RLS).\n\n` +
        `  Fix: add SUPABASE_SERVICE_ROLE_KEY to your .env file.\n` +
        `  Get it at: Supabase Dashboard → Settings → API → service_role`
      );
    }
    throw err;
  }

  if (!rows || rows.length === 0) {
    log.info('No pending lots found in Supabase');
    return { lots: [], totalRows: 0 };
  }

  log.info(`Fetched ${rows.length} lot(s) from Supabase`);

  const lots = rows.map(row => ({
    id:           row.id,           // Supabase row UUID — used for status updates
    batch_id:     row.batch_id,
    lot_number:   String(row.lot_number),
    title:        row.title        || '',
    description:  row.description  || '',
    images:       row.image_urls   || [],
    starting_bid: row.starting_bid ?? 5,
    status:       row.status       || 'pending',
  }));

  return { lots, totalRows: rows.length };
}

// ── Fetch the first lot URL from a batch record ───────────────────────────────

/**
 * getFirstLotUrlForBatch(batchId)
 *
 * Reads doa_first_lot_url from la_batches.
 * This is stored in Vendor-Zen-Tool when a batch is linked to a DOA auction.
 *
 * @param {string} batchId  Batch UUID
 * @returns {string|null}   The URL, or null if not set
 */
export async function getFirstLotUrlForBatch(batchId) {
  if (!batchId) return null;
  try {
    const rows = await sbFetch(
      `/la_batches?id=eq.${encodeURIComponent(batchId)}&select=id,name,doa_first_lot_url`,
      { method: 'GET' }
    );
    const url = rows?.[0]?.doa_first_lot_url || null;
    if (url) {
      log.info(`  Batch first lot URL from Supabase: ${url}`);
    }
    return url;
  } catch (err) {
    log.warn(`  Could not fetch first lot URL for batch ${batchId}: ${err.message}`);
    return null;
  }
}

// ── List all batches that have DOA lots ───────────────────────────────────────

/**
 * listBatches()
 *
 * Returns recent batches from la_batches that have at least one denver_batch_row.
 * Used by --list-batches to let the user pick which batch to run.
 */
export async function listBatches() {
  checkSupabaseEnv();

  // Fetch recent batches (la_batches stores the batch metadata)
  const batches = await sbFetch(
    '/la_batches?select=id,name,lot_count,doa_first_lot_url,created_at&order=created_at.desc&limit=20',
    { method: 'GET' }
  );

  if (!batches || batches.length === 0) return [];

  // For each batch, get the DOA lot count (pending vs completed)
  const enriched = await Promise.all(
    batches.map(async (b) => {
      try {
        const counts = await sbFetch(
          `/denver_batch_rows?batch_id=eq.${b.id}&select=status`,
          { method: 'GET', headers: { 'Prefer': 'count=exact' } }
        );
        const rows = counts || [];
        const pending   = rows.filter(r => r.status !== 'completed').length;
        const completed = rows.filter(r => r.status === 'completed').length;
        return { ...b, doa_pending: pending, doa_completed: completed, doa_total: rows.length };
      } catch {
        return { ...b, doa_pending: '?', doa_completed: '?', doa_total: '?' };
      }
    })
  );

  return enriched;
}

// ── Write status back to Supabase ─────────────────────────────────────────────

/**
 * updateLotStatus(rowId, status, errorLog?)
 *
 * Updates a denver_batch_rows row's status after processing.
 * Called by agent.js onSuccess and onFailure callbacks.
 *
 * @param {string}      rowId     The UUID of the denver_batch_rows row
 * @param {string}      status    'completed' | 'failed' | 'in_progress'
 * @param {string|null} errorLog  Error message to store (for failed lots)
 */
export async function updateLotStatus(rowId, status, errorLog = null) {
  if (!rowId) return;  // CSV mode — no Supabase row ID

  const body = { status };
  if (errorLog) body.error_log = String(errorLog).slice(0, 2000); // cap length

  try {
    await sbFetch(`/denver_batch_rows?id=eq.${encodeURIComponent(rowId)}`, {
      method:  'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body:    JSON.stringify(body),
    });
    log.info(`  Supabase: lot row → ${status}`);
  } catch (err) {
    // Non-fatal — the local progress JSON is still the source of truth for resuming
    log.warn(`  Could not update Supabase status: ${err.message}`);
  }
}
