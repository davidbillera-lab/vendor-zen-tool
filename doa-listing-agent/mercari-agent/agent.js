// doa-listing-agent/mercari-agent/agent.js
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'browser-session');
const SESSION_FILE = path.join(SESSION_DIR, 'mercari-state.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Fetch Mercari credentials for a user from Supabase.
 * Falls back to .env values so David's existing setup keeps working.
 */
async function fetchCredentials(userId) {
  if (userId) {
    const { data } = await supabase
      .from('user_mercari_credentials')
      .select('mercari_email, mercari_password')
      .eq('user_id', userId)
      .single();
    if (data) {
      return { email: data.mercari_email, password: data.mercari_password };
    }
  }
  const email = process.env.MERCARI_EMAIL;
  const password = process.env.MERCARI_PASSWORD;
  if (!email || !password) throw new Error('No Mercari credentials found in DB or .env');
  return { email, password };
}

// ── Download image from URL to a temp file ────────────────────────────────────
async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

// ── Log in to Mercari (only if session is invalid) ───────────────────────────
async function ensureLoggedIn(page, credentials) {
  await page.goto('https://www.mercari.com/', { waitUntil: 'domcontentloaded' });
  const isLoggedIn = await page.locator('[data-testid="avatar-icon"], [aria-label="Account"]').count() > 0;
  if (isLoggedIn) {
    console.log('[mercari] Already logged in via saved session');
    return;
  }
  console.log('[mercari] Logging in...');
  await page.goto('https://www.mercari.com/login/', { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', credentials.email);
  await page.fill('input[name="password"]', credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  console.log('[mercari] Logged in');
}

// ── Post a single listing to Mercari ─────────────────────────────────────────
async function postListing(page, job) {
  const d = job.formatted_data;
  if (!d?.title || !d?.price) throw new Error('formatted_data missing title or price');

  // Download images to temp files
  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  const imageUrls = (d.imageUrls || []).slice(0, 12);
  const imagePaths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const ext = imageUrls[i].split('.').pop()?.split('?')[0] || 'jpg';
    const tmpPath = path.join(tmpDir, `mercari_${job.id}_${i}.${ext}`);
    await downloadImage(imageUrls[i], tmpPath);
    imagePaths.push(tmpPath);
  }

  await page.goto('https://www.mercari.com/sell/', { waitUntil: 'networkidle', timeout: 30000 });

  // Upload photos
  if (imagePaths.length > 0) {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.locator('input[type="file"]').first().click(),
    ]);
    await fileChooser.setFiles(imagePaths);
    await page.waitForTimeout(2000);
  }

  // Fill title (Mercari: char limit 40)
  const titleInput = page.locator('input[name="name"], input[placeholder*="Title"], input[placeholder*="title"]').first();
  await titleInput.click();
  await titleInput.fill(String(d.title).substring(0, 40));

  // Fill description
  const descInput = page.locator('textarea[name="description"], textarea[placeholder*="Description"]').first();
  await descInput.click();
  await descInput.fill(String(d.description || ''));

  // Fill price
  const priceInput = page.locator('input[name="price"], input[placeholder*="Price"], input[placeholder*="price"]').first();
  await priceInput.click();
  await priceInput.fill(String(Math.round(d.price)));

  // NOTE: Category and Condition on Mercari require navigating dropdown UI.
  // These are complex multi-step interactions that depend on Mercari's current UI.
  // The agent will leave these blank (user fills them on Mercari) or you can extend
  // this agent with the specific Playwright steps once you observe the current UI.
  console.log('[mercari] NOTE: Category/Condition dropdowns need manual verification of selectors');

  // Submit
  const submitBtn = page.locator('button[type="submit"], button:has-text("List"), button:has-text("Submit")').first();
  await submitBtn.click();
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });

  // Cleanup temp files
  for (const p of imagePaths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  console.log(`[mercari] Posted job ${job.id}`);
}

// ── Main polling loop ─────────────────────────────────────────────────────────
async function run() {
  console.log('[mercari-agent] Starting up...');

  const { data: jobs, error } = await supabase
    .from('crosspost_jobs')
    .select('*')
    .eq('platform', 'mercari')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { console.error('[mercari-agent] DB error:', error.message); process.exit(1); }
  if (!jobs || jobs.length === 0) { console.log('[mercari-agent] No pending jobs. Exiting.'); return; }

  console.log(`[mercari-agent] Found ${jobs.length} pending job(s)`);

  // Group jobs by user_id so we log in once per user
  const jobsByUser = {};
  for (const job of jobs) {
    const uid = job.user_id || 'default';
    if (!jobsByUser[uid]) jobsByUser[uid] = [];
    jobsByUser[uid].push(job);
  }

  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  for (const [userId, userJobs] of Object.entries(jobsByUser)) {
    let credentials;
    try {
      credentials = await fetchCredentials(userId === 'default' ? null : userId);
    } catch (err) {
      console.error(`[mercari-agent] No credentials for user ${userId}:`, err.message);
      for (const job of userJobs) {
        await supabase.from('crosspost_jobs').update({
          status: 'failed',
          error_log: 'No Mercari credentials configured for this account',
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
      continue;
    }

    const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    try {
      await ensureLoggedIn(page, credentials);
      await context.storageState({ path: SESSION_FILE });

      for (const job of userJobs) {
        await supabase.from('crosspost_jobs').update({
          status: 'in_progress', updated_at: new Date().toISOString(),
        }).eq('id', job.id);

        try {
          await postListing(page, job);
          await supabase.from('crosspost_jobs').update({
            status: 'completed', updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          console.log(`[mercari-agent] ✓ Job ${job.id} completed`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[mercari-agent] ✗ Job ${job.id} failed:`, msg);
          await supabase.from('crosspost_jobs').update({
            status: 'failed', error_log: msg, updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        }
      }
    } finally {
      await context.storageState({ path: SESSION_FILE });
      await browser.close();
    }
  }

  console.log('[mercari-agent] Done.');
}

run().catch(err => {
  console.error('[mercari-agent] Fatal:', err);
  process.exit(1);
});
