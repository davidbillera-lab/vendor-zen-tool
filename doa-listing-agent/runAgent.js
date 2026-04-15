/**
 * runAgent.js — GitHub Actions entry point for the DOA Listing Agent
 *
 * Called by .github/workflows/doa-agent.yml.
 * Reads BATCH_ID from the environment (passed from the GitHub Actions dispatch
 * payload by trigger-doa-agent edge function) and runs the agent in Supabase mode.
 *
 * Local runs are unaffected — continue using agent.js directly.
 */

import { spawnSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const batchId = process.env.BATCH_ID || null;

const args = ['agent.js', '--supabase', '--force'];
if (batchId) {
  args.push('--batch', batchId);
  console.log(`[runAgent] Starting DOA agent for batch: ${batchId}`);
} else {
  console.log('[runAgent] No BATCH_ID set — processing all pending lots');
}

const result = spawnSync('node', args, {
  stdio: 'inherit',
  cwd: __dirname,
});

process.exit(result.status ?? 1);
