# Lovable Edge Function Overwrite Recovery

**When to use this:** Lovable's GitHub integration pushed to `vercel-deploy` and overwrote one or more Supabase edge functions, breaking something that was working (e.g., the pre-publish QA agent, eBay publish logic, category lookup).

**Live Supabase project:** `atgrxqfxysvppqoyvjdd`

---

## How to detect it

1. Check recent commits on `vercel-deploy` — look for commits from the Lovable bot that touch files under `supabase/functions/`
2. Or behavior regresses: eBay pushes stop running the QA agent, category errors reappear, a feature that was working stops working

---

## Recovery: re-deploy any function via CLI

Run from `c:\Users\david\vendor-zen-tool`:

```powershell
# Deploy a single function (replace <function-name>)
supabase functions deploy <function-name> --project-ref atgrxqfxysvppqoyvjdd

# Common functions to check first:
supabase functions deploy ebay-publish       --project-ref atgrxqfxysvppqoyvjdd
supabase functions deploy refine-listing     --project-ref atgrxqfxysvppqoyvjdd
supabase functions deploy generate-listing   --project-ref atgrxqfxysvppqoyvjdd
supabase functions deploy generate-denver-listing --project-ref atgrxqfxysvppqoyvjdd

# Deploy ALL functions at once (nuclear option)
supabase functions deploy --project-ref atgrxqfxysvppqoyvjdd
```

The CLI reads the current function code from `supabase/functions/<name>/index.ts` in this repo and deploys it, overwriting whatever Lovable pushed.

---

## After recovery

1. Test the affected function (e.g., push one eBay listing to confirm the QA agent fires)
2. Check Lovable's dashboard — if it's connected to the live project (`atgrxqfxysvppqoyvjdd`), disconnect it or switch it to the ghost project (`mwspcagajlkanpfdbuqc`) to prevent future overwrites
3. If Lovable keeps doing it: add a GitHub Actions workflow that re-deploys functions on every push to `vercel-deploy`, so CLI always wins

---

## Prevention (long-term)

- Never use Lovable's "Deploy to Supabase" button for this project
- All edge function changes go through: edit in repo → `supabase functions deploy` via CLI
- Lovable is safe to use for frontend UI changes only
