/**
 * notifier.js — EstateSales Agent · Agent 5
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends a completion email after the full pipeline finishes.
 * Uses Gmail + App Password (same pattern as ebay-agent/mailer.js).
 * Silently skips if NOTIFY_EMAIL or GMAIL_APP_PASSWORD are not set.
 */

import nodemailer from 'nodemailer';
import log from './logger.js';

const FROM_EMAIL = process.env.ESTATESALES_EMAIL   || '';
const TO_EMAIL   = process.env.NOTIFY_EMAIL        || '';
const APP_PASS   = process.env.GMAIL_APP_PASSWORD  || '';

/**
 * sendCompletionEmail({ auctionSlug, listingUrl, uploaded, described, failed })
 */
export async function sendCompletionEmail({ auctionSlug, listingUrl, uploaded, described, failed }) {
  if (!TO_EMAIL || !APP_PASS) {
    log.info('NOTIFY_EMAIL or GMAIL_APP_PASSWORD not set — skipping email');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: FROM_EMAIL, pass: APP_PASS },
  });

  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });

  const allGood  = failed === 0;
  const statusLine = allGood
    ? '✅ All photos uploaded and described successfully'
    : `⚠️ ${failed} photo(s) had errors — check logs/screenshots for details`;

  const body = `EstateSales.net Agent — Run Complete
${now} (Mountain Time)

Auction: ${auctionSlug}
${statusLine}

Photos uploaded:      ${uploaded}
Descriptions filled:  ${described}
Failed:               ${failed}

Review your listing:
${listingUrl || '(no listing URL provided)'}

—
This email was sent automatically by the EstateSales Agent.
`;

  const subject = allGood
    ? `EstateSales Agent ✅ — ${auctionSlug} complete`
    : `EstateSales Agent ⚠️ — ${auctionSlug} finished with ${failed} error(s)`;

  try {
    await transporter.sendMail({
      from: `"EstateSales Agent" <${FROM_EMAIL}>`,
      to:   TO_EMAIL,
      subject,
      text:  body,
    });
    log.success(`Completion email sent to ${TO_EMAIL}`);
  } catch (err) {
    log.warn(`Could not send completion email: ${err.message}`);
  }
}
