═══════════════════════════════════════════════════════════════
  DOA Listing Agent — Plain English Guide
═══════════════════════════════════════════════════════════════

WHAT THIS DOES
──────────────
This tool automatically lists auction lots on Denver Online Auctions
for you. It reads your lots from a Supabase database, opens a real
Chrome browser window (so you can watch it work), logs into DOA,
and adds each lot — filling in the title, description, and images.


FIRST TIME SETUP (do this once)
────────────────────────────────

Step 1: Make sure you have Node.js installed
  Open a terminal and type: node --version
  You should see something like: v20.0.0
  If not, download it from: https://nodejs.org

Step 2: Go to the project folder
  In your terminal, navigate to this folder:
  cd path/to/doa-listing-agent

Step 3: Install dependencies
  npm install
  (This downloads all the tools the agent needs. Takes 1-2 minutes.)

Step 4: Install the Chrome browser for Playwright
  npx playwright install chromium
  (This downloads a special version of Chrome. Takes 1-2 minutes.)

Step 5: Create your .env file
  Copy the .env.example file and rename the copy to ".env"
  On Mac/Linux:  cp .env.example .env
  On Windows:    copy .env.example .env

  Then open .env in any text editor and fill in:
  - SUPABASE_URL (already filled in for you)
  - SUPABASE_ANON_KEY (from Supabase dashboard → Settings → API)
  - SUPABASE_EMAIL (your Supabase login email)
  - SUPABASE_PASSWORD (your Supabase login password)
  - DOA_EMAIL (your Denver Online Auctions login)
  - DOA_PASSWORD (your Denver Online Auctions password)
  - DOA_AUCTION_SLUG (the slug from your auction URL, e.g. 175-oz-silver-exgle-vintage-collectibles-china)

Step 6: Make sure your Supabase table has a "status" column
  In Supabase, go to your denver_batch_rows table.
  If there's no column called "status", add one:
  - Type: text
  - Default value: pending


RUNNING THE AGENT
─────────────────

SAFE FIRST TEST — shows what it found, touches nothing:
  node agent.js --dry-run

TEST WITH 3 LOTS — opens browser, processes first 3 lots only:
  node agent.js --test

FULL RUN — processes all pending lots:
  node agent.js --run

PROCESS ONE SPECIFIC LOT:
  node agent.js --lot 5

SKIP THE "Proceed? y/n" QUESTION:
  node agent.js --run --force

RUN ON A SCHEDULE (keeps running in background):
  node scheduler.js


WHAT YOU'LL SEE WHEN IT RUNS
─────────────────────────────
1. Terminal prints the lots it found in a table
2. It asks "Found X lots ready for DOA. Proceed? (y/n)"
3. Type y and press Enter
4. A Chrome browser window opens — you'll watch it:
   - Log into DOA sub-admin
   - Navigate to your auction edit page
   - Click Add Lot for each item
   - Fill in title and description
   - Upload photos
   - Click Save
5. As each lot completes, the terminal shows ✅ or ❌
6. At the end, a summary prints with counts and timing


IF SOMETHING GOES WRONG
────────────────────────
• Screenshots of errors are saved to: logs/screenshots/
• Full run log is saved to: logs/run-YYYY-MM-DD.log
• Error details are in: logs/errors.log
• If a lot fails, its status in Supabase is set to "failed"
• Failed lots can be retried — they won't be skipped next run
• Completed lots have status "completed" and are skipped automatically

Common problems:
  "Could not find email input" → DOA login page changed, screenshot shows what it sees
  "Authentication failed" → Check DOA_EMAIL and DOA_PASSWORD in .env
  "No pending lots found" → All lots may be marked 'completed' in Supabase
  "SUPABASE_ANON_KEY not set" → Check your .env file exists and is filled in


FILE GUIDE
──────────
  agent.js          ← Main file. Run this to start the agent.
  supabaseClient.js ← Reads/writes your Supabase database
  doaAgent.js       ← Controls the Chrome browser on DOA
  imageHandler.js   ← Downloads images so they can be uploaded
  scheduler.js      ← Runs the agent on a timer automatically
  logger.js         ← Handles all the colored terminal output + log files
  .env              ← YOUR CREDENTIALS (never share this file)
  .env.example      ← Safe template showing what goes in .env
  logs/             ← Auto-created folder for log files
  temp/             ← Auto-created folder for temporary image downloads


SUPABASE TABLE REQUIREMENTS
────────────────────────────
Your denver_batch_rows table should have these columns
(the agent also accepts alternate names, listed below):

  id              - unique row ID (required)
  lot_number      - lot number (also accepts: lot_num, lotNumber, lot, number)
  title           - lot title (also accepts: lot_title, name, item_title)
  description     - lot description (also accepts: desc, body, item_description)
  images          - image URLs as JSON array (also accepts: image_urls, photos, image_url)
  status          - tracking column (add this if it doesn't exist, default: "pending")
  error_log       - optional: agent saves error messages here on failure


SCHEDULE FORMAT (CRON)
───────────────────────
The SCHEDULE_TIME in .env uses cron format: minute hour day month weekday
  0 8 * * *     = 8:00am every day (default)
  0 20 * * *    = 8:00pm every day
  0 8 * * 1-5   = 8am Monday through Friday only
  0 */4 * * *   = every 4 hours
  */10 * * * *  = every 10 minutes (for testing only!)

Use https://crontab.guru to build your own schedule.


═══════════════════════════════════════════════════════════════
