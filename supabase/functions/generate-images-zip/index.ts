import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// CRC32 lookup table
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildLocalFileHeader(nameBytes: Uint8Array, crcVal: number, size: number): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.length);
  const v = new DataView(header.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, 0, true);
  v.setUint16(8, 0, true); // stored (no compression)
  v.setUint16(10, 0, true);
  v.setUint16(12, 0, true);
  v.setUint32(14, crcVal, true);
  v.setUint32(18, size, true);
  v.setUint32(22, size, true);
  v.setUint16(26, nameBytes.length, true);
  v.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

function buildCentralDirEntry(nameBytes: Uint8Array, crcVal: number, size: number, localOffset: number): Uint8Array {
  const entry = new Uint8Array(46 + nameBytes.length);
  const v = new DataView(entry.buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, 20, true);
  v.setUint16(8, 0, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, 0, true);
  v.setUint16(14, 0, true);
  v.setUint32(16, crcVal, true);
  v.setUint32(20, size, true);
  v.setUint32(24, size, true);
  v.setUint16(28, nameBytes.length, true);
  v.setUint16(30, 0, true);
  v.setUint16(32, 0, true);
  v.setUint16(34, 0, true);
  v.setUint16(36, 0, true);
  v.setUint32(38, 0, true);
  v.setUint32(42, localOffset, true);
  entry.set(nameBytes, 46);
  return entry;
}

function buildEndOfCentralDir(entryCount: number, centralDirSize: number, centralDirOffset: number): Uint8Array {
  const eocdr = new Uint8Array(22);
  const v = new DataView(eocdr.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(4, 0, true);
  v.setUint16(6, 0, true);
  v.setUint16(8, entryCount, true);
  v.setUint16(10, entryCount, true);
  v.setUint32(12, centralDirSize, true);
  v.setUint32(16, centralDirOffset, true);
  v.setUint16(20, 0, true);
  return eocdr;
}

async function fetchImageWithRetry(url: string, retries = 5): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      if (buf.byteLength === 0) throw new Error('Empty response');
      return new Uint8Array(buf);
    } catch (err) {
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { batch_id, platform } = await req.json();
    if (!batch_id) {
      return new Response(JSON.stringify({ error: 'batch_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const table = platform === 'ebay' ? 'ebay_batch_rows'
                : platform === 'denver' ? 'denver_batch_rows'
                : 'la_batch_rows';

    const { data: rows, error: fetchError } = await supabase
      .from(table)
      .select('lot_number, image_urls')
      .eq('batch_id', batch_id)
      .order('lot_number', { ascending: true });

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ error: 'No rows found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Build image list
    const imageItems: { url: string; filename: string }[] = [];
    for (const row of rows) {
      const urls = (row.image_urls || []) as string[];
      for (let i = 0; i < urls.length; i++) {
        const paddedIndex = (i + 1).toString().padStart(2, '0');
        imageItems.push({ url: urls[i], filename: `${row.lot_number}_${paddedIndex}.jpg` });
      }
    }

    console.log(`Streaming ZIP for ${imageItems.length} images, batch ${batch_id}`);

    const encoder = new TextEncoder();

    // Stream the ZIP: write local file entries one at a time, then central directory at the end.
    // This keeps memory usage to ~1 image at a time.
    const stream = new ReadableStream({
      async start(controller) {
        const centralEntries: Uint8Array[] = [];
        let offset = 0;
        let successCount = 0;
        let failCount = 0;

        for (let idx = 0; idx < imageItems.length; idx++) {
          const item = imageItems[idx];
          const data = await fetchImageWithRetry(item.url);
          if (!data) {
            failCount++;
            console.warn(`Failed after retries: ${item.filename}`);
            continue;
          }

          successCount++;
          const nameBytes = encoder.encode(item.filename);
          const crcVal = crc32(data);

          // Write local file header
          const localHeader = buildLocalFileHeader(nameBytes, crcVal, data.length);
          controller.enqueue(localHeader);

          // Write file data
          controller.enqueue(data);

          // Record central dir entry for later
          centralEntries.push(buildCentralDirEntry(nameBytes, crcVal, data.length, offset));
          offset += localHeader.length + data.length;

          // Log progress every 100 images
          if (successCount % 100 === 0) {
            console.log(`Progress: ${successCount}/${imageItems.length} images streamed`);
          }
        }

        // Write central directory
        const centralDirOffset = offset;
        let centralDirSize = 0;
        for (const entry of centralEntries) {
          controller.enqueue(entry);
          centralDirSize += entry.length;
        }

        // Write end of central directory
        controller.enqueue(buildEndOfCentralDir(successCount, centralDirSize, centralDirOffset));

        console.log(`ZIP complete: ${successCount} succeeded, ${failCount} failed out of ${imageItems.length}`);
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="images-${batch_id.slice(0, 8)}.zip"`,
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (err) {
    console.error('Error generating ZIP:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
