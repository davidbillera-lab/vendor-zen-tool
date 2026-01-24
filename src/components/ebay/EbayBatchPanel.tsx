import { useEffect, useState } from "react";
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
import { generateListing } from "@/lib/api/listings";
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
  const [defaultCategoryId, setDefaultCategoryId] = useState<string>("");
  const [backfillingCategories, setBackfillingCategories] = useState(false);

  // Persist default category per project so it doesn't reset (prevents repeated "missing category" blocks)
  useEffect(() => {
    if (!projectId) return;
    try {
      const saved = localStorage.getItem(`ebayDefaultCategoryId:${projectId}`);
      if (saved) setDefaultCategoryId(saved);
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    try {
      const normalized = defaultCategoryId.trim();
      if (normalized) {
        localStorage.setItem(`ebayDefaultCategoryId:${projectId}`, normalized);
      } else {
        localStorage.removeItem(`ebayDefaultCategoryId:${projectId}`);
      }
    } catch {
      // ignore
    }
  }, [defaultCategoryId, projectId]);

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

  // Sanitize text for CSV - remove newlines that break parsing
  const sanitizeForCSV = (text: string): string => {
    return text
      .replace(/\r\n/g, ' ')  // Windows newlines
      .replace(/\n/g, ' ')     // Unix newlines
      .replace(/\r/g, ' ')     // Old Mac newlines
      .replace(/\s+/g, ' ')    // Collapse multiple spaces
      .trim();
  };

  // Convert description to basic HTML for eBay - MUST sanitize first to prevent CSV row breaks
  const toHtmlDescription = (text: string): string => {
    // First sanitize to remove ALL line breaks, then wrap in HTML
    const sanitized = sanitizeForCSV(text);
    // Double-escape quotes for CSV field embedding
    return `<p>${sanitized.replace(/"/g, '""')}</p>`;
  };

  // Generate CSV content matching eBay's official draft template
  const generateCSVContent = () => {
    // eBay's official draft template headers
    const baseHeaders = [
      "Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)",
      "Custom label (SKU)",
      "Category ID",
      "Title",
      "UPC",
      "Price",
      "Quantity",
      "Item photo URL",
      "Condition ID",
      "Description",
      "Format"
    ];

    // Collect all item specifics across all rows for C: columns
    const allSpecifics = new Set<string>();
    rows.forEach(r => {
      if (r.item_specifics) {
        Object.keys(r.item_specifics).forEach(k => allSpecifics.add(k));
      }
    });
    const specificHeaders = Array.from(allSpecifics).map(s => `C:${s}`);
    const fullHeaders = [...baseHeaders, ...specificHeaders];

    // eBay ConditionID must be numeric codes in the file-upload draft flow.
    // Common values:
    // - 1000 = New
    // - 3000 = Used
    // - 7000 = For parts or not working
    // Ref: eBay File Exchange / bulk upload conventions.
    const conditionMap: Record<string, string> = {
      "New": "1000",
      "Open box": "3000",
      "Used": "3000",
      "For parts": "7000",
    };

    const csvRows = rows.map((row, index) => {
      // Extract numeric category ID from category string (e.g. "Shoes (47140)" -> "47140")
      const extractedCategoryId = row.category?.match(/\d{3,}/)?.[0] || "";
      const fallbackCategoryId = defaultCategoryId.trim().match(/^\d{3,}$/) ? defaultCategoryId.trim() : "";
      const categoryId = extractedCategoryId || fallbackCategoryId;
      
      const base = [
        "Draft",
        row.lot_number?.toString() || (index + 1).toString(), // SKU = lot number
        categoryId,
        sanitizeForCSV(row.title || ""),
        "", // UPC - leave empty
        row.price?.toString() || "0",
        "1", // Quantity
        (row.image_urls || []).join("|"),
        conditionMap[row.condition || ""] || "3000",
        toHtmlDescription(row.description || ""),
        "FixedPrice"
      ];

      // Add item specifics values in order
      const specificValues = Array.from(allSpecifics).map(s => 
        sanitizeForCSV(row.item_specifics?.[s] || "")
      );

      return [...base, ...specificValues];
    });

    // Build CSV with info headers matching eBay template
    const infoLines = [
      '#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US',
      '#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html',
      '"#INFO After you\'ve successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts"',
      '#INFO'
    ];

    const csvContent = [
      ...infoLines,
      fullHeaders.join(","),
      ...csvRows.map(row => row.map(cell => 
        `"${String(cell).replace(/"/g, '""')}"`
      ).join(","))
    ].join("\r\n");

    return csvContent;
  };

  const getMissingCategoryLots = (): number[] => {
    const missing: number[] = [];
    rows.forEach((row, idx) => {
      const extractedCategoryId = row.category?.match(/\d{3,}/)?.[0] || "";
      const fallbackCategoryId = defaultCategoryId.trim().match(/^\d{3,}$/) ? defaultCategoryId.trim() : "";
      const categoryId = extractedCategoryId || fallbackCategoryId;
      if (!categoryId) {
        missing.push(row.lot_number ?? (idx + 1));
      }
    });
    return missing;
  };

  const backfillMissingCategoryIds = async () => {
    if (!projectId) return;
    const missingRowIds = rows
      .filter((row) => {
        const extractedCategoryId = row.category?.match(/\d{3,}/)?.[0] || "";
        return !extractedCategoryId;
      })
      .map((r) => r.id);

    if (missingRowIds.length === 0) {
      toast({ title: "All set", description: "All listings already have category IDs." });
      return;
    }

    setBackfillingCategories(true);
    try {
      const missingRows = rows.filter((r) => missingRowIds.includes(r.id));

      const results = await Promise.all(
        missingRows.map(async (row) => {
          if (!row.image_urls || row.image_urls.length === 0) {
            return { id: row.id, categoryId: null as number | null, error: "No images on this row" };
          }

          try {
            const listing = await generateListing(
              'ebay',
              row.image_urls,
              'Only identify the most accurate numeric eBay categoryId for the item shown. If unsure, choose the closest specific categoryId.'
            );

            const categoryId = (listing as any)?.categoryId;
            const asNum = Number(categoryId);
            if (!categoryId || Number.isNaN(asNum)) {
              return { id: row.id, categoryId: null as number | null, error: "No categoryId returned" };
            }

            const { error: updateError } = await supabase
              .from('ebay_batch_rows')
              .update({ category: String(asNum) })
              .eq('id', row.id);

            if (updateError) {
              return { id: row.id, categoryId: null as number | null, error: updateError.message };
            }

            return { id: row.id, categoryId: asNum, error: null as string | null };
          } catch (e) {
            return { id: row.id, categoryId: null as number | null, error: e instanceof Error ? e.message : 'Unknown error' };
          }
        })
      );

      const succeeded = results.filter((r) => r.error == null && r.categoryId != null);
      const failed = results.filter((r) => r.error != null);

      if (succeeded.length > 0) {
        onRowsChange(
          rows.map((r) => {
            const hit = succeeded.find((s) => s.id === r.id);
            return hit ? { ...r, category: String(hit.categoryId) } : r;
          })
        );
      }

      if (failed.length === 0) {
        toast({
          title: "Category IDs filled",
          description: `Updated ${succeeded.length} listing(s). You can download the CSV now.`,
        });
      } else {
        toast({
          title: "Some category IDs could not be filled",
          description: `Updated ${succeeded.length}. Failed ${failed.length}. Open the row(s) and try again or set a default ID as a fallback.`,
          variant: "destructive",
        });
      }
    } finally {
      setBackfillingCategories(false);
    }
  };

  const downloadCSV = () => {
    if (rows.length === 0) {
      toast({ title: "No data", description: "Add some listings first", variant: "destructive" });
      return;
    }

    const missingLots = getMissingCategoryLots();
    if (missingLots.length > 0) {
      const preview = missingLots.slice(0, 5).join(", ");
      toast({
        title: "Missing Category ID",
        description: `Add a numeric Category ID (or set a Default Category ID) for lot(s): ${preview}${missingLots.length > 5 ? "…" : ""}. eBay drafts won’t import without it.`,
        variant: "destructive",
      });
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

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Default Category ID</Label>
              <Input
                inputMode="numeric"
                placeholder="e.g. 12345"
                value={defaultCategoryId}
                onChange={(e) => {
                  // keep digits only; eBay category IDs are numeric
                  const digitsOnly = e.target.value.replace(/\D/g, "");
                  setDefaultCategoryId(digitsOnly);
                }}
                className="w-32"
              />
            </div>

            {rows.length > 0 && getMissingCategoryLots().length > 0 && (
              <Button
                variant="outline"
                onClick={backfillMissingCategoryIds}
                disabled={backfillingCategories}
                className="gap-2"
              >
                {backfillingCategories ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Auto-fill Category IDs
              </Button>
            )}

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
