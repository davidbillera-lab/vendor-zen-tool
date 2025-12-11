import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Store, 
  Facebook, 
  Gavel,
  Truck,
  Settings,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Platform {
  id: string;
  name: string;
  description: string;
  icon: typeof Store;
  color: string;
  bgColor: string;
  status: "connected" | "disconnected" | "syncing";
  lastSync?: string;
  stats: {
    listings: number;
    sales: string;
    orders: number;
  };
}

const platforms: Platform[] = [
  {
    id: "ebay",
    name: "eBay Store",
    description: "Your main eBay seller account with store subscription",
    icon: Store,
    color: "text-platform-ebay",
    bgColor: "bg-platform-ebay/20",
    status: "connected",
    lastSync: "2 minutes ago",
    stats: { listings: 456, sales: "$5,230", orders: 89 },
  },
  {
    id: "facebook",
    name: "Facebook Marketplace",
    description: "Personal and business listings on Facebook Marketplace",
    icon: Facebook,
    color: "text-platform-facebook",
    bgColor: "bg-platform-facebook/20",
    status: "connected",
    lastSync: "5 minutes ago",
    stats: { listings: 124, sales: "$2,180", orders: 34 },
  },
  {
    id: "liveauctioneers",
    name: "LiveAuctioneers",
    description: "Online auction platform for antiques and collectibles",
    icon: Gavel,
    color: "text-platform-auction",
    bgColor: "bg-platform-auction/20",
    status: "connected",
    lastSync: "10 minutes ago",
    stats: { listings: 89, sales: "$3,450", orders: 23 },
  },
  {
    id: "denver",
    name: "Denver Online Auctions",
    description: "Regional online auction house for estate sales",
    icon: Gavel,
    color: "text-platform-auction",
    bgColor: "bg-platform-auction/20",
    status: "syncing",
    lastSync: "Syncing now...",
    stats: { listings: 67, sales: "$1,890", orders: 15 },
  },
  {
    id: "estate",
    name: "Estate Services",
    description: "Your estate cleanout and junk removal business",
    icon: Truck,
    color: "text-platform-estate",
    bgColor: "bg-platform-estate/20",
    status: "connected",
    lastSync: "1 hour ago",
    stats: { listings: 223, sales: "$1,590", orders: 12 },
  },
];

const statusConfig = {
  connected: { icon: CheckCircle2, color: "text-success", label: "Connected" },
  disconnected: { icon: AlertCircle, color: "text-destructive", label: "Disconnected" },
  syncing: { icon: Clock, color: "text-warning", label: "Syncing" },
};

export default function Platforms() {
  return (
    <MainLayout 
      title="Platforms" 
      subtitle="Manage your connected selling platforms"
    >
      <div className="space-y-6">
        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Total Platforms</p>
            <p className="mt-1 text-3xl font-bold text-foreground">{platforms.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Active Listings</p>
            <p className="mt-1 text-3xl font-bold text-foreground">
              {platforms.reduce((sum, p) => sum + p.stats.listings, 0)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Total Revenue</p>
            <p className="mt-1 text-3xl font-bold text-success">
              ${platforms.reduce((sum, p) => sum + parseInt(p.stats.sales.replace(/[$,]/g, "")), 0).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Platform Cards */}
        <div className="space-y-4">
          {platforms.map((platform, index) => {
            const StatusIcon = statusConfig[platform.status].icon;
            return (
              <div
                key={platform.id}
                className="group rounded-xl border border-border bg-card transition-all duration-300 hover:border-primary/30 hover:shadow-card animate-fade-in"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="p-6">
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    {/* Platform Info */}
                    <div className="flex items-start gap-4">
                      <div className={cn("rounded-xl p-4", platform.bgColor)}>
                        <platform.icon className={cn("h-8 w-8", platform.color)} />
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="font-serif text-xl font-semibold text-foreground">
                            {platform.name}
                          </h3>
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "gap-1",
                              platform.status === "connected" && "border-success/30 bg-success/10 text-success",
                              platform.status === "disconnected" && "border-destructive/30 bg-destructive/10 text-destructive",
                              platform.status === "syncing" && "border-warning/30 bg-warning/10 text-warning"
                            )}
                          >
                            <StatusIcon className={cn("h-3 w-3", platform.status === "syncing" && "animate-spin")} />
                            {statusConfig[platform.status].label}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{platform.description}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Last synced: {platform.lastSync}
                        </p>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex gap-8">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-foreground">{platform.stats.listings}</p>
                        <p className="text-xs text-muted-foreground">Listings</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-success">{platform.stats.sales}</p>
                        <p className="text-xs text-muted-foreground">This Month</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-foreground">{platform.stats.orders}</p>
                        <p className="text-xs text-muted-foreground">Orders</p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Sync
                      </Button>
                      <Button variant="outline" size="sm">
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </Button>
                      <Button variant="ghost" size="icon">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Platform */}
        <div className="flex justify-center">
          <Button variant="outline" className="border-dashed">
            + Connect New Platform
          </Button>
        </div>
      </div>
    </MainLayout>
  );
}
