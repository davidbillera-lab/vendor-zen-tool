import { Button } from "@/components/ui/button";
import { Plus, Upload, Barcode, Camera, FileText, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function QuickActions() {
  const navigate = useNavigate();

  const actions = [
    { icon: Plus, label: "New Listing", action: () => navigate("/create-listing"), variant: "gold" as const },
    { icon: Upload, label: "Bulk Import", action: () => {}, variant: "outline" as const },
    { icon: Camera, label: "Photo Capture", action: () => {}, variant: "outline" as const },
    { icon: Barcode, label: "Scan Item", action: () => {}, variant: "outline" as const },
    { icon: FileText, label: "Generate Report", action: () => {}, variant: "outline" as const },
    { icon: RefreshCw, label: "Sync All", action: () => {}, variant: "outline" as const },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-serif text-lg font-semibold text-foreground">Quick Actions</h3>
      <p className="mb-4 text-sm text-muted-foreground">Common tasks at your fingertips</p>
      
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.variant}
            className="h-auto flex-col gap-2 py-4"
            onClick={action.action}
          >
            <action.icon className="h-5 w-5" />
            <span className="text-xs">{action.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
