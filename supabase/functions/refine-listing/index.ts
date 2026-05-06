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
}

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

    const { currentListing, correctionPrompt, imageUrls, platform = 'liveauctioneers', mode = 'refine' } = await req.json() as RefineRequest;

    console.log(`Mode: ${mode}, Platform: ${platform}`);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Build content with images for reference
    const content: any[] = [];
    for (const url of imageUrls) {
      content.push({ type: "image_url", image_url: { url } });
    }

    if (mode === 'verify') {
      console.log('Running listing verification...');

      const verifySystemPrompt = `You are an expert eBay listing quality auditor.
Analyze the listing title, description, price, condition, and item specifics for quality and accuracy.

Check for:
1. Title clarity and keyword optimization (eBay limit: 80 characters)
2. Description completeness and accuracy based on images
3. Price reasonableness (if visible from context)
4. Condition accuracy vs. what images show
5. Item specifics completeness

Return a JSON object: { "passed": true/false, "report": "your detailed findings" }
- passed: true if the listing is solid and ready to post, false if issues found
- report: 2-5 sentences summarizing quality, flagging any problems, and suggesting improvements

No markdown fences. Return only the JSON object.`;

      content.push({
        type: "text",
        text: `Listing to verify:\n${JSON.stringify(currentListing, null, 2)}\n\nPlease audit this listing and return your assessment as JSON.`
      });

      const verifyResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-lite',
          messages: [
            { role: 'system', content: verifySystemPrompt },
            { role: 'user', content }
          ],
          max_tokens: 600,
        }),
      });

      if (!verifyResponse.ok) {
        const errorText = await verifyResponse.text();
        console.error('AI gateway error:', verifyResponse.status, errorText);
        if (verifyResponse.status === 429) {
          return new Response(
            JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw new Error(`AI gateway error: ${verifyResponse.status}`);
      }

      const verifyData = await verifyResponse.json();
      const verifyAiResponse = verifyData.choices?.[0]?.message?.content ?? '';

      let verifyResult = { passed: false, report: verifyAiResponse };
      try {
        const jsonMatch = verifyAiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, verifyAiResponse];
        verifyResult = JSON.parse(jsonMatch[1].trim());
      } catch {
        // If JSON parse fails, use the raw text as the report
      }

      return new Response(
        JSON.stringify(verifyResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Refine mode
    console.log(`Refining listing with prompt: ${correctionPrompt}`);

    const titleLimit = platform === 'ebay' ? 80 : 100;
    const platformRules = platform === 'ebay'
      ? `5. eBay title limit is ${titleLimit} characters — never exceed it
6. For description, use clear HTML-friendly formatting; include model, brand, dimensions, and condition details
7. For condition: use eBay standard values (New, Used, For Parts or Not Working, etc.)
8. Keep itemSpecifics keys/values accurate for eBay catalog`
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

ALWAYS return valid JSON with the same structure as the input, no markdown, no explanation.`;

    content.push({
      type: "text",
      text: `Current listing JSON:\n${JSON.stringify(currentListing, null, 2)}\n\nUser's correction request: "${correctionPrompt}"\n\nPlease update the listing based on the user's request and return the complete updated JSON. Remember to keep fields the user didn't mention unchanged.`
    });

    console.log('Calling Lovable AI for refinement...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content }
        ],
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content;

    console.log('AI Response received for refinement');

    // Parse the JSON from the response
    let refinedListing;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResponse];
      const jsonStr = jsonMatch[1].trim();
      refinedListing = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON');
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
