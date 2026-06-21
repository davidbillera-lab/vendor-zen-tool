/**
 * runAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Multi-tenant cloud entrypoint for GitHub Actions.
 *
 * Reads USER_ID and BATCH_ID from env vars (injected by the workflow via
 * client_payload), fetches that user's DOA credentials from Supabase at
 * runtime, injects them into process.env, then hands off to agent.js in
 * --supabase --batch mode.
 *
 * Only SUPABASE_URL and SUPABASE_SERVICE_KEY need to be GitHub Secrets.
 * Per-user DOA credentials are stored in user_doa_credentials (RLS-protected)
 * and are never stored in GitHub.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { webcrypto } from 'node:crypto';

const USER_ID                     = process.env.USER_ID;
const BATCH_ID                    = process.env.BATCH_ID;
const SUPABASE_URL                = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY        = process.env.SUPABASE_SERVICE_KEY;
const CREDENTIALS_ENCRYPTION_KEY  = process.env.CREDENTIALS_ENCRYPTION_KEY;

/**
 * Decrypts a value encrypted by the save-credentials edge function.
 * Returns the value unchanged for legacy plaintext rows.
 */
async function decryptCredential(value, keyBase64) {
  if (!value) return value;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return value; }
  if (!parsed?.iv || !parsed?.ciphertext) return value; // legacy plaintext row
  // Value IS an encrypted envelope. Decrypting requires the key — if it's
  // missing we must NOT silently pass the ciphertext through as the password
  // (that turns into a confusing login failure). Fail loudly instead.
  if (!keyBase64) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY is required to decrypt this credential but is not set.');
  }
  const keyBytes = Buffer.from(keyBase64, 'base64');
  const key = await webcrypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'],
  );
  const iv         = Buffer.from(parsed.iv, 'base64');
  const ciphertext = Buffer.from(parsed.ciphertext, 'base64');
  const plaintext  = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ── Validate required env vars ────────────────────────────────────────────────

if (!USER_ID || !BATCH_ID) {
  console.error('[runAgent] ERROR: USER_ID and BATCH_ID env vars are required.');
  console.error('  These are passed automatically by the GitHub Actions workflow.');
  console.error('  For a manual run: USER_ID=<uuid> BATCH_ID=<uuid> node runAgent.js');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[runAgent] ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.');
  console.error('  Add them as GitHub Secrets: SUPABASE_URL and SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// ── Fetch user credentials from Supabase ──────────────────────────────────────

console.log(`[runAgent] Fetching DOA credentials for user ${USER_ID}...`);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const { data: creds, error } = await supabase
  .from('user_doa_credentials')
  .select('doa_email, doa_password')
  .eq('user_id', USER_ID)
  .single();

if (error || !creds) {
  console.error(`[runAgent] ERROR: No DOA credentials found for user ${USER_ID}.`);
  console.error('  The user must add their DOA credentials in VZT Settings before');
  console.error('  triggering the agent.');
  if (error) console.error(`  Supabase error: ${error.message}`);
  process.exit(1);
}

// ── Validate the DOA batch exists (denver_batch_rows) ─────────────────────────
// A DOA batch is a set of rows in denver_batch_rows keyed by batch_id — the SAME
// table agent.js reads in --batch mode. We do NOT authorize against la_batches:
// that is the LiveAuctioneers platform, a separate system that shares no ownership
// with DOA (denver_batch_rows.batch_id does not map 1:1 to la_batches.id), so
// gating a DOA run on it would reject valid batches.
//
// Guard: the batch must actually exist — a bad/typo'd BATCH_ID otherwise silently
// runs 0 lots. We use a HEAD count (no row bodies pulled). Per-tenant ownership
// authz is intentionally NOT done here: the single-tenant schema has no owner
// column on denver_batch_rows, so there is nothing to check against. Enforcing it
// is deferred to the multi-tenant migration (add an owner column + RLS), tracked
// in decisions.md. Inspecting one arbitrary row's columns gave a false sense of a
// check while enforcing nothing, so it has been removed rather than left half-done.
const { count: batchCount, error: batchErr } = await supabase
  .from('denver_batch_rows')
  .select('id', { count: 'exact', head: true })
  .eq('batch_id', BATCH_ID);

if (batchErr) {
  console.error(`[runAgent] ERROR: Could not read batch ${BATCH_ID} from denver_batch_rows.`);
  console.error(`  Supabase error: ${batchErr.message}`);
  process.exit(1);
}

if (!batchCount || batchCount === 0) {
  console.error(`[runAgent] ERROR: Batch ${BATCH_ID} has no rows in denver_batch_rows. Nothing to run.`);
  process.exit(1);
}

// ── Decrypt and inject credentials into process.env ──────────────────────────

process.env.DOA_EMAIL    = creds.doa_email;
process.env.DOA_PASSWORD = await decryptCredential(creds.doa_password, CREDENTIALS_ENCRYPTION_KEY);

// ── Push CLI args so agent.js enters --supabase --batch mode ──────────────────

process.argv.push('--supabase', '--batch', BATCH_ID, '--force');

console.log(`[runAgent] Credentials loaded. Starting batch ${BATCH_ID}...`);

// ── Hand off to agent.js ──────────────────────────────────────────────────────

await import('./agent.js');
