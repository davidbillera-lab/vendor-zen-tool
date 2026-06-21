/**
 * test-local.js
 *
 * Local headed end-to-end test runner for the EstateSales upload agent.
 * No Supabase job record required — uses a stable fake JOB_ID so ledger
 * rows are scoped to this test run and can be inspected/cleared manually.
 *
 * Prerequisites:
 *   1. Copy .estatesales-test.env.example → .estatesales-test.env and fill it in
 *   2. Run capture-session.js once to produce es-session.json (Google-SSO login)
 *   3. node test-local.js
 *
 * The browser will be headed (visible) because IS_CI is false locally.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load .estatesales-test.env ────────────────────────────────────────────────

const testEnvPath = resolve(__dir, '.estatesales-test.env');
if (!existsSync(testEnvPath)) {
  console.error('[test-local] ERROR: .estatesales-test.env not found.');
  console.error('  Copy .estatesales-test.env.example, fill in the values, then re-run.');
  process.exit(1);
}

for (const line of readFileSync(testEnvPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim();
  if (key && val && !process.env[key]) process.env[key] = val;
}

// ── Smoke-test cap (safety) ───────────────────────────────────────────────────
// A local headed run must NEVER grind all ~169 production DOA lots by accident.
// Default to a 2-lot smoke test unless MAX_LOTS is explicitly set (env or
// .estatesales-test.env). To run the full scrape locally on purpose, set
// MAX_LOTS=0 explicitly.
if (process.env.MAX_LOTS === undefined || process.env.MAX_LOTS === '') {
  process.env.MAX_LOTS = '2';
  console.log('[test-local] MAX_LOTS not set — defaulting to 2 (smoke test). Set MAX_LOTS=0 for a full run.');
} else {
  console.log(`[test-local] MAX_LOTS=${process.env.MAX_LOTS} (from env).`);
}

// ── Load storageState session (Google-SSO) ────────────────────────────────────

const sessionPath = resolve(__dir, 'es-session.json');
if (existsSync(sessionPath)) {
  process.env.ES_STORAGE_STATE = readFileSync(sessionPath, 'utf8');
  console.log('[test-local] Loaded storageState from es-session.json');
} else {
  console.log('[test-local] No es-session.json — falling back to email/password login.');
  console.log('[test-local] If that fails, run capture-session.js first.');
}

// ── Test mode: disable the dedup ledger ───────────────────────────────────────
// AGENT_TEST_MODE=true makes agent.js short-circuit all estatesales_uploaded_lots
// reads/writes (LEDGER_ENABLED=false). A local run injects a fake JOB_ID below;
// without this guard the agent would write user_id:null rows on real
// (es_url, lot_url) keys and poison the production dedup ledger.
process.env.AGENT_TEST_MODE = 'true';

// ── Inject a stable test JOB_ID ───────────────────────────────────────────────
// The agent will try to update estatesales_jobs for this ID — it will match 0
// rows, which is fine (no error, just a no-op update). With AGENT_TEST_MODE on,
// NO ledger rows are written, so there is nothing to clean up afterward.

if (!process.env.JOB_ID) {
  process.env.JOB_ID = '00000000-0000-0000-0000-000000000001';
  console.log(`[test-local] Using test JOB_ID: ${process.env.JOB_ID}`);
}

// ── Validate required vars ────────────────────────────────────────────────────

// SUPABASE_* are NOT required in test mode — the ledger is disabled, so the
// agent never reads/writes Supabase (supabase client is null without them).
const required = ['DOA_EMAIL', 'DOA_PASSWORD', 'DOA_URL', 'ESTATESALES_URL'];
const missing  = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[test-local] ERROR: Missing required env vars: ${missing.join(', ')}`);
  console.error('  Fill them in .estatesales-test.env');
  process.exit(1);
}

console.log('[test-local] Starting agent...');
console.log(`[test-local]   DOA URL:         ${process.env.DOA_URL}`);
console.log(`[test-local]   EstateSales URL: ${process.env.ESTATESALES_URL}`);
console.log('[test-local]   Ledger:          DISABLED (AGENT_TEST_MODE=true — no estatesales_uploaded_lots writes).');
console.log('[test-local]   Browser will be HEADED (visible window).\n');

await import('./agent.js');
