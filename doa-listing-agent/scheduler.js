/**
 * scheduler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs the DOA Listing Agent on a schedule using node-cron.
 *
 * What it does:
 *   - Reads SCHEDULE_TIME from .env (default: "0 8 * * *" = 8am every day)
 *   - Waits for the scheduled time and then runs the full agent automatically
 *   - Logs each scheduled run start/end to logs/schedule.log
 *   - Keeps the process alive between runs
 *
 * How to start:
 *   node scheduler.js
 *   OR: node agent.js --schedule
 *
 * Cron format:
 *   "0 8 * * *"  = 8:00am every day
 *   "0 */4 * * *" = every 4 hours
 *   "*/30 * * * *" = every 30 minutes
 *   See: https://crontab.guru for help building cron expressions
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import cron  from 'node-cron';
import chalk from 'chalk';
import log   from './logger.js';
import { runAgent } from './agent.js';

// Read schedule from .env, default to 8am daily
const SCHEDULE_TIME = process.env.SCHEDULE_TIME || '0 8 * * *';

// SCHEDULE_CSV must be set in .env when using the scheduler
const SCHEDULE_CSV  = process.env.SCHEDULE_CSV;

/**
 * startScheduler()
 * Sets up the cron job and keeps the process running.
 * Called from agent.js when --schedule flag is used, or directly from this file.
 */
export function startScheduler() {
  if (!SCHEDULE_CSV) {
    log.error('SCHEDULE_CSV is not set in your .env file');
    log.error('  Add: SCHEDULE_CSV=C:\\path\\to\\your\\lots.csv');
    process.exit(1);
  }

  // Validate the cron expression before starting
  if (!cron.validate(SCHEDULE_TIME)) {
    log.error(`Invalid SCHEDULE_TIME in .env: "${SCHEDULE_TIME}"`);
    log.error('Example valid values: "0 8 * * *" (8am daily), "*/30 * * * *" (every 30 min)');
    process.exit(1);
  }

  log.section('DOA Listing Agent Scheduler');
  log.schedule(`Schedule: "${SCHEDULE_TIME}" (use https://crontab.guru to read this)`);
  log.schedule('Scheduler is running. Press Ctrl+C to stop.');

  // Show a human-friendly version of when the next run is
  const nextRunMsg = describeSchedule(SCHEDULE_TIME);
  log.schedule(`Next run: ${nextRunMsg}`);

  // Schedule the job
  cron.schedule(SCHEDULE_TIME, async () => {
    const runTime = new Date().toLocaleString();
    log.schedule(`\n${'━'.repeat(50)}`);
    log.schedule(`Scheduled run starting at ${runTime}`);
    log.schedule('━'.repeat(50));

    try {
      // Scheduled runs use force mode (no y/n prompt) since no human is watching
      await runAgent(SCHEDULE_CSV, { force: true });
      log.schedule(`Scheduled run completed at ${new Date().toLocaleString()}`);
    } catch (err) {
      log.error('Scheduled run failed with an uncaught error', err);
      // Don't crash the scheduler on run failure — just log and wait for next run
    }
  });

  // Keep the Node process alive (cron jobs don't prevent exit on their own)
  console.log(chalk.magenta('\n  Scheduler is active. Waiting for next run...'));
  console.log(chalk.gray('  (Press Ctrl+C to stop)\n'));

  // Heartbeat: print a small message every hour so you know the process is still alive
  setInterval(() => {
    log.schedule(`Scheduler heartbeat — still running. Next: ${describeSchedule(SCHEDULE_TIME)}`);
  }, 60 * 60 * 1000); // Every 60 minutes
}

/**
 * describeSchedule(cronExpression)
 * Returns a very simple human-readable description of common cron expressions.
 * Not a full parser — just handles the most common patterns.
 */
function describeSchedule(expr) {
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;

  const [min, hour, dom, month, dow] = parts;

  if (min === '0' && dom === '*' && month === '*' && dow === '*') {
    if (hour === '*') return 'every hour at :00';
    return `daily at ${hour.padStart(2, '0')}:00`;
  }
  if (min.startsWith('*/')) {
    return `every ${min.slice(2)} minutes`;
  }
  if (hour.startsWith('*/')) {
    return `every ${hour.slice(2)} hours`;
  }

  return expr; // Fall back to showing the raw expression
}

// ── Allow running directly: node scheduler.js ─────────────────────────────────
// Check if this file is being run directly (not imported)
if (process.argv[1] && process.argv[1].endsWith('scheduler.js')) {
  startScheduler();
}
