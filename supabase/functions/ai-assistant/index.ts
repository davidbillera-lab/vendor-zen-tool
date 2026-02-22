import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: Message[];
  context?: string;
}

const SYSTEM_PROMPT = `You are a smart, practical AI assistant built into Vendor Zen — a multi-platform selling tool for estate sale and antique dealers. The app helps list items on eBay, Facebook Marketplace, LiveAuctioneers, and Denver Auctions.

Help the user with:
- Writing and improving listing titles and descriptions
- Pricing strategy for antiques, collectibles, and estate sale items
- Platform differences: eBay fees/SEO, Facebook group strategy, auction estimate vs buy-it-now pricing
- Batch workflow efficiency and lot management
- eBay category selection and item specifics
- Condition grading for auction lots
- Comparable sold prices and market trends
- General selling advice across all four platforms

Platform specifics you know:
- eBay: Cassini SEO, 80-char title limit, category IDs, item specifics, promoted listings 5% flat/dynamic
- Facebook: No fees, local buyers, up to 20 groups, good for large/heavy items
- LiveAuctioneers: CSV bulk upload, lot numbers, low/high estimates, start price, condition grading
- Denver Auctions: Copy-paste workflow, starting bid, title + description format

Be concise, direct, and practical. Give real numbers when asked about pricing. Keep responses short and actionable — this is a fast-paced workflow tool.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { messages, context } = (await req.json()) as ChatRequest;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = context
      ? `${SYSTEM_PROMPT}\n\nCurrent page context: ${context}`
      : SYSTEM_PROMPT;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
          ],
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit hit. Please wait a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI usage limit reached. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.error("AI gateway error:", response.status, err);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const reply =
      data.choices?.[0]?.message?.content ?? "No response received.";

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("ai-assistant error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
