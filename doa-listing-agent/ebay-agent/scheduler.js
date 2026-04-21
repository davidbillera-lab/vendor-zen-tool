/**
 * scheduler.js — eBay CSV Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin node-cron wrapper. Reads SCHEDULE_TIME from .env and fires the queue
 * runner on the cron schedule.
 *
 * Also logs a heartbeat every 60 minutes so you can confirm the process is
 * still running (useful when deployed as a background service).
 */

import cron from 'node-cron';
import log from './logger.js';

const DEFAULT_SCHEDULE = '0 20 * * *'; // 8pm every night
const HEARTBEAT_MS     = 60 * 60 * 1000; // 60 minutes

/**
 * startScheduler(runQueue)
 * Starts the cron job and keeps the process alive.
 * @param {Function} runQueue — async function to call on each scheduled tick
 */
export async function startScheduler(runQueue) {
  const scheduleExpr = process.env.SCHEDULE_TIME?.trim() || DEFAULT_SCHEDULE;

  if (!cron.validate(scheduleExpr)) {
    log.error(`Invalid cron expression in SCHEDULE_TIME: "${scheduleExpr}"`);
    log.error('Use https://crontab.guru to build a valid expression, e.g. "0 20 * * *"');
    process.exit(1);
  }

  log.schedule(`Scheduler started — will run at: ${scheduleExpr}`);
  log.schedule(`(Use https://crontab.guru to verify the schedule)`);

  // Schedule the main queue run
  cron.schedule(scheduleExpr, async () => {
    log.schedule('Cron tick fired — starting queue run');
    try {
      const result = await runQueue();
      log.schedule(
        `Queue run complete: ${result.succeeded} succeeded, ${result.failed} failed`
      );
    } catch (err) {
      log.error('Scheduled queue run threw an unexpected error', err);
    }
  });

  // Heartbeat so you know the process is alive
  setInterval(() => {
    log.schedule(`Heartbeat — agent is running. Next run at schedule: ${scheduleExpr}`);
  }, HEARTBEAT_MS);

  // Run once immediately on startup (catch up on any files from while machine was off)
  log.schedule('Running catch-up scan on startup...');
  try {
    const result = await runQueue();
    log.schedule(
      `Startup catch-up complete: ${result.succeeded} succeeded, ${result.failed} failed`
    );
  } catch (err) {
    log.error('Startup catch-up run failed', err);
  }

  log.schedule('Waiting for next scheduled run... (Press Ctrl+C to stop)');
}
