import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Download, 
  Loader2, 
  Check, 
  Store, 
  Trash2,
  Edit2,
  Eye,
  Upload,
  ExternalLink,
  ImageOff
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
  // New fields for full desktop format
  subtitle: string | null;
  store_category: string | null;
  package_weight_lbs: number | null;
  package_weight_oz: number | null;
  package_length: number | null;
  package_width: number | null;
  package_height: number | null;
  best_offer_enabled: boolean | null;
  best_offer_auto_accept: number | null;
  minimum_best_offer: number | null;
  upc: string | null;
  brand: string | null;
  mpn: string | null;
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
  // eBay draft CSV requires a non-empty location (typically a ZIP/postal code or City, ST)
  const [itemLocation, setItemLocation] = useState<string>("");
  const [backfillingCategories, setBackfillingCategories] = useState(false);
  // Option to export without images to avoid EPS/self-hosted conflicts
  const [excludeImages, setExcludeImages] = useState(false);

  // Persist default category and location per project
  useEffect(() => {
    if (!projectId) return;
    try {
      const savedCategory = localStorage.getItem(`ebayDefaultCategoryId:${projectId}`);
      if (savedCategory) setDefaultCategoryId(savedCategory);
      const savedLocation = localStorage.getItem(`ebay_location_${projectId}`);
      if (savedLocation) setItemLocation(savedLocation);
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

  // Persist item location
  useEffect(() => {
    if (!projectId) return;
    try {
      const normalized = itemLocation.trim();
      if (normalized) {
        localStorage.setItem(`ebay_location_${projectId}`, normalized);
      } else {
        localStorage.removeItem(`ebay_location_${projectId}`);
      }
    } catch {
      // ignore
    }
  }, [itemLocation, projectId]);

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
        // New desktop format fields
        subtitle: editingRow.subtitle,
        store_category: editingRow.store_category,
        package_weight_lbs: editingRow.package_weight_lbs,
        package_weight_oz: editingRow.package_weight_oz,
        package_length: editingRow.package_length,
        package_width: editingRow.package_width,
        package_height: editingRow.package_height,
        best_offer_enabled: editingRow.best_offer_enabled,
        best_offer_auto_accept: editingRow.best_offer_auto_accept,
        minimum_best_offer: editingRow.minimum_best_offer,
        upc: editingRow.upc,
        brand: editingRow.brand,
        mpn: editingRow.mpn,
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

  // Generate CSV content using eBay's FULL desktop File Exchange format
  // This includes shipping, returns, package dimensions, and all required fields for complete listings
  // If excludeImages is true, we skip the image URLs to avoid EPS/self-hosted conflicts
  const generateCSVContent = (skipImages: boolean = false) => {
    // Get saved location from state/localStorage (eBay expects a ZIP/postal code or City, ST)
    const savedLocation = itemLocation.trim() || localStorage.getItem(`ebay_location_${projectId}`) || "";
    
    // eBay's FULL desktop File Exchange headers - matches the desktop Seller Hub form exactly
    // This format populates all sections: basic info, item specifics, condition, pricing, shipping, returns
    const baseHeaders = [
      "Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)",
      "Custom label (SKU)",
      "Category ID",
      "Store category",
      "Title",
      "Subtitle",
      "Relationship",
      "Relationship details",
      "P:UPC",
      "P:ISBN",
      "P:EAN",
      "P:EPID",
      "P:Brand",
      "P:MPN",
      "Start price",
      "Buy It Now price",
      "Quantity",
      "Item photo URL",
      "Condition ID",
      "Condition description",
      "Description",
      "Format",
      "Duration",
      "Best Offer enabled",
      "Best Offer auto-accept price",
      "Minimum best offer price",
      "Location",
      "Postcode",
      // Package dimensions for calculated shipping
      "WeightMajor",
      "WeightMinor",
      "WeightUnit",
      "PackageLength",
      "PackageWidth",
      "PackageDepth",
      "MeasurementUnit",
      // Shipping settings
      "*Shipping profile name",
      "*Return profile name",
      "*Payment profile name",
      "Shipping service 1 option",
      "Shipping service 1 cost",
      "Shipping service 1 additional cost",
      "Shipping service 2 option",
      "Shipping service 2 cost",
      "Max dispatch time",
      "Domestic handling costs",
      // International shipping
      "IntlShippingService-1:Option",
      "IntlShippingService-1:Cost",
      "IntlShippingService-1:Locations",
      // Returns
      "Returns accepted option",
      "Returns within option",
      "Refund option",
      "Return shipping cost paid by",
      // Promoted listings
      "eBay Promoted Listings",
      "Ad rate",
      // Payment
      "Immediate pay required"
    ];

    // Collect all item specifics across all rows for C: columns
    const allSpecifics = new Set<string>();
    rows.forEach(r => {
      if (r.item_specifics) {
        Object.keys(r.item_specifics).forEach(k => allSpecifics.add(k));
      }
      // Also add brand if specified separately
      if (r.brand) allSpecifics.add("Brand");
    });
    const specificHeaders = Array.from(allSpecifics).map(s => `C:${s}`);
    const fullHeaders = [...baseHeaders, ...specificHeaders];

    // eBay ConditionID must be numeric codes
    // Full mapping from eBay desktop form
    const conditionMap: Record<string, string> = {
      "New": "1000",
      "New with tags": "1000",
      "New other": "1500",
      "New without tags": "1500",
      "Open box": "1500",
      "Certified refurbished": "2000",
      "Excellent - Refurbished": "2010",
      "Very Good - Refurbished": "2020",
      "Good - Refurbished": "2030",
      "Seller refurbished": "2500",
      "Used": "3000",
      "Pre-owned": "3000",
      "Pre-owned - Excellent": "3000",
      "Pre-owned - Good": "4000",
      "Pre-owned - Fair": "5000",
      "For parts": "7000",
      "For parts or not working": "7000",
    };

    // Shipping service codes for eBay
    const getShippingService = (type: string | null): string => {
      switch (type) {
        case "free": return "USPSMedia";
        case "flat": return "USPSPriority";
        case "calculated": return "USPSPriority";
        default: return "USPSMedia";
      }
    };

    const csvRows = rows.map((row, index) => {
      // Extract numeric category ID from category string (e.g. "Shoes (47140)" -> "47140")
      const extractedCategoryId = row.category?.match(/\d{3,}/)?.[0] || "";
      const fallbackCategoryId = defaultCategoryId.trim().match(/^\d{3,}$/) ? defaultCategoryId.trim() : "";
      const categoryId = extractedCategoryId || fallbackCategoryId;
      
      // Determine shipping cost (0 for free shipping)
      const shippingCost = row.shipping_type === "free" ? "0" : (row.shipping_cost?.toString() || "0");
      
      // Extract postcode from location
      const postcodeMatch = savedLocation.match(/\d{5}/);
      const postcode = postcodeMatch ? postcodeMatch[0] : "";
      
      const base = [
        "Add", // Use "Add" for full desktop format (creates as active or scheduled)
        row.lot_number?.toString() || (index + 1).toString(), // SKU = lot number
        categoryId,
        row.store_category || "", // Store category
        sanitizeForCSV((row.title || "").substring(0, 80)), // Truncate to 80 chars max
        sanitizeForCSV(row.subtitle || ""), // Subtitle ($2 fee)
        "", // Relationship - empty for single items
        "", // Relationship details
        row.upc || "", // P:UPC
        "", // P:ISBN
        "", // P:EAN
        "", // P:EPID
        row.brand || "", // P:Brand
        row.mpn || "", // P:MPN
        row.price?.toString() || "0", // Start price
        "", // Buy It Now price (for auctions)
        "1", // Quantity
        skipImages ? "" : (row.image_urls || []).join("|"), // Skip images if requested
        conditionMap[row.condition || ""] || "3000",
        "", // Condition description
        toHtmlDescription(row.description || ""),
        "FixedPrice",
        "GTC", // Good 'Til Cancelled
        row.best_offer_enabled !== false ? "1" : "0", // Best Offer enabled
        row.best_offer_auto_accept?.toString() || "", // Best Offer auto-accept price
        row.minimum_best_offer?.toString() || "", // Minimum best offer price
        savedLocation, // Location - REQUIRED by eBay
        postcode, // Postcode
        // Package dimensions
        row.package_weight_lbs?.toString() || "", // WeightMajor
        row.package_weight_oz?.toString() || "", // WeightMinor
        row.package_weight_lbs || row.package_weight_oz ? "lb" : "", // WeightUnit
        row.package_length?.toString() || "", // PackageLength
        row.package_width?.toString() || "", // PackageWidth  
        row.package_height?.toString() || "", // PackageDepth
        row.package_length || row.package_width || row.package_height ? "in" : "", // MeasurementUnit
        // Shipping profiles (leave empty to use manual settings)
        "", // Shipping profile name
        "", // Return profile name
        "", // Payment profile name
        getShippingService(row.shipping_type), // Shipping service 1 option
        shippingCost, // Shipping service 1 cost
        "", // Shipping service 1 additional cost
        "", // Shipping service 2 option
        "", // Shipping service 2 cost
        row.handling_time?.toString() || "3", // Max dispatch time (days)
        "", // Domestic handling costs
        // International shipping - leave empty to avoid eBay validation errors
        // Only include if user explicitly sets up international shipping
        "", // IntlShippingService-1:Option (empty = no international shipping)
        "", // IntlShippingService-1:Cost
        "", // IntlShippingService-1:Locations
        // Returns
        row.returns_accepted ? "ReturnsAccepted" : "ReturnsNotAccepted",
        row.return_period ? `Days_${row.return_period}` : "Days_30",
        "MoneyBack", // Refund option
        row.return_shipping === "buyer" ? "Buyer" : "Seller",
        // Promoted listings
        row.promotion_rate && row.promotion_rate > 0 ? "1" : "0",
        row.promotion_rate?.toString() || "",
        // Payment
        "0" // Immediate pay required
      ];

      // Add item specifics values in order
      const specificValues = Array.from(allSpecifics).map(s => {
        // Check if it's brand and we have a separate brand field
        if (s === "Brand" && row.brand) return sanitizeForCSV(row.brand);
        return sanitizeForCSV(row.item_specifics?.[s] || "");
      });

      return [...base, ...specificValues];
    });

    // Build CSV with standard eBay File Exchange format
    const csvContent = [
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

  // Get lots with titles exceeding 80 characters
  const getOverlongTitleLots = (): number[] => {
    return rows
      .filter(row => (row.title?.length || 0) > 80)
      .map((row, idx) => row.lot_number ?? (idx + 1));
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

    const normalizedLocation = itemLocation.trim() || localStorage.getItem(`ebay_location_${projectId}`) || "";
    if (!normalizedLocation) {
      toast({
        title: "Missing Location",
        description: "eBay requires an Item location (usually a ZIP/postal code or City, ST). Add it once, then re-download.",
        variant: "destructive",
      });
      return;
    }

    const csvContent = generateCSVContent(excludeImages);

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
    
    const imageNote = excludeImages ? " (without images - add them in Seller Hub)" : "";
    toast({ title: "CSV Downloaded", description: `${rows.length} listings ready for eBay bulk upload${imageNote}` });
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
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Location</Label>
              <Input
                placeholder="ZIP or City, ST"
                value={itemLocation}
                onChange={(e) => setItemLocation(e.target.value)}
                className="w-40"
              />
            </div>

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
              <div className="flex items-center gap-2">
                <Checkbox
                  id="exclude-images"
                  checked={excludeImages}
                  onCheckedChange={(checked) => setExcludeImages(checked === true)}
                />
                <Label htmlFor="exclude-images" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                  <ImageOff className="h-3 w-3" />
                  Export without images
                </Label>
              </div>
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
              <p className="font-medium mb-2">CSV downloaded! Upload to eBay (Desktop):</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Go to <strong>Seller Hub → Reports</strong></li>
                <li>Click <strong>"Upload"</strong> in the top right</li>
                <li>Select <strong>"Add, revise, relist, or end listings"</strong></li>
                <li>Upload the CSV file you just downloaded</li>
                <li>Review the upload results - listings will be created as active</li>
                {excludeImages && (
                  <li className="text-amber-600 font-medium">Add images to each listing directly in Seller Hub</li>
                )}
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                Using the full desktop File Exchange format with shipping, returns, and all fields pre-filled.
              </p>
              {excludeImages && (
                <p className="text-xs text-amber-600 mt-1">
                  <ImageOff className="h-3 w-3 inline mr-1" />
                  Images were excluded to avoid EPS conflicts. Add them through eBay's interface.
                </p>
              )}
              <Button 
                variant="link" 
                className="h-auto p-0 mt-2 gap-1"
                onClick={() => window.open('https://www.ebay.com/sh/reports/uploads', '_blank')}
              >
                <ExternalLink className="h-3 w-3" />
                Open eBay Reports (Desktop Upload)
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
              {/* Title & Subtitle */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Title (80 chars max)</Label>
                  <Input 
                    value={editingRow.title}
                    onChange={(e) => setEditingRow({ ...editingRow, title: e.target.value })}
                    maxLength={80}
                  />
                  <span className="text-xs text-muted-foreground">{editingRow.title?.length || 0}/80</span>
                </div>
                <div>
                  <Label>Subtitle (55 chars, +$2)</Label>
                  <Input 
                    value={editingRow.subtitle || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, subtitle: e.target.value })}
                    maxLength={55}
                    placeholder="Optional - adds $2 fee"
                  />
                  <span className="text-xs text-muted-foreground">{editingRow.subtitle?.length || 0}/55</span>
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <textarea 
                  value={editingRow.description || ""}
                  onChange={(e) => setEditingRow({ ...editingRow, description: e.target.value })}
                  className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              {/* Pricing & Condition */}
              <div className="grid grid-cols-4 gap-4">
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
                  <div className="flex flex-wrap gap-1 mt-1">
                    {["New", "New other", "Used", "For parts"].map(cond => (
                      <Button
                        key={cond}
                        variant={editingRow.condition === cond ? "gold" : "outline"}
                        size="sm"
                        className="text-xs"
                        onClick={() => setEditingRow({ ...editingRow, condition: cond })}
                      >
                        {cond}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Category ID</Label>
                  <Input 
                    value={editingRow.category || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, category: e.target.value })}
                    placeholder="e.g. 53159"
                  />
                </div>
                <div>
                  <Label>Store Category</Label>
                  <Input 
                    value={editingRow.store_category || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, store_category: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
              </div>

              {/* Product Identifiers */}
              <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border">
                <div>
                  <Label>Brand</Label>
                  <Input 
                    value={editingRow.brand || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, brand: e.target.value })}
                    placeholder="e.g. Nike, Handmade"
                  />
                </div>
                <div>
                  <Label>UPC</Label>
                  <Input 
                    value={editingRow.upc || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, upc: e.target.value })}
                    placeholder="12-digit barcode"
                  />
                </div>
                <div>
                  <Label>MPN</Label>
                  <Input 
                    value={editingRow.mpn || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, mpn: e.target.value })}
                    placeholder="Manufacturer Part #"
                  />
                </div>
              </div>

              <EbayItemSpecificsEditor
                itemSpecifics={editingRow.item_specifics || {}}
                onChange={(specifics) => setEditingRow({ ...editingRow, item_specifics: specifics })}
              />

              {/* Best Offer Settings */}
              <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="best-offer"
                    checked={editingRow.best_offer_enabled !== false}
                    onCheckedChange={(checked) => setEditingRow({ ...editingRow, best_offer_enabled: checked === true })}
                  />
                  <Label htmlFor="best-offer" className="cursor-pointer">Best Offer Enabled</Label>
                </div>
                <div>
                  <Label>Auto-Accept Price ($)</Label>
                  <Input 
                    type="number"
                    step="0.01"
                    value={editingRow.best_offer_auto_accept || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, best_offer_auto_accept: parseFloat(e.target.value) || undefined })}
                    placeholder="Auto-accept above"
                    disabled={editingRow.best_offer_enabled === false}
                  />
                </div>
                <div>
                  <Label>Minimum Offer ($)</Label>
                  <Input 
                    type="number"
                    step="0.01"
                    value={editingRow.minimum_best_offer || ""}
                    onChange={(e) => setEditingRow({ ...editingRow, minimum_best_offer: parseFloat(e.target.value) || undefined })}
                    placeholder="Auto-decline below"
                    disabled={editingRow.best_offer_enabled === false}
                  />
                </div>
              </div>

              {/* Package Dimensions */}
              <div className="pt-3 border-t border-border">
                <Label className="text-sm font-medium mb-2 block">Package Dimensions (for calculated shipping)</Label>
                <div className="grid grid-cols-5 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Weight (lbs)</Label>
                    <Input 
                      type="number"
                      step="0.1"
                      value={editingRow.package_weight_lbs || ""}
                      onChange={(e) => setEditingRow({ ...editingRow, package_weight_lbs: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Weight (oz)</Label>
                    <Input 
                      type="number"
                      step="0.1"
                      value={editingRow.package_weight_oz || ""}
                      onChange={(e) => setEditingRow({ ...editingRow, package_weight_oz: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Length (in)</Label>
                    <Input 
                      type="number"
                      step="0.1"
                      value={editingRow.package_length || ""}
                      onChange={(e) => setEditingRow({ ...editingRow, package_length: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Width (in)</Label>
                    <Input 
                      type="number"
                      step="0.1"
                      value={editingRow.package_width || ""}
                      onChange={(e) => setEditingRow({ ...editingRow, package_width: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Height (in)</Label>
                    <Input 
                      type="number"
                      step="0.1"
                      value={editingRow.package_height || ""}
                      onChange={(e) => setEditingRow({ ...editingRow, package_height: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              </div>

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
