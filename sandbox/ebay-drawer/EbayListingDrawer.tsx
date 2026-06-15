/**
 * sandbox/ebay-drawer/EbayListingDrawer.tsx
 *
 * eBay Listing Detail Drawer — Phase 1/2 sandbox artifact.
 * STAGED ONLY. Move to src/components/ebay/ when Phase 2 is approved.
 *
 * Shows item photos, core fields, and eBay required/recommended item specifics
 * with missing required fields flagged red. Allows editing specifics in-place
 * before pushing to avoid eBay rejections.
 *
 * Authored as if it lives in src/components/ebay/ — all @/ imports resolve
 * correctly after the file is moved.
 *
 * Props consumed from EbayBatchPanel.tsx's EbayRow interface.
 * Gate behind VITE_FEATURE_EBAY_DRAWER env var (defaults off).
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ImageEditor reused AS-IS — do NOT rebuild crop/rotate/enhance logic.
// It renders as a full-screen Dialog overlay when mounted.
import { ImageEditor } from "@/components/ImageEditor";

import {
  fetchCategoryAspects,
  extractCategoryId,
  mergeAspectsWithSpecifics,
  type AspectMeta,
} from "./ebayCategoryAspects";

// ---------------------------------------------------------------------------
// Feature flag guard — honours VITE_FEATURE_EBAY_DRAWER=true
// ---------------------------------------------------------------------------

const FEATURE_ENABLED = import.meta.env.VITE_FEATURE_EBAY_DRAWER === "true";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal EbayRow shape the drawer cares about.
 * Mirrors the full EbayRow interface in EbayBatchPanel.tsx — kept minimal here
 * so the drawer stays loosely coupled. Extend if the drawer needs more fields.
 */
export interface DrawerEbayRow {
  id: string;
  lot_number: number;
  title: string;
  description: string | null;
  price: number | null;
  category: string | null;
  condition: string | null;
  item_specifics: Record<string, string>;
  image_urls: string[] | null;
  status: string | null;
  custom_sku: string | null;
  // Extended fields shown in core block
  upc: string | null;
  brand: string | null;
  mpn: string | null;
}

