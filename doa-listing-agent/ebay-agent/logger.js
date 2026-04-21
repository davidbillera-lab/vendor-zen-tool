/**
 * logger.js — eBay CSV Agent
 * Timestamped logging to terminal + log files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.join(__dirname, 'logs');
const SCREENSHOTS_DIR = path.join(LOGS_DIR, 'screenshots');

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

function today() {
  return new Date().toISOString().split('T')[0];
}

function timestamp() {
  return new Date().toTimeString().split(' ')[0];
}

function writeToFile(filename, message) {
  const filePath = path.join(LOGS_DIR, filename);
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(filePath, line, 'utf8');
  } catch (err) {
    console.error(chalk.red(`⚠ Could not write to log file ${filename}: ${err.message}`));
  }
}

const log = {
  info(msg) {
    console.log(chalk.white(`[${timestamp()}] ℹ  ${msg}`));
    writeToFile(`run-${today()}.log`, `INFO  ${msg}`);
  },
  success(msg) {
    console.log(chalk.green(`[${timestamp()}] ✅ ${msg}`));
    writeToFile(`run-${today()}.log`, `OK    ${msg}`);
  },
  warn(msg) {
    console.log(chalk.yellow(`[${timestamp()}] ⚠️  ${msg}`));
    writeToFile(`run-${today()}.log`, `WARN  ${msg}`);
    writeToFile('errors.log', `WARN  ${msg}`);
  },
  error(msg, err = null) {
    const detail = err ? ` | ${err.message || err}` : '';
    console.error(chalk.red(`[${timestamp()}] ❌ ${msg}${detail}`));
    writeToFile(`run-${today()}.log`, `ERROR ${msg}${detail}`);
    writeToFile('errors.log', `ERROR ${msg}${detail}`);
  },
  section(msg) {
    const line = `\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`;
    console.log(chalk.cyan(line));
    writeToFile(`run-${today()}.log`, line);
  },
  schedule(msg) {
    console.log(chalk.magenta(`[${timestamp()}] 🕐 ${msg}`));
    writeToFile(`run-${today()}.log`, `SCHED ${msg}`);
    writeToFile('schedule.log', `SCHED ${msg}`);
  },
  getScreenshotsDir() {
    return SCREENSHOTS_DIR;
  },
  getRunLogPath() {
    return path.join(LOGS_DIR, `run-${today()}.log`);
  },
};

export default log;
