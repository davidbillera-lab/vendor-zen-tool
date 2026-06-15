# EstateSales.net Login Failure — Diagnosis & Fix Plan

**Date:** 2026-06-14  
**Branch:** vercel-deploy  
**Status:** DIAGNOSIS COMPLETE — no code changed, no login attempted, no secrets read

---

## 1. Root Cause Diagnosis

### What the automation does

The automation performs a classic **email + password form fill**, not Google SSO.

Key code path (`agent.js:516–568`):

```
page.goto('https://www.estatesales.net/sign-in', …)
emailEl.fill(ES_EMAIL)         // fills #email / input[type="email"] / etc.
passEl.fill(ES_PASSWORD)       // fills #password-input / #password / etc.
submitEl.click()               // clicks "Sign In" button
waitForURL(not /sign-in/)      // waits for client-side redirect
```

There is **zero SSO handling** anywhere in the codebase — no Google OAuth redirect, no popup intercept, no cookie-based login, no `storageState` used.

### Confirmed root cause: Google-SSO-only account

The hypothesis is correct. David's account was registered via **Google SSO**. When you sign up through Google, EstateSales.net does not set an independent email+password credential. The `/sign-in` page will render an email field (because the MUI form always does), but:

1. Filling email + password and clicking "Sign In" will fail because no password exists server-side for the account.
2. The server response likely redirects back to `/sign-in` with an error, which is exactly what the automation detects at `agent.js:562–568` ("still on login page" → throws).

This also explains why re-saving credentials (2026-06-12) didn't fix it — the credentials themselves are structurally wrong for the account type. The stored `estatesales_email` and `estatesales_password` in `user_estatesales_credentials` are valid strings, but no password login path exists on the server for a Google-SSO account regardless of what password value is saved.

### Why manual login works

David's manual browser login uses Google OAuth. The browser navigates the Google consent flow with David's real Google session cookies already present. The automation has no Google session, so it cannot replicate this.

---

## 2. Code Evidence (exact file:line)

| Location | What it does |
|---|---|
| `agent.js:516` | Navigates to `/sign-in` |
| `agent.js:520–525` | Tries selectors `#email`, `input[name="email"]`, `input[type="email"]`, `input[placeholder*="email"]` |
| `agent.js:535–543` | Tries selectors `#password-input`, `#password`, `input[name="password"]`, `input[type="password"]`, `input[placeholder*="password"]` |
| `agent.js:547–555` | Clicks `button:has-text("Sign In")` etc. |
| `agent.js:557` | `waitForURL(not /sign-in/)` — if login fails, URL stays on sign-in and this resolves via `.catch(() => {})` |
| `agent.js:562–568` | Checks `page.url()` — if still `/sign-in`, throws "login appears to have failed" |
| `agent.js:794–799` | Browser context created with NO `storageState` — no session state injected |
| `runAgent.js:103–117` | Fetches `estatesales_email` and `estatesales_password` from `user_estatesales_credentials` table |
| `runAgent.js:124–125` | Injects as `process.env.ESTATESALES_EMAIL` / `process.env.ESTATESALES_PASSWORD` |
| `save-credentials/index.ts:26–33` | Password fields in the save flow include `estatesales_password` — confirms password-only credential model |

---

## 3. Credential Mechanism (no values read)

Credentials are sourced like this:

1. **David saves credentials via VZT Settings UI** → calls `save-credentials` edge function  
   (`supabase/functions/save-credentials/index.ts`)
2. Edge function **AES-GCM encrypts the password** with `CREDENTIALS_ENCRYPTION_KEY` and upserts to `user_estatesales_credentials` (columns: `estatesales_email`, `estatesales_password`)
3. At job run time, `runAgent.js` fetches the row, **decrypts the password** using the same key from `process.env.CREDENTIALS_ENCRYPTION_KEY` (a GitHub Actions secret)
4. Injects both as env vars → `agent.js` reads them from `process.env.ES_EMAIL` / `process.env.ES_PASSWORD`

The credential storage mechanism works correctly. The problem is that the **credential type stored** (email + password) does not match the **authentication type required** by the account (Google SSO).

---

## 4. Selector Audit

The selectors used for the login form:

**Email:** `#email`, `input[name="email"]`, `input[type="email"]`, `input[placeholder*="email" i]`  
**Password:** `#password-input`, `#password`, `input[name="password"]`, `input[type="password"]`, `input[placeholder*="password" i]`  
**Submit:** `button:has-text("Sign In")`, `button:has-text("Log In")`, `button:has-text("Login")`, `button[type="submit"]`, `input[type="submit"]`

**Assessment:** The selectors are reasonable for the `/sign-in` page, but for a Google-SSO-only account these selectors are irrelevant — the form exists on the page, the selectors will match, the form will fill and submit, and the server will reject the attempt. Selector quality is not the problem. A controlled probe could confirm whether the MUI form renders an email field initially or only shows "Continue with Google" — but running that probe is outside the scope of this diagnosis.

---

## 5. Fix Plan

Three viable options, ordered by recommendation.

---

### Option A — Playwright `storageState` (RECOMMENDED)

**What it is:** David exports his authenticated browser session as a JSON file (Playwright `storageState` = cookies + localStorage) from his working manual login. The automation loads this file at browser context creation time instead of logging in.

**How it works:**

`agent.js:794-799` currently creates the browser context with no state:
```js
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent: '...',
});
```

