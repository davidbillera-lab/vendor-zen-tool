import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

interface PlatformCardProps {
  name: string;
  icon: LucideIcon;
  listings: number;
  sales: string;
  color: string;
  status: "connected" | "disconnected" | "syncing";
}

export function PlatformCard({ 
  name, 
  icon: Icon, 
  listings, 
  sales, 
  color,
  status 
}: PlatformCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 transition-all duration-300 hover:border-primary/30 hover:shadow-card">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-lg p-2.5", color)}>
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{name}</h3>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={cn(
                "h-2 w-2 rounded-full",
                status === "connected" && "bg-success",
                status === "disconnected" && "bg-destructive",
                status === "syncing" && "bg-warning animate-pulse"
              )} />
              <span className="text-xs capitalize text-muted-foreground">{status}</span>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="opacity-0 transition-opacity group-hover:opacity-100">
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Active Listings</p>
          <p className="text-xl font-bold text-foreground">{listings}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">This Month</p>
          <p className="text-xl font-bold text-success">{sales}</p>
        </div>
      </div>
    </div>
  );
}
