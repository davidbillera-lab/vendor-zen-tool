/**
 * logger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all logging for the DOA Listing Agent.
 *
 * What it does:
 *   - Writes timestamped messages to the terminal (with color via chalk)
 *   - Saves every message to logs/run-YYYY-MM-DD.log (one file per day)
 *   - Saves errors separately to logs/errors.log
 *   - Saves scheduled run activity to logs/schedule.log
 *
 * Usage (from other files):
 *   import log from './logger.js';
 *   log.info('Starting...');
 *   log.success('Lot #1 done');
 *   log.error('Something broke');
 *   log.warn('Image missing');
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

// __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.join(__dirname, 'logs');
const SCREENSHOTS_DIR = path.join(LOGS_DIR, 'screenshots');

// Make sure log folders exist when this module is imported
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Returns today's date as YYYY-MM-DD (used for log file names)
function today() {
  return new Date().toISOString().split('T')[0];
}

// Returns current time as HH:MM:SS (used in log messages)
function timestamp() {
  return new Date().toTimeString().split(' ')[0];
}

// Writes a line to a specific log file
function writeToFile(filename, message) {
  const filePath = path.join(LOGS_DIR, filename);
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(filePath, line, 'utf8');
  } catch (err) {
    // Don't crash if we can't write a log file — just warn in console
    console.error(chalk.red(`⚠ Could not write to log file ${filename}: ${err.message}`));
  }
}

// The main log object with different levels
const log = {
  // General information — shown in white/gray
  info(msg) {
    const line = `[${timestamp()}] ℹ  ${msg}`;
    console.log(chalk.white(line));
    writeToFile(`run-${today()}.log`, `INFO  ${msg}`);
  },

  // Success messages — shown in green
  success(msg) {
    const line = `[${timestamp()}] ✅ ${msg}`;
    console.log(chalk.green(line));
    writeToFile(`run-${today()}.log`, `OK    ${msg}`);
  },

  // Warnings — shown in yellow
  warn(msg) {
    const line = `[${timestamp()}] ⚠️  ${msg}`;
    console.log(chalk.yellow(line));
    writeToFile(`run-${today()}.log`, `WARN  ${msg}`);
    writeToFile('errors.log', `WARN  ${msg}`);
  },

  // Errors — shown in red, also saved to errors.log
  error(msg, err = null) {
    const detail = err ? ` | ${err.message || err}` : '';
    const line = `[${timestamp()}] ❌ ${msg}${detail}`;
    console.error(chalk.red(line));
    writeToFile(`run-${today()}.log`, `ERROR ${msg}${detail}`);
    writeToFile('errors.log', `ERROR ${msg}${detail}`);
  },

  // Section headers — shown in cyan, makes runs easy to scan
  section(msg) {
    const line = `\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`;
    console.log(chalk.cyan(line));
    writeToFile(`run-${today()}.log`, `\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`);
  },

  // Scheduled job activity — saved to schedule.log as well
  schedule(msg) {
    const line = `[${timestamp()}] 🕐 ${msg}`;
    console.log(chalk.magenta(line));
    writeToFile(`run-${today()}.log`, `SCHED ${msg}`);
    writeToFile('schedule.log', `SCHED ${msg}`);
  },

  // Returns the path to today's run log (used in the final summary)
  getRunLogPath() {
    return path.join(LOGS_DIR, `run-${today()}.log`);
  },

  // Returns the screenshots directory path (used by doaAgent.js)
  getScreenshotsDir() {
    return SCREENSHOTS_DIR;
  },
};

export default log;
