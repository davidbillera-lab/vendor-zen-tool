import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { webhookUrl, payload } = await req.json();

    if (!webhookUrl || !payload) {
      return new Response(JSON.stringify({ error: "Missing webhookUrl or payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[zapier-proxy] Forwarding payload to Zapier webhook");

    // Simply forward the payload to Zapier — Zapier's native eBay integration
    // handles OAuth internally, no API keys needed from our side.
    const zapierResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const zapierStatus = zapierResponse.status;
    const zapierBody = await zapierResponse.text();

    console.log(`[zapier-proxy] Zapier responded: ${zapierStatus}`);

    return new Response(JSON.stringify({ success: true, zapierStatus, zapierBody }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("zapier-proxy error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
