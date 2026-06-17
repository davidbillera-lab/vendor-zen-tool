import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { EbayOAuthManager } from "@/components/ebay/EbayOAuthManager";
import { MercariCredentialsCard } from "@/components/credentials/MercariCredentialsCard";
import { PoshmarkCredentialsCard } from "@/components/credentials/PoshmarkCredentialsCard";
import { DoaCredentialsCard } from "@/components/credentials/DoaCredentialsCard";
import { EstateSalesCredentialsCard } from "@/components/credentials/EstateSalesCredentialsCard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Store, Facebook, Gavel, Truck, ShoppingBag, Package, Brain, TrendingDown, TrendingUp } from "lucide-react";

const ALL_PLATFORMS = [
  { id: "ebay", label: "eBay", icon: Store, description: "List and push directly to your eBay store" },
  { id: "denver_auctions", label: "Denver Online Auctions", icon: Gavel, description: "Build and upload auction batches to DOA" },
  { id: "liveauctioneers", label: "LiveAuctioneers", icon: Gavel, description: "Manage lots for LiveAuctioneers auctions" },
  { id: "facebook", label: "Facebook Marketplace", icon: Facebook, description: "Export listings for Facebook Marketplace" },
  { id: "mercari", label: "Mercari", icon: ShoppingBag, description: "List items on Mercari" },
  { id: "poshmark", label: "Poshmark", icon: Package, description: "List clothing and accessories on Poshmark" },
  { id: "estate_services", label: "Estate Services", icon: Truck, description: "Track estate clean-out and consignment projects" },
];

