# DOA Listing Agent — Lovable Dashboard Prompt
# ─────────────────────────────────────────────────────────────────────────────
# INSTRUCTIONS: Paste the entire content below "START PROMPT" into Lovable.
# ─────────────────────────────────────────────────────────────────────────────

---

## START PROMPT

You are an Agentic Software Engineer. Your directive is to build a complete, production-ready web dashboard for the DOA (Denver Online Auctions) Listing Agent. You will architect the full system — frontend, backend API, and real-time communication layer — and you will push through any obstacle you encounter autonomously. If you hit an error, diagnose it, apply the fix, and continue without stopping. Do not ask for help on solvable engineering problems. Resolve them.

---

## SYSTEM OVERVIEW

This dashboard is the control center for an automation agent that posts auction lots to Denver Online Auctions (DOA). The agent is a Node.js script (`agent.js`) that uses Playwright to drive a real browser. The dashboard gives users a visual interface to upload a CSV of auction lots, configure the auction, monitor real-time progress, and review results.

**The agent already exists and works.** You are building the UI and the Express API wrapper around it. Do not rewrite agent.js. Call it as a child process.

---

## TECH STACK (DO NOT DEVIATE)

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS + shadcn/ui components |
| Backend API | Node.js + Express (new file: `server.js`) |
| Real-time | Server-Sent Events (SSE) — no WebSockets, no polling |
| File Handling | Multer for CSV upload |
| CSV Parsing | Papa Parse (frontend preview) + native csvReader.js (agent) |
| State Management | React useState + useReducer — no Redux |
| Deployment | Single machine — Express serves both API and static build |

---

## ARCHITECTURE

```
Browser (React App)
    │
    │  POST /api/run  (CSV + config)
    │  GET  /api/status/:runId  (SSE stream)
    │  GET  /api/runs  (run history)
    │  POST /api/retry/:runId/:lotNumber
    │
Express Server (server.js) — port 3001
    │
    ├── Receives CSV → writes to temp file
    ├── Spawns: node agent.js --csv <tempFile> --force
    ├── Captures stdout/stderr line by line
    ├── Parses log lines → structured events
    └── Streams events to browser via SSE
```

---

## BACKEND: server.js

Create `server.js` in the `doa-listing-agent/` folder. This file:

### Endpoints

**POST /api/run**
- Accepts multipart form data: `csv` (file), `firstLotUrl` (string), `testMode` (boolean)
- Saves the uploaded CSV to `./temp/uploads/<runId>.csv`
- If `firstLotUrl` is provided, write it to a temp `.env.override` read by agent — OR inject via env var override on the child process
- Spawns: `node agent.js --csv ./temp/uploads/<runId>.csv --force`
  - If testMode: add `--test` flag
- Stores run metadata in memory (Map): `{ runId, status, startTime, lots: [], stdout: [] }`
- Returns `{ runId }` immediately — client then opens SSE stream

**GET /api/status/:runId** (SSE)
- Sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Sends all buffered events for this runId immediately (catch-up on reconnect)
- Then streams new events as they arrive in real time
- Sends `event: heartbeat` every 15s to keep connection alive
- On agent process exit: sends `event: complete` then closes stream

**GET /api/runs**
- Returns array of all run summaries from memory: `{ runId, startTime, status, totalLots, completed, failed }`

**POST /api/retry/:runId/:lotNumber**
- Re-runs the agent on the same CSV with `--lot <lotNumber>` flag
- Creates a child runId: `<runId>-retry-<lotNumber>`
- Returns new runId for SSE tracking

**GET /api/health**
- Returns `{ status: "ok", timestamp }` — used by frontend to detect if server is running

### Log Parsing

Parse each line of agent stdout to extract structured events. The agent's logger outputs lines with these prefixes:

```
[✓] Lot 1 — Title Here           → { type: "lot_success", lotNumber: 1 }
[✗] Lot 2 — failed: error msg    → { type: "lot_failure", lotNumber: 2, error: "..." }
[→] Processing lot 3             → { type: "lot_start", lotNumber: 3 }
[i] Uploading image 2 of 5       → { type: "image_progress", ... }
[!] Warning message              → { type: "warning", message: "..." }
```

Broadcast each parsed event as an SSE message:
```
event: lot_update
data: {"type":"lot_success","lotNumber":1,"title":"Oak Dresser","timestamp":"..."}
```

Also broadcast raw log lines as:
```
event: log
data: {"line":"[✓] Lot 1 completed","timestamp":"..."}
```

