/**
 * downloader.js — EstateSales Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Downloads the primary image for each lot from the Bunny CDN.
 *
 * Strategy:
 *   1. Try the full-res URL (strip "_thumbnail" from the CDN path)
 *   2. Fall back to the thumbnail URL if full-res 404s
 *
 * Files are saved as:
 *   lots/{auction-slug}/images/{lotNumber:03d}-{title-slug}.jpg
 *
 * Updates each lot object in-place with `imagePath` pointing to the saved file.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**
 * toSlug(str) — converts a title to a safe filename segment
 */
function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * fullResUrl(thumbnailUrl)
 * Converts a _thumbnail.jpg CDN URL to the presumed full-res URL.
 */
function fullResUrl(thumbnailUrl) {
  return thumbnailUrl.replace('_thumbnail.jpg', '.jpg');
}

/**
 * downloadImage(url, destPath)
 * Downloads a single image. Returns true on success, false on failure.
 */
async function downloadImage(url, destPath) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;

    const buffer = Buffer.from(await response.arrayBuffer());
    // Validate it's actually an image (not a 404 HTML error page)
    if (buffer.length < 1024) return false;
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * downloadLots(lots, auctionSlug)
 * Downloads images for all lots. Mutates each lot, adding `imagePath`.
 * Returns stats: { succeeded, failed }.
 */
export async function downloadLots(lots, auctionSlug) {
  log.section('Downloading Lot Images');
  log.info(`${lots.length} lots to download`);

  const imagesDir = path.join(__dirname, 'lots', auctionSlug, 'images');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  let succeeded = 0;
  let failed = 0;

  for (const lot of lots) {
    const paddedNum = String(lot.lotNumber).padStart(3, '0');
    const slug = toSlug(lot.title);
    const filename = `${paddedNum}-${slug}.jpg`;
    const destPath = path.join(imagesDir, filename);

    // Skip if already downloaded (allows resume on re-run)
    if (fs.existsSync(destPath)) {
      lot.imagePath = destPath;
      log.info(`Already downloaded: ${filename}`);
      succeeded++;
      continue;
    }

    // Try full-res first, then thumbnail
    const fullUrl  = fullResUrl(lot.imageUrl);
    const thumbUrl = lot.imageUrl;

    let downloaded = await downloadImage(fullUrl, destPath);
    if (downloaded) {
      lot.imagePath = destPath;
      log.info(`Downloaded (full-res): ${filename}`);
      succeeded++;
    } else {
      downloaded = await downloadImage(thumbUrl, destPath);
      if (downloaded) {
        lot.imagePath = destPath;
        log.info(`Downloaded (thumbnail): ${filename}`);
        succeeded++;
      } else {
        log.warn(`Failed to download lot ${lot.lotNumber}: ${lot.title}`);
        failed++;
      }
    }
  }

  log.success(`Downloads complete: ${succeeded} succeeded, ${failed} failed`);
  return { succeeded, failed };
}
