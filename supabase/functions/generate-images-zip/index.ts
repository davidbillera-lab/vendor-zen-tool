import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Minimal ZIP builder - no external deps needed
// ZIP format: local file headers + data + central directory + end record

function createZipFromFiles(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const centralEntries: Uint8Array[] = [];
  const localEntries: Uint8Array[] = [];
  let offset = 0;

  const encoder = new TextEncoder();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    
    // Local file header (30 bytes + name + data)
    const local = new Uint8Array(30 + nameBytes.length + file.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // compression: stored
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0, true); // mod date
    lv.setUint32(14, crc, true); // crc32
    lv.setUint32(18, file.data.length, true); // compressed size
    lv.setUint32(22, file.data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // name length
    lv.setUint16(28, 0, true); // extra length
    local.set(nameBytes, 30);
    local.set(file.data, 30 + nameBytes.length);
    localEntries.push(local);

    // Central directory entry (46 bytes + name)
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // compression
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, 0, true); // mod date
    cv.setUint32(16, crc, true); // crc32
    cv.setUint32(20, file.data.length, true); // compressed size
    cv.setUint32(24, file.data.length, true); // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // name length
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centralEntries.push(central);

    offset += local.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const c of centralEntries) centralDirSize += c.length;

  // End of central directory (22 bytes)
  const eocdr = new Uint8Array(22);
  const ev = new DataView(eocdr.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // central dir disk
  ev.setUint16(8, files.length, true); // entries on disk
  ev.setUint16(10, files.length, true); // total entries
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirOffset, true);
  ev.setUint16(20, 0, true); // comment length

  // Combine all parts
  const totalSize = offset + centralDirSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const l of localEntries) { result.set(l, pos); pos += l.length; }
  for (const c of centralEntries) { result.set(c, pos); pos += c.length; }
  result.set(eocdr, pos);

  return result;
}

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

async function fetchImageWithRetry(url: string, retries = 5): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      if (buf.byteLength === 0) throw new Error('Empty response');
      return new Uint8Array(buf);
    } catch (err) {
      console.warn(`Attempt ${attempt + 1}/${retries} failed for ${url}:`, err);
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

    // Determine which table to query based on platform
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

    console.log(`Downloading ${imageItems.length} images for batch ${batch_id}...`);

    // Download all images - server-side has no CORS limits
    const CHUNK_SIZE = 30;
    const files: { name: string; data: Uint8Array }[] = [];
    const failed: string[] = [];

    for (let i = 0; i < imageItems.length; i += CHUNK_SIZE) {
      const chunk = imageItems.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map(async (item) => {
          const data = await fetchImageWithRetry(item.url);
          return { name: item.filename, data };
        })
      );

      for (const result of results) {
        if (result.data) {
          files.push({ name: result.name, data: result.data });
        } else {
          failed.push(result.name);
        }
      }
    }

    // Retry failures once more
    if (failed.length > 0) {
      console.log(`Retrying ${failed.length} failed images...`);
      await new Promise(r => setTimeout(r, 2000));
      
      const failedItems = failed.map(name => {
        const item = imageItems.find(i => i.filename === name)!;
        return item;
      });
      
      // Clear failed list and retry
      failed.length = 0;
      
      for (let i = 0; i < failedItems.length; i += 10) {
        const chunk = failedItems.slice(i, i + 10);
        const results = await Promise.all(
          chunk.map(async (item) => {
            const data = await fetchImageWithRetry(item.url, 5);
            return { name: item.filename, data };
          })
        );
        
        for (const result of results) {
          if (result.data) {
            files.push({ name: result.name, data: result.data });
          } else {
            failed.push(result.name);
          }
        }
        
        if (i + 10 < failedItems.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    if (failed.length > 0) {
      console.error(`Still failed after retries: ${failed.join(', ')}`);
    }

    console.log(`Building ZIP with ${files.length}/${imageItems.length} images...`);
    const zipData = createZipFromFiles(files);

    return new Response(zipData, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="images-${batch_id.slice(0, 8)}.zip"`,
        'X-Total-Images': imageItems.length.toString(),
        'X-Success-Count': files.length.toString(),
        'X-Failed-Count': failed.length.toString(),
        'X-Failed-Files': failed.join(','),
      },
    });
  } catch (err) {
    console.error('Error generating ZIP:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