---

## FRONTEND PAGES & COMPONENTS

### Page 1: Dashboard (default route `/`)

**Layout:** Dark sidebar on left, main content on right. Clean, modern — like Linear or Vercel.

**Sidebar:**
- Logo: "DOA Agent" with a robot/lightning bolt icon
- Nav items: Dashboard, New Run, History, Settings
- Bottom: Agent Status indicator (green dot = server connected, red = offline)

**Main Content when idle:**
Split into two panels:

**LEFT PANEL — Upload & Configure:**

1. **CSV Drop Zone**
   - Large dashed border box, centered icon and text: "Drop your auction CSV here or click to browse"
   - Accepts `.csv` files only
   - On file drop/select:
     - Parse CSV with Papa Parse in browser
     - Show file name + row count badge
     - Display preview table (see below)
   - If wrong file type: show red toast "Only CSV files are accepted"

2. **CSV Preview Table**
   - Shows first 10 rows: Lot #, Title (truncated 40 chars), Image Count, Starting Bid
   - Row count summary: "Showing 10 of 47 lots"
   - Status column: all show "Pending" badge (blue) before run starts

3. **Auction Configuration Panel** (card below drop zone)
   - Field: "DOA First Lot URL" — text input, placeholder: `https://denveronlineauctions.com/sub-admin/EditAuction?id=...`
   - Toggle: "Test Mode" — switch with label "Process first 3 lots only (for verification)"
   - Validation: URL field must start with `https://denveronlineauctions.com` or show inline error

4. **Run Button**
   - Large, full-width: "Start Agent" with play icon
   - Disabled state: greyed out when no CSV loaded or URL invalid
   - Loading state: spinner + "Launching agent..."
   - On click: POST to `/api/run`, then navigate to run view

**RIGHT PANEL — Live Run View** (appears after run starts):

5. **Progress Header**
   - Run ID (truncated), Start time, Elapsed timer (live, ticking every second)
   - Status badge: RUNNING (yellow pulse) / COMPLETE (green) / FAILED (red)

6. **Stats Bar**
   - 4 cards in a row:
     - Total Lots (grey)
     - Completed (green, count ticks up live)
     - Failed (red)
     - Remaining (blue, counts down)
   - Progress bar below: fills green as lots complete, red segments for failures

7. **Lot Status Table** (live updating)
   - Columns: Lot #, Title, Status, Images, Duration, Actions
   - Status badges:
     - Pending: grey "○ Pending"
     - In Progress: yellow spinning "⟳ Processing"
     - Complete: green "✓ Done"
     - Failed: red "✗ Failed"
   - Actions column: "Retry" button (icon only) — only visible on failed rows
   - Rows highlight briefly (pulse animation) when status changes
   - Auto-scroll to the currently processing lot

8. **Live Log Panel** (collapsible, below table)
   - Monospace font, dark background (like a terminal)
   - Streams each log line as it arrives
   - Color coded: green for success lines, red for errors, grey for info
   - Auto-scrolls to bottom
   - "Copy Log" button top-right

---

### Page 2: History (`/history`)

- Table of all past runs: Date/Time, Lots Total, Completed, Failed, Duration, Status badge
- Click any row → expand to show lot-level detail
- "Retry Failed" button per run — re-runs only failed lots from that run

---

### Page 3: Settings (`/settings`)

- Form fields for default configuration (persisted in localStorage):
  - Default First Lot URL
  - Default to Test Mode (toggle)
  - Agent server URL (default: `http://localhost:3001`)
- "Test Connection" button → hits `/api/health` → shows green/red result

---

## STARTUP & CONNECTION HANDLING

On app load:
1. Hit `GET /api/health`
2. If unreachable: show full-screen overlay: "Agent Server Offline — Make sure server.js is running on port 3001" with a Retry button
3. If reachable: show green status dot, load normally

On SSE disconnect (network blip):
- Auto-reconnect every 3 seconds
- On reconnect, server sends all buffered events so UI catches up — no data loss

---

## ERROR HANDLING RULES (CRITICAL — READ THIS)

Every error state must have a visible UI representation AND a recovery path:

| Error | UI Response | Recovery |
|-------|-------------|----------|
| No CSV uploaded | Run button disabled + tooltip | Upload CSV |
| Invalid DOA URL | Inline red text under field | Fix URL |
| Agent server offline | Full-screen overlay | Retry button |
| Lot failed | Red badge + error tooltip on hover | Retry button |
| All lots failed | Red banner at top | Retry All Failed button |
| Network disconnect | Yellow banner: "Reconnecting..." | Auto-reconnect |
| File too large (>10MB) | Toast: "CSV too large" | N/A |
| Wrong columns in CSV | Parse error panel listing missing columns | N/A |

