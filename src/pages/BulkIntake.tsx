import React, { useState, useCallback, useEffect, useRef } from 'react';
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { generateListing, uploadImage, type GeneratedListing } from "@/lib/api/listings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Upload, Layers } from "lucide-react";

// ── Helpers (outside component) ───────────────────────────────────────────────

async function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const size = 256;
      const ratio = Math.min(size / img.width, size / img.height);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.5));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

async function isLikelyDivider(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      canvas.width = 256;
      canvas.height = 256;
      ctx?.drawImage(img, 0, 0, 256, 256);
      const data = ctx?.getImageData(0, 0, 256, 256).data;
      if (!data) return resolve(false);
      const pixels: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        pixels.push((data[i] + data[i + 1] + data[i + 2]) / 3);
      }
      const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
      const variance = pixels.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / pixels.length;
      resolve(avg > 200 && variance < 500);
    };
    img.onerror = () => resolve(false);
    img.src = URL.createObjectURL(file);
  });
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
  const [lotStatus, setLotStatus] = useState<Map<number, LotStatus>>(new Map());
  const [lotErrors, setLotErrors] = useState<Map<number, string>>(new Map());
  const [targetEbay, setTargetEbay] = useState(true);
  const [targetDoa, setTargetDoa] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch projects (la_batches) on mount — same pattern as BatchManager.tsx
  useEffect(() => {
    const fetchProjects = async () => {
      const { data, error } = await supabase
        .from('la_batches')
        .select('id, name')
        .order('updated_at', { ascending: false });
      if (error) {
        console.error('Failed to load projects:', error);
        return;
      }
      setProjects((data || []).map(p => ({ id: p.id, name: p.name })));
    };
    fetchProjects();
  }, []);

  // File drop / select handler
  const handleFiles = useCallback(async (newFiles: File[]) => {
    const imageFiles = newFiles.filter(f => f.type.startsWith('image/'));
    const dividerChecks = await Promise.all(imageFiles.map(isLikelyDivider));
    const filtered = imageFiles.filter((_, i) => !dividerChecks[i]);
    if (filtered.length < imageFiles.length) {
      toast({ title: `${imageFiles.length - filtered.length} divider image(s) removed automatically` });
    }
    const thumbs = await Promise.all(filtered.map(generateThumbnail));
    setFiles(prev => [...prev, ...filtered]);
    setThumbnails(prev => [...prev, ...thumbs]);
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    handleFiles(dropped);
  };

  const handleDropZoneClick = () => {
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  // Group lots via Gemini vision edge function
  const handleGroupLots = async () => {
    if (files.length === 0) return;
    setIsGrouping(true);
    try {
      const base64Images = await Promise.all(files.map(fileToBase64));
      const { data, error } = await supabase.functions.invoke('group-lots-vision', {
        body: { images: base64Images },
      });
      if (error) throw error;
      setLots(data.lots);
      toast({ title: `${data.lots.length} lots identified` });
    } catch (err) {
      toast({ title: 'Grouping failed', description: String(err), variant: 'destructive' });
    } finally {
      setIsGrouping(false);
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

    // Reset status maps
    setLotStatus(new Map());
    setLotErrors(new Map());

    for (let lotIdx = 0; lotIdx < lots.length; lotIdx++) {
      const lot = lots[lotIdx];
      const lotNumber = lot.lot;

      const updateStatus = (status: LotStatus) =>
        setLotStatus(prev => new Map(prev).set(lotIdx, status));
      const setError = (msg: string) =>
        setLotErrors(prev => new Map(prev).set(lotIdx, msg));

      try {
        // 1. Upload images
        updateStatus('uploading');
        const lotFiles = lot.imageIndices.map(i => files[i]);
        const uploadedUrls = await Promise.all(lotFiles.map(uploadImage));

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
              lot_number: lotNumber,
              title: listing.title || '',
              description: listing.description || '',
              price: listing.price || 0,
              category: listing.categoryId ? String(listing.categoryId) : (listing.category || ''),
              condition: listing.condition || '',
              item_specifics: listing.itemSpecifics || {},
              image_urls: uploadedUrls,
              shipping_type: 'calculated',
              shipping_cost: 0,
              handling_time: 3,
              returns_accepted: true,
              return_period: '30 Days',
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
          if (listing.injectedCorrectionIds?.length && rowData) {
            supabase.rpc('record_correction_injections', {
              p_row_id: String(rowData.id),
              p_platform: 'ebay',
              p_ids: listing.injectedCorrectionIds,
            });
          }
        }

        if (targetDoa) {
          // Schema confirmed from src/lib/crosspost/api.ts buildDenverBatchRow:
          // batch_id (required), lot_number (integer), title, description,
          // starting_bid, image_urls, status
          // Note: condition and created_by are NOT in the confirmed schema — omitted.
          const { error: doaError } = await supabase.from('denver_batch_rows').insert({
            batch_id: selectedBatchId || null,
            lot_number: lotNumber,
            title: (listing.title || '').substring(0, 100),
            description: listing.description || '',
            starting_bid: listing.startingBid ?? listing.price ?? 0,
            image_urls: uploadedUrls,
            status: 'pending',
          });
          if (doaError) throw doaError;
        }

        updateStatus('done');
      } catch (err) {
        updateStatus('error');
        setError(String(err));
      }
    }

    setIsPublishing(false);
    toast({ title: `Published ${lots.length} lots` });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <MainLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <Layers className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Bulk Intake</h1>
        </div>

        {/* Drop zone */}
        <Card>
          <CardContent className="p-0">
            <div
              className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={handleDropZoneClick}
            >
              <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium">Drop estate sale photos here</p>
              <p className="text-sm text-muted-foreground mt-1">
                Drag &amp; drop or click to select. Divider images auto-removed.
              </p>
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
                    Grouping...
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
            <h2 className="text-lg font-semibold">{lots.length} Lots</h2>
            {lots.map((lot, lotIdx) => {
              const status = lotStatus.get(lotIdx) ?? 'idle';
              const listing = lotListings.get(lotIdx);
              const err = lotErrors.get(lotIdx);

              return (
                <Card key={lotIdx}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm">Lot {lot.lot}</CardTitle>
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
                    {/* Thumbnails for this lot */}
                    <div className="flex gap-2 flex-wrap">
                      {lot.imageIndices.map(i => (
                        <img
                          key={i}
                          src={thumbnails[i]}
                          className="h-20 w-20 object-cover rounded border"
                          alt=""
                        />
                      ))}
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

              {targetEbay && (
                <div>
                  <Label className="text-xs mb-1 block">eBay Batch / Project</Label>
                  <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Select batch..." />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                onClick={handlePublish}
                disabled={isPublishing || lots.length === 0}
                className="w-full"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  `Generate & Publish ${lots.length} Lots`
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
