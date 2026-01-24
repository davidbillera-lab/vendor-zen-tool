import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Download, 
  Loader2, 
  Check, 
  Store, 
  Trash2,
  Edit2,
  Eye,
  Upload,
  ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EbayItemSpecificsEditor } from "./EbayItemSpecificsEditor";
import { EbayShippingSettings, type ShippingSettings } from "./EbayShippingSettings";

interface EbayRow {
  id: string;
  lot_number: number;
  title: string;
  description: string | null;
  price: number | null;
  category: string | null;
  condition: string | null;
  item_specifics: Record<string, string>;
  image_urls: string[] | null;
  shipping_type: string | null;
  shipping_cost: number | null;
  handling_time: number | null;
  returns_accepted: boolean | null;
  return_period: number | null;
  return_shipping: string | null;
  promotion_rate: number | null;
  promotion_type: string | null;
  status: string | null;
}

interface EbayBatchPanelProps {
  projectId: string | null;
  rows: EbayRow[];
  onRowsChange: (rows: EbayRow[]) => void;
  nextLotNumber: number;
  onLotNumberChange: (num: number) => void;
}

export function EbayBatchPanel({ 
  projectId, 
  rows, 
  onRowsChange, 
  nextLotNumber, 
  onLotNumberChange 
}: EbayBatchPanelProps) {
  const [editingRow, setEditingRow] = useState<EbayRow | null>(null);
  const [viewingRow, setViewingRow] = useState<EbayRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [showUploadInstructions, setShowUploadInstructions] = useState(false);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this listing?")) return;
    
    const { error } = await supabase
      .from('ebay_batch_rows')
      .delete()
      .eq('id', id);
    
    if (error) {
      toast({ title: "Delete failed", variant: "destructive" });
      return;
    }
    
    onRowsChange(rows.filter(r => r.id !== id));
    toast({ title: "Listing deleted" });
  };

  const handleClearAll = async () => {
    if (!projectId) return;
    if (!confirm("Clear all eBay listings in this project?")) return;
    
    const { error } = await supabase
      .from('ebay_batch_rows')
      .delete()
      .eq('batch_id', projectId);
    
    if (error) {
      toast({ title: "Clear failed", variant: "destructive" });
      return;
    }
    
    onRowsChange([]);
    onLotNumberChange(1);
    toast({ title: "All eBay listings cleared" });
  };

  const handleSaveEdit = async () => {
    if (!editingRow) return;
    setSaving(true);
    
    const { error } = await supabase
      .from('ebay_batch_rows')
      .update({
        title: editingRow.title,
        description: editingRow.description,
        price: editingRow.price,
        category: editingRow.category,
        condition: editingRow.condition,
        item_specifics: editingRow.item_specifics,
        shipping_type: editingRow.shipping_type,
        shipping_cost: editingRow.shipping_cost,
        handling_time: editingRow.handling_time,
        returns_accepted: editingRow.returns_accepted,
        return_period: editingRow.return_period,
        return_shipping: editingRow.return_shipping,
        promotion_rate: editingRow.promotion_rate,
        promotion_type: editingRow.promotion_type,
      })
      .eq('id', editingRow.id);
    
    setSaving(false);
    
    if (error) {
      toast({ title: "Save failed", variant: "destructive" });
      return;
    }
    
    onRowsChange(rows.map(r => r.id === editingRow.id ? editingRow : r));
    setEditingRow(null);
    toast({ title: "Listing updated" });
  };

  // Generate CSV content (reusable helper)
  const generateCSVContent = () => {
    // eBay File Exchange format headers
    const headers = [
      "Action", "ItemID", "Title", "Description", "Category", "ConditionID",
      "PicURL", "Quantity", "StartPrice", "Format", "Duration",
      "ShippingType", "ShippingService-1:Option", "ShippingService-1:Cost",
      "DispatchTimeMax", "ReturnsAcceptedOption", "ReturnsWithinOption",
      "RefundOption", "ShippingCostPaidByOption",
      "PromotedListingsFeatureType", "PromotedListingsAdRate"
    ];

    // Add item specifics columns
    const allSpecifics = new Set<string>();
    rows.forEach(r => {
      if (r.item_specifics) {
        Object.keys(r.item_specifics).forEach(k => allSpecifics.add(k));
      }
    });
    const specificHeaders = Array.from(allSpecifics).map(s => `C:${s}`);
    const fullHeaders = [...headers, ...specificHeaders];

    const csvRows = rows.map(row => {
      const conditionMap: Record<string, string> = {
        "New": "1000",
        "Open box": "1500",
        "Used": "3000",
        "For parts": "7000",
      };

      const base = [
        "Add", // Action
        "", // ItemID (empty for new)
        row.title || "",
        row.description || "",
        row.category || "",
        conditionMap[row.condition || ""] || "3000",
        (row.image_urls || []).join("|"),
        "1", // Quantity
        row.price?.toString() || "0",
        "FixedPrice",
        "GTC",
        row.shipping_type === "free" ? "Free" : (row.shipping_type === "calculated" ? "Calculated" : "Flat"),
        "USPSPriority",
        row.shipping_cost?.toString() || "0",
        row.handling_time?.toString() || "3",
        row.returns_accepted ? "ReturnsAccepted" : "ReturnsNotAccepted",
        `Days_${row.return_period || 30}`,
        "MoneyBack",
        row.return_shipping === "seller" ? "Seller" : "Buyer",
        row.promotion_type === "fluctuating" ? "VARIABLE" : "STANDARD",
        row.promotion_rate?.toString() || "0"
      ];

      // Add item specifics values
      const specificValues = Array.from(allSpecifics).map(s => 
        row.item_specifics?.[s] || ""
      );

      return [...base, ...specificValues];
    });

    const csvContent = [
      fullHeaders.join(","),
      ...csvRows.map(row => row.map(cell => 
        `"${String(cell).replace(/"/g, '""')}"`
      ).join(","))
    ].join("\r\n"); // Use CRLF for better compatibility

    return csvContent;
  };

  const downloadCSV = () => {
    if (rows.length === 0) {
      toast({ title: "No data", description: "Add some listings first", variant: "destructive" });
      return;
    }

    const csvContent = generateCSVContent();

    // Add UTF-8 BOM for proper Google Sheets/Excel recognition
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ebay-listings-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link); // Required for iOS Safari
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({ title: "CSV Downloaded", description: `${rows.length} listings ready for eBay bulk upload` });
    setShowUploadInstructions(true);
  };
  if (!projectId) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Store className="h-5 w-5" />
          <span>Select a project to manage eBay listings</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={cn(
        "rounded-xl border p-4 space-y-4 transition-colors",
        rows.length > 0 ? "border-blue-500/50 bg-blue-500/5" : "border-border bg-card"
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-blue-500" />
            <div>
              <span className="font-semibold text-foreground">eBay Batch</span>
              <span className="text-muted-foreground ml-2">
                {rows.length} listings • Next: #{nextLotNumber}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              value={nextLotNumber}
              onChange={(e) => onLotNumberChange(parseInt(e.target.value) || 1)}
              className="w-20"
            />
            {rows.length > 0 && (
              <Button variant="gold" onClick={downloadCSV} className="gap-2">
                <Download className="h-4 w-4" />
                Download CSV for eBay
              </Button>
            )}
            {rows.length > 0 && (
              <Button variant="outline" onClick={handleClearAll}>
                Clear All
              </Button>
            )}
          </div>
        </div>

        {/* Upload Instructions */}
        {showUploadInstructions && (
          <Alert className="border-blue-500/50 bg-blue-500/5">
            <Upload className="h-4 w-4 text-blue-500" />
            <AlertDescription className="text-sm">
              <p className="font-medium mb-2">CSV downloaded! Now upload to eBay:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Go to <strong>Seller Hub → Listings → Create listing</strong></li>
                <li>Click <strong>"File upload"</strong></li>
                <li>Select <strong>"Create new drafts"</strong></li>
                <li>Upload the CSV file you just downloaded</li>
                <li>Review and publish your drafts</li>
              </ol>
              <Button 
                variant="link" 
                className="h-auto p-0 mt-2 gap-1"
                onClick={() => window.open('https://www.ebay.com/sh/lst', '_blank')}
              >
                <ExternalLink className="h-3 w-3" />
                Open eBay Seller Hub
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {rows.length > 0 && (
          <div className="border-t border-border pt-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Check className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">{rows.length} listings ready for export</span>
            </div>
            
            <div className="max-h-48 overflow-y-auto space-y-1">
              {rows.map((row) => (
                <div 
                  key={row.id} 
                  className="text-xs flex justify-between items-center py-2 px-3 bg-background/50 rounded hover:bg-background/80 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="font-mono text-muted-foreground">#{row.lot_number}</span>
                    <span className="truncate font-medium">{row.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-primary font-semibold">${row.price || 0}</span>
                    <span className="text-muted-foreground capitalize">{row.condition || "—"}</span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 w-7 p-0"
                      onClick={() => setViewingRow(row)}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 w-7 p-0"
                      onClick={() => setEditingRow(row)}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(row.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* View Dialog */}
      <Dialog open={!!viewingRow} onOpenChange={() => setViewingRow(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Listing #{viewingRow?.lot_number}</DialogTitle>
          </DialogHeader>
          {viewingRow && (
            <div className="space-y-4">
              {viewingRow.image_urls && viewingRow.image_urls.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {viewingRow.image_urls.map((url, i) => (
                    <img 
                      key={i} 
                      src={url} 
                      alt={`Image ${i + 1}`}
                      className="h-24 w-24 object-cover rounded"
                    />
                  ))}
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">Title</Label>
                <p className="font-medium">{viewingRow.title}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{viewingRow.description}</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Price</Label>
                  <p className="font-semibold text-primary">${viewingRow.price || 0}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Condition</Label>
                  <p>{viewingRow.condition || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Category</Label>
                  <p>{viewingRow.category || "—"}</p>
                </div>
              </div>
              {viewingRow.item_specifics && Object.keys(viewingRow.item_specifics).length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Item Specifics</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {Object.entries(viewingRow.item_specifics).map(([k, v]) => (
                      <div key={k} className="text-sm">
                        <span className="font-medium">{k}:</span> {v}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingRow} onOpenChange={() => setEditingRow(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Listing #{editingRow?.lot_number}</DialogTitle>
          </DialogHeader>
          {editingRow && (
            <div className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input 
                  value={editingRow.title}
                  onChange={(e) => setEditingRow({ ...editingRow, title: e.target.value })}
                />
              </div>
              <div>
                <Label>Description</Label>
                <textarea 
                  value={editingRow.description || ""}
                  onChange={(e) => setEditingRow({ ...editingRow, description: e.target.value })}
                  className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Price ($)</Label>
                  <Input 
                    type="number"
                    step="0.01"
                    value={editingRow.price || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, price: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <Label>Condition</Label>
                  <div className="flex gap-1 mt-1">
                    {["New", "Open box", "Used", "For parts"].map(cond => (
                      <Button
                        key={cond}
                        variant={editingRow.condition === cond ? "gold" : "outline"}
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => setEditingRow({ ...editingRow, condition: cond })}
                      >
                        {cond}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Category</Label>
                  <Input 
                    value={editingRow.category || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, category: e.target.value })}
                  />
                </div>
              </div>

              <EbayItemSpecificsEditor
                itemSpecifics={editingRow.item_specifics || {}}
                onChange={(specifics) => setEditingRow({ ...editingRow, item_specifics: specifics })}
              />

              <EbayShippingSettings
                settings={{
                  shippingType: (editingRow.shipping_type as "flat" | "calculated" | "free") || "flat",
                  shippingCost: editingRow.shipping_cost || 0,
                  handlingTime: editingRow.handling_time || 3,
                  returnsAccepted: editingRow.returns_accepted ?? true,
                  returnPeriod: editingRow.return_period || 30,
                  returnShipping: (editingRow.return_shipping as "buyer" | "seller") || "buyer",
                }}
                onChange={(settings) => setEditingRow({
                  ...editingRow,
                  shipping_type: settings.shippingType,
                  shipping_cost: settings.shippingCost,
                  handling_time: settings.handlingTime,
                  returns_accepted: settings.returnsAccepted,
                  return_period: settings.returnPeriod,
                  return_shipping: settings.returnShipping,
                })}
              />

              <div className="flex gap-4 pt-4 border-t">
                <div className="flex-1">
                  <Label>Promotion Rate (%)</Label>
                  <Input 
                    type="number"
                    step="0.1"
                    value={editingRow.promotion_rate || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, promotion_rate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="flex-1">
                  <Label>Promotion Type</Label>
                  <div className="flex gap-1 mt-1">
                    <Button
                      variant={editingRow.promotion_type === "flat" ? "gold" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditingRow({ ...editingRow, promotion_type: "flat" })}
                    >
                      Flat
                    </Button>
                    <Button
                      variant={editingRow.promotion_type === "fluctuating" ? "gold" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditingRow({ ...editingRow, promotion_type: "fluctuating" })}
                    >
                      Dynamic
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setEditingRow(null)}>
                  Cancel
                </Button>
                <Button variant="gold" onClick={handleSaveEdit} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
