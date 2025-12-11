import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Order {
  id: string;
  item: string;
  platform: string;
  buyer: string;
  amount: string;
  status: "pending" | "shipped" | "delivered" | "cancelled";
  date: string;
}

const orders: Order[] = [
  { id: "ORD-001", item: "Antique Brass Lamp", platform: "eBay", buyer: "john_collector", amount: "$145.00", status: "shipped", date: "Dec 10" },
  { id: "ORD-002", item: "Vintage Tea Set", platform: "LiveAuctioneers", buyer: "antique_lover", amount: "$280.00", status: "pending", date: "Dec 10" },
  { id: "ORD-003", item: "Mid-Century Chair", platform: "Facebook", buyer: "Sarah M.", amount: "$320.00", status: "delivered", date: "Dec 9" },
  { id: "ORD-004", item: "Crystal Decanter Set", platform: "eBay", buyer: "vintage_finds", amount: "$95.00", status: "shipped", date: "Dec 9" },
  { id: "ORD-005", item: "Estate Jewelry Lot", platform: "Denver Auctions", buyer: "gem_hunter", amount: "$450.00", status: "pending", date: "Dec 8" },
];

const statusStyles = {
  pending: "bg-warning/20 text-warning border-warning/30",
  shipped: "bg-info/20 text-info border-info/30",
  delivered: "bg-success/20 text-success border-success/30",
  cancelled: "bg-destructive/20 text-destructive border-destructive/30",
};

const platformColors: Record<string, string> = {
  "eBay": "text-platform-ebay",
  "Facebook": "text-platform-facebook",
  "LiveAuctioneers": "text-platform-auction",
  "Denver Auctions": "text-platform-auction",
};

export function RecentOrdersTable() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border p-5">
        <h3 className="font-serif text-lg font-semibold text-foreground">Recent Orders</h3>
        <p className="text-sm text-muted-foreground">Latest transactions across all platforms</p>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Order</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Item</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Platform</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Buyer</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Amount</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((order) => (
              <tr key={order.id} className="transition-colors hover:bg-secondary/20">
                <td className="whitespace-nowrap px-5 py-4">
                  <span className="font-mono text-sm text-muted-foreground">{order.id}</span>
                </td>
                <td className="px-5 py-4">
                  <span className="font-medium text-foreground">{order.item}</span>
                </td>
                <td className="px-5 py-4">
                  <span className={cn("font-medium", platformColors[order.platform] || "text-foreground")}>
                    {order.platform}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className="text-muted-foreground">{order.buyer}</span>
                </td>
                <td className="px-5 py-4">
                  <span className="font-semibold text-foreground">{order.amount}</span>
                </td>
                <td className="px-5 py-4">
                  <Badge variant="outline" className={cn("capitalize", statusStyles[order.status])}>
                    {order.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
