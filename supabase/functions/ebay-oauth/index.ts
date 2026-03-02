import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * eBay OAuth 2.0 Consent Flow
 * 
 * Actions:
 *   1. get_auth_url   → Returns the eBay consent URL for the user to visit
 *   2. exchange_code   → Exchanges the authorization code for access + refresh tokens
 *   3. test_credentials → Tests stored credentials by attempting a token refresh
 *   4. diagnose        → Returns detailed diagnostic info about stored credentials
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, code, redirect_uri, environment = "production" } = body;
    const env = environment === "sandbox" ? EBAY_SANDBOX : EBAY_PRODUCTION;

    const clientId = getSecret("EBAY_CLIENT_ID");
    const clientSecret = getSecret("EBAY_CLIENT_SECRET");
    const refreshToken = getSecret("EBAY_REFRESH_TOKEN");

    if (action === "get_auth_url") {
      // Generate the consent URL the user needs to visit
      if (!clientId) {
        return jsonResponse({ error: "EBAY_CLIENT_ID is not configured" }, 400);
      }
      if (!redirect_uri) {
        return jsonResponse({ error: "redirect_uri is required" }, 400);
      }

      const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirect_uri,
        scope: REQUIRED_SCOPES.join(" "),
      });

      const authUrl = `${env.authUrl}?${params.toString()}`;
      return jsonResponse({ authUrl, scopes: REQUIRED_SCOPES });
    }

    if (action === "exchange_code") {
      // Exchange authorization code for tokens
      if (!code) {
        return jsonResponse({ error: "authorization code is required" }, 400);
      }
      if (!clientId || !clientSecret) {
        return jsonResponse({ error: "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be configured" }, 400);
      }

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
          redirect_uri: redirect_uri || "",
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
      
      // The refresh token is what they need to store
      return jsonResponse({
        success: true,
        token_type: "OAuth 2.0 User Token",
        refresh_token: tokenData.refresh_token,
        refresh_token_expires_in: tokenData.refresh_token_expires_in,
        access_token_preview: fingerprint(tokenData.access_token || ""),
        scopes_granted: tokenData.scope,
        message: "Save the refresh_token as EBAY_REFRESH_TOKEN secret. It expires in ~18 months.",
      });
    }

    if (action === "test_credentials") {
      // Test the stored refresh token by attempting to get an access token
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
        // Parse eBay error to give clear guidance
        let ebayError: any = {};
        try { ebayError = JSON.parse(tokenText); } catch {}

        let guidance = "";
        const errDesc = ebayError.error_description || tokenText;
        
        if (errDesc.includes("invalid_grant")) {
          guidance = "Your refresh token is expired or was generated with Auth'n'Auth instead of OAuth 2.0. You need to re-authorize using the OAuth consent flow.";
        } else if (errDesc.includes("invalid_client")) {
          guidance = "Your Client ID or Client Secret (Cert ID) is incorrect. Double-check them in your eBay Developer Portal under Application Keys.";
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
      // Return diagnostic info about stored credentials
      const tokenFormat = !refreshToken ? "❌ Not set" :
        refreshToken.startsWith("v^1.1") ? "⚠️ Auth'n'Auth token (WRONG — need OAuth 2.0)" :
        refreshToken.startsWith("v^1") ? "✅ OAuth 2.0 format" :
        `⚠️ Unknown format (starts with: ${refreshToken.slice(0, 5)}...)`;

      return jsonResponse({
        credentials: {
          clientId: clientId ? `✅ ${fingerprint(clientId)}` : "❌ Missing",
          clientSecret: clientSecret ? `✅ ${clientSecret.length} chars` : "❌ Missing",
          refreshToken: refreshToken ? `${tokenFormat} — ${refreshToken.length} chars` : "❌ Missing",
        },
        required_scopes: REQUIRED_SCOPES,
        runame_needed: "Your RuName (Redirect URL) from eBay Developer Portal",
        next_steps: !refreshToken || refreshToken.startsWith("v^1.1") 
          ? "You need to generate an OAuth 2.0 refresh token using the consent flow. Click 'Start OAuth Flow' above."
          : "Your token format looks correct. Click 'Test Credentials' to verify it works.",
      });
    }

    return jsonResponse({ error: "Unknown action. Use: get_auth_url, exchange_code, test_credentials, diagnose" }, 400);

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
