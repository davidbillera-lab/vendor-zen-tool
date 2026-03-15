/**
 * notifier.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends a completion email via Gmail when an auction batch finishes.
 *
 * SETUP:
 *   1. Enable 2-Factor Authentication on your Google account (required)
 *   2. Go to: https://myaccount.google.com/apppasswords
 *   3. Create an App Password (select "Mail" + "Windows Computer")
 *   4. Copy the 16-character password Google gives you
 *   5. Add these to your .env file:
 *
 *        NOTIFY_EMAIL_TO=jsgliquidators@gmail.com
 *        NOTIFY_EMAIL_FROM=jsgliquidators@gmail.com
 *        NOTIFY_GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
 *
 * If any of these are missing, the notifier logs a warning and skips silently.
 * It will never crash the agent — notifications are best-effort only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import nodemailer from 'nodemailer';
import log        from './logger.js';

/**
 * sendCompletionEmail({ batchName, succeeded, failed, skipped, duration, logPath, results })
 *
 * @param {object} opts
 *   batchName  {string}   Name/ID of the batch or CSV file
 *   succeeded  {number}   Lots posted successfully
 *   failed     {number}   Lots that failed
 *   skipped    {number}   Lots already completed (skipped)
 *   duration   {string}   Human-readable elapsed time e.g. "4m 32s"
 *   logPath    {string}   Path to the run log file
 *   results    {Array}    Full results array for lot-level detail
 */
export async function sendCompletionEmail(opts = {}) {
  const {
    batchName = 'Unknown Batch',
    succeeded = 0,
    failed    = 0,
    skipped   = 0,
    duration  = 'unknown',
    logPath   = '',
    results   = [],
  } = opts;

  // ── Validate env vars ─────────────────────────────────────────────────────
  const to       = process.env.NOTIFY_EMAIL_TO;
  const from     = process.env.NOTIFY_EMAIL_FROM;
  const appPass  = process.env.NOTIFY_GMAIL_APP_PASSWORD;

  if (!to || !from || !appPass) {
    log.warn('Email notification skipped — NOTIFY_EMAIL_TO, NOTIFY_EMAIL_FROM, or NOTIFY_GMAIL_APP_PASSWORD not set in .env');
    return;
  }

  // ── Build email body ──────────────────────────────────────────────────────
  const status     = failed === 0 ? '✅ COMPLETE' : '⚠️ COMPLETED WITH FAILURES';
  const subject    = `DOA Agent: ${status} — ${batchName}`;
  const totalLots  = succeeded + failed;

  // Lot breakdown table for HTML email
  const lotRows = results.map(r => {
    const icon  = r.status === 'completed' ? '✅' : r.status === 'failed' ? '❌' : '❓';
    const error = r.error ? `<span style="color:#ef4444;font-size:12px">${escHtml(r.error.message || String(r.error)).slice(0, 120)}</span>` : '';
    return `
      <tr style="border-bottom:1px solid #2a2a2a">
        <td style="padding:6px 12px;color:#a1a1aa">${escHtml(String(r.lot.lot_number))}</td>
        <td style="padding:6px 12px;color:#f4f4f5">${escHtml((r.lot.title || '').slice(0, 60))}</td>
        <td style="padding:6px 12px">${icon}</td>
        <td style="padding:6px 12px">${error}</td>
      </tr>`;
  }).join('');

  const failedSection = failed > 0 ? `
    <div style="background:#1f0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:16px;margin:16px 0">
      <strong style="color:#ef4444">⚠️ ${failed} lot(s) failed</strong>
      <p style="color:#fca5a5;margin:8px 0 0">
        Re-run the same command — completed lots are skipped automatically, only failed lots will be retried.
      </p>
    </div>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0f0f0f;color:#f4f4f5;font-family:Inter,Arial,sans-serif;margin:0;padding:24px">

  <div style="max-width:640px;margin:0 auto">

    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:24px;margin-bottom:16px">
      <h1 style="margin:0 0 4px;font-size:22px;color:#f4f4f5">DOA Listing Agent</h1>
      <p style="margin:0;color:#71717a;font-size:14px">Auction Batch Complete</p>
    </div>

    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:24px;margin-bottom:16px">
      <h2 style="margin:0 0 16px;font-size:16px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.05em">Summary</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:8px 0;color:#71717a;width:160px">Batch</td>
          <td style="padding:8px 0;color:#f4f4f5;font-weight:600">${escHtml(batchName)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#71717a">Status</td>
          <td style="padding:8px 0;color:${failed === 0 ? '#22c55e' : '#f59e0b'};font-weight:600">${status}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#71717a">Lots Posted</td>
          <td style="padding:8px 0;color:#22c55e;font-weight:600">${succeeded} / ${totalLots}</td>
        </tr>
        ${failed > 0 ? `<tr>
          <td style="padding:8px 0;color:#71717a">Failed</td>
          <td style="padding:8px 0;color:#ef4444;font-weight:600">${failed}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:8px 0;color:#71717a">Duration</td>
          <td style="padding:8px 0;color:#f4f4f5">${escHtml(duration)}</td>
        </tr>
        ${logPath ? `<tr>
          <td style="padding:8px 0;color:#71717a">Log File</td>
          <td style="padding:8px 0;color:#71717a;font-size:12px;font-family:monospace">${escHtml(logPath)}</td>
        </tr>` : ''}
      </table>
    </div>

    ${failedSection}

    ${results.length > 0 ? `
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:24px;margin-bottom:16px">
      <h2 style="margin:0 0 16px;font-size:16px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.05em">Lot Detail</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:2px solid #2a2a2a">
            <th style="padding:8px 12px;text-align:left;color:#71717a;font-weight:500">Lot #</th>
            <th style="padding:8px 12px;text-align:left;color:#71717a;font-weight:500">Title</th>
            <th style="padding:8px 12px;text-align:left;color:#71717a;font-weight:500">Status</th>
            <th style="padding:8px 12px;text-align:left;color:#71717a;font-weight:500">Error</th>
          </tr>
        </thead>
        <tbody>
          ${lotRows}
        </tbody>
      </table>
    </div>` : ''}

    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:16px;text-align:center">
      <p style="margin:0;color:#71717a;font-size:13px">
        ${failed === 0
          ? '🎉 Auction is ready. Log in to DOA to review and launch.'
          : '⚠️ Review failed lots above. Re-run the agent to retry — completed lots are skipped automatically.'}
      </p>
    </div>

    <p style="text-align:center;color:#3f3f46;font-size:11px;margin-top:16px">
      Sent by DOA Listing Agent · JSG Liquidators
    </p>

  </div>
</body>
</html>`;

  // ── Send ──────────────────────────────────────────────────────────────────
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: from,
        pass: appPass.replace(/\s/g, ''),  // strip spaces from copied app password
      },
    });

    await transporter.sendMail({
      from: `"DOA Listing Agent" <${from}>`,
      to,
      subject,
      html,
    });

    log.success(`Email notification sent to ${to}`);
  } catch (err) {
    // Never crash the agent because of a notification failure
    log.warn(`Email notification failed: ${err.message}`);
    log.warn('  Check NOTIFY_GMAIL_APP_PASSWORD in your .env — make sure you used an App Password,');
    log.warn('  not your regular Gmail password. See notifier.js setup instructions.');
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
