-- tenant_usage: tracks per-user API usage per billing period (YYYY-MM)
-- Used by enhance-image to enforce the 300 image/month soft cap
-- and by future cost attribution when multi-tenant RLS isolation lands.

CREATE TABLE IF NOT EXISTS tenant_usage (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  billing_period TEXT        NOT NULL, -- 'YYYY-MM'
  enhancement_count INTEGER  NOT NULL DEFAULT 0,
  listing_count  INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, billing_period)
);

-- Index for the fast lookup pattern: user + current period
CREATE INDEX idx_tenant_usage_user_period ON tenant_usage(user_id, billing_period);

-- RLS: users can read their own usage row; service role manages all writes
ALTER TABLE tenant_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON tenant_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages usage"
  ON tenant_usage FOR ALL
  USING (auth.role() = 'service_role');

-- Atomic increment to avoid race conditions when multiple requests land simultaneously.
-- Called by enhance-image edge function after every successful image generation.
CREATE OR REPLACE FUNCTION increment_enhancement_count(p_user_id UUID, p_billing_period TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  INSERT INTO tenant_usage (user_id, billing_period, enhancement_count)
  VALUES (p_user_id, p_billing_period, 1)
  ON CONFLICT (user_id, billing_period)
  DO UPDATE SET
    enhancement_count = tenant_usage.enhancement_count + 1,
    updated_at        = now()
  RETURNING enhancement_count INTO v_new_count;

  RETURN v_new_count;
END;
$$;

-- Keep updated_at current on any update
CREATE OR REPLACE FUNCTION update_tenant_usage_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_usage_updated_at
  BEFORE UPDATE ON tenant_usage
  FOR EACH ROW EXECUTE PROCEDURE update_tenant_usage_timestamp();