This becomes:
```js
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent: '...',
  storageState: process.env.ES_STORAGE_STATE
    ? JSON.parse(process.env.ES_STORAGE_STATE)
    : undefined,
});
```

The entire login block at `agent.js:514–568` is wrapped in a conditional — skipped if `ES_STORAGE_STATE` is set.

**Files to change:**

| File | Change |
|---|---|
| `estatesales-agent/agent.js` | Add `ES_STORAGE_STATE` env var read at top; wrap login block in `if (!ES_STORAGE_STATE)` guard; load `storageState` in `browser.newContext()` call |
| `runAgent.js` | Add `process.env.ES_STORAGE_STATE = esCreds.estatesales_storage_state` after fetching creds |
| Supabase migration | Add `estatesales_storage_state TEXT` column to `user_estatesales_credentials` table |
| `.github/workflows/estatesales-agent.yml` | No change needed — `ES_STORAGE_STATE` value comes from Supabase, not a GitHub secret |
| VZT Settings UI | Add a "Export Session" button or text area for David to paste the JSON blob (or automate capture via a one-time Playwright script David runs locally) |

**What David must provide (one-time capture steps):**

David runs this one-time capture from his local machine (Node.js + Playwright installed):

```js
// capture-session.js — run once locally, NEVER commit output
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('https://www.estatesales.net/sign-in');
// Manually complete Google SSO login in the browser window that opens
// Wait until fully logged in, then press Enter in the terminal
await new Promise(r => process.stdin.once('data', r));
await context.storageState({ path: 'es-session.json' });
await browser.close();
console.log('Session saved to es-session.json');
```

The output `es-session.json` is then uploaded to Supabase (`user_estatesales_credentials.estatesales_storage_state`) via the Settings UI or a one-time SQL insert. The JSON file must NOT be committed to git.

**Session lifespan caveat:** EstateSales.net sessions likely expire in days to weeks. The automation will need a re-auth workflow when the session goes stale. This can be detected at runtime (URL check after navigating to ES_URL) and surfaced as a job failure with a clear message like "Session expired — re-export from VZT Settings."

**Risk:** Low — completely bypasses the SSO flow, no bot-detection surface during auth.  
**Effort:** Medium — 3–4 files changed, one schema migration, one UI widget for session upload, one capture step for David.  
**Recommended:** YES — this is the fastest and most reliable unblock.

---

### Option B — Automate Google SSO login via Playwright

**What it is:** The automation navigates to `/sign-in`, clicks "Continue with Google" (or equivalent), then fills in David's Google credentials in the Google popup/redirect.

**Problems:**
- Google's login pages are heavily bot-detection hardened. Even with `playwright-extra` + stealth plugin (already in the stack), Google CAPTCHA/2FA challenges are common in CI headless environments (GitHub Actions `ubuntu-latest`, no real GPU, datacenter IP).
- EstateSales.net may show a Google OAuth popup (new window) or redirect. Playwright can handle popups via `page.waitForEvent('popup')`, but the flow is fragile.
- Google actively blocks automated login attempts from non-residential IPs. This is likely to fail intermittently or permanently in GitHub Actions.

**Files to change:** `agent.js:516–568` (replace email/password form fill with Google button click + popup handling).

**Risk:** High — bot detection, fragile selectors, Google 2FA can interrupt anytime.  
**Effort:** High — significant Playwright complexity, needs proxy IP or residential runner, ongoing maintenance.  
**Recommended:** NO — do not pursue unless Option A is impossible.

---

### Option C — Fix the email+password form (only valid if account has a password)

**What it is:** Verify whether the EstateSales.net account has a password set. If David originally signed up via email+password and later linked Google, both methods may still work.

**How to determine:** David visits `https://www.estatesales.net/sign-in` manually in a private/incognito window (no Google session) and attempts to sign in with the email + password stored in VZT Settings. If it works: Option C is viable and the problem is a wrong stored password, not SSO architecture.

**If the account is confirmed Google-SSO-only:** Option C is not viable. EstateSales.net has no "set a password for an OAuth account" flow for most SaaS sites.

**Files to change:** None yet — the selectors are already correct. The only change needed would be verifying/correcting the stored password in `user_estatesales_credentials`.

**Risk:** Only viable if the account actually has a password; high chance it does not (confirmed symptom: re-saving credentials also failed).  
**Effort:** Low if viable — no code change, just credential correction.  
**Recommended:** Test this FIRST as a 2-minute sanity check before building Option A. If incognito email+password login works, it points to a wrong stored password, not SSO. If it fails, Option A is the path forward.

---

## 6. Summary Recommendation

**Step 1 (5 min):** David opens a private/incognito browser window, goes to `https://www.estatesales.net/sign-in`, and tries email + password login manually (not Google). If it succeeds, correct the stored password in VZT Settings. Done.

**Step 2 (if Step 1 fails — confirm Google-SSO-only):** Implement Option A — Playwright `storageState`. David runs the one-time capture script above, exports `es-session.json`, and uploads the JSON to the VZT Settings page. The agent is modified to load this state at context creation and skip the login block. Estimated build time: 2–4 hours including schema migration, code change, and UI widget.

**Do not implement Option B (Google SSO automation).** The bot-detection risk in a GitHub Actions headless environment is prohibitively high.

---

## 7. Confirmation of Constraints

- No existing code was changed.
- No login, probe, browser session, or dispatch was triggered.
- No `.env` file, credential value, token, or secret was read or printed. Only env var names and table column names were identified from code.
- No git-mutating commands were run.
- No push to main occurred.
