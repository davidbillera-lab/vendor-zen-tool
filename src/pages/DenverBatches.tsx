import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Loader2, RefreshCw, CheckCircle2, Clock, XCircle,
  Package, ChevronDown, ChevronUp, Zap, Cloud,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface LotCounts {
  pending: number;
  completed: number;
  failed: number;
  total: number;
}

interface FailedLot {
  id: string;
  lot_number: string | null;
  title: string | null;
  error_message: string | null;
}

interface Batch {
  id: string;
  name: string;
  created_at: string;
  doa_auction_url: string | null;
  counts: LotCounts;
  failedLots: FailedLot[];
}

const DOA_URL_STORAGE_KEY = "resalehub_doa_url";
const REFRESH_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DenverBatches() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [triggerBatch, setTriggerBatch] = useState<Batch | null>(null);
  const [doaUrl, setDoaUrl] = useState(() => localStorage.getItem(DOA_URL_STORAGE_KEY) || "");
  const [triggering, setTriggering] = useState(false);

  const loadBatches = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const { data: batchRows, error } = await supabase
        .from("la_batches")
        .select("id, name, created_at, platforms")
        .contains("platforms", ["denver"])
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const results = await Promise.allSettled(
        (batchRows || []).map(async (b) => {
          const { data: lots } = await supabase
            .from("denver_batch_rows")
            .select("id, status, lot_number, title")
            .eq("batch_id", b.id);

          const counts: LotCounts = { pending: 0, completed: 0, failed: 0, total: 0 };
          const failedLots: FailedLot[] = [];

          for (const lot of lots || []) {
            counts.total++;
            if (lot.status === "pending") counts.pending++;
            else if (lot.status === "completed") counts.completed++;
            else if (lot.status === "failed") {
              counts.failed++;
              failedLots.push({
                id: lot.id,
                lot_number: lot.lot_number,
                title: lot.title,
                error_message: null,
              });
            }
          }

          return { ...b, doa_auction_url: null, counts, failedLots } as Batch;
        })
      );

      const enriched: Batch[] = results
        .filter((r): r is PromiseFulfilledResult<Batch> => r.status === "fulfilled")
        .map((r) => r.value);

      setBatches(enriched);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (!silent) toast({ title: "Error loading batches", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  useEffect(() => {
    const interval = setInterval(() => loadBatches(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadBatches]);

  async function handleRunAgent() {
    if (!triggerBatch || !doaUrl.trim()) return;

    setTriggering(true);
    localStorage.setItem(DOA_URL_STORAGE_KEY, doaUrl.trim());

    try {
      // Invoke the Supabase edge function — it saves the URL, resets lots,
      // and dispatches the GitHub Actions workflow automatically.
      const { data, error } = await supabase.functions.invoke("trigger-doa-agent", {
        body: { batch_id: triggerBatch.id, doa_url: doaUrl.trim() },
      });

      if (error) throw error;

      toast({
        title: "Agent dispatched to the cloud!",
        description: data?.message ?? `${data?.pending_lots ?? 0} lots queued. GitHub Actions is filling them now.`,
      });

      setTriggerBatch(null);
      loadBatches(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to trigger agent", description: message, variant: "destructive" });
    } finally {
      setTriggering(false);
    }
  }

  if (loading) {
    return (
      <MainLayout title="Denver Batches" subtitle="DOA automation dashboard">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Denver Batches" subtitle="DOA automation dashboard">
      <div className="space-y-6">

        {/* Cloud agent info bar */}
        <CloudAgentBanner />

        {/* Header row */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {batches.length} batch{batches.length !== 1 ? "es" : ""} · auto-refreshes every 10s
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadBatches(true)}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Batch cards */}
        {batches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <Package className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No Denver batches found.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a batch in the Create Listing page with the Denver platform selected.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {batches.map((batch) => (
              <BatchCard
                key={batch.id}
                batch={batch}
                onRunAgent={() => setTriggerBatch(batch)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Push to DOA dialog */}
      <Dialog open={!!triggerBatch} onOpenChange={(open) => !open && setTriggerBatch(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Push to DOA</DialogTitle>
            <DialogDescription>
              GitHub Actions will log in to DOA and fill each lot automatically in the cloud.
              No local server required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 p-3 text-sm text-blue-800 dark:text-blue-300">
              <Cloud className="inline h-4 w-4 mr-1.5" />
              <strong>Cloud-powered.</strong> The agent runs on GitHub Actions — no terminal needed.
              Lots update in real time as they complete.
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">DOA EditAuction URL</label>
              <Input
                placeholder="https://denveronlineauctions.com/sub-admin/EditAuction?id=..."
                value={doaUrl}
                onChange={(e) => setDoaUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRunAgent()}
              />
              <p className="text-xs text-muted-foreground">
                This URL is saved for next time.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1"
                onClick={handleRunAgent}
                disabled={!doaUrl.trim() || triggering}
              >
                {triggering ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                {triggering ? "Dispatching…" : "Push to DOA"}
              </Button>
              <Button variant="outline" onClick={() => setTriggerBatch(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

// ---------------------------------------------------------------------------
// Cloud agent info banner
// ---------------------------------------------------------------------------

function CloudAgentBanner() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 px-4 py-3 text-sm">
      <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-blue-500" />
      <span className="text-blue-700 dark:text-blue-400 font-medium">
        <Cloud className="inline h-3.5 w-3.5 mr-1" />
        DOA Agent runs on GitHub Actions — click "Push to DOA" on any batch to start
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch card
// ---------------------------------------------------------------------------

function BatchCard({
  batch,
  onRunAgent,
}: {
  batch: Batch;
  onRunAgent: () => void;
}) {
  const { counts, failedLots } = batch;
  const pct = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
  const allDone = counts.total > 0 && counts.completed === counts.total;
  const [showFailed, setShowFailed] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground truncate">{batch.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(new Date(batch.created_at), "MMM d, yyyy")}
          </p>
        </div>
        {allDone ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> Done
          </span>
        ) : counts.pending > 0 ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600">
            <Clock className="h-3 w-3" /> {counts.pending} pending
          </span>
        ) : null}
      </div>

      {/* Progress bar */}
      {counts.total > 0 && (
        <div className="space-y-1">
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                allDone ? "bg-emerald-500" : "bg-primary"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{counts.completed} / {counts.total} lots complete</p>
        </div>
      )}

      {/* Status breakdown */}
      <div className="flex gap-3 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          {counts.completed} done
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3.5 w-3.5 text-amber-500" />
          {counts.pending} pending
        </span>
        {counts.failed > 0 && (
          <button
            className="flex items-center gap-1 text-red-500 hover:underline"
            onClick={() => setShowFailed((v) => !v)}
          >
            <XCircle className="h-3.5 w-3.5" />
            {counts.failed} failed
            {showFailed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {/* Failed lots detail */}
      {showFailed && failedLots.length > 0 && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-3 space-y-2">
          {failedLots.map((lot) => (
            <div key={lot.id} className="text-xs">
              <span className="font-medium text-red-700 dark:text-red-400">
                {lot.lot_number ? `Lot ${lot.lot_number}` : "Unknown lot"}
                {lot.title ? ` — ${lot.title}` : ""}
              </span>
              {lot.error_message && (
                <p className="text-red-600 dark:text-red-500 mt-0.5">{lot.error_message}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Button
        className="w-full"
        size="sm"
        variant={allDone ? "outline" : "default"}
        onClick={onRunAgent}
        disabled={counts.total === 0}
      >
        <Zap className="h-3.5 w-3.5 mr-1.5" />
        {allDone ? "Re-run Agent" : "Push to DOA"}
      </Button>
    </div>
  );
}
