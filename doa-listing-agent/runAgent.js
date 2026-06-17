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

// ── Decrypt and inject credentials into process.env ──────────────────────────

process.env.DOA_EMAIL    = creds.doa_email;
process.env.DOA_PASSWORD = await decryptCredential(creds.doa_password, CREDENTIALS_ENCRYPTION_KEY);

// ── Push CLI args so agent.js enters --supabase --batch mode ──────────────────

process.argv.push('--supabase', '--batch', BATCH_ID, '--force');

console.log(`[runAgent] Credentials loaded. Starting batch ${BATCH_ID}...`);

// ── Hand off to agent.js ──────────────────────────────────────────────────────

await import('./agent.js');
