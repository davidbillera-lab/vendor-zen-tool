/**
 * capture-session.js
 *
 * One-time tool: opens a headed browser, lets you log in to EstateSales.net
 * via Google SSO manually, then saves the Playwright storageState to
 * es-session.json so test-local.js (and eventually the VZT Settings UI) can
 * use it for automated runs.
 *
 * Usage:
 *   node capture-session.js
 *
 * Output: es-session.json (gitignored — treat as a credential)
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

// Wait for the operator to press Enter in the terminal. We do NOT auto-detect
// login — the Google OAuth redirect sets cookies mid-flow that falsely look
// like a finished login, which closed the browser before you could sign in.
function waitForEnter(promptText) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(promptText, () => { rl.close(); resolve(); }));
}

chromium.use(StealthPlugin());

console.log('[capture] Launching headed browser...');
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page    = await context.newPage();

await page.goto('https://www.estatesales.net/sign-in', { waitUntil: 'domcontentloaded' });

console.log('[capture] Browser open. Complete the Google SSO login in the window.');
console.log('[capture] Take your time — the browser will NOT close on its own.');
console.log('');

// Loop until the operator confirms AND the page is genuinely back on
// estatesales.net (not Google, not the /sign-in page). This prevents saving a
// half-finished session while still mid-OAuth.
let state = null;
while (true) {
  await waitForEnter('[capture] When you are fully signed in and see your EstateSales dashboard, press ENTER...');

  let url;
  try { url = new URL(page.url()); }
  catch { console.log('[capture] Page is mid-navigation — wait a moment, then press ENTER again.\n'); continue; }

  const onEstateSales = url.hostname.includes('estatesales.net');
  const onSignInPage  = url.pathname.startsWith('/sign-in');

  if (!onEstateSales) {
    console.log(`[capture] You're still on ${url.hostname} (not estatesales.net).`);
    console.log('[capture] Finish the Google login until the page returns to estatesales.net, then press ENTER.\n');
    continue;
  }
  if (onSignInPage) {
    console.log('[capture] Still on the /sign-in page — the login has not completed yet.');
    console.log('[capture] Make sure you land on your dashboard/account, then press ENTER.\n');
    continue;
  }

  // Genuinely logged in. Confirm there are estatesales.net cookies before saving.
  const esCookies = (await context.cookies()).filter((c) => c.domain.includes('estatesales.net'));
  if (esCookies.length === 0) {
    console.log('[capture] No estatesales.net cookies found yet — the session is empty.');
    console.log('[capture] Reload your dashboard once, then press ENTER.\n');
    continue;
  }

  state = await context.storageState();
  console.log(`[capture] Logged-in landing confirmed: ${page.url()}`);
  console.log(`[capture] Captured ${esCookies.length} estatesales.net cookie(s).`);
  break;
}

writeFileSync('./es-session.json', JSON.stringify(state, null, 2));
console.log('[capture] Session saved to es-session.json');
console.log('[capture] Next: open es-session.json, copy ALL of it, paste into VZT Settings → EstateSales.net Session.');

await browser.close();
process.exit(0);
