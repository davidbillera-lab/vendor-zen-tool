# DOA Listing Agent: Workflow Audit & Production Strategy

## Identified Breakpoints

### 1. The Trigger Disconnect (Frontend vs. GitHub Actions)
The frontend was triggering the agent by calling `http://localhost:3333/run` after invoking the Supabase edge function. This only works if the terminal is running on your personal machine — anyone else on the team fails silently.

**Fix:** The `trigger-doa-agent` edge function now makes an HTTP POST to the GitHub API (`repository_dispatch`) to trigger the Action directly. No local server required.

### 2. GitHub Actions Workflow Was Incomplete
The workflow only triggered on `workflow_dispatch` (manual button in GitHub UI). It did not listen for `repository_dispatch`, so Supabase could never trigger it via API.

**Fix:** Added `repository_dispatch: types: [run-doa-agent]` to the workflow trigger.

### 3. Missing Secrets in GitHub
The workflow expects four secrets set in GitHub repository settings:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `DOA_EMAIL`
- `DOA_PASSWORD`

And the edge function requires one secret in Supabase:
- `GITHUB_PAT` — a GitHub Personal Access Token with `repo` scope

### 4. Architecture Was Split Between Two Models
The codebase was caught between "Local Server" (localhost:3333) and "GitHub Actions" architectures. Neither worked end-to-end.

**Fix:** Fully committed to GitHub Actions. Removed all localhost polling from the frontend.

---

## Production Setup Checklist

### GitHub Secrets (Settings → Secrets and variables → Actions)
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_KEY`
- [ ] `DOA_EMAIL`
- [ ] `DOA_PASSWORD`

### Supabase Edge Function Secrets (Project Settings → Edge Functions → Secrets)
- [ ] `GITHUB_PAT` — GitHub Personal Access Token with `repo` scope

### Deploy the Edge Function
```bash
supabase functions deploy trigger-doa-agent
```

---

## How It Works Now

1. User clicks "Push to DOA" in the web app
2. Frontend calls `trigger-doa-agent` Supabase edge function
3. Edge function resets lots to `pending`, marks batch `is_active`, then POSTs to GitHub API
4. GitHub fires the `doa-agent.yml` workflow via `repository_dispatch`
5. GitHub Actions runs Playwright, fills each lot, updates Supabase rows to `completed`
6. Frontend auto-refreshes every 10s — lots turn green in real time
