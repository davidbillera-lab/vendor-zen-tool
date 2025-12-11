import { MainLayout } from "@/components/layout/MainLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { PlatformCard } from "@/components/dashboard/PlatformCard";
import { RecentOrdersTable } from "@/components/dashboard/RecentOrdersTable";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { 
  Package, 
  DollarSign, 
  TrendingUp, 
  ShoppingCart,
  Store,
  Facebook,
  Gavel,
  Truck
} from "lucide-react";

const stats = [
  { 
    title: "Total Inventory", 
    value: "1,247", 
    change: "+23 items this week", 
    changeType: "positive" as const,
    icon: Package,
  },
  { 
    title: "Monthly Revenue", 
    value: "$12,450", 
    change: "+18% from last month", 
    changeType: "positive" as const,
    icon: DollarSign,
  },
  { 
    title: "Active Listings", 
    value: "892", 
    change: "Across 4 platforms", 
    changeType: "neutral" as const,
    icon: TrendingUp,
  },
  { 
    title: "Pending Orders", 
    value: "34", 
    change: "12 ready to ship", 
    changeType: "neutral" as const,
    icon: ShoppingCart,
  },
];

const platforms = [
  { name: "eBay Store", icon: Store, listings: 456, sales: "$5,230", color: "bg-platform-ebay/20", status: "connected" as const },
  { name: "Facebook Marketplace", icon: Facebook, listings: 124, sales: "$2,180", color: "bg-platform-facebook/20", status: "connected" as const },
  { name: "LiveAuctioneers", icon: Gavel, listings: 89, sales: "$3,450", color: "bg-platform-auction/20", status: "connected" as const },
  { name: "Estate Services", icon: Truck, listings: 223, sales: "$1,590", color: "bg-platform-estate/20", status: "connected" as const },
];

export default function Index() {
  return (
    <MainLayout 
      title="Dashboard" 
      subtitle="Welcome back! Here's your business overview."
    >
      <div className="space-y-6">
        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div 
              key={stat.title} 
              className="animate-fade-in"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <StatCard {...stat} />
            </div>
          ))}
        </div>

        {/* Platforms Grid */}
        <div>
          <h2 className="mb-4 font-serif text-xl font-semibold text-foreground">
            Connected Platforms
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {platforms.map((platform, index) => (
              <div 
                key={platform.name}
                className="animate-fade-in"
                style={{ animationDelay: `${(index + 4) * 100}ms` }}
              >
                <PlatformCard {...platform} />
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Section */}
        <div className="grid gap-6 lg:grid-cols-4">
          <div className="lg:col-span-3">
            <RecentOrdersTable />
          </div>
          <div>
            <QuickActions />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
