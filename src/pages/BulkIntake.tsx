import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { generateListing, uploadImage, type GeneratedListing } from "@/lib/api/listings";
import { getNextLotNumber } from "@/lib/crosspost/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Upload } from "lucide-react";

// ── Helpers (outside component) ───────────────────────────────────────────────

// One decode per file: produces the 256px thumbnail AND the divider verdict.
// (Previously each file was decoded twice — thumbnail + divider check — which
// doubled memory pressure on large drops.)
async function processImageFile(file: File): Promise<{ thumb: string; isDivider: boolean }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const size = 256;
      const ratio = Math.min(size / img.width, size / img.height);
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = img.width * ratio;
      thumbCanvas.height = img.height * ratio;
      thumbCanvas.getContext('2d')?.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const thumb = thumbCanvas.toDataURL('image/jpeg', 0.5);

      const divCanvas = document.createElement('canvas');
      divCanvas.width = 256;
      divCanvas.height = 256;
      const divCtx = divCanvas.getContext('2d');
      divCtx?.drawImage(img, 0, 0, 256, 256);
      const data = divCtx?.getImageData(0, 0, 256, 256).data;
      let isDivider = false;
      if (data) {
        const n = data.length / 4;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        const avg = sum / n;
        let varSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const d = (data[i] + data[i + 1] + data[i + 2]) / 3 - avg;
          varSum += d * d;
        }
        isDivider = avg > 200 && varSum / n < 500;
      }
      resolve({ thumb, isDivider });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

// Bounded-concurrency map: large photo drops must not decode hundreds of
// images simultaneously (browser memory spike / hang).
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      done++;
      onProgress?.(done);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LotGroup {
  lot: number;
  imageIndices: number[];
}

interface LotListing {
  generated: GeneratedListing;
  title: string;
  description: string;
  price: number;
}

type LotStatus = 'idle' | 'uploading' | 'generating' | 'publishing' | 'done' | 'error';

// ── Component ─────────────────────────────────────────────────────────────────