---

## VISUAL DESIGN SYSTEM

- **Color Palette:**
  - Background: `#0f0f0f` (near black)
  - Surface: `#1a1a1a` (card background)
  - Border: `#2a2a2a`
  - Primary: `#6366f1` (indigo — matches Vendor-Zen-Tool brand)
  - Success: `#22c55e` (green)
  - Error: `#ef4444` (red)
  - Warning: `#f59e0b` (amber)
  - Text primary: `#f4f4f5`
  - Text muted: `#71717a`

- **Typography:** Inter font, imported from Google Fonts
- **Border radius:** 8px for cards, 6px for buttons, 4px for badges
- **Animations:**
  - Lot rows: `transition-all duration-300` on status change
  - Currently processing row: subtle left-border pulse in yellow
  - Progress bar: smooth fill with `transition-width duration-500`
  - Success flash: brief green background fade on completion

- **DO NOT use:** Gradients on backgrounds, heavy shadows, or overly decorative UI. This is an operator tool — clean, functional, readable.

---

## PACKAGE.JSON ADDITIONS

Add to `doa-listing-agent/package.json` scripts:
```json
"scripts": {
  "server": "node server.js",
  "dev": "concurrently \"node server.js\" \"vite --port 5173\"",
  "agent": "node agent.js"
}
```

Add dependencies:
- `express` — HTTP server
- `multer` — file uploads
- `cors` — cross-origin for dev
- `concurrently` — run server + vite together in dev
- `uuid` — run ID generation

---

## SELF-HEALING ENGINEER DIRECTIVES

You are an autonomous agentic engineer. Apply these rules throughout development:

1. **If a dependency is missing** — install it and continue. Do not ask.

2. **If a file import fails** — check the actual file path and fix the import. Do not scaffold a workaround.

3. **If an SSE stream has CORS issues in dev** — add `cors()` middleware to Express and configure Vite proxy in `vite.config.ts` to forward `/api` to `localhost:3001`. Fix it.

4. **If CSV parsing produces unexpected column names** — implement column name normalization (lowercase, trim, strip quotes) before validation. Never fail silently.

5. **If the agent child process fails to spawn** — check that `node` is in PATH, log the full error to the SSE stream, set run status to `fatal_error`, and show the error in a modal with the exact command that failed.

6. **If a component has a TypeScript error** — resolve the type error correctly. Do not use `any` as a shortcut unless absolutely unavoidable and documented with a comment.

7. **If the build fails** — read the full error output, identify the root cause, fix it, and rebuild. Never deliver a codebase that doesn't build.

8. **If a test is needed to verify correctness** — write it inline as a comment or simple assertion. Do not skip verification.

9. **If you realize the architecture needs adjustment mid-build** — make the adjustment and document what changed and why in a comment at the top of the affected file.

10. **Complete the full task.** The deliverable is a working system, not a partial implementation. Do not stop until all features listed in this prompt are functional.

---

## DELIVERABLES CHECKLIST

When you are done, every item below must be true:

- [ ] `server.js` exists and runs without errors on `node server.js`
- [ ] `GET /api/health` returns `{ status: "ok" }`
- [ ] `POST /api/run` accepts a CSV file and config, spawns the agent, returns runId
- [ ] `GET /api/status/:runId` streams SSE events correctly
- [ ] React app builds without TypeScript or lint errors
- [ ] CSV drag-and-drop works and shows preview table
- [ ] Live lot status table updates in real time via SSE
- [ ] Progress bar and stats cards update live
- [ ] Failed lots show error message on hover and a Retry button
- [ ] History page shows past runs
- [ ] Settings page saves to localStorage and tests server connection
- [ ] Offline overlay appears when server is unreachable
- [ ] All error states in the Error Handling table above have UI representation
- [ ] Dark theme applied consistently across all pages
- [ ] No hardcoded localhost URLs — use the configurable server URL from Settings

---

## FINAL NOTE

This is a real production tool used to post hundreds of auction lots to Denver Online Auctions. Reliability is non-negotiable. Build it like it needs to run unattended at 2am with nobody watching. Every failure needs a recovery path. Every success needs to be logged. Ship the complete system.
