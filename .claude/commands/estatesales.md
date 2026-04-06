# EstateSales Photo Upload Agent

Automates uploading lot photos and descriptions to estatesales.net from a Denver Online Auctions listing.

## What to do when this command is invoked

1. Ask David for two things:
   - The **DOA auction URL** (Denver Online Auctions page for the active auction)
   - The **estatesales.net listing editor URL** (the photo management page — should end in `/account/sale-wizard/pictures/<ID>`)

2. Once you have both URLs, run the full pipeline using the Bash tool:

```
cd "c:\Users\david\OneDrive\Desktop\doa-listing-agent\doa-listing-agent\estatesales-agent" && node --env-file=.env agent.js --auction "<DOA_URL>" --listing "<ESTATESALES_URL>"
```

**Always use `--env-file=.env`** — dotenv alone does not reliably load in this environment.

## What the agent does (5 phases)

1. **Scraper** — Opens the DOA auction in a browser, extracts all lot titles and image URLs
2. **Downloader** — Downloads the primary image for every lot to a local folder
3. **Photo Uploader** — Opens estatesales.net, logs in (saves session for future runs), uploads all photos in lot order
4. **Describer** — For each photo: clicks it to select → clicks Description toolbar button → fills lot title → clicks Next
5. **Notifier** — Sends a completion email (currently broken — Gmail app password needs refreshing)

## Confirmed working selectors (do not change without re-testing)

### Login (photoUploader.js + describer.js)
- Navigate with `waitUntil: 'networkidle'`
- Wait for email field to be visible before filling
- Submit with `page.keyboard.press('Enter')` — do NOT use the submit button selector, there are multiple submit buttons and `.first()` hits the wrong one ("Back" button)

### Description filler (describer.js)
- Photo images on the page: `img[src*="picturescdn.estatesales.net"]`
- Select a photo by clicking it at index N → toolbar appears
- Description button in toolbar: `button[title="Description"]`
- Text input in dialog: `mat-dialog-container input.mat-input-element, [role="dialog"] input[type="text"]`
- Next button in dialog: `mat-dialog-container button:has-text("Next"), [role="dialog"] button:has-text("Next")`
- The dialog auto-advances through all photos with Next — only need to open it once on the first unfilled photo

## Batching / incremental runs

The agent fully supports batching. David can run it before all lots are ready:

1. Run with current lots → photos + descriptions go live on estatesales.net
2. Add more lots to DOA later
3. Re-run the exact same command
4. Agent re-scrapes fresh, merges with previous run, uploads only NEW lots (skips ones with `uploadedAt`), fills descriptions only for new lots (skips ones with `descriptionFilled`)

State is tracked per auction in `lots/<auction-slug>/lots.json`.

## Re-run flags (partial runs)

```
# Scrape + download only (no upload yet):
node --env-file=.env agent.js --auction "<DOA_URL>" --scrape-only

# Re-run descriptions only:
node --env-file=.env agent.js --describe-only --listing "<ESTATESALES_URL>"

# Re-run photo upload only:
node --env-file=.env agent.js --upload-only --listing "<ESTATESALES_URL>"
```

## Important notes

- The **browser runs visibly** — David may need to handle login or CAPTCHA on the first run. Session is saved to `browser-session/` automatically after that.
- Lots with no images on DOA will show "Failed to download" — expected, they'll be picked up on the next batch run.
- The completion email notification is currently broken (Gmail app password expired). Needs a new app password: Google Account → Security → App Passwords.
- The listing URL must be the **editor/photo management page**, not the public listing page.

Stream all output to David so he can see what's happening in real time.