export interface EbayListingDrawerProps {
  row: DrawerEbayRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when operator saves edited specifics. Parent should persist to DB. */
  onSaveSpecifics?: (rowId: string, specifics: Record<string, string>) => Promise<void>;
  /** Called when operator clicks Publish. Parent triggers existing publish flow. */
  onPublish?: (rowId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal state shape
// ---------------------------------------------------------------------------

interface AspectField {
  aspect: AspectMeta;
  currentValue: string;
}

type DrawerStatus = "idle" | "loading" | "loaded" | "error";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLive(row: DrawerEbayRow | null): boolean {
  return row?.status === "published";
}

function formatPrice(price: number | null): string {
  if (price == null) return "—";
  return `$${price.toFixed(2)}`;
}

function missingRequired(fields: AspectField[]): AspectField[] {
  return fields.filter((f) => f.aspect.required && !f.currentValue.trim());
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Photo strip — up to 8 thumbnails. Click opens ImageEditor (full-screen overlay). */
function PhotoStrip({
  images,
  readOnly,
  onImagesUpdated,
}: {
  images: string[];
  readOnly: boolean;
  onImagesUpdated: (updated: string[]) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorIndex, setEditorIndex] = useState(0);
  const [workingImages, setWorkingImages] = useState<string[]>(images);

  // Sync if parent images prop changes (e.g. drawer re-opened for different row)
  useEffect(() => {
    setWorkingImages(images);
  }, [images]);

  function openEditor(idx: number) {
    if (readOnly) return;
    setEditorIndex(idx);
    setEditorOpen(true);
  }

  function handleEditorSave(updated: string[]) {
    setWorkingImages(updated);
    onImagesUpdated(updated);
    setEditorOpen(false);
  }

  if (workingImages.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 rounded-md border border-dashed border-muted text-muted-foreground text-sm gap-2">
        <ImageIcon className="h-4 w-4" />
        No photos attached
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {workingImages.slice(0, 8).map((url, idx) => (
          <button
            key={idx}
            onClick={() => openEditor(idx)}
            disabled={readOnly}
            aria-label={`Photo ${idx + 1}${readOnly ? "" : " — click to edit"}`}
            className={cn(
              "relative flex-shrink-0 w-20 h-20 rounded-md overflow-hidden border border-border",
              "bg-muted focus:outline-none focus:ring-2 focus:ring-ring",
              !readOnly && "cursor-pointer hover:border-primary transition-colors"
            )}
          >
            <img
              src={url}
              alt={`Item photo ${idx + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {idx === 0 && (
              <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-black/50 text-white py-0.5">
                Primary
              </span>
            )}
          </button>
        ))}
        {workingImages.length > 8 && (
          <div className="flex-shrink-0 w-20 h-20 rounded-md border border-border bg-muted flex items-center justify-center text-muted-foreground text-xs">
            +{workingImages.length - 8} more
          </div>
        )}
      </div>

      {/* ImageEditor: full-screen Dialog overlay — renders when editorOpen === true */}
      {editorOpen && (
        <ImageEditor
          images={workingImages}
          initialIndex={editorIndex}
          onSave={handleEditorSave}
          onCancel={() => setEditorOpen(false)}
        />
      )}
    </>
  );
}

/** Core info block: title, price, condition, category, SKU */
function CoreBlock({ row }: { row: DrawerEbayRow }) {
  const categoryId = extractCategoryId(row.category);

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div className="col-span-2">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">Title</span>
        <p className="font-medium text-foreground mt-0.5">{row.title || "—"}</p>
      </div>

      <div>
        <span className="text-muted-foreground text-xs uppercase tracking-wide">Price</span>
        <p className="font-semibold text-primary mt-0.5">{formatPrice(row.price)}</p>
      </div>

      <div>
        <span className="text-muted-foreground text-xs uppercase tracking-wide">Condition</span>
        <p className="mt-0.5">{row.condition || "—"}</p>
      </div>

      <div>
        <span className="text-muted-foreground text-xs uppercase tracking-wide">Category ID</span>
        <p className="mt-0.5 font-mono text-xs">{categoryId || "—"}</p>
      </div>

      {row.custom_sku && (
        <div>
          <span className="text-muted-foreground text-xs uppercase tracking-wide">SKU</span>
          <p className="mt-0.5 font-mono text-xs">{row.custom_sku}</p>
        </div>
      )}

      {row.brand && (
        <div>
          <span className="text-muted-foreground text-xs uppercase tracking-wide">Brand</span>
          <p className="mt-0.5">{row.brand}</p>
        </div>
      )}

      {row.upc && (
        <div>
          <span className="text-muted-foreground text-xs uppercase tracking-wide">UPC</span>
          <p className="mt-0.5 font-mono text-xs">{row.upc}</p>
        </div>
      )}
    </div>
  );
}

/** Validation banner: red when required fields missing, green when all filled or live */
function ValidationBanner({
  missing,
  readOnly,
}: {
  missing: number;
  readOnly: boolean;
}) {
  if (readOnly) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-emerald-950 border border-emerald-700 px-3 py-2 text-sm text-emerald-300">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        Live on eBay — read-only view
      </div>
    );
  }

  if (missing === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-emerald-950 border border-emerald-700 px-3 py-2 text-sm text-emerald-300">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        All required specifics filled — ready to publish
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-red-950 border border-red-700 px-3 py-2 text-sm text-red-300">
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <span>
        <strong>{missing} required field{missing !== 1 ? "s" : ""} missing</strong> — eBay will
        reject this listing until all required specifics are filled.
      </span>
    </div>
  );
}

/** A single aspect control — Select for SELECTION_ONLY, Input for FREE_TEXT */
function AspectControl({
  field,
  readOnly,
  onChange,
}: {
  field: AspectField;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const { aspect, currentValue } = field;
  const isEmpty = !currentValue.trim();
  const isBad = aspect.required && isEmpty;
  const isGood = !isEmpty;

  const borderClass = isBad
    ? "border-red-500 ring-red-500/20"
    : isGood
    ? "border-emerald-600"
    : "border-input";

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        {aspect.name}
        {aspect.required && (
          <span className="text-red-400 font-bold" aria-label="Required by eBay">
            *
          </span>
        )}
        {!aspect.required && (
          <span className="text-muted-foreground/50 text-[10px]">(recommended)</span>
        )}
      </label>

      {aspect.mode === "SELECTION_ONLY" && aspect.allowedValues.length > 0 ? (
        <Select
          value={currentValue}
          onValueChange={readOnly ? undefined : onChange}
          disabled={readOnly}
        >
          <SelectTrigger
            className={cn(
              "h-9 text-sm",
              borderClass,
              isBad && "bg-red-950/30 text-red-300 placeholder:text-red-400"
            )}
          >
            <SelectValue placeholder={isBad ? "Required by eBay" : "Select…"} />
          </SelectTrigger>
          <SelectContent>
            {aspect.allowedValues.map((val) => (
              <SelectItem key={val} value={val}>
                {val}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={currentValue}
          onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
          readOnly={readOnly}
          disabled={readOnly}
          placeholder={isBad ? "Required by eBay" : "Enter value…"}
          className={cn(
            "h-9 text-sm",
            borderClass,
            isBad && "bg-red-950/30 text-red-300 placeholder:text-red-400"
          )}
        />
      )}

      {isBad && (
        <p className="text-[11px] text-red-400">Required by eBay for this category</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main drawer component
// ---------------------------------------------------------------------------

export function EbayListingDrawer({
  row,
  open,
  onOpenChange,
  onSaveSpecifics,
  onPublish,
}: EbayListingDrawerProps) {
  const [status, setStatus] = useState<DrawerStatus>("idle");
  const [aspectFields, setAspectFields] = useState<AspectField[]>([]);
  const [workingImages, setWorkingImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const prevRowId = useRef<string | null>(null);

  // Feature flag guard — must come after all hooks to satisfy rules-of-hooks
  if (!FEATURE_ENABLED) return null;

  const live = isLive(row);

  // On open / row change: fetch aspects and seed working state
  useEffect(() => {
    if (!open || !row) {
      prevRowId.current = null; // SF1: reset so re-open for same row re-fetches
      setAspectFields([]);
      setStatus("idle");
      return;
    }

    // Guard: same row already loading/loaded in this open — do not re-fetch
    if (prevRowId.current === row.id) return;
    prevRowId.current = row.id;

    // Snapshot row values — prevents stale-closure surprises in async callbacks
    const rowId = row.id;
    const imageUrls = row.image_urls ?? [];
    const itemSpecifics = row.item_specifics ?? {};
    const category = row.category;

    setWorkingImages(imageUrls);
    setAspectFields([]); // B4: clear prior row's fields immediately on new load

    const categoryId = extractCategoryId(category);
    if (!categoryId) {
      // No category set — show existing specifics as free-text fields
      const fallback: AspectField[] = Object.entries(itemSpecifics).map(
        ([name, value]) => ({
          aspect: { name, required: false, mode: "FREE_TEXT" as const, allowedValues: [] },
          currentValue: value,
        })
      );
      setAspectFields(fallback);
      setStatus("loaded");
      return;
    }

    setStatus("loading");
    fetchCategoryAspects(categoryId)
      .then((result) => {
        if (prevRowId.current !== rowId) return; // B3: stale result — row changed, discard
        if (!result) {
          // Edge fn unavailable — degrade to existing specifics
          const fallback: AspectField[] = Object.entries(itemSpecifics).map(
            ([name, value]) => ({
              aspect: {
                name,
                required: false,
                mode: "FREE_TEXT" as const,
                allowedValues: [],
              },
              currentValue: value,
            })
          );
          setAspectFields(fallback);
        } else {
          const merged = mergeAspectsWithSpecifics(result.aspects, itemSpecifics);
          setAspectFields(merged);
        }
        setStatus("loaded");
      })
      .catch(() => {
        if (prevRowId.current !== rowId) return; // B3: discard stale error
        setStatus("error");
      });
  }, [open, row?.id, row?.image_urls, row?.item_specifics, row?.category]);

  // ---------------------------------------------------------------------------
  // Field updates
  // ---------------------------------------------------------------------------

  const updateField = useCallback((aspectName: string, value: string) => {
    setAspectFields((prev) =>
      prev.map((f) =>
        f.aspect.name === aspectName ? { ...f, currentValue: value } : f
      )
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!row || !onSaveSpecifics) return;
    setSaving(true);
    try {
      const updated: Record<string, string> = {};
      for (const f of aspectFields) {
        if (f.currentValue.trim()) {
          updated[f.aspect.name] = f.currentValue.trim();
        }
      }
      await onSaveSpecifics(row.id, updated);
      onOpenChange(false);
    } catch (err) {
      toast.error("Save failed — check your connection and try again.");
      console.error("[EbayListingDrawer] handleSave error:", err);
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  async function handlePublish() {
    if (!row || !onPublish) return;
    setPublishing(true);
    try {
      // Save specifics first, then publish
      if (onSaveSpecifics) {
        const updated: Record<string, string> = {};
        for (const f of aspectFields) {
          if (f.currentValue.trim()) updated[f.aspect.name] = f.currentValue.trim();
        }
        await onSaveSpecifics(row.id, updated);
      }
      await onPublish(row.id);
      onOpenChange(false);
    } catch (err) {
      toast.error("Publish failed — check your connection and try again.");
      console.error("[EbayListingDrawer] handlePublish error:", err);
    } finally {
      setPublishing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const requiredFields = aspectFields.filter((f) => f.aspect.required);
  const recommendedFields = aspectFields.filter((f) => !f.aspect.required);
  const missing = missingRequired(aspectFields);
  const canPublish = !live && status === "loaded" && missing.length === 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full sm:max-w-xl p-0 flex flex-col",
          "bg-[hsl(20_14%_7%)] border-l border-border"
        )}
        // Override default SheetContent close button positioning (we have our own header)
        aria-describedby="drawer-description"
      >
        {/* ── Sticky header ─────────────────────────────────── */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 border-b border-border bg-[hsl(20_14%_7%)]">
          <div className="min-w-0 flex-1">
            <SheetHeader>
              <SheetTitle className="text-base font-semibold text-foreground leading-tight line-clamp-2">
                {row.title || "Untitled listing"}
              </SheetTitle>
              <SheetDescription id="drawer-description" className="sr-only">
                eBay listing detail for lot {row.lot_number}. Edit required item specifics before publishing.
              </SheetDescription>
            </SheetHeader>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-muted-foreground">Lot #{row.lot_number}</span>
              {live ? (
                <Badge variant="secondary" className="bg-emerald-900 text-emerald-300 text-[10px]">
                  Live
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-amber-900 text-amber-300 text-[10px]">
                  {row.status ?? "staged"}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* ── Scrollable body ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Photos */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Photos
            </h3>
            <PhotoStrip
              images={workingImages}
              readOnly={live}
              onImagesUpdated={setWorkingImages}
            />
          </section>

          {/* Core fields */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Core Fields
            </h3>
            <CoreBlock row={row} />
          </section>

          {/* Validation banner */}
          {status === "loaded" && (
            <ValidationBanner missing={missing.length} readOnly={live} />
          )}

          {/* Aspects loading / error states */}
          {status === "loading" && (
            <div className="text-sm text-muted-foreground animate-pulse">
              Loading eBay category requirements…
            </div>
          )}

          {status === "error" && (
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              Could not load eBay category data. Showing current specifics only.
            </div>
          )}

          {/* Item Specifics — Required */}
          {requiredFields.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Required by eBay
                <span className="ml-1 text-red-400">*</span>
              </h3>
              <div className="space-y-3">
                {requiredFields.map((f) => (
                  <AspectControl
                    key={f.aspect.name}
                    field={f}
                    readOnly={live}
                    onChange={(val) => updateField(f.aspect.name, val)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Item Specifics — Recommended */}
          {recommendedFields.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Recommended
              </h3>
              <div className="space-y-3">
                {recommendedFields.map((f) => (
                  <AspectControl
                    key={f.aspect.name}
                    field={f}
                    readOnly={live}
                    onChange={(val) => updateField(f.aspect.name, val)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Sticky footer ──────────────────────────────────── */}
        <div className="sticky bottom-0 z-10 border-t border-border px-5 py-4 bg-[hsl(20_14%_7%)] flex items-center gap-3">
          {live ? (
            // Read-only: show "View live listing" link only
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              asChild
            >
              <a
                href={`https://www.ebay.com/itm/${row.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View live listing
              </a>
            </Button>
          ) : (
            <>
              {/* Save & close */}
              {onSaveSpecifics && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || publishing}
                >
                  {saving ? "Saving…" : "Save & close"}
                </Button>
              )}

              {/* Publish */}
              {onPublish && (
                <Button
                  size="sm"
                  onClick={handlePublish}
                  disabled={!canPublish || saving || publishing}
                  className={cn(
                    "gap-1.5",
                    canPublish
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                  title={
                    !canPublish
                      ? `Fill ${missing.length} required field${missing.length !== 1 ? "s" : ""} to enable publish`
                      : "Publish to eBay"
                  }
                >
                  {publishing ? "Publishing…" : "Publish to eBay"}
                </Button>
              )}

              {/* Missing count helper text */}
              {missing.length > 0 && (
                <span className="text-xs text-red-400 ml-auto">
                  {missing.length} required field{missing.length !== 1 ? "s" : ""} missing
                </span>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