export default function Settings() {
  const { user, userPlatforms, refreshPlatforms } = useAuth();
  const { toast } = useToast();

  const [businessName, setBusinessName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [platformStates, setPlatformStates] = useState<Record<string, boolean>>({});
  const [savingPlatforms, setSavingPlatforms] = useState(false);

  // v2.4: self-improving loop effectiveness metric (re-correction rate + 30d trend)
  const [learnStats, setLearnStats] = useState<{
    total_injections: number;
    re_corrected: number;
    re_correction_rate: number;
    rate_last_30d: number;
    rate_prior_30d: number;
  } | null>(null);

  // Load profile
  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_profiles' as any)
      .select('business_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if ((data as any)?.business_name) setBusinessName((data as any).business_name);
      });
  }, [user]);

  // Load platform toggles from DB
  useEffect(() => {
    const states: Record<string, boolean> = {};
    ALL_PLATFORMS.forEach(p => { states[p.id] = false; });
    states['ebay'] = true; // safe default for new users

    if (userPlatforms.length > 0) {
      userPlatforms.forEach(p => { states[p.platform] = p.enabled; });
    }
    setPlatformStates(states);
  }, [userPlatforms]);

  // Load correction-loop effectiveness stats (fire-and-forget; never blocks the page)
  useEffect(() => {
    if (!user) return;
    supabase
      .rpc('correction_effectiveness_stats')
      .then(({ data, error }) => {
        if (error) {
          console.warn("correction_effectiveness_stats unavailable (non-blocking):", error.message);
          return;
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (row) setLearnStats(row as any);
      });
  }, [user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    const { error } = await supabase
      .from('user_profiles' as any)
      .upsert({ id: user.id, business_name: businessName });
    setSavingProfile(false);
    if (error) {
      toast({ title: "Error saving profile", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile saved" });
    }
  };

  const handleSavePlatforms = async () => {
    if (!user) return;
    setSavingPlatforms(true);
    const rows = ALL_PLATFORMS.map((p, i) => ({
      user_id: user.id,
      platform: p.id,
      enabled: platformStates[p.id] ?? false,
      display_order: i,
    }));
    const { error } = await supabase
      .from('user_platforms' as any)
      .upsert(rows, { onConflict: 'user_id,platform' });
    setSavingPlatforms(false);
    if (error) {
      toast({ title: "Error saving platforms", description: error.message, variant: "destructive" });
    } else {
      await refreshPlatforms();
      toast({ title: "Platform preferences saved" });
    }
  };

  return (
    <MainLayout title="Settings" subtitle="Manage your account and platform preferences">
      <div className="max-w-3xl space-y-8">

        {/* Learning Loop — correction effectiveness (v2.4) */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <Brain className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="font-serif text-xl font-semibold text-foreground">Learning Loop</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                How often a listing shaped by past corrections gets corrected again. Lower is better — it means the system is learning your taste.
              </p>
            </div>
          </div>
          <Separator className="my-6" />
          {(() => {
            // Zero-data: no corrections have been injected into a generation yet.
            if (!learnStats || learnStats.total_injections === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  No data yet. Once you generate listings while past corrections are being applied,
                  the re-correction rate will appear here.
                </p>
              );
            }
            const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
            // Delta in percentage points, last-30d vs prior-30d. Negative = improving.
            const deltaPts = (learnStats.rate_last_30d - learnStats.rate_prior_30d) * 100;
            const improving = deltaPts < 0;
            const flat = Math.abs(deltaPts) < 0.05;
            const TrendIcon = improving ? TrendingDown : TrendingUp;
            return (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-secondary/30 p-4">
                  <p className="text-sm text-muted-foreground">Re-correction rate</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {pct(learnStats.re_correction_rate)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {learnStats.re_corrected} of {learnStats.total_injections} injections re-corrected
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/30 p-4">
                  <p className="text-sm text-muted-foreground">Last 30 days</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {pct(learnStats.rate_last_30d)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    prior 30d: {pct(learnStats.rate_prior_30d)}
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/30 p-4">
                  <p className="text-sm text-muted-foreground">30-day trend</p>
                  <div className="mt-1 flex items-center gap-2">
                    {!flat && (
                      <TrendIcon className={`h-5 w-5 ${improving ? "text-emerald-500" : "text-red-500"}`} />
                    )}
                    <p className={`text-2xl font-semibold ${flat ? "text-foreground" : improving ? "text-emerald-500" : "text-red-500"}`}>
                      {flat ? "Flat" : `${deltaPts > 0 ? "+" : ""}${deltaPts.toFixed(1)} pts`}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {flat ? "no change vs prior 30d" : improving ? "improving vs prior 30d" : "up vs prior 30d"}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Profile */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your business information</p>
          <Separator className="my-6" />
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email ?? ""} disabled className="opacity-60" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="business">Business Name</Label>
              <Input
                id="business"
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                placeholder="e.g. JSG Liquidators LLC"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="gold" onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? "Saving…" : "Save Profile"}
            </Button>
          </div>
        </div>

        {/* Platform Preferences */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Active Platforms</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enable only the platforms you use. Your dashboard and workflow panels reflect these choices.
          </p>
          <Separator className="my-6" />
          <div className="space-y-4">
            {ALL_PLATFORMS.map(p => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-secondary/30 p-4">
                <div className="flex items-center gap-3">
                  <p.icon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">{p.label}</p>
                    <p className="text-sm text-muted-foreground">{p.description}</p>
                  </div>
                </div>
                <Switch
                  checked={platformStates[p.id] ?? false}
                  onCheckedChange={val => setPlatformStates(prev => ({ ...prev, [p.id]: val }))}
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="gold" onClick={handleSavePlatforms} disabled={savingPlatforms}>
              {savingPlatforms ? "Saving…" : "Save Platforms"}
            </Button>
          </div>
        </div>

        {/* eBay Connection */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">eBay Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your own eBay developer credentials. Listings push to your eBay store.
          </p>
          <Separator className="my-6" />
          <EbayOAuthManager />
        </div>

        {/* Mercari Connection */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Mercari Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your Mercari account. Listings post to your store only.
          </p>
          <Separator className="my-6" />
          <MercariCredentialsCard />
        </div>

        {/* Poshmark Connection */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Poshmark Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your Poshmark account. Listings post to your closet only.
          </p>
          <Separator className="my-6" />
          <PoshmarkCredentialsCard />
        </div>

        {/* Denver Online Auctions Connection */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Denver Online Auctions Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your DOA sub-admin account. Lots post to your auction only.
          </p>
          <Separator className="my-6" />
          <DoaCredentialsCard />
        </div>

        {/* EstateSales.net Connection */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">EstateSales.net Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your EstateSales.net account. The upload agent posts lots on your behalf.
          </p>
          <Separator className="my-6" />
          <EstateSalesCredentialsCard />
        </div>

      </div>
    </MainLayout>
  );
}
