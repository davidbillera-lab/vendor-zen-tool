/**
 * runAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * GitHub Actions entrypoint for the EstateSales upload agent.
 *
 * Reads JOB_ID from env, fetches the job record and all user credentials
 * from Supabase at runtime, injects them, then hands off to agent.js.
 *
 * Only SUPABASE_URL and SUPABASE_SERVICE_KEY need to be GitHub Secrets.
 * Per-user credentials are stored in user_doa_credentials and
 * user_estatesales_credentials — never in GitHub.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { webcrypto } from 'node:crypto';

const JOB_ID                      = process.env.JOB_ID;
const SUPABASE_URL                = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY        = process.env.SUPABASE_SERVICE_KEY;
const CREDENTIALS_ENCRYPTION_KEY  = process.env.CREDENTIALS_ENCRYPTION_KEY;

/**
 * Decrypts a value that was encrypted by the save-credentials edge function.
 * Falls back to returning the value as-is for legacy plaintext rows.
 */
async function decryptCredential(value, keyBase64) {
  if (!keyBase64 || !value) return value;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return value; }
  if (!parsed?.iv || !parsed?.ciphertext) return value;
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

if (!JOB_ID) {
  console.error('[runAgent] ERROR: JOB_ID env var is required.');
  console.error('  Passed automatically by the GitHub Actions workflow.');
  console.error('  For a manual run: JOB_ID=<uuid> node runAgent.js');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[runAgent] ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.');
  console.error('  Add them as GitHub Secrets: SUPABASE_URL and SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// ── Connect to Supabase ───────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Fetch job record ──────────────────────────────────────────────────────────

console.log(`[runAgent] Fetching job ${JOB_ID}...`);

const { data: job, error: jobError } = await supabase
  .from('estatesales_jobs')
  .select('id, user_id, doa_url, estatesales_url, status')
  .eq('id', JOB_ID)
  .single();

if (jobError || !job) {
  console.error(`[runAgent] ERROR: Job ${JOB_ID} not found.`);
  if (jobError) console.error(`  Supabase error: ${jobError.message}`);
  process.exit(1);
}

// ── Fetch DOA credentials ─────────────────────────────────────────────────────

console.log(`[runAgent] Fetching DOA credentials for user ${job.user_id}...`);

const { data: doaCreds, error: doaError } = await supabase
  .from('user_doa_credentials')
  .select('doa_email, doa_password')
  .eq('user_id', job.user_id)
  .single();

if (doaError || !doaCreds) {
  const msg = 'No DOA credentials found. User must add DOA credentials in VZT Settings.';
  console.error(`[runAgent] ERROR: ${msg}`);
  await supabase
    .from('estatesales_jobs')
    .update({ status: 'failed', error_message: msg, completed_at: new Date().toISOString() })
    .eq('id', JOB_ID);
  process.exit(1);
}

// ── Fetch EstateSales credentials ─────────────────────────────────────────────

console.log(`[runAgent] Fetching EstateSales.net credentials for user ${job.user_id}...`);

const { data: esCreds, error: esError } = await supabase
  .from('user_estatesales_credentials')
  .select('estatesales_email, estatesales_password')
  .eq('user_id', job.user_id)
  .single();

if (esError || !esCreds) {
  const msg = 'No EstateSales.net credentials found. User must add EstateSales.net credentials in VZT Settings.';
  console.error(`[runAgent] ERROR: ${msg}`);
  await supabase
    .from('estatesales_jobs')
    .update({ status: 'failed', error_message: msg, completed_at: new Date().toISOString() })
    .eq('id', JOB_ID);
  process.exit(1);
}

// ── Decrypt and inject credentials into process.env ──────────────────────────

process.env.DOA_EMAIL             = doaCreds.doa_email;
process.env.DOA_PASSWORD          = await decryptCredential(doaCreds.doa_password, CREDENTIALS_ENCRYPTION_KEY);
process.env.DOA_URL               = job.doa_url;
process.env.ESTATESALES_EMAIL     = esCreds.estatesales_email;
process.env.ESTATESALES_PASSWORD  = await decryptCredential(esCreds.estatesales_password, CREDENTIALS_ENCRYPTION_KEY);
process.env.ESTATESALES_URL       = job.estatesales_url;

console.log(`[runAgent] Credentials loaded. Starting job ${JOB_ID}...`);
console.log(`[runAgent]   DOA URL:          ${job.doa_url}`);
console.log(`[runAgent]   EstateSales URL:  ${job.estatesales_url}`);

// ── Hand off to agent.js ──────────────────────────────────────────────────────

await import('./agent.js');
