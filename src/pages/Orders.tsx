import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Search, 
  Filter,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  MoreVertical
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Order {
  id: string;
  item: string;
  platform: string;
  buyer: string;
  buyerEmail: string;
  amount: number;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  date: string;
  trackingNumber?: string;
}

const mockOrders: Order[] = [
  { id: "ORD-2024-001", item: "Antique Brass Floor Lamp", platform: "eBay", buyer: "john_collector", buyerEmail: "john@email.com", amount: 185, status: "shipped", date: "2024-12-10", trackingNumber: "1Z999AA10123456784" },
  { id: "ORD-2024-002", item: "Vintage Crystal Decanter Set", platform: "LiveAuctioneers", buyer: "antique_lover", buyerEmail: "antique@email.com", amount: 280, status: "pending", date: "2024-12-10" },
  { id: "ORD-2024-003", item: "Mid-Century Modern Chair", platform: "Facebook", buyer: "Sarah M.", buyerEmail: "sarah@email.com", amount: 320, status: "delivered", date: "2024-12-09" },
  { id: "ORD-2024-004", item: "Sterling Silver Tea Service", platform: "eBay", buyer: "vintage_finds", buyerEmail: "vintage@email.com", amount: 450, status: "processing", date: "2024-12-09" },
  { id: "ORD-2024-005", item: "Victorian Jewelry Box", platform: "Facebook", buyer: "Maria K.", buyerEmail: "maria@email.com", amount: 125, status: "shipped", date: "2024-12-08", trackingNumber: "1Z999AA10123456785" },
  { id: "ORD-2024-006", item: "Art Deco Vanity Mirror", platform: "Denver Auctions", buyer: "gem_hunter", buyerEmail: "gem@email.com", amount: 275, status: "cancelled", date: "2024-12-07" },
];

const statusConfig = {
  pending: { icon: Clock, color: "bg-warning/20 text-warning border-warning/30", label: "Pending" },
  processing: { icon: Package, color: "bg-info/20 text-info border-info/30", label: "Processing" },
  shipped: { icon: Truck, color: "bg-primary/20 text-primary border-primary/30", label: "Shipped" },
  delivered: { icon: CheckCircle2, color: "bg-success/20 text-success border-success/30", label: "Delivered" },
  cancelled: { icon: XCircle, color: "bg-destructive/20 text-destructive border-destructive/30", label: "Cancelled" },
};

export default function Orders() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const filteredOrders = mockOrders.filter(order => {
    const matchesSearch = 
      order.item.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.buyer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.id.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (activeTab === "all") return matchesSearch;
    return matchesSearch && order.status === activeTab;
  });

  const orderCounts = {
    all: mockOrders.length,
    pending: mockOrders.filter(o => o.status === "pending").length,
    processing: mockOrders.filter(o => o.status === "processing").length,
    shipped: mockOrders.filter(o => o.status === "shipped").length,
    delivered: mockOrders.filter(o => o.status === "delivered").length,
  };

  return (
    <MainLayout 
      title="Orders" 
      subtitle="Track and manage orders across all platforms"
    >
      <div className="space-y-6">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-secondary">
            <TabsTrigger value="all">All ({orderCounts.all})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({orderCounts.pending})</TabsTrigger>
            <TabsTrigger value="processing">Processing ({orderCounts.processing})</TabsTrigger>
            <TabsTrigger value="shipped">Shipped ({orderCounts.shipped})</TabsTrigger>
            <TabsTrigger value="delivered">Delivered ({orderCounts.delivered})</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-6">
            <div className="space-y-4">
              {filteredOrders.map((order, index) => {
                const StatusIcon = statusConfig[order.status].icon;
                return (
                  <div
                    key={order.id}
                    className="group rounded-xl border border-border bg-card p-5 transition-all duration-300 hover:border-primary/30 hover:shadow-card animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-4">
                        <div className={cn(
                          "flex h-12 w-12 items-center justify-center rounded-lg",
                          statusConfig[order.status].color.split(" ")[0]
                        )}>
                          <StatusIcon className={cn("h-6 w-6", statusConfig[order.status].color.split(" ")[1])} />
                        </div>
                        
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-foreground">{order.item}</h3>
                            <Badge variant="outline" className={statusConfig[order.status].color}>
                              {statusConfig[order.status].label}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {order.id} • {order.platform} • {order.buyer}
                          </p>
                          {order.trackingNumber && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Tracking: <span className="font-mono">{order.trackingNumber}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-lg font-bold text-foreground">${order.amount}</p>
                          <p className="text-xs text-muted-foreground">{order.date}</p>
                        </div>
                        <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredOrders.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Package className="h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 font-medium text-foreground">No orders found</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try adjusting your search or filter criteria
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
