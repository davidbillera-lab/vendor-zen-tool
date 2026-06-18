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

chromium.use(StealthPlugin());

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

console.log('[capture] Launching headed browser...');
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page    = await context.newPage();

await page.goto('https://www.estatesales.net/sign-in', { waitUntil: 'domcontentloaded' });

console.log('[capture] Browser open. Complete the Google SSO login in the window.');
console.log('[capture] When you land on the EstateSales dashboard, press Enter here.');
await ask('');

const state = await context.storageState();
writeFileSync('./es-session.json', JSON.stringify(state, null, 2));
console.log('[capture] Session saved to es-session.json');
console.log('[capture] Run: node test-local.js  to start the upload test');

await browser.close();
rl.close();
