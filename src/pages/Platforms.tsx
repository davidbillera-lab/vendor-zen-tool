import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Store,
  Facebook,
  Gavel,
  Truck,
  Settings,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Link2,
  Link2Off,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function Platforms() {
  const location = useLocation();
  const navigate = useNavigate();
  const [ebayConnected, setEbayConnected] = useState(false);
  const [ebayConnectedAt, setEbayConnectedAt] = useState<string | null>(null);
  const [ebayAction, setEbayAction] = useState<"loading" | "connecting" | "disconnecting" | null>("loading");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (code) {
      navigate("/platforms", { replace: true });
      handleOAuthCallback(code);
    } else {
      checkEbayStatus();
    }
  }, []);

  const checkEbayStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("ebay-oauth", {
        body: { action: "get_status" },
      });
      if (!error && data) {
        setEbayConnected(data.connected ?? false);
        setEbayConnectedAt(data.connected_at ?? null);
      }
    } catch {
      // not connected
    } finally {
      setEbayAction(null);
    }
  };

  const handleOAuthCallback = async (code: string) => {
    setEbayAction("connecting");
    try {
      const { data, error } = await supabase.functions.invoke("ebay-oauth", {
        body: { action: "exchange_code", code },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Failed to connect eBay account");
        return;
      }
      setEbayConnected(true);
      setEbayConnectedAt(new Date().toISOString());
      toast.success("eBay account connected!");
    } catch (e: any) {
      toast.error(e.message || "Failed to connect eBay account");
    } finally {
      setEbayAction(null);
    }
  };

  const handleEbayConnect = async () => {
    setEbayAction("connecting");
    try {
      const { data, error } = await supabase.functions.invoke("ebay-oauth", {
        body: { action: "get_auth_url" },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Failed to get eBay auth URL");
        setEbayAction(null);
        return;
      }
      window.location.href = data.authUrl;
    } catch (e: any) {
      toast.error(e.message);
      setEbayAction(null);
    }
  };

  const handleEbayDisconnect = async () => {
    setEbayAction("disconnecting");
    try {
      const { data, error } = await supabase.functions.invoke("ebay-oauth", {
        body: { action: "disconnect" },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Failed to disconnect eBay account");
        return;
      }
      setEbayConnected(false);
      setEbayConnectedAt(null);
      toast.success("eBay account disconnected");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEbayAction(null);
    }
  };

  const ebayStatus = ebayAction === "loading" ? "syncing" : ebayConnected ? "connected" : "disconnected";

  const otherPlatforms = [
    {
      id: "facebook",
      name: "Facebook Marketplace",
      description: "Personal and business listings on Facebook Marketplace",
      icon: Facebook,
      color: "text-platform-facebook",
      bgColor: "bg-platform-facebook/20",
    },
    {
      id: "liveauctioneers",
      name: "LiveAuctioneers",
      description: "Online auction platform for antiques and collectibles",
      icon: Gavel,
      color: "text-platform-auction",
      bgColor: "bg-platform-auction/20",
    },
    {
      id: "denver",
      name: "Denver Online Auctions",
      description: "Regional online auction house for estate sales",
      icon: Gavel,
      color: "text-platform-auction",
      bgColor: "bg-platform-auction/20",
    },
    {
      id: "estate",
      name: "EstateSales.net",
      description: "Estate sale listing and management platform",
      icon: Truck,
      color: "text-platform-estate",
      bgColor: "bg-platform-estate/20",
    },
  ];

  return (
    <MainLayout
      title="Platforms"
      subtitle="Manage your connected selling platforms"
    >
      <div className="space-y-4">
        {/* eBay — live connection */}
        <div className="rounded-xl border border-border bg-card transition-all duration-300 hover:border-primary/30 hover:shadow-card animate-fade-in">
          <div className="p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-xl p-4 bg-platform-ebay/20">
                  <Store className="h-8 w-8 text-platform-ebay" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-serif text-xl font-semibold text-foreground">eBay Store</h3>
                    <Badge
                      variant="outline"
                      className={cn(
                        "gap-1",
                        ebayStatus === "connected" && "border-success/30 bg-success/10 text-success",
                        ebayStatus === "disconnected" && "border-destructive/30 bg-destructive/10 text-destructive",
                        ebayStatus === "syncing" && "border-warning/30 bg-warning/10 text-warning"
                      )}
                    >
                      {ebayStatus === "connected" && <CheckCircle2 className="h-3 w-3" />}
                      {ebayStatus === "disconnected" && <AlertCircle className="h-3 w-3" />}
                      {ebayStatus === "syncing" && <Clock className="h-3 w-3 animate-spin" />}
                      {ebayStatus === "connected" ? "Connected" : ebayStatus === "disconnected" ? "Not Connected" : "Loading..."}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your eBay seller account for listing and publishing
                  </p>
                  {ebayConnected && ebayConnectedAt && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Connected {new Date(ebayConnectedAt).toLocaleDateString()}
                    </p>
                  )}
                  {!ebayConnected && ebayAction !== "loading" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Connect your eBay account to publish listings
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                {ebayConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEbayDisconnect}
                    disabled={ebayAction !== null}
                  >
                    {ebayAction === "disconnecting" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2Off className="mr-2 h-4 w-4" />
                    )}
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleEbayConnect}
                    disabled={ebayAction !== null}
                  >
                    {ebayAction === "connecting" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" />
                    )}
                    Connect eBay
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Other platforms — coming soon */}
        {otherPlatforms.map((platform, index) => (
          <div
            key={platform.id}
            className="rounded-xl border border-border bg-card transition-all duration-300 hover:border-primary/30 hover:shadow-card animate-fade-in"
            style={{ animationDelay: `${(index + 1) * 100}ms` }}
          >
            <div className="p-6">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-4">
                  <div className={cn("rounded-xl p-4", platform.bgColor)}>
                    <platform.icon className={cn("h-8 w-8", platform.color)} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="font-serif text-xl font-semibold text-foreground">{platform.name}</h3>
                      <Badge variant="outline" className="gap-1 border-muted-foreground/30 bg-muted/10 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Coming Soon
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{platform.description}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled>
                    <Settings className="mr-2 h-4 w-4" />
                    Configure
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </MainLayout>
  );
}
