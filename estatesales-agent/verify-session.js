/**
 * verify-session.js
 *
 * Sanity-checks es-session.json BEFORE you paste it into VZT Settings.
 * Loads the captured storageState into a headed browser, navigates to an
 * account-only EstateSales.net page, and reports whether the session is
 * authenticated (stayed on the account page) or dead (bounced to /sign-in).
 *
 * This mirrors the agent's own validity gate in agent.js (~line 689):
 *   if the sale page URL matches /sign-in|/log-in, the session is invalid.
 *
 * USAGE:
 *   node verify-session.js
 *   node verify-session.js https://www.estatesales.net/account/sale-wizard/pictures/4967160
 *
 * The default check URL is the generic account dashboard, which requires login.
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFileSync, existsSync } from 'node:fs';

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
