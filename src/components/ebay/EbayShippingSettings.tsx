import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Package, RotateCcw } from "lucide-react";

export interface ShippingSettings {
  shippingType: "flat" | "calculated" | "free";
  shippingCost: number;
  handlingTime: number;
  returnsAccepted: boolean;
  returnPeriod: number;
  returnShipping: "buyer" | "seller";
}

interface EbayShippingSettingsProps {
  settings: ShippingSettings;
  onChange: (settings: ShippingSettings) => void;
}

export function EbayShippingSettings({ settings, onChange }: EbayShippingSettingsProps) {
  const update = (partial: Partial<ShippingSettings>) => {
    onChange({ ...settings, ...partial });
  };

  return (
    <div className="space-y-4">
      {/* Shipping */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Shipping</Label>
        </div>
        
        <div className="flex gap-1">
          {(["free", "flat", "calculated"] as const).map((type) => (
            <Button
              key={type}
              variant={settings.shippingType === type ? "gold" : "outline"}
              size="sm"
              className="flex-1 capitalize"
              onClick={() => update({ shippingType: type })}
            >
              {type}
            </Button>
          ))}
        </div>

        {settings.shippingType === "flat" && (
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Cost ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={settings.shippingCost}
                onChange={(e) => update({ shippingCost: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Handling (days)</Label>
              <Input
                type="number"
                value={settings.handlingTime}
                onChange={(e) => update({ handlingTime: parseInt(e.target.value) || 1 })}
              />
            </div>
          </div>
        )}

        {settings.shippingType === "calculated" && (
          <div>
            <Label className="text-xs text-muted-foreground">Handling Time (days)</Label>
            <Input
              type="number"
              value={settings.handlingTime}
              onChange={(e) => update({ handlingTime: parseInt(e.target.value) || 1 })}
            />
          </div>
        )}
      </div>

      {/* Returns */}
      <div className="space-y-3 pt-3 border-t border-border">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Returns</Label>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-sm">Accept Returns</Label>
          <Switch
            checked={settings.returnsAccepted}
            onCheckedChange={(checked) => update({ returnsAccepted: checked })}
          />
        </div>

        {settings.returnsAccepted && (
          <>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Period (days)</Label>
                <div className="flex gap-1">
                  {[14, 30, 60].map((days) => (
                    <Button
                      key={days}
                      variant={settings.returnPeriod === days ? "gold" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => update({ returnPeriod: days })}
                    >
                      {days}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Return Shipping Paid By</Label>
              <div className="flex gap-1 mt-1">
                <Button
                  variant={settings.returnShipping === "buyer" ? "gold" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => update({ returnShipping: "buyer" })}
                >
                  Buyer
                </Button>
                <Button
                  variant={settings.returnShipping === "seller" ? "gold" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => update({ returnShipping: "seller" })}
                >
                  Seller
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
