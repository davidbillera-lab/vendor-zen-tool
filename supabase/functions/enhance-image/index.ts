 import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
 import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 
 const corsHeaders = {
   'Access-Control-Allow-Origin': '*',
   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
 };
 
 interface EnhanceRequest {
   imageUrl: string;
   prompt: string;
   mode: 'enhance' | 'generate' | 'edit';
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
 
     const { imageUrl, prompt, mode } = await req.json() as EnhanceRequest;
     
     console.log(`Image ${mode} request: ${prompt}`);
 
     const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
     if (!LOVABLE_API_KEY) {
       throw new Error('LOVABLE_API_KEY is not configured');
     }
 
     let messages: any[] = [];
     
     if (mode === 'generate') {
       // Pure text-to-image generation
       messages = [
         {
           role: 'user',
           content: prompt
         }
       ];
     } else {
       // Image editing or enhancement
       const enhancePrompt = mode === 'enhance' 
         ? `Enhance this product image for e-commerce listing. Make it look professional with good lighting, clear details, and appealing presentation. ${prompt || 'Improve overall quality and appeal.'}` 
         : prompt;
       
       messages = [
         {
           role: 'user',
           content: [
             {
               type: 'text',
               text: enhancePrompt
             },
             {
               type: 'image_url',
               image_url: {
                 url: imageUrl
               }
             }
           ]
         }
       ];
     }
 
     console.log('Calling Lovable AI for image processing...');
     
     const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
       method: 'POST',
       headers: {
         'Authorization': `Bearer ${LOVABLE_API_KEY}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({
         model: 'google/gemini-2.5-flash-image',
         messages,
         modalities: ['image', 'text'],
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
     console.log('AI Response received');
     
     // Extract the generated image from the response
     const message = data.choices?.[0]?.message;
     const images = message?.images;
     
     if (!images || images.length === 0) {
       console.error('No image generated in response');
       return new Response(
         JSON.stringify({ error: 'No image was generated. Try a different prompt.' }),
         { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }
     
     const generatedImageUrl = images[0]?.image_url?.url;
     
     if (!generatedImageUrl) {
       throw new Error('Failed to extract image URL from response');
     }
     
     // Upload the base64 image to Supabase storage
     const base64Data = generatedImageUrl.split(',')[1];
     const imageBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
     const fileName = `enhanced-${Date.now()}-${Math.random().toString(36).substring(7)}.png`;
     
     const serviceClient = createClient(
       Deno.env.get('SUPABASE_URL')!,
       Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
     );
     
     const { data: uploadData, error: uploadError } = await serviceClient.storage
       .from('listing-images')
       .upload(`${user.id}/${fileName}`, imageBuffer, {
         contentType: 'image/png',
         upsert: false
       });
     
     if (uploadError) {
       console.error('Failed to upload enhanced image:', uploadError);
       // Return the base64 as fallback
       return new Response(
         JSON.stringify({ 
           imageUrl: generatedImageUrl,
           isBase64: true,
           message: message?.content || 'Image processed successfully'
         }),
         { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }
     
     const { data: publicUrl } = serviceClient.storage
       .from('listing-images')
       .getPublicUrl(`${user.id}/${fileName}`);
 
     return new Response(
       JSON.stringify({ 
         imageUrl: publicUrl.publicUrl,
         isBase64: false,
         message: message?.content || 'Image processed successfully'
       }),
       { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
     );
 
   } catch (error) {
     console.error('Error in enhance-image:', error);
     return new Response(
       JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
       { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
     );
   }
 });