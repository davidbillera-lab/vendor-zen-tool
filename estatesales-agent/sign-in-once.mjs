/**
 * sign-in-once.mjs
 *
 * Opens the agent's own Chrome profile at the EstateSales.net sign-in page so
 * you can log in BY HAND, once. The session cookie is written into
 * .chrome-profile and every later agent run reuses it.
 *
 * Why this exists:
 *   EstateSales.net puts its sign-in form behind reCAPTCHA v3, which scores the
 *   visitor and, on a low score, rejects the attempt with "Email Address and/or
 *   Password was incorrect" — the same message as a genuinely wrong password.
 *   An automated form fill scores badly no matter how correct the credentials
 *   are. Signing in yourself scores like a human, and the agent then never
 *   touches the form again.
 *
 * Run:  node sign-in-once.mjs      (or double-click SIGN-IN-ONCE.bat)
 *
 * Sign in, and the window closes itself once the session is live.
 */

import path from 'path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PROFILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.chrome-profile');
const SIGN_IN = 'https://www.estatesales.net/sign-in';
const ACCOUNT = 'https://www.estatesales.net/account';
const TIMEOUT_MS = 10 * 60 * 1000;

// Same detection the agent uses, so "signed in" here means signed in there.
async function onSignInWall(page) {
  const candidates = page.locator(
    '#password-input, #password, input[name="password"], input[type="password"], input[placeholder*="password" i]'
  );
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    if (await candidates.nth(i).isVisible().catch(() => false)) return true;
  }
  return await page.getByText(/sign in to estatesales/i).first().isVisible().catch(() => false);
}

console.log('');
console.log('  ================================================');
console.log('   EstateSales.net — one-time sign in');
console.log('  ================================================');
console.log('');
console.log('  A Chrome window is opening on the EstateSales sign-in page.');
console.log('  Sign in normally. This window closes itself when you are in.');
console.log('');

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: 'chrome',
  viewport: { width: 1280, height: 900 },
});

const page = context.pages()[0] ?? await context.newPage();
await page.goto(SIGN_IN, { waitUntil: 'domcontentloaded', timeout: 60_000 });

const started = Date.now();
let signedIn = false;

while (Date.now() - started < TIMEOUT_MS) {
  // The operator closing the window is a valid way to bail out.
  if (context.pages().length === 0) break;
  await page.waitForTimeout(2000);

  let walled;
  try {
    walled = await onSignInWall(page);
  } catch {
    break;                                   // window closed mid-check
  }

  if (!walled && !/\/sign-in/i.test(page.url())) {
    // Confirm against a page that requires auth, so a redirect mid-login is
    // not mistaken for success.
    try {
      await page.goto(ACCOUNT, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1000);
      if (!(await onSignInWall(page))) { signedIn = true; break; }
    } catch {
      break;
    }
  }
}

if (signedIn) {
  console.log('  Signed in. Session saved to .chrome-profile.');
  console.log('  The agent will now skip the sign-in form on every run.');
  console.log('');
  await page.waitForTimeout(1500);
} else {
  console.log('  Did not detect a completed sign-in.');
  console.log('  Nothing was broken — just run this again and finish signing in.');
  console.log('');
}

await context.close().catch(() => {});
process.exit(signedIn ? 0 : 1);
