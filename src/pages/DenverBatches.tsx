import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Gavel,
  Play,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
  Link,
  ImageIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LotRow {
  id: string;
  lot_number: number;
  title: string;
  description: string | null;
  image_urls: string[] | null;
  starting_bid: number | null;
  status: string | null;
  error_log: string | null;
}

interface BatchSummary {
  id: string;
  name: string;
  created_at: string;
  doa_first_lot_url: string | null;
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:     { label: "Pending",     color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",   icon: <Clock className="h-3 w-3" /> },
  in_progress: { label: "Processing",  color: "bg-blue-500/20 text-blue-400 border-blue-500/30",         icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed:   { label: "Completed",   color: "bg-green-500/20 text-green-400 border-green-500/30",      icon: <CheckCircle2 className="h-3 w-3" /> },
  failed:      { label: "Failed",      color: "bg-red-500/20 text-red-400 border-red-500/30",            icon: <XCircle className="h-3 w-3" /> },
};

function batchOverallStatus(b: BatchSummary): string {
  if (b.in_progress > 0)                         return "in_progress";
  if (b.completed > 0 && b.pending === 0 && b.failed === 0) return "completed";
  if (b.failed > 0 && b.pending === 0)            return "failed";
  if (b.pending > 0)                              return "pending";
  return "completed";
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DenverBatches() {
  const [batches, setBatches]           = useState<BatchSummary[]>([]);
  const [loading, setLoading]           = useState(true);
  const [expandedBatch, setExpanded]    = useState<string | null>(null);
  const [lotsByBatch, setLotsByBatch]   = useState<Record<string, LotRow[]>>({});
  const [triggering, setTriggering]     = useState<string | null>(null);

  // DOA URL dialog
  const [urlDialog, setUrlDialog]       = useState<BatchSummary | null>(null);
  const [doaUrl, setDoaUrl]             = useState("");

  // ── Load batches ───────────────────────────────────────────────────────────

  const loadBatches = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all rows from denver_batch_rows
      const { data: rows, error } = await supabase
        .from("denver_batch_rows")
        .select("id, batch_id, lot_number, title, status")
        .order("lot_number");

      if (error) throw error;

      // Group by batch_id
      const map = new Map<string, BatchSummary>();
      for (const row of rows ?? []) {
        const key = row.batch_id ?? "unknown";
        if (!map.has(key)) {
          map.set(key, {
            id: key, name: key.slice(0, 8) + "…", created_at: "",
            doa_first_lot_url: null,
            total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0,
          });
        }
        const b = map.get(key)!;
        b.total++;
        const s = (row.status ?? "pending") as keyof typeof b;
        if (s in b) (b as any)[s]++;
      }

      // Enrich with batch metadata
      const batchIds = Array.from(map.keys()).filter(id => id !== "unknown");
      if (batchIds.length > 0) {
        const { data: meta } = await supabase
          .from("la_batches")
          .select("id, name, created_at")
          .in("id", batchIds);

        for (const m of meta ?? []) {
          const b = map.get(m.id);
          if (b) {
            b.name = m.name ?? b.name;
            b.created_at = m.created_at ?? "";
          }
        }

        // Try to get doa_first_lot_url (requires migration 20260308)
        try {
          const { data: urlMeta } = await (supabase as any)
            .from("la_batches")
            .select("id, doa_first_lot_url")
            .in("id", batchIds);
          for (const m of urlMeta ?? []) {
            const b = map.get(m.id);
            if (b) b.doa_first_lot_url = m.doa_first_lot_url ?? null;
          }
        } catch { /* column may not exist yet */ }
      }

      setBatches(Array.from(map.values()).sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
      ));
    } catch (err: any) {
      toast({ title: "Failed to load batches", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  // Auto-refresh every 15s when any batch is in progress
  useEffect(() => {
    const hasActive = batches.some(b => b.in_progress > 0);
    if (!hasActive) return;
    const t = setInterval(loadBatches, 15_000);
    return () => clearInterval(t);
  }, [batches, loadBatches]);

  // ── Expand batch → load lots ───────────────────────────────────────────────

  const toggleExpand = async (batchId: string) => {
    if (expandedBatch === batchId) {
      setExpanded(null);
      return;
    }
    setExpanded(batchId);
    if (!lotsByBatch[batchId]) {
      const { data } = await supabase
        .from("denver_batch_rows")
        .select("id, lot_number, title, description, image_urls, starting_bid, status, error_log")
        .eq("batch_id", batchId)
        .order("lot_number");
      setLotsByBatch(prev => ({ ...prev, [batchId]: data ?? [] }));
    }
  };

  // Refresh lots for an expanded batch
  const refreshLots = async (batchId: string) => {
    const { data } = await supabase
      .from("denver_batch_rows")
      .select("id, lot_number, title, description, image_urls, starting_bid, status, error_log")
      .eq("batch_id", batchId)
      .order("lot_number");
    setLotsByBatch(prev => ({ ...prev, [batchId]: data ?? [] }));
  };

  // ── Trigger agent ──────────────────────────────────────────────────────────

  const triggerAgent = async (batch: BatchSummary, overrideUrl?: string) => {
    const finalUrl = overrideUrl ?? batch.doa_first_lot_url;

    if (!finalUrl) {
      setUrlDialog(batch);
      setDoaUrl(batch.doa_first_lot_url ?? "");
      return;
    }

    setTriggering(batch.id);
    try {
      const { data, error } = await supabase.functions.invoke("trigger-doa-agent", {
        body: {
          batch_id: batch.id,
          doa_first_lot_url: finalUrl,
          reset_failed: true,
        },
      });

      if (error) throw error;

      toast({
        title: "Agent triggered",
        description: data?.message ?? `${data?.lots_queued ?? 0} lot(s) queued`,
      });

      await loadBatches();
      if (expandedBatch === batch.id) await refreshLots(batch.id);
    } catch (err: any) {
      toast({ title: "Trigger failed", description: err.message, variant: "destructive" });
    } finally {
      setTriggering(null);
      setUrlDialog(null);
    }
  };

  const handleUrlSubmit = () => {
    if (!urlDialog) return;
    if (!doaUrl.trim()) {
      toast({ title: "URL required", description: "Paste the DOA EditAuction URL for this batch", variant: "destructive" });
      return;
    }
    triggerAgent(urlDialog, doaUrl.trim());
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <MainLayout
      title="Denver Auction Batches"
      subtitle="Upload CSVs at upload-whiz-glide.lovable.app — they appear here automatically"
    >
      <div className="space-y-4">
        {/* Header actions */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {batches.length} batch{batches.length !== 1 ? "es" : ""} found
          </p>
          <Button variant="outline" size="sm" onClick={loadBatches} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Batch list */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-3 h-5 w-5 animate-spin" />
            Loading batches…
          </div>
        ) : batches.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Gavel className="mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-lg font-medium text-foreground">No batches yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a CSV at{" "}
                <a
                  href="https://upload-whiz-glide.lovable.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  upload-whiz-glide.lovable.app
                </a>
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {batches.map(batch => {
              const status = batchOverallStatus(batch);
              const cfg    = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
              const isExp  = expandedBatch === batch.id;
              const lots   = lotsByBatch[batch.id] ?? [];
              const isTrig = triggering === batch.id;

              return (
                <Card key={batch.id} className="overflow-hidden">
                  {/* Batch header row */}
                  <CardHeader
                    className="cursor-pointer select-none p-4 hover:bg-sidebar-accent/30 transition-colors"
                    onClick={() => toggleExpand(batch.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {isExp
                          ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        }
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate">{batch.name}</CardTitle>
                          {batch.created_at && (
                            <CardDescription className="text-xs mt-0.5">
                              {format(new Date(batch.created_at), "MMM d, yyyy h:mm a")}
                            </CardDescription>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Status counts */}
                        <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                          {batch.completed > 0 && (
                            <span className="flex items-center gap-1 text-green-400">
                              <CheckCircle2 className="h-3 w-3" />{batch.completed}
                            </span>
                          )}
                          {batch.failed > 0 && (
                            <span className="flex items-center gap-1 text-red-400">
                              <XCircle className="h-3 w-3" />{batch.failed}
                            </span>
                          )}
                          {batch.pending > 0 && (
                            <span className="flex items-center gap-1 text-yellow-400">
                              <Clock className="h-3 w-3" />{batch.pending}
                            </span>
                          )}
                          <span className="text-muted-foreground/50">/ {batch.total}</span>
                        </div>

                        <Badge className={cn("flex items-center gap-1 border text-xs", cfg.color)}>
                          {cfg.icon}
                          {cfg.label}
                        </Badge>

                        <Button
                          size="sm"
                          onClick={e => { e.stopPropagation(); triggerAgent(batch); }}
                          disabled={isTrig || status === "in_progress"}
                          className="gap-1.5"
                        >
                          {isTrig
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Play className="h-3.5 w-3.5" />
                          }
                          {status === "completed" ? "Re-run" : "Run Agent"}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  {/* Expanded lots table */}
                  {isExp && (
                    <CardContent className="p-0 border-t border-border">
                      {lots.length === 0 ? (
                        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading lots…
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-16">#</TableHead>
                              <TableHead>Title</TableHead>
                              <TableHead className="w-24 text-center">Images</TableHead>
                              <TableHead className="w-28">Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lots.map(lot => {
                              const lcfg = STATUS_CONFIG[lot.status ?? "pending"] ?? STATUS_CONFIG.pending;
                              return (
                                <TableRow key={lot.id}>
                                  <TableCell className="font-mono text-muted-foreground">
                                    {lot.lot_number}
                                  </TableCell>
                                  <TableCell>
                                    <div>
                                      <p className="text-sm font-medium line-clamp-1">{lot.title}</p>
                                      {lot.error_log && (
                                        <p className="mt-0.5 text-xs text-red-400 line-clamp-1">
                                          <AlertCircle className="inline h-3 w-3 mr-1" />
                                          {lot.error_log}
                                        </p>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    {lot.image_urls && lot.image_urls.length > 0 ? (
                                      <span className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                                        <ImageIcon className="h-3 w-3" />
                                        {lot.image_urls.length}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground/40">—</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge className={cn("flex w-fit items-center gap-1 border text-xs", lcfg.color)}>
                                      {lcfg.icon}
                                      {lcfg.label}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* DOA URL dialog — appears when batch has no URL set yet */}
      <Dialog open={!!urlDialog} onOpenChange={open => { if (!open) setUrlDialog(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Set DOA Auction URL</DialogTitle>
            <DialogDescription>
              Paste the Denver Auctions <strong>EditAuction</strong> URL for the first lot in this batch.
              It will be saved for future runs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="doa-url">First Lot URL</Label>
              <Input
                id="doa-url"
                placeholder="https://denveronlineauctions.com/sub-admin/EditAuction?id=..."
                value={doaUrl}
                onChange={e => setDoaUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleUrlSubmit()}
              />
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <Link className="h-3 w-3 mt-0.5 shrink-0" />
                Log into Denver Auctions, open the Edit page for your first lot, and copy the URL from your browser.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setUrlDialog(null)}>Cancel</Button>
              <Button onClick={handleUrlSubmit} disabled={!!triggering}>
                {triggering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Run Agent
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
