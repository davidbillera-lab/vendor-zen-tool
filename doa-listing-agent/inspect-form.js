/**
 * inspect-form.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Run this ONCE before your first production batch to discover DOA's actual
 * form field names. Prints every input, textarea, select, and button on the
 * lot editing page so you can verify the selectors in doaAgent.js are correct.
 *
 * Usage:
 *   node inspect-form.js
 *
 * What it does:
 *   1. Opens a visible Chrome window
 *   2. Logs into DOA sub-admin
 *   3. Navigates to your first lot's edit page
 *   4. Prints a table of all form fields found on the page
 *   5. Takes a full-page screenshot called "form-inspection.png"
 *   6. Stays open for 60 seconds so you can also inspect manually in DevTools
 *
 * After running this, compare the output against the SELECTORS object in
 * doaAgent.js and update any that don't match.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium } from 'playwright';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DOA_BASE_URL    = process.env.DOA_BASE_URL || 'https://denveronlineauctions.com';
const DOA_EMAIL       = process.env.DOA_EMAIL;
const DOA_PASSWORD    = process.env.DOA_PASSWORD;
const DOA_FIRST_LOT_URL = process.env.DOA_FIRST_LOT_URL;
const LOGIN_URL       = `${DOA_BASE_URL}/sub-admin/`;

// ── Validate env before doing anything ───────────────────────────────────────
if (!DOA_EMAIL || !DOA_PASSWORD) {
  console.error('\n❌  DOA_EMAIL and DOA_PASSWORD must be set in your .env file\n');
  process.exit(1);
}
if (!DOA_FIRST_LOT_URL) {
  console.error('\n❌  DOA_FIRST_LOT_URL must be set in your .env file');
  console.error('    Example: https://denveronlineauctions.com/sub-admin/EditAuction?id=1678330&PartyId=115\n');
  process.exit(1);
}

console.log('\n🔍  DOA Form Inspector');
console.log('─'.repeat(60));
console.log(`    Login URL:    ${LOGIN_URL}`);
console.log(`    First Lot:    ${DOA_FIRST_LOT_URL}`);
console.log(`    Email:        ${DOA_EMAIL}`);
console.log('─'.repeat(60) + '\n');

const browser = await chromium.launch({ headless: false, slowMo: 50, args: ['--start-maximized'] });
const context = await browser.newContext({ viewport: null });
const page    = await context.newPage();

// ── Login ─────────────────────────────────────────────────────────────────────
console.log('⏳  Logging in…');
await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

// Try each common email selector
const emailField = await firstVisible(page, [
  'input[name="email"]', 'input[type="email"]', 'input[name="username"]',
  'input[id*="email"]', 'input[placeholder*="email" i]',
]);
if (!emailField) { console.error('❌  Could not find email field on login page'); await browser.close(); process.exit(1); }
await emailField.fill(DOA_EMAIL);

const passwordField = await firstVisible(page, [
  'input[name="password"]', 'input[type="password"]',
  'input[id*="password"]', 'input[placeholder*="password" i]',
]);
if (!passwordField) { console.error('❌  Could not find password field on login page'); await browser.close(); process.exit(1); }
await passwordField.fill(DOA_PASSWORD);

// Submit
const submitBtn = await firstVisible(page, [
  'button[type="submit"]', 'input[type="submit"]',
  'button:has-text("Login")', 'button:has-text("Sign In")', 'button:has-text("Log In")',
]);
if (submitBtn) { await submitBtn.click(); } else { await page.keyboard.press('Enter'); }

await page.waitForTimeout(3000);
console.log('✅  Login submitted\n');

// ── Navigate to first lot ─────────────────────────────────────────────────────
console.log('⏳  Navigating to lot edit page…');
await page.goto(DOA_FIRST_LOT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(3000); // let TinyMCE and any JS finish loading
console.log('✅  On lot page\n');

// ── Inspect all form elements ─────────────────────────────────────────────────
console.log('═'.repeat(72));
console.log('  FORM FIELDS FOUND ON THIS PAGE');
console.log('  (Use these to verify/update the SELECTORS object in doaAgent.js)');
console.log('═'.repeat(72));

const fields = await page.evaluate(() => {
  const results = [];

  // All inputs, textareas, selects
  const elements = document.querySelectorAll('input, textarea, select');
  elements.forEach(el => {
    results.push({
      tag:         el.tagName.toLowerCase(),
      type:        el.getAttribute('type') || '(none)',
      name:        el.getAttribute('name') || '',
      id:          el.getAttribute('id') || '',
      placeholder: el.getAttribute('placeholder') || '',
      value:       el.value ? el.value.slice(0, 40) : '',
      className:   el.className ? el.className.slice(0, 40) : '',
      visible:     el.offsetParent !== null,
    });
  });

  return results;
});

// Print a readable table
console.log(`\n  ${'TAG'.padEnd(10)} ${'TYPE'.padEnd(12)} ${'NAME'.padEnd(24)} ${'ID'.padEnd(24)} ${'PLACEHOLDER'.padEnd(24)} CURRENT VALUE`);
console.log('  ' + '─'.repeat(120));
for (const f of fields) {
  const tag   = f.tag.padEnd(10);
  const type  = f.type.padEnd(12);
  const name  = (f.name || '(none)').padEnd(24);
  const id    = (f.id   || '(none)').padEnd(24);
  const ph    = (f.placeholder || '').padEnd(24);
  const val   = f.value || '';
  const vis   = f.visible ? '' : ' [HIDDEN]';
  console.log(`  ${tag} ${type} ${name} ${id} ${ph} ${val}${vis}`);
}

// ── Inspect buttons ───────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
console.log('  BUTTONS FOUND ON THIS PAGE');
console.log('═'.repeat(72));

const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a[class*="btn"]'))
    .map(el => ({
      tag:      el.tagName.toLowerCase(),
      type:     el.getAttribute('type') || '(none)',
      text:     (el.textContent || el.value || '').trim().slice(0, 50),
      id:       el.getAttribute('id') || '',
      classes:  el.className ? el.className.slice(0, 60) : '',
      name:     el.getAttribute('name') || '',
      visible:  el.offsetParent !== null,
    }));
});

console.log(`\n  ${'TAG'.padEnd(10)} ${'TYPE'.padEnd(12)} ${'TEXT'.padEnd(40)} ${'ID'.padEnd(20)} CLASSES`);
console.log('  ' + '─'.repeat(120));
for (const b of buttons) {
  const tag  = b.tag.padEnd(10);
  const type = b.type.padEnd(12);
  const text = (b.text || '(empty)').padEnd(40);
  const id   = (b.id || '(none)').padEnd(20);
  const cls  = b.classes;
  const vis  = b.visible ? '' : ' [HIDDEN]';
  console.log(`  ${tag} ${type} ${text} ${id} ${cls}${vis}`);
}

// ── Check for TinyMCE ─────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
console.log('  TINYMC STATUS');
console.log('═'.repeat(72));

const tinymceStatus = await page.evaluate(() => {
  if (!window.tinymce) return { found: false };
  const editors = window.tinymce.editors || [];
  return {
    found:         true,
    version:       window.tinymce.majorVersion + '.' + window.tinymce.minorVersion,
    editorCount:   editors.length,
    activeEditorId: window.tinymce.activeEditor?.id || '(none)',
    editorIds:     editors.map(e => e.id),
  };
});

if (tinymceStatus.found) {
  console.log(`\n  ✅  TinyMCE v${tinymceStatus.version} found`);
  console.log(`      Editors: ${tinymceStatus.editorCount}`);
  console.log(`      Active:  ${tinymceStatus.activeEditorId}`);
  console.log(`      All IDs: ${tinymceStatus.editorIds.join(', ')}`);
} else {
  console.log('\n  ⚠️   TinyMCE NOT found — description field may be a plain textarea');
  console.log('      Check the textarea entries in the form fields table above');
}

// ── File upload inputs ────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
console.log('  FILE UPLOAD INPUTS');
console.log('═'.repeat(72));

const fileInputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
    name:    el.getAttribute('name') || '(none)',
    id:      el.getAttribute('id') || '(none)',
    accept:  el.getAttribute('accept') || '(any)',
    multiple: el.hasAttribute('multiple'),
    visible: el.offsetParent !== null,
  }));
});

if (fileInputs.length === 0) {
  console.log('\n  ⚠️   No <input type="file"> found on page');
  console.log('      DOA may use a custom upload widget (drag-drop zone, etc.)');
  console.log('      Look for divs with class names containing "upload", "drop", "dropzone"');
} else {
  console.log(`\n  Found ${fileInputs.length} file input(s):`);
  for (const fi of fileInputs) {
    console.log(`\n    name="${fi.name}"  id="${fi.id}"  accept="${fi.accept}"  multiple=${fi.multiple}  visible=${fi.visible}`);
  }
}

// ── Screenshot ────────────────────────────────────────────────────────────────
const screenshotPath = path.join(__dirname, 'form-inspection.png');
await page.screenshot({ path: screenshotPath, fullPage: true });
console.log(`\n\n📸  Full-page screenshot saved: ${screenshotPath}`);

// ── Keep open for manual inspection ──────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
console.log('  Browser stays open for 60 seconds.');
console.log('  Right-click any element → "Inspect" to explore further.');
console.log('  Press Ctrl+C at any time to close.');
console.log('═'.repeat(72) + '\n');

await page.waitForTimeout(60_000);
await browser.close();

// ── Helper ────────────────────────────────────────────────────────────────────

async function firstVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) return el;
    } catch { /* continue */ }
  }
  return null;
}
