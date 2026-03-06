/**
 * imageHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Downloads images from URLs (Supabase storage or any direct URL) to a local
 * temp folder so Playwright can upload them to DOA.
 *
 * What it does:
 *   - Takes an array of image URLs for one lot
 *   - Downloads each image to /temp/images/lotX_imageY.jpg
 *   - Returns an array of local file paths ready for Playwright's setInputFiles()
 *   - Cleans up (deletes) the temp images after that lot is done
 *   - Skips broken or missing URLs with a warning (never crashes the whole run)
 *
 * Usage:
 *   import { downloadImages, cleanupImages } from './imageHandler.js';
 *   const localPaths = await downloadImages(lot.images, lot.lot_number);
 *   // ... upload localPaths with Playwright ...
 *   await cleanupImages(localPaths);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import log from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, 'temp', 'images');

// Make sure the temp folder exists when this module loads
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// How long to wait for a single image download (milliseconds)
const DOWNLOAD_TIMEOUT_MS = 30_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * guessExtension(url, contentType)
 * Picks the right file extension for the saved image.
 * Tries the URL first, then falls back to the Content-Type header.
 */
function guessExtension(url, contentType = '') {
  const urlPath = new URL(url).pathname.toLowerCase();
  for (const ext of ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']) {
    if (urlPath.endsWith(ext)) return ext.replace('.jpeg', '.jpg');
  }
  if (contentType.includes('png'))  return '.png';
  if (contentType.includes('gif'))  return '.gif';
  if (contentType.includes('webp')) return '.webp';
  return '.jpg'; // default
}

/**
 * sanitizeUrl(url)
 * Handles edge cases like double-encoded URLs or missing protocols.
 */
function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith('http')) return null;
  return trimmed;
}

// ── Main exports ──────────────────────────────────────────────────────────────

/**
 * downloadImages(imageUrls, lotNumber)
 * Downloads all images for one lot to the temp folder.
 *
 * @param {string[]} imageUrls  - Array of image URLs from Supabase
 * @param {number|string} lotNumber - Used for naming temp files (lot1_image1.jpg)
 * @returns {string[]} Array of absolute local file paths (only successfully downloaded ones)
 */
export async function downloadImages(imageUrls, lotNumber) {
  if (!imageUrls || imageUrls.length === 0) {
    log.info(`  Lot #${lotNumber}: No images to download`);
    return [];
  }

  log.info(`  Lot #${lotNumber}: Downloading ${imageUrls.length} image(s)…`);

  const localPaths = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const rawUrl = imageUrls[i];
    const url    = sanitizeUrl(rawUrl);

    if (!url) {
      log.warn(`  Lot #${lotNumber} image ${i + 1}: Invalid URL skipped: "${rawUrl}"`);
      continue;
    }

    try {
      log.info(`  Lot #${lotNumber} image ${i + 1}/${imageUrls.length}: ${url}`);

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT_MS,
        headers: {
          // Some servers reject requests without a user-agent
          'User-Agent': 'DOA-Listing-Agent/1.0',
        },
        // Follow up to 5 redirects (common with Supabase storage URLs)
        maxRedirects: 5,
      });

      const ext      = guessExtension(url, response.headers['content-type'] || '');
      const filename = `lot${lotNumber}_image${i + 1}${ext}`;
      const filePath = path.join(TEMP_DIR, filename);

      fs.writeFileSync(filePath, response.data);
      localPaths.push(filePath);

      const sizeKb = Math.round(response.data.byteLength / 1024);
      log.success(`  Saved: ${filename} (${sizeKb} KB)`);

    } catch (err) {
      // Log but continue — one bad image shouldn't stop the lot
      const reason = err.response
        ? `HTTP ${err.response.status}`
        : err.code || err.message;
      log.warn(`  Lot #${lotNumber} image ${i + 1}: Download failed (${reason}) — skipping`);
    }
  }

  log.info(`  Lot #${lotNumber}: ${localPaths.length}/${imageUrls.length} images downloaded`);
  return localPaths;
}

/**
 * cleanupImages(localPaths)
 * Deletes the temp image files for one lot after it has been uploaded to DOA.
 * Keeps the temp folder itself so it's ready for the next lot.
 *
 * @param {string[]} localPaths - Array of file paths returned by downloadImages()
 */
export async function cleanupImages(localPaths) {
  if (!localPaths || localPaths.length === 0) return;

  for (const filePath of localPaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log.info(`  Cleaned up: ${path.basename(filePath)}`);
      }
    } catch (err) {
      log.warn(`  Could not delete temp file ${filePath}: ${err.message}`);
    }
  }
}

/**
 * cleanupAllTemp()
 * Deletes ALL files in the temp/images folder.
 * Called at the start of a run to ensure no stale files from a previous crash.
 */
export function cleanupAllTemp() {
  if (!fs.existsSync(TEMP_DIR)) return;
  const files = fs.readdirSync(TEMP_DIR);
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(TEMP_DIR, file));
    } catch {
      // Ignore errors during bulk cleanup
    }
  }
  if (files.length > 0) {
    log.info(`Cleaned up ${files.length} leftover temp file(s) from previous run`);
  }
}
