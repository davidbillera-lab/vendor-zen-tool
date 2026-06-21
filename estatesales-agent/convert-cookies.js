/**
 * convert-cookies.js
 *
 * Converts a Cookie-Editor (or EditThisCookie) JSON export into a Playwright
 * storageState file (es-session.json) that test-local.js / agent.js can load.
 *
 * WHY THIS EXISTS:
 *   EstateSales.net uses Google SSO. Google refuses to complete OAuth inside an
 *   automation-controlled browser (the popup closes instantly with no account
 *   chooser). So we can't capture the session by logging in through Playwright.
 *   Instead, log in normally in your real Chrome, export the estatesales.net
 *   cookies with the free "Cookie-Editor" extension, and run this to convert.
 *
 * USAGE:
 *   1. In your normal Chrome, log in to https://www.estatesales.net
 *   2. Install the "Cookie-Editor" extension (Chrome Web Store, free).
 *   3. While on estatesales.net, open Cookie-Editor → Export → "Export as JSON"
 *      (this copies the cookies to your clipboard).
 *   4. Paste them into a file named es-cookies.json in THIS folder
 *      (estatesales-agent/). Save.
 *   5. Run:  node convert-cookies.js
 *
 * Output: es-session.json (gitignored — treat as a credential)
 */

import { readFileSync, writeFileSync } from 'node:fs';

const INPUT  = process.argv[2] || './es-cookies.json';
const OUTPUT = './es-session.json';

let raw;
try {
  raw = readFileSync(INPUT, 'utf8');
} catch {
  console.error(`[convert] Could not read ${INPUT}.`);
  console.error('[convert] Export your estatesales.net cookies with Cookie-Editor');
  console.error('[convert] and save them as es-cookies.json in this folder, then re-run.');
  process.exit(1);
}

let cookies;
try {
  cookies = JSON.parse(raw);
} catch {
  console.error(`[convert] ${INPUT} is not valid JSON. Re-export and try again.`);
  process.exit(1);
}

if (!Array.isArray(cookies)) {
  console.error('[convert] Expected a JSON array of cookies (Cookie-Editor "Export as JSON").');
  process.exit(1);
}

// Cookie-Editor sameSite values → Playwright values.
const sameSiteMap = {
  no_restriction: 'None',
  none: 'None',
  lax: 'Lax',
  strict: 'Strict',
  unspecified: 'Lax',
};

const pwCookies = cookies
  .filter((c) => c && c.name && c.domain)
  .map((c) => {
    const expires =
      typeof c.expirationDate === 'number' ? Math.round(c.expirationDate)
      : typeof c.expires === 'number'       ? Math.round(c.expires)
      : -1; // session cookie
    return {
      name: c.name,
      value: c.value ?? '',
      domain: c.domain,
      path: c.path || '/',
      expires,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: sameSiteMap[(c.sameSite || '').toLowerCase()] || 'Lax',
    };
  });

if (pwCookies.length === 0) {
  console.error('[convert] No usable cookies found in the export.');
  process.exit(1);
}

const esCount = pwCookies.filter((c) => c.domain.includes('estatesales.net')).length;
if (esCount === 0) {
  console.warn('[convert] WARNING: none of these cookies are for estatesales.net.');
  console.warn('[convert] Make sure you exported while ON the estatesales.net tab.');
}

const state = { cookies: pwCookies, origins: [] };
writeFileSync(OUTPUT, JSON.stringify(state, null, 2));

console.log(`[convert] Wrote ${OUTPUT} with ${pwCookies.length} cookie(s) (${esCount} for estatesales.net).`);
console.log('[convert] Next: node test-local.js   to run the headed 2-lot test.');
