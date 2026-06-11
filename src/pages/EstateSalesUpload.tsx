import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Loader2, RefreshCw, CheckCircle2, Clock, XCircle,
  Upload, Cloud, Zap, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const DOA_URL_KEY = "vzt_estatesales_doa_url";
const ES_URL_KEY  = "vzt_estatesales_es_url";
const REFRESH_MS  = 10_000;

interface Job {
  id: string;
  doa_url: string;
  estatesales_url: string;
  status: "pending" | "running" | "completed" | "failed";
  error_message: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function EstateSalesUpload() {
  const [doaUrl, setDoaUrl]     = useState(() => localStorage.getItem(DOA_URL_KEY) || "");
  const [esUrl, setEsUrl]       = useState(() => localStorage.getItem(ES_URL_KEY)  || "");
  const [triggering, setTriggering] = useState(false);
  const [jobs, setJobs]         = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  const loadJobs = useCallback(async (silent = false) => {
    if (!silent) setLoadingJobs(true);
    try {
      const { data, error } = await supabase
        .from("estatesales_jobs" as any)
        .select("id, doa_url, estatesales_url, status, error_message, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      setJobs(((data as any[]) || []) as Job[]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!silent) toast({ title: "Error loading jobs", description: msg, variant: "destructive" });
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  useEffect(() => {
    const interval = setInterval(() => loadJobs(true), REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadJobs]);

  async function handleStart() {
    if (!doaUrl.trim() || !esUrl.trim()) return;
    setTriggering(true);
    localStorage.setItem(DOA_URL_KEY, doaUrl.trim());
    localStorage.setItem(ES_URL_KEY,  esUrl.trim());
    try {
      const { data, error } = await supabase.functions.invoke("trigger-estatesales-agent", {
        body: { doa_url: doaUrl.trim(), estatesales_url: esUrl.trim() },
      });
      if (error) throw error;
      toast({
        title: "Upload agent dispatched!",
        description: data?.message ?? "The agent is running on GitHub Actions. Status updates appear below.",
      });
      loadJobs(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Failed to start agent", description: msg, variant: "destructive" });
    } finally {
      setTriggering(false);
    }
  }

  return (
    <MainLayout
      title="EstateSales Upload"
      subtitle="Copy DOA listings to EstateSales.net automatically"
    >
      <div className="max-w-2xl space-y-6">

        {/* Cloud agent banner */}
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 px-4 py-3 text-sm">
          <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-blue-500" />
          <span className="text-blue-700 dark:text-blue-400 font-medium">
            <Cloud className="inline h-3.5 w-3.5 mr-1" />
            Agent runs on GitHub Actions — opens DOA, scrapes all lots, then uploads images and descriptions to EstateSales.net
          </span>
        </div>

        {/* Credentials reminder */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Make sure your <strong>DOA</strong> and <strong>EstateSales.net</strong> credentials are saved in{" "}
            <a href="/settings" className="underline underline-offset-2">Settings</a> before starting.
          </span>
        </div>

        {/* Upload form */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <div>
            <h2 className="font-serif text-lg font-semibold">Start Upload</h2>
            <p className="text-sm text-muted-foreground mt-1">
              The agent logs into DOA, scrapes each lot's title, description, and images, then posts them to EstateSales.net.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">DOA Auction URL</label>
              <Input
                placeholder="https://denveronlineauctions.com/sub-admin/EditAuction?id=..."
                value={doaUrl}
                onChange={e => setDoaUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleStart()}
              />
              <p className="text-xs text-muted-foreground">
                The EditAuction admin URL for the DOA auction to scrape.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">EstateSales.net Sale URL</label>
              <Input
                placeholder="https://www.estatesales.net/company/sale/..."
                value={esUrl}
                onChange={e => setEsUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleStart()}
              />
              <p className="text-xs text-muted-foreground">
                The EstateSales.net sale management URL where lots will be uploaded.
              </p>
            </div>
          </div>

          <div className="pt-1">
            <Button
              onClick={handleStart}
              disabled={!doaUrl.trim() || !esUrl.trim() || triggering}
              className="w-full sm:w-auto"
            >
              {triggering
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Zap className="h-4 w-4 mr-2" />}
              {triggering ? "Dispatching…" : "Start Upload"}
            </Button>
          </div>
        </div>

        {/* Recent jobs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Recent Jobs</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadJobs(true)}
              disabled={loadingJobs}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loadingJobs && "animate-spin")} />
              Refresh
            </Button>
          </div>

          {loadingJobs ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No jobs yet. Start your first upload above.</p>
              <p className="text-xs text-muted-foreground mt-1">Auto-refreshes every 10 seconds once running.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map(job => <JobCard key={job.id} job={job} />)}
            </div>
          )}
        </div>

      </div>
    </MainLayout>
  );
}

// ---------------------------------------------------------------------------
// Job card
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  pending:   { label: "Pending",   Icon: Clock,        cls: "text-amber-600 bg-amber-500/10",   spin: false },
  running:   { label: "Running",   Icon: Loader2,      cls: "text-blue-600 bg-blue-500/10",     spin: true  },
  completed: { label: "Completed", Icon: CheckCircle2, cls: "text-emerald-600 bg-emerald-500/10", spin: false },
  failed:    { label: "Failed",    Icon: XCircle,      cls: "text-red-600 bg-red-500/10",       spin: false },
} as const;

function JobCard({ job }: { job: Job }) {
  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
  const { Icon } = cfg;

  const doaShort = job.doa_url.replace(/^https?:\/\/[^/]+/, "");
  const esShort  = job.estatesales_url.replace(/^https?:\/\/[^/]+/, "");

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs text-muted-foreground truncate" title={job.doa_url}>
            <span className="font-medium text-foreground">DOA:</span> {doaShort}
          </p>
          <p className="text-xs text-muted-foreground truncate" title={job.estatesales_url}>
            <span className="font-medium text-foreground">ES:</span> {esShort}
          </p>
        </div>
        <span className={cn(
          "shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
          cfg.cls
        )}>
          <Icon className={cn("h-3 w-3", cfg.spin && "animate-spin")} />
          {cfg.label}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {format(new Date(job.created_at), "MMM d, yyyy h:mm a")}
      </p>

      {job.error_message && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-2.5 text-xs text-red-700 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {job.error_message}
        </div>
      )}
    </div>
  );
}
