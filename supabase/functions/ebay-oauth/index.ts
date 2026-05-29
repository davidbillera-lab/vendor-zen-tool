import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * eBay OAuth 2.0 Consent Flow — Multi-Tenant SaaS
 *
 * Actions:
 *   get_auth_url     → Returns eBay consent URL (reads EBAY_RUNAME from env — never exposed to client)
 *   exchange_code    → Exchanges auth code; saves refresh_token to DB per authenticated user
 *   get_status       → Returns {connected, connected_at} for the authenticated user
 *   disconnect       → Deletes the user's row from user_ebay_credentials
 *   test_credentials → Tests JSG shared credentials (admin/debug use)
 *   diagnose         → Returns diagnostic info (admin/debug use)
 */

const EBAY_PRODUCTION = {
  authUrl: "https://auth.ebay.com/oauth2/authorize",
  tokenUrl: "https://api.ebay.com/identity/v1/oauth2/token",
  apiBase: "https://api.ebay.com",
};

const EBAY_SANDBOX = {
  authUrl: "https://auth.sandbox.ebay.com/oauth2/authorize",
  tokenUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  apiBase: "https://api.sandbox.ebay.com",
};

const REQUIRED_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/commerce.media.upload",
];

function getSecret(name: string): string {
  const raw = Deno.env.get(name) ?? "";
  return raw.trim().replace(/^['"]|['"]$/g, "");
}

function fingerprint(s: string): string {
  if (s.length > 12) return `${s.slice(0, 8)}...${s.slice(-4)}`;
  if (s.length > 4) return `${s.slice(0, 4)}...`;
  return s ? "***" : "(empty)";
}

function getUserIdFromAuth(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const jwt = authHeader.slice(7);
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    return (payload.sub as string) || null;
  } catch {
    return null;
  }
}

function getServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, code, environment = "production" } = body;
    const authHeader = req.headers.get("authorization");
    const env = environment === "sandbox" ? EBAY_SANDBOX : EBAY_PRODUCTION;

    const clientId = getSecret("EBAY_CLIENT_ID");
    const clientSecret = getSecret("EBAY_CLIENT_SECRET");
    const refreshToken = getSecret("EBAY_REFRESH_TOKEN");

    if (action === "get_auth_url") {
      if (!clientId) {
        return jsonResponse({ error: "EBAY_CLIENT_ID is not configured" }, 400);
      }
      const ruName = getSecret("EBAY_RUNAME");
      if (!ruName) {
        return jsonResponse({ error: "EBAY_RUNAME is not configured. Set it via: npx supabase secrets set EBAY_RUNAME=<your-runame>" }, 400);
      }

      const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: ruName,
        scope: REQUIRED_SCOPES.join(" "),
      });

      const authUrl = `${env.authUrl}?${params.toString()}`;
      return jsonResponse({ authUrl, scopes: REQUIRED_SCOPES });
    }

    if (action === "exchange_code") {
      if (!code) {
        return jsonResponse({ error: "authorization code is required" }, 400);
      }
      if (!clientId || !clientSecret) {
        return jsonResponse({ error: "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be configured" }, 400);
      }

      const userId = getUserIdFromAuth(authHeader);
      if (!userId) {
        return jsonResponse({ error: "Authentication required to connect eBay account" }, 401);
      }

      const ruName = getSecret("EBAY_RUNAME");
      const b64Auth = btoa(`${clientId}:${clientSecret}`);
      const tokenRes = await fetch(env.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${b64Auth}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: ruName,
        }),
      });

      const tokenText = await tokenRes.text();
      if (!tokenRes.ok) {
        return jsonResponse({
          error: "Token exchange failed",
          status: tokenRes.status,
          details: tokenText,
        }, 400);
      }

      const tokenData = JSON.parse(tokenText);
      if (!tokenData.refresh_token) {
        return jsonResponse({ error: "No refresh token in eBay response" }, 400);
      }

      const db = getServiceClient();
      if (!db) {
        return jsonResponse({ error: "Database connection unavailable" }, 500);
      }

      const { error: upsertError } = await db
        .from("user_ebay_credentials")
        .upsert({
          user_id: userId,
          refresh_token: tokenData.refresh_token,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (upsertError) {
        console.error("[ebay-oauth] Failed to save credentials:", upsertError);
        return jsonResponse({ error: "Failed to save eBay credentials" }, 500);
      }

      return jsonResponse({ success: true, connected: true, message: "eBay account connected successfully." });
    }

    if (action === "get_status") {
      const userId = getUserIdFromAuth(authHeader);
      if (!userId) {
        return jsonResponse({ connected: false });
      }

      const db = getServiceClient();
      if (!db) {
        return jsonResponse({ connected: false });
      }

      const { data } = await db
        .from("user_ebay_credentials")
        .select("connected_at")
        .eq("user_id", userId)
        .maybeSingle();

      return jsonResponse({
        connected: !!data,
        connected_at: data?.connected_at ?? null,
      });
    }

    if (action === "disconnect") {
      const userId = getUserIdFromAuth(authHeader);
      if (!userId) {
        return jsonResponse({ error: "Authentication required" }, 401);
      }

      const db = getServiceClient();
      if (!db) {
        return jsonResponse({ error: "Database connection unavailable" }, 500);
      }

      const { error: deleteError } = await db
        .from("user_ebay_credentials")
        .delete()
        .eq("user_id", userId);

      if (deleteError) {
        return jsonResponse({ error: "Failed to disconnect eBay account" }, 500);
      }

      return jsonResponse({ success: true, connected: false });
    }

    if (action === "test_credentials") {
      if (!clientId || !clientSecret || !refreshToken) {
        return jsonResponse({
          success: false,
          error: "Missing credentials",
          diagnosis: {
            clientId: clientId ? "✅ Set" : "❌ Missing",
            clientSecret: clientSecret ? `✅ Set (${clientSecret.length} chars)` : "❌ Missing",
            refreshToken: refreshToken ? `✅ Set (${refreshToken.length} chars)` : "❌ Missing",
          },
        });
      }

      const b64Auth = btoa(`${clientId}:${clientSecret}`);
      const tokenRes = await fetch(env.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${b64Auth}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: REQUIRED_SCOPES.join(" "),
        }),
      });

      const tokenText = await tokenRes.text();
      if (!tokenRes.ok) {
        let ebayError: any = {};
        try { ebayError = JSON.parse(tokenText); } catch {}

        let guidance = "";
        const errDesc = ebayError.error_description || tokenText;

        if (errDesc.includes("invalid_grant")) {
          guidance = "Your refresh token is expired or was generated with Auth'n'Auth instead of OAuth 2.0. Use the OAuth consent flow to get a new one.";
        } else if (errDesc.includes("invalid_client")) {
          guidance = "Your Client ID or Client Secret (Cert ID) is incorrect. Double-check them in eBay Developer Portal.";
        } else if (errDesc.includes("invalid_scope")) {
          guidance = "The scopes on your token don't match. Re-authorize with the correct scopes.";
        }

        return jsonResponse({
          success: false,
          error: ebayError.error || "token_refresh_failed",
          error_description: errDesc,
          guidance,
          http_status: tokenRes.status,
          token_type_hint: refreshToken.startsWith("v^1.1") ? "⚠️ This looks like an Auth'n'Auth token, NOT OAuth 2.0!" :
                           refreshToken.startsWith("v^1") ? "This looks like an OAuth 2.0 refresh token ✅" : "Unknown token format",
        });
      }

      const tokenData = JSON.parse(tokenText);
      return jsonResponse({
        success: true,
        message: "OAuth 2.0 credentials are valid! Token refresh succeeded.",
        environment,
        access_token_preview: fingerprint(tokenData.access_token || ""),
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
      });
    }

    if (action === "diagnose") {
      const ruName = getSecret("EBAY_RUNAME");
      const tokenFormat = !refreshToken ? "❌ Not set" :
        refreshToken.startsWith("v^1.1") ? "⚠️ Auth'n'Auth token (WRONG — need OAuth 2.0)" :
        refreshToken.startsWith("v^1") ? "✅ OAuth 2.0 format" :
        `⚠️ Unknown format (starts with: ${refreshToken.slice(0, 5)}...)`;

      return jsonResponse({
        credentials: {
          clientId: clientId ? `✅ ${fingerprint(clientId)}` : "❌ Missing",
          clientSecret: clientSecret ? `✅ ${clientSecret.length} chars` : "❌ Missing",
          refreshToken: refreshToken ? `${tokenFormat} — ${refreshToken.length} chars` : "❌ Missing",
          ruName: ruName ? `✅ ${fingerprint(ruName)}` : "❌ Missing — set EBAY_RUNAME secret",
        },
        required_scopes: REQUIRED_SCOPES,
        next_steps: !refreshToken || refreshToken.startsWith("v^1.1")
          ? "You need to generate an OAuth 2.0 refresh token using the consent flow."
          : "Your token format looks correct. Click 'Test Credentials' to verify it works.",
      });
    }

    return jsonResponse({ error: "Unknown action. Use: get_auth_url, exchange_code, get_status, disconnect, test_credentials, diagnose" }, 400);

  } catch (e) {
    console.error("ebay-oauth error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
