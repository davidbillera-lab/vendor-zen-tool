/**
 * scraper.js — EstateSales Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes all lots from a Denver Online Auctions page.
 * Uses Playwright (visible browser) to handle Cloudflare protection.
 *
 * Returns an array of lot objects:
 *   [{ lotNumber, title, imageUrl, imagePath: null }, ...]
 *
 * Image URLs point to Bunny CDN thumbnails (_thumbnail.jpg).
 * downloader.js will attempt to resolve full-res before falling back.
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SESSION_DIR = path.join(__dirname, 'browser-session');

/**
 * scrapeAuction(auctionUrl)
 * Opens the auction page in a persistent browser session and extracts all lots.
 * Returns array of lot objects sorted by lot number.
 */
export async function scrapeAuction(auctionUrl) {
  log.section('Scraping DOA Auction');
  log.info(`URL: ${auctionUrl}`);

  let context = null;
  try {
    const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
    context = await chromium.launchPersistentContext(SESSION_DIR, {
      headless: isCI,
      slowMo: isCI ? 0 : 50,
      args: isCI ? [] : ['--start-maximized'],
      viewport: isCI ? { width: 1280, height: 720 } : null,
    });

    const page = await context.newPage();

    log.info('Navigating to auction page...');
    await page.goto(auctionUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Wait for lot items to appear
    log.info('Waiting for lot items to render...');
    await page.waitForSelector('div.auction-item', { timeout: 30000 });

    // Scroll to bottom to trigger any lazy-loaded items
    log.info('Scrolling to load all lots...');
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let totalHeight = 0;
        const distance = 800;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    await page.waitForTimeout(1500);

    const lots = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div.auction-item'));
      return items.map(item => {
        const lotNumber = parseInt(item.getAttribute('data-lot-number') || '0', 10);

        // Title from the anchor inside .auction-name
        const titleEl = item.querySelector('.auction-name a');
        const title = titleEl ? titleEl.innerText.trim() : '';

        // Image src from the thumbnail img
        const imgEl = item.querySelector('.auction-image img');
        const imageUrl = imgEl ? imgEl.getAttribute('src') || '' : '';

        return { lotNumber, title, imageUrl, imagePath: null };
      });
    });

    // Filter out any items with no data, sort by lot number
    const validLots = lots
      .filter(l => l.lotNumber > 0 && l.title && l.imageUrl)
      .sort((a, b) => a.lotNumber - b.lotNumber);

    log.success(`Scraped ${validLots.length} lots from auction`);

    if (validLots.length === 0) {
      log.warn('No lots found — page may not have loaded fully or selectors changed');
    }

    // Take a screenshot for verification
    const screenshotPath = path.join(__dirname, 'logs', 'screenshots', `scrape-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    log.info(`Screenshot saved: ${screenshotPath}`);

    return validLots;

  } finally {
    if (context) await context.close().catch(() => {});
  }
}

/**
 * auctionSlugFromUrl(url)
 * Extracts the auction slug from a Denver Online Auctions URL.
 * e.g. "https://denveronlineauctions.com/auction/175-oz-silver-eagle-..."
 *   → "175-oz-silver-eagle-..."
 */
export function auctionSlugFromUrl(url) {
  const match = url.match(/\/auction\/([^/?#]+)/);
  return match ? match[1] : `auction-${Date.now()}`;
}
