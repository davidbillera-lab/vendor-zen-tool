// doa-listing-agent/poshmark-agent/agent.js
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'browser-session');
const SESSION_FILE = path.join(SESSION_DIR, 'poshmark-state.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Fetch Poshmark credentials for a user from Supabase.
 * Falls back to .env values so David's existing setup keeps working.
 */
async function fetchCredentials(userId) {
  if (userId) {
    const { data } = await supabase
      .from('user_poshmark_credentials')
      .select('poshmark_email, poshmark_password')
      .eq('user_id', userId)
      .single();
    if (data) {
      return { email: data.poshmark_email, password: data.poshmark_password };
    }
  }
  const email = process.env.POSHMARK_EMAIL;
  const password = process.env.POSHMARK_PASSWORD;
  if (!email || !password) throw new Error('No Poshmark credentials found in DB or .env');
  return { email, password };
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${url}`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

async function ensureLoggedIn(page, credentials) {
  await page.goto('https://poshmark.com/', { waitUntil: 'domcontentloaded' });
  const isLoggedIn = await page.locator('[data-et-name="user_avatar"], .user-image, [data-testid="header-avatar"]').count() > 0;
  if (isLoggedIn) { console.log('[poshmark] Already logged in'); return; }

  console.log('[poshmark] Logging in...');
  await page.goto('https://poshmark.com/login', { waitUntil: 'networkidle' });
  await page.fill('input[name="login_form[username_email]"], input[placeholder*="Email"]', credentials.email);
  await page.fill('input[name="login_form[password]"], input[placeholder*="Password"]', credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  console.log('[poshmark] Logged in');
}

async function postListing(page, job) {
  const d = job.formatted_data;
  if (!d?.title || !d?.price) throw new Error('formatted_data missing title or price');

  // Download images
  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  const imageUrls = (d.imageUrls || []).slice(0, 16); // Poshmark allows up to 16 photos
  const imagePaths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const ext = imageUrls[i].split('.').pop()?.split('?')[0] || 'jpg';
    const tmpPath = path.join(tmpDir, `poshmark_${job.id}_${i}.${ext}`);
    await downloadImage(imageUrls[i], tmpPath);
    imagePaths.push(tmpPath);
  }

  await page.goto('https://poshmark.com/create-listing', { waitUntil: 'networkidle', timeout: 30000 });

  // Upload photos
  if (imagePaths.length > 0) {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.locator('input[type="file"]').first().click(),
    ]);
    await fileChooser.setFiles(imagePaths);
    await page.waitForTimeout(3000);
  }

  // Fill title
  const titleInput = page.locator('input[name="title"], input[placeholder*="Title"]').first();
  await titleInput.click();
  await titleInput.fill(String(d.title).substring(0, 80));

  // Fill description
  const descInput = page.locator('textarea[name="description"], textarea[placeholder*="Describe"]').first();
  await descInput.click();
  await descInput.fill(String(d.description || ''));

  // Fill original price and listing price
  // Poshmark has two price fields: "Original Price" and "Listing Price"
  const priceInputs = page.locator('input[name*="price"], input[placeholder*="Price"]');
  const priceCount = await priceInputs.count();
  if (priceCount >= 2) {
    await priceInputs.nth(0).fill(String(Math.round(d.price * 1.2))); // original price (slightly higher)
    await priceInputs.nth(1).fill(String(Math.round(d.price)));        // listing price
  } else if (priceCount === 1) {
    await priceInputs.nth(0).fill(String(Math.round(d.price)));
  }

  // NOTE: Category, Brand, Size, Condition on Poshmark are dropdown/search interactions.
  // These require specific Playwright steps based on Poshmark's current UI.
  // Extend this agent with those steps after observing the live UI.
  console.log('[poshmark] NOTE: Category/Brand/Size/Condition selectors need manual UI verification');

  // Submit
  const submitBtn = page.locator('button[type="submit"], button:has-text("List"), button:has-text("Next")').first();
  await submitBtn.click();
  await page.waitForTimeout(3000);

  // Cleanup
  for (const p of imagePaths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  console.log(`[poshmark] Posted job ${job.id}`);
}

async function run() {
  console.log('[poshmark-agent] Starting up...');

  const { data: jobs, error } = await supabase
    .from('crosspost_jobs')
    .select('*')
    .eq('platform', 'poshmark')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { console.error('[poshmark-agent] DB error:', error.message); process.exit(1); }
  if (!jobs || jobs.length === 0) { console.log('[poshmark-agent] No pending jobs. Exiting.'); return; }

  console.log(`[poshmark-agent] Found ${jobs.length} pending job(s)`);

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
      console.error(`[poshmark-agent] No credentials for user ${userId}:`, err.message);
      for (const job of userJobs) {
        await supabase.from('crosspost_jobs').update({
          status: 'failed',
          error_log: 'No Poshmark credentials configured for this account',
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
          console.log(`[poshmark-agent] ✓ Job ${job.id} completed`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[poshmark-agent] ✗ Job ${job.id} failed:`, msg);
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

  console.log('[poshmark-agent] Done.');
}

run().catch(err => {
  console.error('[poshmark-agent] Fatal:', err);
  process.exit(1);
});
