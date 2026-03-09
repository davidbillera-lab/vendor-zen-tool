

## Does Vendor Zen Have an API?

Yes — your app effectively has a REST API through its backend. Here's what's available:

### Existing API Endpoints

Your backend functions serve as API endpoints at:

```
https://mwspcagajlkanpfdbuqc.supabase.co/functions/v1/{function-name}
```

**Edge Functions (callable endpoints):**
- `generate-listing` — AI listing generation
- `refine-listing` — AI listing refinement
- `generate-denver-listing` — Denver-specific listing generation
- `enhance-image` — Image enhancement
- `generate-images-zip` — ZIP packaging for images
- `ebay-publish` — Publish to eBay
- `ebay-oauth` — eBay OAuth flow
- `enrich-ebay-batch` — Enrich eBay batch data
- `append-to-sheet` — Google Sheets integration
- `zapier-proxy` — Zapier automation proxy
- `ai-assistant` — AI chat

### Database API (Auto-generated REST)

Every database table is also accessible via REST at:

```
https://mwspcagajlkanpfdbuqc.supabase.co/rest/v1/{table_name}
```

This is what your DOA Chrome extension and external agents (like Agent Zero) already use. Requests require:
- `apikey` header (the anon key)
- `Authorization: Bearer {JWT}` header (obtained by authenticating with user credentials)

### Summary

You don't need to build a separate API — **it already exists**. Any external tool, automation agent, or extension can authenticate and call your edge functions or query your database tables directly.