export default function BulkIntake() {
  const [files, setFiles] = useState<File[]>([]);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isGrouping, setIsGrouping] = useState(false);
  const [lots, setLots] = useState<LotGroup[]>([]);
  const [lotListings, setLotListings] = useState<Map<number, LotListing>>(new Map());
  // Uploaded image URLs per lot, cached so a retry doesn't re-upload or duplicate
  const [lotUploadedUrls, setLotUploadedUrls] = useState<Map<number, string[]>>(new Map());
  // Photos pulled out of lots (or added after grouping) — held here, never published
  const [unassigned, setUnassigned] = useState<number[]>([]);
  const [ingestProgress, setIngestProgress] = useState<{ done: number; total: number } | null>(null);
  const [groupProgress, setGroupProgress] = useState<{ done: number; total: number } | null>(null);
  const [lotStatus, setLotStatus] = useState<Map<number, LotStatus>>(new Map());
  const [lotErrors, setLotErrors] = useState<Map<number, string>>(new Map());
  const [targetEbay, setTargetEbay] = useState(true);
  const [targetDoa, setTargetDoa] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [projects, setProjects] = useState<{ id: string; name: string; consignor_name: string | null }[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Authoritative running count of loaded files (state reads are stale in callbacks)
  const filesCountRef = useRef(0);
  const [searchParams] = useSearchParams();

  // Fetch projects (la_batches) on mount — same pattern as BatchManager.tsx
  useEffect(() => {
    const fetchProjects = async () => {
      const { data, error } = await supabase
        .from('la_batches')
        .select('id, name, consignor_name')
        .order('updated_at', { ascending: false });
      if (error) {
        console.error('Failed to load projects:', error);
        return;
      }
      const loaded = (data || []).map(p => ({ id: p.id, name: p.name, consignor_name: p.consignor_name ?? null }));
      setProjects(loaded);
      const paramId = searchParams.get('project');
      if (paramId && loaded.some(p => p.id === paramId)) {
        setSelectedBatchId(paramId);
      }
    };
    fetchProjects();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // File drop / select handler — bounded concurrency + progress for large drops
  const handleFiles = useCallback(async (newFiles: File[]) => {
    const imageFiles = newFiles.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setIngestProgress({ done: 0, total: imageFiles.length });
    try {
      const processed = await mapWithConcurrency(
        imageFiles,
        6,
        f => processImageFile(f).catch(() => null),
        done => setIngestProgress({ done, total: imageFiles.length })
      );

      const kept: File[] = [];
      const thumbs: string[] = [];
      let dividers = 0;
      let unreadable = 0;
      processed.forEach((p, i) => {
        if (!p) unreadable++;
        else if (p.isDivider) dividers++;
        else {
          kept.push(imageFiles[i]);
          thumbs.push(p.thumb);
        }
      });
      if (dividers > 0) toast({ title: `${dividers} divider image(s) removed automatically` });
      if (unreadable > 0) {
        toast({ title: `${unreadable} file(s) couldn't be read and were skipped`, variant: 'destructive' });
      }

      const start = filesCountRef.current;
      filesCountRef.current += kept.length;
      setFiles(prev => [...prev, ...kept]);
      setThumbnails(prev => [...prev, ...thumbs]);
      // After grouping, new photos land in the Unassigned pool — drag onto a lot to use
      if (lots.length > 0 && kept.length > 0) {
        setUnassigned(prev => [...prev, ...kept.map((_, k) => start + k)]);
        toast({ title: `${kept.length} photo(s) added to Unassigned — drag onto a lot` });
      }
    } finally {
      setIngestProgress(null);
    }
  }, [lots.length]);

  // Move a photo to another lot, to Unassigned (null), or to a brand-new lot ('new').
  // Blocked on published lots; clears the touched lots' upload cache + status so a
  // retry re-uploads the corrected photo set.
  const movePhoto = useCallback((imageIdx: number, target: number | null | 'new') => {
    if (isPublishing) return;
    const fromLot = lots.findIndex(l => l.imageIndices.includes(imageIdx));
    if (fromLot !== -1 && lotStatus.get(fromLot) === 'done') return;
    if (typeof target === 'number' && (target === fromLot || lotStatus.get(target) === 'done')) return;

    setLots(prev => {
      const next = prev.map((l, i) =>
        i === fromLot ? { ...l, imageIndices: l.imageIndices.filter(x => x !== imageIdx) } :
        i === target ? { ...l, imageIndices: [...l.imageIndices, imageIdx] } : l
      );
      return target === 'new'
        ? [...next, { lot: Math.max(0, ...prev.map(l => l.lot)) + 1, imageIndices: [imageIdx] }]
        : next;
    });
    setUnassigned(prev => {
      const without = prev.filter(x => x !== imageIdx);
      return target === null ? [...without, imageIdx] : without;
    });
    setLotUploadedUrls(prev => {
      const next = new Map(prev);
      if (fromLot !== -1) next.delete(fromLot);
      if (typeof target === 'number') next.delete(target);
      return next;
    });
    setLotStatus(prev => {
      const next = new Map(prev);
      if (fromLot !== -1) next.delete(fromLot);
      if (typeof target === 'number') next.delete(target);
      return next;
    });
  }, [isPublishing, lots, lotStatus]);

  const readDraggedPhoto = (e: React.DragEvent): number | null => {
    const raw = e.dataTransfer.getData('application/x-photo-index');
    if (!raw) return null; // e.g. an OS file drag, not one of our thumbnails
    const idx = Number(raw);
    return Number.isInteger(idx) && idx >= 0 ? idx : null;
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!selectedBatchId) {
      toast({ title: 'Pick a consignor / project first', variant: 'destructive' });
      return;
    }
    const dropped = Array.from(e.dataTransfer.files);
    handleFiles(dropped);
  };

  const handleDropZoneClick = () => {
    if (!selectedBatchId) {
      toast({ title: 'Pick a consignor / project first', variant: 'destructive' });
      return;
    }
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  // Group lots via Gemini vision edge function.
  // Large batches are sent in overlapping chunks: one giant request is slow,
  // can exceed payload/output limits, and degrades grouping quality. Chunks
  // overlap so an item photographed across a boundary still merges into one lot.
  const GROUP_CHUNK_SIZE = 60;
  const GROUP_CHUNK_OVERLAP = 6;

  const handleGroupLots = async () => {
    if (files.length === 0) return;
    setIsGrouping(true);
    try {
      const base64Images = thumbnails.map(t => t.split(',')[1]);

      // Chunk ranges: after the first, each starts GROUP_CHUNK_OVERLAP early
      const ranges: { start: number; end: number }[] = [];
      for (let s = 0; s < base64Images.length; ) {
        const start = s === 0 ? 0 : s - GROUP_CHUNK_OVERLAP;
        const end = Math.min(base64Images.length, s + GROUP_CHUNK_SIZE);
        ranges.push({ start, end });
        s = end;
      }
      if (ranges.length > 1) setGroupProgress({ done: 0, total: ranges.length });

      // imageIdx -> position in mergedLots; overlap images stitch chunk results together
      const assignment = new Map<number, number>();
      const mergedLots: LotGroup[] = [];
      let anyFallback = false;

      for (let c = 0; c < ranges.length; c++) {
        const { start, end } = ranges[c];
        const { data, error } = await supabase.functions.invoke('group-lots-vision', {
          body: { images: base64Images.slice(start, end) },
        });
        if (error) throw error;
        if (!data || !Array.isArray(data.lots)) {
          throw new Error(data?.error || 'Unexpected response from grouping service');
        }
        if (data.fallback) anyFallback = true;

        for (const lot of data.lots as LotGroup[]) {
          const globalIdxs = lot.imageIndices
            .map(i => i + start)
            .filter(i => i >= start && i < end);
          if (globalIdxs.length === 0) continue;
          // If any image was already placed by the previous chunk (overlap),
          // this whole lot joins that existing lot.
          const existing = globalIdxs.map(i => assignment.get(i)).find(v => v !== undefined);
          const pos = existing !== undefined ? existing : mergedLots.length;
          if (existing === undefined) mergedLots.push({ lot: pos + 1, imageIndices: [] });
          for (const gi of globalIdxs) {
            if (!assignment.has(gi)) {
              assignment.set(gi, pos);
              mergedLots[pos].imageIndices.push(gi);
            }
          }
        }
        if (ranges.length > 1) setGroupProgress({ done: c + 1, total: ranges.length });
      }

      const finalLots = mergedLots
        .filter(l => l.imageIndices.length > 0)
        .map((l, i) => ({ lot: i + 1, imageIndices: l.imageIndices }));
      setLots(finalLots);

      if (anyFallback) {
        toast({
          title: 'AI grouping partially unavailable — some photos became single lots',
          description: 'Merge related photos manually before publishing.',
          variant: 'destructive',
        });
      } else {
        toast({ title: `${finalLots.length} lots identified` });
      }
    } catch (err) {
      toast({ title: 'Grouping failed', description: String(err), variant: 'destructive' });
    } finally {
      setIsGrouping(false);
      setGroupProgress(null);
    }
  };

  // Publish all lots
  const handlePublish = async () => {
    if (!targetEbay && !targetDoa) {
      toast({ title: 'Select at least one platform', variant: 'destructive' });
      return;
    }
    if (targetEbay && !selectedBatchId) {
      toast({ title: 'Select an eBay batch/project', variant: 'destructive' });
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    setIsPublishing(true);

    // Clear stale errors but keep 'done' statuses so a retry skips finished lots
    setLotErrors(new Map());

    let successCount = 0;
    let failCount = 0;

    // Continue each table's lot sequence — Gemini's lot labels restart at 1 every
    // session and must never be used as DB lot numbers (duplicates hide lots and
    // collide on the DOA agent run). Fetched fresh per publish so retries stay correct.
    let nextEbayLot = targetEbay ? await getNextLotNumber('ebay_batch_rows', selectedBatchId) : 0;
    let nextDenverLot = targetDoa && selectedBatchId ? await getNextLotNumber('denver_batch_rows', selectedBatchId) : 1;

    for (let lotIdx = 0; lotIdx < lots.length; lotIdx++) {
      const lot = lots[lotIdx];

      // Emptied by photo edits — not an error, just nothing to publish
      if (lot.imageIndices.length === 0) continue;

      if (lotStatus.get(lotIdx) === 'done') {
        successCount++;
        continue;
      }

      const updateStatus = (status: LotStatus) =>
        setLotStatus(prev => new Map(prev).set(lotIdx, status));
      const setError = (msg: string) =>
        setLotErrors(prev => new Map(prev).set(lotIdx, msg));

      try {
        // 1. Upload images (reuse cached URLs on retry)
        updateStatus('uploading');
        let uploadedUrls = lotUploadedUrls.get(lotIdx);
        if (!uploadedUrls) {
          const lotFiles = lot.imageIndices.map(i => files[i]).filter(Boolean);
          if (lotFiles.length === 0) {
            throw new Error('No valid photos in this lot');
          }
          uploadedUrls = await Promise.all(lotFiles.map(uploadImage));
          const urls = uploadedUrls;
          setLotUploadedUrls(prev => new Map(prev).set(lotIdx, urls));
        }

        // 2. Generate or use existing edits
        updateStatus('generating');
        const existingListing = lotListings.get(lotIdx);
        let listing: GeneratedListing;
        if (existingListing) {
          listing = {
            ...existingListing.generated,
            title: existingListing.title,
            description: existingListing.description,
            price: existingListing.price,
          };
        } else {
          if (targetEbay) {
            listing = await generateListing('ebay', uploadedUrls);
          } else {
            listing = await generateListing('denver', uploadedUrls);
          }
          setLotListings(prev => {
            const next = new Map(prev);
            next.set(lotIdx, {
              generated: listing,
              title: listing.title,
              description: listing.description,
              price: listing.price ?? listing.startingBid ?? 0,
            });
            return next;
          });
        }

        // 3. Publish
        updateStatus('publishing');

        if (targetEbay) {
          const { data: rowData, error: insertError } = await supabase
            .from('ebay_batch_rows')
            .insert({
              batch_id: selectedBatchId,
              lot_number: nextEbayLot,
              title: listing.title || '',
              description: listing.description || '',
              price: listing.price || 0,
              category: listing.categoryId ? String(listing.categoryId) : (listing.category || ''),
              condition: listing.condition || '',
              item_specifics: listing.itemSpecifics || {},
              image_urls: uploadedUrls,
              shipping_type: 'flat',
              shipping_cost: 9.98,
              handling_time: 3,
              returns_accepted: true,
              return_period: 30,
              return_shipping: 'Buyer',
              promotion_rate: 0,
              promotion_type: 'flat',
              custom_sku: null,
              injected_correction_ids: listing.injectedCorrectionIds?.length
                ? listing.injectedCorrectionIds
                : null,
              created_by: user?.id,
            })
            .select()
            .single();
          if (insertError) throw insertError;
          nextEbayLot++;
          if (listing.injectedCorrectionIds?.length && rowData) {
            // Supabase builders are lazy — without .then() the request never fires
            supabase.rpc('record_correction_injections', {
              p_row_id: String(rowData.id),
              p_platform: 'ebay',
              p_ids: listing.injectedCorrectionIds,
            }).then(({ error }) => {
              if (error) console.warn('record_correction_injections skipped:', error.message);
            });
          }
        }

        if (targetDoa) {
          const { error: doaError } = await supabase.from('denver_batch_rows').insert({
            batch_id: selectedBatchId || null,
            lot_number: nextDenverLot,
            title: (listing.title || '').substring(0, 100),
            description: listing.description || '',
            starting_bid: listing.startingBid ?? listing.price ?? 0,
            image_urls: uploadedUrls,
            status: 'pending',
            created_by: user?.id ?? null,
          });
          if (doaError) throw doaError;
          nextDenverLot++;
        }

        updateStatus('done');
        successCount++;
      } catch (err) {
        updateStatus('error');
        setError(String(err));
        failCount++;
      }
    }

    setIsPublishing(false);
    if (failCount === 0) {
      toast({
        title: `Published ${successCount} lots`,
        description: 'Workspace cleared — ready for the next batch.',
      });
      resetWorkspace();
    } else {
      toast({
        title: `${successCount} lots published, ${failCount} failed`,
        description: 'Fix the errors shown on each lot, then publish again — finished lots are skipped.',
        variant: 'destructive',
      });
    }
  };

  // Full reset after a clean publish — keeps the selected consignor/project
  const resetWorkspace = () => {
    setFiles([]);
    setThumbnails([]);
    setLots([]);
    setLotListings(new Map());
    setLotStatus(new Map());
    setLotErrors(new Map());
    setLotUploadedUrls(new Map());
    setUnassigned([]);
    filesCountRef.current = 0;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const renderPhoto = (i: number, locked: boolean, showRemove: boolean) => (
    <div key={i} className="relative group">
      <img
        src={thumbnails[i]}
        alt={`Photo ${i + 1}`}
        draggable={!locked}
        onDragStart={e => e.dataTransfer.setData('application/x-photo-index', String(i))}
        className={`h-20 w-20 object-cover rounded border ${locked ? '' : 'cursor-grab active:cursor-grabbing'}`}
      />
      {!locked && showRemove && (
        <button
          type="button"
          onClick={() => movePhoto(i, null)}
          title="Remove from lot"
          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs leading-none"
        >
          ×
        </button>
      )}
    </div>
  );

  const dropOnLot = (target: number | null | 'new') => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const idx = readDraggedPhoto(e);
    if (idx !== null) movePhoto(idx, target);
  };

  const allowDrop = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();

  const publishableCount = lots.filter(l => l.imageIndices.length > 0).length;

  return (
    <MainLayout title="Bulk Intake" subtitle="Drop photos, group into lots, publish">
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Consignor / Project picker — must select before dropping photos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Session Consignor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Select consignor / project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.consignor_name ? `${p.consignor_name} — ${p.name}` : p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedBatchId && (() => {
                const active = projects.find(p => p.id === selectedBatchId);
                return active ? (
                  <span className="text-sm text-muted-foreground">
                    {active.consignor_name
                      ? <><span className="font-medium text-foreground">{active.consignor_name}</span> · {active.name}</>
                      : <span className="font-medium text-foreground">{active.name}</span>}
                  </span>
                ) : null;
              })()}
            </div>
            {!selectedBatchId && (
              <p className="text-xs text-muted-foreground mt-2">
                All lots from this session will be grouped under the selected project. Create projects in <strong>Projects</strong>.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Drop zone */}
        <Card>
          <CardContent className="p-0">
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                selectedBatchId
                  ? 'border-muted-foreground/25 cursor-pointer hover:border-primary/50'
                  : 'border-muted-foreground/15 opacity-50 cursor-not-allowed'
              }`}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={handleDropZoneClick}
            >
              <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              {selectedBatchId ? (
                <>
                  <p className="text-lg font-medium">Drop estate sale photos here</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {ingestProgress
                      ? `Processing photos… ${ingestProgress.done}/${ingestProgress.total}`
                      : lots.length > 0
                      ? 'New photos land in Unassigned below — drag them onto a lot.'
                      : 'Drag & drop or click to select. Divider images auto-removed.'}
                  </p>
                </>
              ) : (
                <p className="text-lg font-medium text-muted-foreground">Select a consignor above to unlock</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleInputChange}
              />
            </div>
          </CardContent>
        </Card>

        {/* Thumbnail strip — shown after files are loaded */}
        {files.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">{files.length} photos loaded</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mb-4">
                {thumbnails.map((thumb, i) => (
                  <img
                    key={i}
                    src={thumb}
                    className="h-16 w-16 object-cover rounded border"
                    alt={`Photo ${i + 1}`}
                  />
                ))}
              </div>
              <Button
                onClick={handleGroupLots}
                disabled={isGrouping || lots.length > 0}
              >
                {isGrouping ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {groupProgress ? `Grouping… ${groupProgress.done}/${groupProgress.total}` : 'Grouping...'}
                  </>
                ) : (
                  'Group into Lots'
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Lot cards — shown after grouping */}
        {lots.length > 0 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{publishableCount} Lots</h2>
              <p className="text-xs text-muted-foreground">
                Drag photos between lots to fix the grouping. Hover a photo and click × to pull it out.
              </p>
            </div>
            {lots.map((lot, lotIdx) => {
              const status = lotStatus.get(lotIdx) ?? 'idle';
              const listing = lotListings.get(lotIdx);
              const err = lotErrors.get(lotIdx);
              const locked = status === 'done' || isPublishing;
              const isEmpty = lot.imageIndices.length === 0;

              return (
                <Card
                  key={lotIdx}
                  onDragOver={locked ? undefined : allowDrop}
                  onDrop={locked ? undefined : dropOnLot(lotIdx)}
                  className={isEmpty ? 'opacity-60 border-dashed' : undefined}
                >
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm">
                      Lot {lot.lot}
                      {isEmpty && <span className="ml-2 font-normal text-muted-foreground">(empty — will be skipped)</span>}
                    </CardTitle>
                    {status !== 'idle' && (
                      <Badge
                        variant={
                          status === 'done'
                            ? 'default'
                            : status === 'error'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {status === 'uploading'
                          ? 'Uploading...'
                          : status === 'generating'
                          ? 'Generating...'
                          : status === 'publishing'
                          ? 'Publishing...'
                          : status === 'done'
                          ? 'Done'
                          : 'Error'}
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Thumbnails for this lot — draggable, removable */}
                    <div className="flex gap-2 flex-wrap min-h-[2rem]">
                      {isEmpty ? (
                        <p className="text-xs text-muted-foreground italic">Drag photos here or leave empty to skip.</p>
                      ) : (
                        lot.imageIndices.map(i => renderPhoto(i, locked, true))
                      )}
                    </div>

                    {/* Editable fields if listing has been generated */}
                    {listing && (
                      <>
                        <div>
                          <Label className="text-xs">Title</Label>
                          <Input
                            value={listing.title}
                            onChange={e =>
                              setLotListings(prev => {
                                const next = new Map(prev);
                                next.set(lotIdx, { ...listing, title: e.target.value });
                                return next;
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Description</Label>
                          <Textarea
                            value={listing.description}
                            rows={3}
                            onChange={e =>
                              setLotListings(prev => {
                                const next = new Map(prev);
                                next.set(lotIdx, { ...listing, description: e.target.value });
                                return next;
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Price / Starting Bid</Label>
                          <Input
                            type="number"
                            value={listing.price}
                            onChange={e =>
                              setLotListings(prev => {
                                const next = new Map(prev);
                                next.set(lotIdx, { ...listing, price: Number(e.target.value) });
                                return next;
                              })
                            }
                          />
                        </div>
                      </>
                    )}

                    {err && <p className="text-xs text-destructive">{err}</p>}
                  </CardContent>
                </Card>
              );
            })}

            {/* New-lot drop target — split an item Gemini wrongly merged */}
            {!isPublishing && (
              <div
                onDragOver={allowDrop}
                onDrop={dropOnLot('new')}
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center text-sm text-muted-foreground"
              >
                Drag a photo here to start a new lot
              </div>
            )}

            {/* Unassigned pool — removed or late-added photos, never published */}
            {unassigned.length > 0 && (
              <Card onDragOver={allowDrop} onDrop={dropOnLot(null)}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Unassigned ({unassigned.length})
                    <span className="ml-2 font-normal text-muted-foreground">
                      — held out of all lots; drag onto a lot to use
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 flex-wrap">
                    {unassigned.map(i => renderPhoto(i, isPublishing, false))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Publish controls — shown after grouping */}
        {lots.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Publish</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-6">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="ebay"
                    checked={targetEbay}
                    onCheckedChange={v => setTargetEbay(!!v)}
                  />
                  <Label htmlFor="ebay">eBay</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="doa"
                    checked={targetDoa}
                    onCheckedChange={v => setTargetDoa(!!v)}
                  />
                  <Label htmlFor="doa">Denver Online Auctions</Label>
                </div>
              </div>

              <Button
                onClick={handlePublish}
                disabled={isPublishing || publishableCount === 0}
                className="w-full"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  `Generate & Publish ${publishableCount} Lots`
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
