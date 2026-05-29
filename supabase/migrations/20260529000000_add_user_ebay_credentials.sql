-- user_ebay_credentials: per-user eBay OAuth refresh tokens for SaaS multi-tenant.
-- SaaS design: EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are shared app-level secrets (env vars).
-- Only the refresh_token is per-user — it scopes publishing to each user's own eBay seller account.

CREATE TABLE IF NOT EXISTS public.user_ebay_credentials (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token TEXT        NOT NULL,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.user_ebay_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own eBay credentials"
  ON public.user_ebay_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages eBay credentials"
  ON public.user_ebay_credentials FOR ALL
  USING (auth.role() = 'service_role');
