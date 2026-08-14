/**
 * probe-doa-login.mjs
 *
 * Read-only probe of the DOA login page. Loads the public /Account/Login form
 * and reports which candidate selectors actually resolve. Does NOT log in and
 * needs no credentials.
 *
 * Run this FIRST whenever DOA login breaks — the July 2026 outage was DOM
 * drift (#MainContent_Email → #username), not bad credentials, and guessing
 * cost a day. Update the chains in agent.js AND doa-listing-agent/doaAgent.js
 * to whatever this prints.
 *
 *   node probe-doa-login.mjs
 */

import { chromium } from 'playwright';

const USERNAME = [
  '#username',
  'input[name="ctl00$MainContent$username"]',
  'input[name$="$username"]',
  '#MainContent_Email',
  'input[name="Email"]',
];
const PASSWORD = [
  '#Password',
  'input[name="ctl00$MainContent$Password"]',
  'input[name$="$Password"]',
  '#MainContent_Password',
  'input[type="password"]',
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto('https://denveronlineauctions.com/Account/Login', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  console.log(`\nURL after load: ${page.url()}`);
  console.log(`Title: ${await page.title()}\n`);

  for (const [label, list] of [['USERNAME', USERNAME], ['PASSWORD', PASSWORD]]) {
    console.log(`── ${label} candidates ───────────────────────────`);
    for (const sel of list) {
      const n = await page.locator(sel).count().catch(() => -1);
      const vis = n > 0 ? await page.locator(sel).first().isVisible().catch(() => false) : false;
      const mark = n > 0 ? (vis ? 'MATCH (visible)' : 'match (hidden)') : 'no match';
      console.log(`  ${String(n).padStart(2)}  ${mark.padEnd(16)} ${sel}`);
    }
    console.log('');
  }

  // Every text/email/password input on the page, so a renamed field is obvious
  console.log('── all text/email/password inputs on page ──────────');
  const inputs = await page.locator('input[type="text"], input[type="email"], input[type="password"], input:not([type])').all();
  for (const el of inputs) {
    const [id, name, type, ph] = await Promise.all([
      el.getAttribute('id'), el.getAttribute('name'),
      el.getAttribute('type'), el.getAttribute('placeholder'),
    ]);
    const visible = await el.isVisible().catch(() => false);
    console.log(`  ${visible ? 'vis ' : 'hid '} id=${id ?? '-'} name=${name ?? '-'} type=${type ?? '-'} placeholder=${ph ?? '-'}`);
  }
} finally {
  await browser.close();
}
