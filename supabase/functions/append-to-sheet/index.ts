import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SheetRow {
  lotNum: number;
  title: string;
  description: string;
  lowEst: number;
  highEst: number;
  startPrice: number;
  condition: string;
  consignor: string;
  height: string;
  width: string;
  depth: string;
  dimensionUnit: string;
  weight: string;
  weightUnit: string;
}

interface AppendRequest {
  spreadsheetId: string;
  sheetName?: string;
  rows: SheetRow[];
}

async function getAccessToken(serviceAccount: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  
  // Import the private key
  const pemContent = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Create JWT
  const jwt = await create(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: getNumericDate(0),
      exp: getNumericDate(3600),
    },
    cryptoKey
  );

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Failed to get access token: ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Try Base64 encoded version first, fall back to raw JSON
    let serviceAccountJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON_B64');
    let serviceAccount;
    
    if (serviceAccountJson) {
      // Decode from Base64
      const decoded = atob(serviceAccountJson);
      serviceAccount = JSON.parse(decoded);
      console.log('Using Base64-encoded service account credentials');
    } else {
      // Fall back to raw JSON
      serviceAccountJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
      if (!serviceAccountJson) {
        throw new Error('Google service account credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON_B64 with Base64-encoded JSON.');
      }
      serviceAccount = JSON.parse(serviceAccountJson);
      console.log('Using raw JSON service account credentials');
    }
    const { spreadsheetId, sheetName = 'Sheet1', rows } = await req.json() as AppendRequest;

    if (!spreadsheetId) {
      throw new Error('spreadsheetId is required');
    }

    if (!rows || rows.length === 0) {
      throw new Error('At least one row is required');
    }

    console.log(`Appending ${rows.length} rows to spreadsheet ${spreadsheetId}`);

    const accessToken = await getAccessToken(serviceAccount);

    // Format rows for Google Sheets API
    // Column order: LotNum, Title, Description, LowEst, HighEst, StartPrice, Condition, Consignor, Height, Width, Depth, Dimension Unit, Weight, Weight Unit
    const values = rows.map(row => [
      row.lotNum,
      row.title,
      row.description,
      row.lowEst,
      row.highEst,
      row.startPrice,
      row.condition,
      row.consignor || 'JSG',
      row.height || '',
      row.width || '',
      row.depth || '',
      row.dimensionUnit || '',
      row.weight || '',
      row.weightUnit || ''
    ]);

    // Append rows to the sheet (14 columns: A:N)
    const range = `${sheetName}!A:N`;
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    const response = await fetch(appendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Sheets API error:', response.status, errorText);
      console.error('Service account email (share your sheet with this):', serviceAccount?.client_email);
      throw new Error(
        `Google Sheets API error: ${response.status} - ${errorText}\n` +
          `Fix: Share the spreadsheet with this service account email as Editor: ${serviceAccount?.client_email}`
      );
    }

    const result = await response.json();
    console.log('Successfully appended rows:', result.updates?.updatedRows);

    return new Response(
      JSON.stringify({ 
        success: true, 
        updatedRows: result.updates?.updatedRows || rows.length,
        updatedRange: result.updates?.updatedRange
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in append-to-sheet:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
