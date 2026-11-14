import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RefineRequest {
  currentListing: Record<string, any>;
  correctionPrompt: string;
  imageUrls: string[];
  platform?: 'ebay' | 'liveauctioneers' | 'denver';
  mode?: 'refine' | 'verify';
  masterPrompt?: string;
  publishError?: string;
}

// Appended to the refine prompt only when fixing an eBay publish error.
const EBAY_ERROR_PLAYBOOK = `

FIXING AN EBAY PUBLISH ERROR — you may change ANY field needed to make the listing publish (title, description, condition, category, brand, subtitle, upc, mpn, itemSpecifics), and must fix every problem the error names. Never just restate the error.
Known eBay rules:
- Clothing Size must be a standard code (XS, S, M, L, XL, XXL, 3XL…) or a number (32, 10, 17 34/35). Never "See Description", never a range like "S/M". "Size Type" must match the size: plain XS–XL sizes are "Regular"; "Big & Tall"/"Tall" only for big/tall sizes (2XL, XLT, LT…). If unsure, use "Regular".
- "Brand has an invalid value" (e.g. "Mixed", "Various", "Assorted"): use the real brand if the photos or title show one, otherwise "Unbranded".
- "X is a required field" / "Enter a valid value for X": fill X from the photos, title or description; if it truly can't be known, use the most neutral standard value eBay accepts for that aspect.
- Remove item specifics that don't belong to the category (e.g. clothing "Size Type" on trading cards).
- Trading cards (183454 Pokémon/CCG, 261328 sports, 183050 non-sport): ungraded cards need itemSpecifics "Card Condition" — for 183454 one of "Near Mint or Better", "Lightly Played (Excellent)", "Moderately Played (Very Good)", "Heavily Played (Poor)"; for the others "Near Mint or Better", "Excellent", "Very Good", "Poor". Graded cards need "Professional Grader" and "Grade".
- Several items sold together (a lot, a binder or box of cards) must not sit in a single-item category: CCG card lots → 183455 (CCG Mixed Card Lots).
- "Condition … is not valid for category": pick the closest condition eBay allows (New, New other, Used, For parts or not working).
- Error 240 "cannot be listed … improper words or policy": usually a lot in a single-item category, or another company's brand/trademark in the title of an item that isn't theirs — fix the category or remove the word.
- Warnings to ignore: "business policies" (21919456), "item specifics were renamed" (21920277), promoted-ad "bidPercentage" errors.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      console.error('Authentication failed:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Authenticated user: ${user.id}`);

    const authedClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { currentListing, correctionPrompt, imageUrls = [], platform = 'liveauctioneers', mode = 'refine', masterPrompt, publishError } = await req.json() as RefineRequest;

    console.log(`Mode: ${mode}, Platform: ${platform}`);

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    // Build Anthropic content with images for reference
    const imageContent: any[] = [];
    for (const url of imageUrls.filter(Boolean)) {
      imageContent.push({ type: "image", source: { type: "url", url } });
    }

    if (mode === 'verify') {
      console.log('Running listing verification with Claude...');

      let lessons: { id: string; lesson_text: string }[] = [];
      try {
        const { data, error: lessonsErr } = await authedClient
          .from('listing_correction_lessons')
          .select('id, lesson_text')
          .eq('retired', false)
          .order('created_at', { ascending: false })
          .limit(5);
        if (lessonsErr) {
          console.warn('lesson fetch skipped:', lessonsErr.message);
        } else {
          lessons = data ?? [];
          if (lessons.length > 0) {
            console.log(`Injected ${lessons.length} distilled lesson(s)`);
            // Stage 3 audit trail — was missing here, so this (the busiest path:
            // both DOA and eBay AI Verify) never showed up in correction_injections.
            authedClient
              .rpc('record_lesson_injections', { p_ids: lessons.map((l) => l.id) })
              .then(({ error }) => {
                if (error) console.warn('record_lesson_injections skipped (non-blocking):', error.message);
              });
          }
        }
      } catch (e) {
        console.warn('lesson fetch failed (non-blocking):', e);
      }

      const lessonsSection = lessons.length > 0
        ? `=== LEARNED LESSONS (from this seller's correction history) ===\n${lessons.map(l => `- ${l.lesson_text}`).join('\n')}\n=== END LEARNED LESSONS ===\n\n`
        : '';

      const masterPromptSection = masterPrompt
        ? `\nBUSINESS CONTEXT (apply to all evaluations):\n${masterPrompt}\n`
        : '';

      // Auction platforms (Denver Online Auctions, LiveAuctioneers) are a different
      // product from a fixed-price eBay listing: the number is an OPENING BID meant
      // to attract bidding, titles run to 100 chars, and there are no item specifics
      // or categories to audit. Auditing a lot with the eBay ruleset produces bad
      // advice (it flags healthy opening bids as underpriced and invents fields).
      const isAuction = platform === 'denver' || platform === 'liveauctioneers';

      // Global measurement guardrail (all platforms): the operator adds verified
      // measurements manually — the auditor must neither add nor remove them.
      const measurementRule = `
MEASUREMENT RULE (HARD — overrides BUSINESS CONTEXT and LEARNED LESSONS above if either conflicts):
- Do NOT add measurements (dimensions, weight, capacity) to the title or description, and do NOT flag missing measurements as a defect — the operator adds verified measurements manually. Neither a generic saved business-context preference nor a distilled lesson overrides this; only an explicit per-listing instruction can.
- NEVER remove or "correct" measurements already present in the listing: they are operator-verified from real measuring, not photo estimates.
`;

      const verifySystemPrompt = isAuction
        ? `${lessonsSection}You are an expert auction catalog quality auditor with deep knowledge of estate and collectible values.${masterPromptSection}

Analyze the lot title, description, and starting bid for quality and accuracy.

Check for:
1. Title accuracy and searchability (limit: 100 characters). Identification first — maker, model/pattern, material, era — not marketing language.
2. Description completeness and accuracy based ONLY on what the images show plus research-confirmed facts (a model number that resolves to known specs, a maker's mark that resolves to a maker).
3. Condition and damage disclosure: chips, cracks, repairs, wear, missing pieces visible in the images MUST be stated.
4. Misidentification — the most costly error. If the item is not what the title claims, say so plainly.

STARTING BID VERIFICATION (CRITICAL — auction, not fixed price):
- A starting bid is an OPENING price designed to attract bidding, NOT the expected sale price. It is normally well BELOW market value, and that is correct.
- Only flag the bid if it is HIGH enough to suppress bidding (at or above realistic retail/sold value), or so high the lot will not open.
- Do NOT flag a low starting bid as underpriced — that is the intended auction strategy.
- Cite a realistic sold-value range for the item and explain how the opening bid relates to it.

DO NOT invent or require eBay-only fields: no item specifics, no category IDs, no shipping details.
${measurementRule}
Return a JSON object with exactly these fields:
{
  "passed": true/false,
  "report": "2-5 sentences summarizing quality, flagging misidentification or undisclosed damage, and citing a realistic value range",
  "correctedListing": { ...the full listing JSON with any corrections applied, or original values if no changes needed. Use the SAME field names as the input (title, description, startingBid). }
}

No markdown fences. Return only the JSON object.`
        : `${lessonsSection}You are an expert eBay listing quality auditor with deep knowledge of current market prices.${masterPromptSection}

Analyze the listing title, description, price, condition, and item specifics for quality and accuracy.

Check for:
1. Title clarity and keyword optimization (eBay limit: 80 characters)
2. Description completeness and accuracy based on images
3. Condition accuracy vs. what images show
4. Item specifics completeness

PRICING VERIFICATION (CRITICAL):
- Research recent eBay SOLD listings (last 90 days) for this exact item or close equivalents.
- If the listed price is more than 20% below the median sold price, flag as UNDERPRICED.
- If the listed price is more than 50% above median sold price, flag as OVERPRICED.
- State the specific median sold comp price you found and your reasoning.
- A price that would sell within minutes indicates underpricing — treat suspiciously low prices as a red flag.
${measurementRule}
Return a JSON object with exactly these fields:
{
  "passed": true/false,
  "report": "2-5 sentences summarizing quality, flagging problems, and citing specific sold comp prices found",
  "correctedListing": { ...the full listing JSON with any corrections applied, or original values if no changes needed }
}

No markdown fences. Return only the JSON object.`;

      const anthropicContent: any[] = [];
      anthropicContent.push(...imageContent);
      anthropicContent.push({
        type: "text",
        text: `Listing to verify:\n${JSON.stringify(currentListing, null, 2)}\n\nPlease audit this listing and return your assessment as JSON.`
      });

      const verifyResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5-5',
          thinking: { type: 'between_tools' },
          max_tokens: 1500,
          system: verifySystemPrompt,
          messages: [{ role: 'user', content: anthropicContent }],
        }),
      });

      if (!verifyResponse.ok) {
        const errorText = await verifyResponse.text();
        console.error('Anthropic API error:', verifyResponse.status, errorText);
        if (verifyResponse.status === 429 || verifyResponse.status === 529 || verifyResponse.status === 503) {
          return new Response(
            JSON.stringify({ error: 'AI service is temporarily busy. Please try again in a moment.' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw new Error(`Anthropic API error: ${verifyResponse.status}`);
      }

      const verifyData = await verifyResponse.json();
      const verifyAiResponse = verifyData.content?.[0]?.text ?? '';

      let verifyResult: { passed: boolean; report: string; correctedListing?: Record<string, any> } = {
        passed: false,
        report: verifyAiResponse,
        correctedListing: currentListing,
      };
      try {
        const jsonMatch = verifyAiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, verifyAiResponse];
        const parsed = JSON.parse(jsonMatch[1].trim());
        verifyResult = {
          passed: parsed.passed ?? false,
          report: parsed.report ?? verifyAiResponse,
          correctedListing: parsed.correctedListing ?? currentListing,
        };
      } catch {
        // If JSON parse fails, use the raw text as the report with original listing as correctedListing
      }

      return new Response(
        JSON.stringify(verifyResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Refine mode
    console.log(`Refining listing with prompt: ${correctionPrompt}`);
    // eBay errors (pasted, or sent by the "Fix with AI" button) need reasoning about
    // category and aspect rules, so they go to Sonnet; plain edits stay on Haiku.
    const fixingPublishError = platform === 'ebay'
      && (!!publishError?.trim() || /\[\d{3,}\]|error\s*\d{3,}|ebay (rejected|error)|push failed/i.test(correctionPrompt));
    const refineModel = fixingPublishError ? 'claude-sonnet-5-5' : 'claude-haiku-5-5';

    const titleLimit = platform === 'ebay' ? 80 : 100;
    const platformRules = platform === 'ebay'
      ? `5. eBay title limit is ${titleLimit} characters — never exceed it
6. For description, use clear HTML-friendly formatting; include model, brand, and condition details
7. For condition: use eBay standard values (New, Used, For Parts or Not Working, etc.)
8. Keep itemSpecifics keys/values accurate for eBay catalog
9. "category" is the numeric eBay leaf category ID. Change it only when the request or an eBay error calls for it, and only to an ID you are confident is a current eBay US leaf category — never invent one
10. Optional top-level fields you may also change: subtitle, brand, upc, mpn
11. Add a top-level "_summary" string: one short plain-English sentence saying what you changed and why`
      : `5. If the user asks about the title, keep it under ${titleLimit} characters
6. If the user asks about description, make it detailed and compelling
7. For condition updates, be specific about flaws and wear`;

    const systemPrompt = `You are an expert ${platform === 'ebay' ? 'eBay' : 'auction catalog'} listing editor.
Your task is to refine an existing listing based on user feedback.

IMPORTANT RULES:
1. ONLY modify the fields that the user's correction prompt relates to
2. Keep all other fields EXACTLY as they are
3. Maintain the same JSON structure
4. If the user asks about pricing, adjust those fields appropriately
${platformRules}

MEASUREMENT RULE (HARD): Never ADD measurements (dimensions, weight, capacity) to the title or description unless the user's correction request explicitly provides or asks for them — this overrides any conflicting standing preference. Never estimate measurements from photos. Preserve measurements already present — they are operator-verified — unless the user asks to change them.

ALWAYS return valid JSON with the same structure as the input, no markdown, no explanation.${fixingPublishError ? EBAY_ERROR_PLAYBOOK : ''}`;

    const content = [...imageContent];
    content.push({
      type: "text",
      text: `Current listing JSON:\n${JSON.stringify(currentListing, null, 2)}\n\nUser's correction request: "${correctionPrompt}"${publishError ? `\n\neBay rejected the last publish with:\n${publishError}` : ''}\n\nPlease update the listing based on the user's request${fixingPublishError ? ' and fix every problem in the eBay error' : ''} and return the complete updated JSON. Remember to keep fields the user didn't mention unchanged.`
    });

    console.log('Calling Anthropic API for refinement...');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: refineModel,
        thinking: fixingPublishError ? { type: 'between_tools' } : { type: 'disabled' },
        max_tokens: fixingPublishError ? 4000 : 2500,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);

      if (response.status === 429 || response.status === 529 || response.status === 503) {
        return new Response(
          JSON.stringify({ error: 'AI service is temporarily busy. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.content?.find((b: any) => b.type === 'text')?.text ?? '';

    console.log(`AI Response received for refinement (${refineModel})`);
    const inTok = data.usage?.input_tokens ?? 0;
    const outTok = data.usage?.output_tokens ?? 0;
    // $/MTok — same rates as generate-listing (Haiku 5.5) and distill-lessons (Sonnet 5.5).
    const [inRate, outRate] = fixingPublishError ? [2.0, 10.0] : [0.10, 0.50];
    authedClient.from('model_costs').insert({
      user_id: user.id,
      source: 'refine-listing',
      operation: fixingPublishError ? 'fix-publish-error' : 'refine',
      model: refineModel,
      input_tokens: inTok,
      output_tokens: outTok,
      cost_usd: (inTok * inRate + outTok * outRate) / 1_000_000,
    }).then(({ error }) => { if (error) console.warn('model_costs log skipped:', error.message); });

    // Parse the JSON from the response
    let refinedListing;
    try {
      const codeBlockMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        refinedListing = JSON.parse(codeBlockMatch[1].trim());
      } else {
        const objMatch = aiResponse.match(/\{[\s\S]*\}/);
        refinedListing = JSON.parse(objMatch ? objMatch[0] : aiResponse.trim());
      }
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', aiResponse.substring(0, 500));
      return new Response(
        JSON.stringify({ error: 'AI returned an unparseable response. Please try again.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ listing: refinedListing }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in refine-listing:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
