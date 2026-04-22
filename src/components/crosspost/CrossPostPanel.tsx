// src/components/crosspost/CrossPostPanel.tsx
import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Plus, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { saveListing, type GeneratedListing } from "@/lib/api/listings";
import { PLATFORM_ADAPTERS, type PlatformAdapter } from "@/lib/crosspost/registry";
import { reformatListing, dispatchPlatform } from "@/lib/crosspost/api";

type PlatformStatus = 'idle' | 'reformatting' | 'posting' | 'done' | 'failed';

interface PlatformRowState {
  checked: boolean;
  status: PlatformStatus;
  previewOpen: boolean;
  previewLoading: boolean;
  preview: Record<string, any> | null;
  error: string | null;
}

interface CrossPostPanelProps {
  listing: GeneratedListing;
  images: string[];       // Supabase public URLs already uploaded
  projectId?: string;
  listingId?: string;     // If already saved to listings table
}

export function CrossPostPanel({ listing, images, projectId, listingId: initialListingId }: CrossPostPanelProps) {
  const [rows, setRows] = useState<Record<string, PlatformRowState>>(() =>
    Object.fromEntries(
      PLATFORM_ADAPTERS.map(p => [p.id, {
        checked: false, status: 'idle', previewOpen: false,
        previewLoading: false, preview: null, error: null,
      }])
    )
  );
  const [savedListingId, setSavedListingId] = useState<string | null>(initialListingId ?? null);
  const [posting, setPosting] = useState(false);

  // Real-time: track crosspost_jobs status updates
  useEffect(() => {
    if (!savedListingId) return;
    const channel = supabase
      .channel(`crosspost_${savedListingId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'crosspost_jobs',
        filter: `listing_id=eq.${savedListingId}`,
      }, (payload) => {
        const job = payload.new as { platform: string; status: string; error_log: string | null };
        setRows(prev => ({
          ...prev,
          [job.platform]: {
            ...prev[job.platform],
            status: job.status === 'completed' ? 'done'
                  : job.status === 'failed' ? 'failed'
                  : 'posting',
            error: job.error_log ?? null,
          },
        }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [savedListingId]);

  const checkedCount = Object.values(rows).filter(r => r.checked).length;

  function updateRow(id: string, patch: Partial<PlatformRowState>) {
    setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function ensureListingSaved(): Promise<string> {
    if (savedListingId) return savedListingId;
    const saved = await saveListing({
      platform: 'cross-post',
      status: 'draft',
      title: listing.title,
      description: listing.description,
      price: listing.price,
      category: listing.category,
      condition: listing.condition,
      item_specifics: listing.itemSpecifics,
      image_urls: images,
      project_id: projectId,
    });
    setSavedListingId(saved.id);
    return saved.id;
  }

  async function handlePreview(platformId: string) {
    const row = rows[platformId];
    if (row.previewOpen) {
      updateRow(platformId, { previewOpen: false });
      return;
    }
    if (row.preview) {
      updateRow(platformId, { previewOpen: true });
      return;
    }
    updateRow(platformId, { previewLoading: true, previewOpen: true });
    try {
      const formatted = await reformatListing(platformId, listing, images);
      updateRow(platformId, { preview: formatted, previewLoading: false });
    } catch (err) {
      updateRow(platformId, { previewLoading: false, previewOpen: false });
      toast({ title: 'Preview failed', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
    }
  }

  async function handleCrossPost() {
    if (checkedCount === 0) return;
    setPosting(true);

    let listingId: string;
    try {
      listingId = await ensureListingSaved();
    } catch (err) {
      toast({ title: 'Could not save listing', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
      setPosting(false);
      return;
    }

    const targets = PLATFORM_ADAPTERS.filter(p => rows[p.id].checked);

    await Promise.all(targets.map(async (platform) => {
      updateRow(platform.id, { status: 'reformatting', error: null });
      try {
        const formatted = rows[platform.id].preview ?? await reformatListing(platform.id, listing, images);
        updateRow(platform.id, { status: 'posting' });
        const result = await dispatchPlatform(platform.id, formatted, images, listingId, projectId);
        if (result.ok) {
          if (['ebay-batch', 'la-batch', 'denver-batch'].includes(platform.publishType)) {
            updateRow(platform.id, { status: 'done' });
          }
          // For queue/etsy-api, real-time subscription updates status
        } else {
          updateRow(platform.id, { status: 'failed', error: result.error });
        }
      } catch (err) {
        updateRow(platform.id, { status: 'failed', error: err instanceof Error ? err.message : 'Error' });
      }
    }));

    setPosting(false);
    toast({ title: 'Cross-post dispatched', description: `Sent to ${targets.length} platform${targets.length > 1 ? 's' : ''}` });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 mt-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Cross-post this listing</h3>

      <div className="space-y-2">
        {PLATFORM_ADAPTERS.map((platform) => (
          <PlatformRow
            key={platform.id}
            platform={platform}
            state={rows[platform.id]}
            onToggle={(checked) => updateRow(platform.id, { checked })}
            onPreview={() => handlePreview(platform.id)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <Plus className="h-3 w-3" /> add platform
        </button>
        <Button
          size="sm"
          disabled={checkedCount === 0 || posting}
          onClick={handleCrossPost}
        >
          {posting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Cross-post to {checkedCount} platform{checkedCount !== 1 ? 's' : ''} →
        </Button>
      </div>
    </div>
  );
}

function PlatformRow({
  platform,
  state,
  onToggle,
  onPreview,
}: {
  platform: PlatformAdapter;
  state: PlatformRowState;
  onToggle: (checked: boolean) => void;
  onPreview: () => void;
}) {
  const Icon = platform.icon;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2">
        <Checkbox
          checked={state.checked}
          onCheckedChange={(v) => onToggle(Boolean(v))}
          disabled={['reformatting', 'posting', 'done'].includes(state.status)}
        />
        <div className={cn("rounded p-1", platform.bgColor)}>
          <Icon className={cn("h-4 w-4", platform.color)} />
        </div>
        <span className="text-sm font-medium flex-1">{platform.name}</span>
        <StatusBadge status={state.status} />
        <button
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          onClick={onPreview}
        >
          preview {state.previewOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {state.previewOpen && (
        <div className="px-3 pb-3 bg-muted/30 border-t border-border text-xs text-muted-foreground space-y-1">
          {state.previewLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Reformatting for {platform.name}…
            </div>
          ) : state.preview ? (
            <PreviewContent data={state.preview} />
          ) : null}
        </div>
      )}

      {state.status === 'failed' && state.error && (
        <div className="px-3 py-1 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive">
          {state.error}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PlatformStatus }) {
  if (status === 'idle') return <span className="text-xs text-muted-foreground">{''}</span>;
  if (status === 'reformatting') return <span className="flex items-center gap-1 text-xs text-blue-400"><Loader2 className="h-3 w-3 animate-spin" /> reformatting</span>;
  if (status === 'posting') return <span className="flex items-center gap-1 text-xs text-yellow-400"><Clock className="h-3 w-3" /> posting</span>;
  if (status === 'done') return <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle2 className="h-3 w-3" /> done</span>;
  if (status === 'failed') return <span className="flex items-center gap-1 text-xs text-red-400"><XCircle className="h-3 w-3" /> failed</span>;
  return null;
}

function PreviewContent({ data }: { data: Record<string, any> }) {
  const fields = Object.entries(data).filter(([k]) => !['imageUrls'].includes(k));
  return (
    <>
      {fields.slice(0, 6).map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <span className="shrink-0 w-24 text-muted-foreground/70">{key}:</span>
          <span className="truncate">{Array.isArray(value) ? value.join(', ') : String(value ?? '')}</span>
        </div>
      ))}
      {fields.length > 6 && <div className="text-muted-foreground/50">+{fields.length - 6} more fields</div>}
    </>
  );
}
