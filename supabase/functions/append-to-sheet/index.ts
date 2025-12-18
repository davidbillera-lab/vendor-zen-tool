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
  category: string;
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

async function resolveSheetTitle(accessToken: string, spreadsheetId: string, requestedSheetName: string) {
  const normalize = (s: string) =>
    (s || '')
      .replace(/\u00A0/g, ' ') // non‑breaking spaces
      .replace(/\s+/g, ' ')
      .trim();

  const requested = normalize(requestedSheetName || '');
  if (!requested) return 'Sheet1';

  // Google returns "Unable to parse range" when the sheet title doesn't match an existing tab.
  // Resolve the exact tab title via spreadsheet metadata.
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title))`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!metaRes.ok) {
    console.warn('Could not fetch spreadsheet metadata; falling back to provided sheetName');
    return requested;
  }

  const meta = await metaRes.json();
  const titles: string[] = (meta?.sheets || [])
    .map((s: any) => s?.properties?.title)
    .filter(Boolean);

  const exact = titles.find((t) => normalize(t) === requested);
  if (exact) return exact;

  const ci = titles.find((t) => normalize(t).toLowerCase() === requested.toLowerCase());
  if (ci) return ci;

  // If the requested tab doesn't exist, default to the first sheet to keep the workflow moving.
  const fallback = titles[0] || 'Sheet1';
  console.warn('Requested sheet tab not found. Falling back to first tab.', {
    requested: requestedSheetName,
    available: titles,
    fallback,
  });
  return fallback;
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
    const resolvedSheetName = await resolveSheetTitle(accessToken, spreadsheetId, sheetName);

    // Format rows for Google Sheets API
    // Column order: A=LotNum, B=Title, C=Description, D=LowEst, E=HighEst, F=StartPrice, G=Condition, H=Consignor, I=Height, J=Width, K=Depth, L=Dimension Unit, M=Weight, N=Weight Unit, O=Category
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
      row.weightUnit || '',
      row.category || ''
    ]);

    // Append rows to the sheet (15 columns: A:O)
    // Google Sheets API expects: /values/{range}:append
    // Some accounts/sheets can be picky about quoting in the range, so we try a couple of safe variants.
    const cleanedSheetName = (resolvedSheetName || '').trim();
    const rangeCandidates = [
      `${cleanedSheetName}!A:O`,
      `'${cleanedSheetName.replace(/'/g, "''")}'!A:O`,
    ];

    const tryAppend = async (rangeA1: string) => {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      });
    };

    let response: Response | null = null;
    for (const candidate of rangeCandidates) {
      console.log('Trying append range:', candidate);
      response = await tryAppend(candidate);
      if (response.ok) break;

      const maybeText = await response.text();
      // Recreate the Response for later error handling if needed
      response = new Response(maybeText, { status: response.status, headers: response.headers });

      // Only retry on the specific range parsing error; otherwise fail fast.
      if (response.status !== 400 || !maybeText.includes('Unable to parse range')) {
        break;
      }
    }

    if (!response) throw new Error('Failed to call Google Sheets API');

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Sheets API error:', response.status, errorText);
      console.error('Resolved sheet name:', resolvedSheetName);
      console.error('Service account email (share your sheet with this):', serviceAccount?.client_email);

      throw new Error(
        `Google Sheets API error: ${response.status} - ${errorText}\n\n` +
        `Fix: Verify the sheet tab name exists (requested: "${sheetName}") and share the spreadsheet with this service account email as Editor: ${serviceAccount?.client_email}`
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
