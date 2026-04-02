/**
 * notifier.js — DOA Bulk Upload Agent · Phase 3
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends a completion email after the upload pipeline finishes.
 * Uses Gmail + App Password (same pattern as estatesales-agent/notifier.js).
 */

import nodemailer from 'nodemailer';
import log from './logger.js';

/**
 * sendCompletionEmail({ zipName, auctionGroup, lotCount, imageCount, success, error })
 */
export async function sendCompletionEmail({ zipName, auctionGroup, lotCount, imageCount, success, error = null }) {
  const toEmail   = process.env.NOTIFY_EMAIL       || '';
  const fromEmail = process.env.GMAIL_FROM_EMAIL   || '';
  const appPass   = process.env.GMAIL_APP_PASSWORD || '';

  if (!toEmail || !appPass || !fromEmail) {
    log.warn('Email credentials not fully set — skipping notification email');
    log.warn('Set NOTIFY_EMAIL, GMAIL_FROM_EMAIL, and GMAIL_APP_PASSWORD in .env');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: fromEmail, pass: appPass },
  });

  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });
  const statusLine = success
    ? `✅ ${lotCount} lots uploaded and queued for AI title/description generation`
    : `❌ Upload failed — ${error || 'check logs for details'}`;

  const body = `DOA Bulk Upload Agent — Run Complete
${now} (Mountain Time)

ZIP file:       ${zipName}
Auction group:  ${auctionGroup || '(not set)'}
${statusLine}

Lots uploaded:  ${lotCount}
Images total:   ${imageCount}

Next steps:
  1. Open DOA Admin → Bulk Image Uploader → View Auction Group
  2. Wait a few minutes for AI titles/descriptions to generate
  3. Do NOT edit any lot titles until the AI processing is complete

—
This email was sent automatically by the DOA Bulk Upload Agent.
`;

  const subject = success
    ? `DOA Agent ✅ — ${auctionGroup} upload complete (${lotCount} lots)`
    : `DOA Agent ❌ — ${auctionGroup} upload FAILED`;

  try {
    await transporter.sendMail({
      from: `"DOA Upload Agent" <${fromEmail}>`,
      to:   toEmail,
      subject,
      text:  body,
    });
    log.success(`Completion email sent to ${toEmail}`);
  } catch (err) {
    log.warn(`Could not send completion email: ${err.message}`);
  }
}
