import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { EbayOAuthManager } from "@/components/ebay/EbayOAuthManager";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Store, Facebook, Gavel, Truck, ShoppingBag, Package } from "lucide-react";

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

      </div>
    </MainLayout>
  );
}
