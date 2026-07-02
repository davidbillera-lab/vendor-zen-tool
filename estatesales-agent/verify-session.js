/**
 * verify-session.js — DEPRECATED (no longer used).
 *
 * The EstateSales.net agent now logs in with native email + password on every
 * run (set in VZT Settings). The Playwright cookie/storageState session machine
 * this script supported has been retired. Kept for git history only.
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFileSync, existsSync } from 'node:fs';

console.error('[DEPRECATED] This script is retired. The EstateSales agent now logs in with email + password set in VZT Settings. No session capture/conversion is needed.');
process.exit(1);

chromium.use(StealthPlugin());

const SESSION_PATH = './es-session.json';
const CHECK_URL = process.argv[2] || 'https://www.estatesales.net/account';

if (!existsSync(SESSION_PATH)) {
  console.error(`[verify] ${SESSION_PATH} not found. Run convert-cookies.js or capture-session.js first.`);
  process.exit(1);
}

let storageState;
try {
  storageState = JSON.parse(readFileSync(SESSION_PATH, 'utf8'));
} catch {
  console.error(`[verify] ${SESSION_PATH} is not valid JSON.`);
  process.exit(1);
}

const esCookies = (storageState.cookies || []).filter((c) => (c.domain || '').includes('estatesales.net'));
console.log(`[verify] Session has ${esCookies.length} estatesales.net cookie(s).`);
if (esCookies.length === 0) {
  console.error('[verify] No estatesales.net cookies in the session — it will not authenticate.');
  process.exit(1);
}

console.log('[verify] Launching headed browser and loading the session...');
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState });
const page = await context.newPage();

console.log(`[verify] Navigating to ${CHECK_URL} ...`);
await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000); // let any client-side auth redirect settle

const landed = page.url();
const bounced = /\/(sign-?in|log-?in)/i.test(landed);

console.log('');
if (bounced) {
  console.log(`[verify] ❌ SESSION IS DEAD — bounced to: ${landed}`);
  console.log('[verify] These cookies are NOT logged in. Re-export from a fresh estatesales.net login.');
} else {
  console.log(`[verify] ✅ SESSION IS LIVE — stayed on: ${landed}`);
  console.log('[verify] Safe to paste es-session.json into VZT Settings → EstateSales.net Session.');
}
console.log('[verify] Look at the browser window to confirm you see your logged-in account.');
console.log('[verify] Closing in 15s...');
await page.waitForTimeout(15000);

await browser.close();
process.exit(bounced ? 1 : 0);
