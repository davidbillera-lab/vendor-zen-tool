/**
 * mailer.js — sends a post-run summary email via Gmail
 */

import nodemailer from 'nodemailer';
import log from './logger.js';

const FROM_EMAIL  = process.env.EBAY_EMAIL        || '';
const TO_EMAIL    = process.env.NOTIFY_EMAIL       || '';
const APP_PASS    = process.env.GMAIL_APP_PASSWORD || '';

/**
 * sendRunSummary({ attempted, succeeded, failed, files })
 * Sends a plain-text summary email after an agent run.
 * Silently skips if NOTIFY_EMAIL or GMAIL_APP_PASSWORD are not set.
 */
export async function sendRunSummary({ attempted, succeeded, failed, files = [] }) {
  if (!TO_EMAIL || !APP_PASS) return;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: FROM_EMAIL, pass: APP_PASS },
  });

  const now    = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });
  const status = failed === 0 ? '✅ All uploads succeeded' : succeeded === 0 ? '❌ All uploads failed' : `⚠️ ${succeeded} succeeded, ${failed} failed`;

  const fileLines = files.length
    ? files.map(f => `  • ${f.name} — ${f.result}`).join('\n')
    : '  (no files processed)';

  const body = `eBay CSV Agent — Run Report
${now} (Mountain Time)

${status}
Attempted: ${attempted}
Succeeded: ${succeeded}
Failed:    ${failed}

Files:
${fileLines}

Check Seller Hub for listing results:
https://www.ebay.com/sh/reports/uploads
`;

  try {
    await transporter.sendMail({
      from: `"eBay CSV Agent" <${FROM_EMAIL}>`,
      to:   TO_EMAIL,
      subject: `eBay Agent — ${status} (${now})`,
      text:  body,
    });
    log.info(`Run summary emailed to ${TO_EMAIL}`);
  } catch (err) {
    log.warn(`Could not send summary email: ${err.message}`);
  }
}
