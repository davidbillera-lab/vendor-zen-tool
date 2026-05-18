# eBay CSV Agent

You are working on the eBay CSV upload agent for JSG Liquidators.

## What this project is

A Windows-based Node.js agent (`doa-listing-agent/ebay-agent/`) that watches a single folder on the Desktop (`eBay CSV`), picks up CSV files downloaded from the Vendor Zen app, and uploads them to eBay Seller Hub via Playwright browser automation.

## Key facts — no need to read files to verify these

- **Entry point:** `doa-listing-agent/ebay-agent/agent.js`
- **Queue logic:** `doa-listing-agent/ebay-agent/queue.js` — flat folder, no subfolders
- **Upload logic:** `doa-listing-agent/ebay-agent/ebayUploader.js` — Playwright → eBay Seller Hub
- **Config:** `doa-listing-agent/ebay-agent/.env` (copy from `.env.example`)
- **Watch folder:** `C:\Users\david\Desktop\eBay CSV` (set via `EBAY_CSV_QUEUE_DIR`)
- **Launcher scripts:** `start-ebay-agent.bat` (scheduled daemon), `start-ebay-agent-once.bat` (one-shot)

## How the queue works

Files are renamed in place — no subfolders:
- `my-listings.csv` → drop here to queue it
- `PROCESSING-my-listings.csv` → agent is uploading right now
- `DONE-my-listings.csv` → upload succeeded, safe to delete
- `FAILED-my-listings.csv` → upload failed, see `.error.txt` sidecar

Agent startup automatically handles any `PROCESSING-` files left from a crash (marks them failed).

## How CSV files get created

Downloaded from the Vendor Zen web app (`EbayBatchPanel` component). All shipping and returns fields are baked into the CSV — do not add inline shipping/returns logic to the agent or edge functions. David controls those fields at the data level.

## eBay publishing — REST API is NOT used

David opted out of eBay Business Policies entirely and the eBay REST API (`ebay-publish` edge function) is not the active publishing path. The CSV upload via Seller Hub is the only active path.

## Agent run modes

```
node agent.js               # run once, then exit
node agent.js --schedule    # cron daemon (fires at SCHEDULE_TIME)
node agent.js --watch       # run once, then poll every 30 min
node agent.js --dry-run     # log what would happen, no browser
node agent.js --retry       # rename all FAILED- files back to plain CSV, then run
node agent.js --count 3     # override MAX_UPLOADS_PER_RUN for this run
```

## .env variables

```
EBAY_EMAIL=              # eBay seller account email
EBAY_PASSWORD=           # eBay seller account password
EBAY_CSV_QUEUE_DIR=C:\Users\david\Desktop\eBay CSV
SCHEDULE_TIME=0 20 * * * # cron — default 8pm nightly
MAX_UPLOADS_PER_RUN=2    # cap per run to avoid flooding eBay
```

## What to do when invoked

Make the change the user is asking for directly. The architecture above is the full context needed. Do not explore the codebase unless the user's request involves something outside this scope.
