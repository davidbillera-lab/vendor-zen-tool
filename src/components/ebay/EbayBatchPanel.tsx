import { useEffect, useState, useMemo } from "react";
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
  ImageOff,
  ImagePlus,
  Send,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { generateListing } from "@/lib/api/listings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EbayItemSpecificsEditor } from "./EbayItemSpecificsEditor";
import { EbayShippingSettings, type ShippingSettings } from "./EbayShippingSettings";
import { DraggableImageGrid } from "../DraggableImageGrid";
import { ImageEnhancer } from "../ImageEnhancer";

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
  const DEFAULT_SHIPPING_TYPE = "flat" as const;
  const DEFAULT_SHIPPING_COST = 9.98;
  const DEFAULT_HANDLING_TIME = 1;
  const DEFAULT_RETURNS_ACCEPTED = true;
  const DEFAULT_RETURN_PERIOD = 30;
  const DEFAULT_RETURN_SHIPPING = "seller" as const;
  const DEFAULT_PROMOTION_RATE = 5;
  const DEFAULT_PROMOTION_TYPE = "flat" as const;

  const [editingRow, setEditingRow] = useState<EbayRow | null>(null);
  const [viewingRow, setViewingRow] = useState<EbayRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [showUploadInstructions, setShowUploadInstructions] = useState(false);
  const [showCSVPreview, setShowCSVPreview] = useState(false);
  const [csvPreviewContent, setCsvPreviewContent] = useState("");
  const [pendingCSVBlob, setPendingCSVBlob] = useState<Blob | null>(null);
  const [defaultCategoryId, setDefaultCategoryId] = useState<string>("");
  const [itemLocation, setItemLocation] = useState<string>("80129");
  const [backfillingCategories, setBackfillingCategories] = useState(false);
  const [excludeImages, setExcludeImages] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [zapierWebhookUrl, setZapierWebhookUrl] = useState("https://hooks.zapier.com/hooks/catch/26172063/uqfpdh0/");
  const [sendingToZapier, setSendingToZapier] = useState(false);
  const [showZapierConfig, setShowZapierConfig] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [shippingProfileName, setShippingProfileName] = useState<string>("");
  const [returnProfileName, setReturnProfileName] = useState<string>("");
  const [paymentProfileName, setPaymentProfileName] = useState<string>("");
  const [fullCsvContent, setFullCsvContent] = useState<string>("");
  const [pendingDeleteIds, setPendingDeleteIds] = useState<{ ids: string[]; count: number } | null>(null);

  // Persist default category and location per project
  useEffect(() => {
    if (!projectId) return;
    try {
      const savedCategory = localStorage.getItem(`ebayDefaultCategoryId:${projectId}`);
      if (savedCategory) setDefaultCategoryId(savedCategory);
      const savedLocation = localStorage.getItem(`ebay_location_${projectId}`);
      if (savedLocation) setItemLocation(savedLocation);
      const savedWebhook = localStorage.getItem(`ebay_zapier_webhook`);
      if (savedWebhook) setZapierWebhookUrl(savedWebhook);
      const savedShippingProfile = localStorage.getItem(`ebay_shipping_profile_${projectId}`);
      if (savedShippingProfile) setShippingProfileName(savedShippingProfile);
      const savedReturnProfile = localStorage.getItem(`ebay_return_profile_${projectId}`);
      if (savedReturnProfile) setReturnProfileName(savedReturnProfile);
      const savedPaymentProfile = localStorage.getItem(`ebay_payment_profile_${projectId}`);
      if (savedPaymentProfile) setPaymentProfileName(savedPaymentProfile);
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

  // Persist eBay Business Policy profile names
  useEffect(() => {
    if (!projectId) return;
    try {
      if (shippingProfileName.trim()) localStorage.setItem(`ebay_shipping_profile_${projectId}`, shippingProfileName.trim());
      else localStorage.removeItem(`ebay_shipping_profile_${projectId}`);
      if (returnProfileName.trim()) localStorage.setItem(`ebay_return_profile_${projectId}`, returnProfileName.trim());
      else localStorage.removeItem(`ebay_return_profile_${projectId}`);
      if (paymentProfileName.trim()) localStorage.setItem(`ebay_payment_profile_${projectId}`, paymentProfileName.trim());
      else localStorage.removeItem(`ebay_payment_profile_${projectId}`);
    } catch {
      // ignore
    }
  }, [shippingProfileName, returnProfileName, paymentProfileName, projectId]);

  const normalizeRowDefaults = (row: EbayRow): EbayRow => ({
    ...row,
    shipping_type: row.shipping_type || DEFAULT_SHIPPING_TYPE,
    shipping_cost: row.shipping_cost ?? DEFAULT_SHIPPING_COST,
    handling_time: row.handling_time ?? DEFAULT_HANDLING_TIME,
    returns_accepted: row.returns_accepted ?? DEFAULT_RETURNS_ACCEPTED,
    return_period: row.return_period ?? DEFAULT_RETURN_PERIOD,
    return_shipping: row.return_shipping || DEFAULT_RETURN_SHIPPING,
    promotion_rate: row.promotion_rate ?? DEFAULT_PROMOTION_RATE,
    promotion_type: row.promotion_type || DEFAULT_PROMOTION_TYPE,
  });

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

    const normalizedRow = normalizeRowDefaults(editingRow);
    
    const { error } = await supabase
      .from('ebay_batch_rows')
      .update({
        title: normalizedRow.title,
        description: normalizedRow.description,
        price: normalizedRow.price,
        category: normalizedRow.category,
        condition: normalizedRow.condition,
        item_specifics: normalizedRow.item_specifics,
        shipping_type: normalizedRow.shipping_type,
        shipping_cost: normalizedRow.shipping_cost,
        handling_time: normalizedRow.handling_time,
        returns_accepted: normalizedRow.returns_accepted,
        return_period: normalizedRow.return_period,
        return_shipping: normalizedRow.return_shipping,
        promotion_rate: normalizedRow.promotion_rate,
        promotion_type: normalizedRow.promotion_type,
        // New desktop format fields
        subtitle: normalizedRow.subtitle,
        store_category: normalizedRow.store_category,
        package_weight_lbs: normalizedRow.package_weight_lbs,
        package_weight_oz: normalizedRow.package_weight_oz,
        package_length: normalizedRow.package_length,
        package_width: normalizedRow.package_width,
        package_height: normalizedRow.package_height,
        best_offer_enabled: normalizedRow.best_offer_enabled,
        best_offer_auto_accept: normalizedRow.best_offer_auto_accept,
        minimum_best_offer: normalizedRow.minimum_best_offer,
        upc: normalizedRow.upc,
        brand: normalizedRow.brand,
        mpn: normalizedRow.mpn,
      })
      .eq('id', normalizedRow.id);
    
    setSaving(false);
    
    if (error) {
      toast({ title: "Save failed", variant: "destructive" });
      return;
    }
    
    onRowsChange(rows.map(r => r.id === normalizedRow.id ? normalizedRow : r));
    setEditingRow(null);
    toast({ title: "Listing updated" });
  };

  // Sanitize text for CSV - remove newlines that break parsing
  const sanitizeForCSV = (text: string): string => {
    return text
      .replace(/\r\n/g, ' ')  // Windows newlines
      .replace(/\n/g, ' ')     // Unix newlines
      .replace(/\r/g, ' ')     // Old Mac newlines
      .replace(/"/g, '')       // eBay prohibits quotation marks in titles/text
      .replace(/\s+/g, ' ')    // Collapse multiple spaces
      .trim();
  };

  // Convert description to basic HTML for eBay - MUST sanitize first to prevent CSV row breaks
  const toHtmlDescription = (text: string): string => {
    // First sanitize to remove ALL line breaks, then wrap in HTML
    const sanitized = sanitizeForCSV(text);
    // Do NOT escape quotes here - the final CSV builder wraps each cell in quotes
    // and escapes internal quotes via .replace(/"/g, '""') at line ~529
    return `<p>${sanitized}</p>`;
  };

  // Categories that eBay has deprecated or remapped — warn before export
  const DEPRECATED_CATEGORIES: Record<number, { replacement: number; label: string }> = {
    159769: { replacement: 33164,  label: "Christmas Wreaths → 33164" },
    128035: { replacement: 170083, label: "Holiday Décor → 170083" },
    11450:  { replacement: 57990,  label: "Clothing parent → pick a leaf" },
    550:    { replacement: 360,    label: "Art parent → Art Prints 360" },
    20081:  { replacement: 162032, label: "Home Décor parent → Figurines 162032" },
    // Toys & Hobbies — root ID is 220 (confirmed eBay April 2026). 1188 was also blocked historically.
    220:    { replacement: 31787,  label: "Toys & Hobbies root (220) — use a leaf: 31787 model kits, 261068 action figures, 262318 HO trains" },
    1188:   { replacement: 31787,  label: "Toys & Hobbies old ID (1188) → Military Model Kits 31787" },
    51028:  { replacement: 31787,  label: "Models & Kits parent → Military Model Kits 31787" },
    180250: { replacement: 262318, label: "Model Railroads & Trains parent (180250) → HO Scale Trains 262318" },
    20601:  { replacement: 20668,  label: "Bedding parent → Blankets & Throws 20668" },
    19130:  { replacement: 262318, label: "Old HO Trains ID → HO Scale 262318" },
    2611:   { replacement: 31787,  label: "Aircraft Model Kits 2611 deprecated — eBay remaps to games. Use Military Model Kits 31787" },
    // Root/parent categories — eBay error 87 if used directly (confirmed April 2026 from eBay category list)
    11450:  { replacement: 0,      label: "Clothing, Shoes & Accessories root (11450) — select specific leaf category" },
    267:    { replacement: 0,      label: "Books & Magazines root (267) — use leaf: 29223 antiquarian, 171228 fiction, 183387 nonfiction, 280 magazines" },
    281:    { replacement: 0,      label: "Jewelry & Watches root (281) — use leaf: 31387 watches, 67681 rings, 67652 necklaces, 10968 fashion jewelry" },
    293:    { replacement: 0,      label: "Consumer Electronics root (293) — use leaf: 112529 Bluetooth headphones" },
    550:    { replacement: 360,    label: "Art root (550) → Art Prints 360 (or 551 paintings, 60628 sculptures)" },
    619:    { replacement: 0,      label: "Musical Instruments root (619) — use leaf: 33034 guitars, 16220 keyboards, 180014 brass" },
    625:    { replacement: 0,      label: "Cameras & Photo root (625) — use leaf: 31388 digital, 15230 vintage, 11724 camcorders, 30106 lenses" },
    237:    { replacement: 238,    label: "Dolls & Bears root (237) → Barbie 238 (or 16497 vintage dolls, 2228 teddy bears)" },
    260:    { replacement: 261,    label: "Stamps root (260) → US Stamps 261 (or 262 world stamps)" },
    870:    { replacement: 916,    label: "Pottery & Glass root (870) → Glass 916 (or 45237 vases)" },
    888:    { replacement: 0,      label: "Sporting Goods root (888) — use leaf: 15273 fitness equipment, 1513 golf, 1492 fishing" },
    1:      { replacement: 162032, label: "Collectibles root (1) → Figurines 162032 (or 36018 plates, 33164 Christmas wreaths)" },
    1249:   { replacement: 139971, label: "Video Games & Consoles root (1249) → Video Game Consoles 139971" },
    11116:  { replacement: 253,    label: "Coins & Paper Money root (11116) → US Coins 253 (or 256 world coins, 3412 paper money)" },
    11232:  { replacement: 617,    label: "Movies & TV root (11232) → DVDs & Blu-ray 617 (or 309 VHS)" },
    11233:  { replacement: 306,    label: "Music root (11233) → Vinyl Records 306 (or 176984 CDs)" },
    11700:  { replacement: 177005, label: "Home & Garden root (11700) → Kitchen & Steak Knives 177005 (pick correct leaf)" },
    20081:  { replacement: 0,      label: "Antiques root (20081) — use leaf: 20091 furniture, 20086 decorative arts, 37978 rugs" },
    45100:  { replacement: 0,      label: "Entertainment Memorabilia root (45100) — select specific leaf category" },
    20625:  { replacement: 177005, label: "Kitchen, Dining & Bar parent (20625) → Kitchen & Steak Knives 177005" },
    20637:  { replacement: 177005, label: "Flatware, Knives & Cutlery parent (20637) → Kitchen & Steak Knives 177005" },
    // AI-hallucinated / invalid IDs — eBay error 107 "Category is not valid"
    177708: { replacement: 0, label: "Invalid category 177708 — eBay error 107. Select correct leaf category manually." },
  };

  // Per-category required item specifics with auto-fill defaults.
  // "default" = value to inject automatically if missing (blank string = must be filled manually).
  // Add new entries here as eBay rejects listings for missing fields.
  const CATEGORY_REQUIRED_SPECIFICS: Record<number, { field: string; default: string }[]> = {
    // Military Vehicle Model Kits — requires Shade (eBay error 21919303)
    31787: [{ field: "Shade", default: "Multicolor" }],
    // Ship/Boat Model Kits
    37278: [{ field: "Shade", default: "Multicolor" }],
    // Car/Truck Model Kits
    51023: [{ field: "Shade", default: "Multicolor" }],
    // Figure Model Kits
    19063: [{ field: "Shade", default: "Multicolor" }],
    // Blankets & Throws — eBay remapped to 133704 which requires Model (eBay error 21919303)
    20668: [{ field: "Model", default: "" }],
    133704: [{ field: "Model", default: "" }],
    // Men's Clothing — Department auto-filled; Size falls back to "See Description" if AI didn't provide it
    21235: [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's T-Shirts
    57990: [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's Casual Shirts
    57991: [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's Dress Shirts
    11483: [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's Jeans
    57989: [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's Dress Pants
    11484: [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's Sweaters
    3001:  [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's Suits & Blazers
    15709: [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's Athletic Shoes
    24087: [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's Casual Shoes
    53120: [{ field: "Department", default: "Men" }, { field: "Size", default: "See Description" }],  // Men's Dress Shoes
    // Women's Clothing — Department auto-filled; Size falls back to "See Description" if AI didn't provide it
    63862: [{ field: "Department", default: "Women" }, { field: "Size", default: "See Description" }], // Women's Coats & Jackets
    53159: [{ field: "Department", default: "Women" }, { field: "Size", default: "See Description" }], // Women's Tops & Blouses
    63861: [{ field: "Department", default: "Women" }, { field: "Size", default: "See Description" }], // Women's Dresses
    11554: [{ field: "Department", default: "Women" }, { field: "Size", default: "See Description" }], // Women's Jeans
    63866: [{ field: "Department", default: "Women" }, { field: "Size", default: "See Description" }], // Women's Sweaters
    185176:[{ field: "Department", default: "Women" }, { field: "Size", default: "See Description" }], // Women's Activewear
    55793: [{ field: "Department", default: "Women" }, { field: "Size", default: "See Description" }], // Women's Pumps & Heels
    45333: [{ field: "Department", default: "Women" }, { field: "Size", default: "See Description" }], // Women's Flats
    95672: [{ field: "Department", default: "Women" }, { field: "Size", default: "See Description" }], // Women's Athletic Shoes
    // Camcorders — Condition 3000 (Used) is valid, but Condition 1000 (New) is not for most camcorder subcats
    // (no auto-fill needed, just a reminder that condition matters)
  };

  // Known valid leaf categories for quick reference
  const KNOWN_LEAF_CATEGORIES: Record<number, string> = {
    // Men's Clothing
    57988: "Men's Coats & Jackets",
    185099: "Men's Vests",
    57990: "Men's Casual Shirts",
    57991: "Men's Dress Shirts",
    11483: "Men's Jeans",
    57989: "Men's Dress Pants",
    11484: "Men's Sweaters",
    3001: "Men's Suits & Blazers",
    // Women's Clothing
    63862: "Women's Coats & Jackets",
    53159: "Women's Tops",
    63861: "Women's Dresses",
    11554: "Women's Jeans",
    63866: "Women's Sweaters",
    185176: "Women's Activewear",
    // Jewelry
    67681: "Fine Rings",
    67652: "Fine Necklaces",
    10968: "Costume Jewelry",
    31387: "Wristwatches",
    // Art
    360: "Art Prints",
    551: "Paintings",
    60628: "Sculptures & Carvings",
    158658: "Mixed Media Art",
    // Collectibles
    162032: "Home Figurines",
    36018: "Decorative Plates",
    48579: "Vintage Jewelry",
    // Home — Knives & cutlery
    177005: "Kitchen & Steak Knives",      // leaf under 20637 > 20625 > 11700
    20637:  "Flatware, Knives & Cutlery",  // NOTE: this is a parent — use 177005 for individual knives
    // Home — Décor & lighting
    20625: "Kitchen Glassware",
    112581: "Table Lamps",
    20706: "Floor Lamps",
    45510: "Area Rugs",
    // Bedding
    20668: "Blankets & Throws",
    20677: "Bed Pillows",
    20672: "Comforters & Sets",
    20675: "Sheet Sets",
    20681: "Mattress Pads & Toppers",
    // Shoes
    15709: "Men's Athletic Shoes",
    24087: "Men's Loafers",
    53120: "Men's Dress Shoes",
    55793: "Women's Pumps",
    45333: "Women's Flats",
    95672: "Women's Athletic Shoes",
    // Bags
    169291: "Women's Shoulder/Crossbody",
    169285: "Women's Totes",
    4250: "Men's Bags",
    // Electronics
    112529: "Wireless Headphones",
    31388: "Digital Cameras",
    11724: "Camcorders & Video Cameras",
    15230: "Vintage Cameras",
    139971: "Video Game Consoles",
    // Toys
    261068: "Action Figures",
    180349: "Board Games",
    // Model Kits (use 31787 for all military/aircraft kits — 2611 is deprecated, eBay remaps it to a games category)
    31787: "Military & Aircraft Model Kits",
    37278: "Ship/Boat Model Kits",
    51023: "Car/Truck Model Kits",
    19063: "Figure Model Kits",
    // Model Trains
    262318: "HO Scale Trains",
    47006: "N Scale Trains",
    47004: "O Scale Trains",
    47002: "G Scale Trains",
    4748: "Model Train Accessories",
    // Seasonal / Holiday
    33164: "Christmas Wreaths",
    170091: "Christmas Ornaments",
    170098: "Christmas Stockings",
    170083: "Other Christmas Décor",
    116022: "Seasonal Home Décor",
  };

  // Get lots missing required item specifics for their category
  // Note: clothing-category check removed — JSG deals in liquidation/estate items, not clothing.
  // AI sometimes assigns wrong clothing category IDs; that check caused false blocking errors.
  const getMissingItemSpecificsLots = (sourceRows: EbayRow[] = rows): { lotNumber: number; missing: string[] }[] => {
    const results: { lotNumber: number; missing: string[] }[] = [];

    sourceRows.forEach((row, idx) => {
      const categoryId = parseInt(row.category?.match(/\d{3,}/)?.[0] || "0");
      const missing: string[] = [];

      // Check category-specific required fields that have no auto-fill default
      const catRequired = CATEGORY_REQUIRED_SPECIFICS[categoryId] || [];
      const specs = row.item_specifics || {};
      catRequired.forEach(({ field, default: def }) => {
        // Only warn if there's no default (empty default = must be filled manually)
        if (def === "" && !specs[field]) {
          missing.push(field);
        }
      });

      if (missing.length > 0) {
        results.push({ lotNumber: row.lot_number ?? (idx + 1), missing });
      }
    });

    return results;
  };

  // Generate CSV content using eBay's official category listing template format
  // Matches the template downloaded from Seller Hub Reports (Version=1193)
  const generateCSVContent = (skipImages: boolean = false, sourceRows: EbayRow[] = rows) => {
    const savedLocation = itemLocation.trim() || localStorage.getItem(`ebay_location_${projectId}`) || "";
    
    // Collect ALL item specifics across rows - ensure required ones come first
    const requiredSpecifics = ["Brand", "Type", "Department", "Size Type", "Size", "Color", "Shade", "Material", "Style"];
    const allSpecifics = new Set<string>(requiredSpecifics);
    sourceRows.forEach(r => {
      if (r.item_specifics) {
        Object.keys(r.item_specifics).forEach(k => allSpecifics.add(k));
      }
      // Ensure columns for any category-required fields exist in the header
      const catId = parseInt(r.category?.match(/\d{3,}/)?.[0] || "0");
      (CATEGORY_REQUIRED_SPECIFICS[catId] || []).forEach(({ field }) => allSpecifics.add(field));
    });
    
    // C: prefix for item specifics columns
    const specificHeaders = Array.from(allSpecifics).map(s => `C:${s}`);

    // eBay category listing template headers — matches fx_category_template_EBAY_US (Version=1193|CC=UTF-8)
    // Downloaded from Seller Hub → Reports → Uploads → Download template → Create or Schedule new listings
    const baseHeaders = [
      "*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)",
      "CustomLabel",
      "*Category",
      "*Title",
      "Relationship",
      "RelationshipDetails",
      "ScheduleTime",
      "*ConditionID",
      "PicURL",
      "VideoID",
      "*Description",
      "*Format",
      "*Duration",
      "*StartPrice",
      "BuyItNowPrice",
      "BestOfferEnabled",
      "BestOfferAutoAcceptPrice",
      "MinimumBestOfferPrice",
      "*Quantity",
      "ImmediatePayRequired",
      "*Location",
      "ShippingType",
      "ShippingService-1:Option",
      "ShippingService-1:Cost",
      "ShippingService-2:Option",
      "ShippingService-2:Cost",
      "*DispatchTimeMax",
      "*ReturnsAcceptedOption",
      "ReturnsWithinOption",
      "RefundOption",
      "ShippingCostPaidByOption",
    ];

    const fullHeaders = [...baseHeaders, ...specificHeaders];

    // Categories that do NOT accept condition 3000 (Used) — only New (1000) or New Other (1500).
    // eBay error 21916883 if you use an invalid condition for the category.
    // Vintage/shelf-worn unbuilt kits should use 1500 (New Other).
    const MODEL_KIT_CATEGORIES = new Set([31787, 37278, 51023, 19063, 2611]);

    // eBay ConditionID mapping
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

    // JSG default service: USPS Ground Advantage with editable flat-rate cost
    const EBAY_SHIPPING_SERVICE = "USPSGroundAdvantage";

    const csvRows = sourceRows.map((row, index) => {
      const normalizedRow = normalizeRowDefaults(row);
      // Extract numeric category ID
      const extractedCategoryId = normalizedRow.category?.match(/\d{3,}/)?.[0] || "";
      const fallbackCategoryId = defaultCategoryId.trim().match(/^\d{3,}$/) ? defaultCategoryId.trim() : "";
      const categoryId = (extractedCategoryId || fallbackCategoryId).replace(/\.0$/, '').trim();

      const shippingCost = normalizedRow.shipping_type === "free"
        ? "0.00"
        : (normalizedRow.shipping_cost ?? DEFAULT_SHIPPING_COST).toFixed(2);
      const returnsAccepted = normalizedRow.returns_accepted ?? DEFAULT_RETURNS_ACCEPTED;
      const returnPeriod = normalizedRow.return_period ?? DEFAULT_RETURN_PERIOD;
      const returnShippingPaidBy = (normalizedRow.return_shipping || DEFAULT_RETURN_SHIPPING) === "buyer"
        ? "Buyer"
        : "Seller";
      
      // Build item specifics values
      const specs = { ...(normalizedRow.item_specifics || {}) };
      if (normalizedRow.brand && !specs["Brand"]) specs["Brand"] = normalizedRow.brand;

      // Auto-inject category-required specifics that have a default value
      const numCatId = parseInt(categoryId || "0");
      (CATEGORY_REQUIRED_SPECIFICS[numCatId] || []).forEach(({ field, default: def }) => {
        if (def !== "" && !specs[field]) specs[field] = def;
      });
      
      const base = [
        "Add",                                                           // *Action
        normalizedRow.lot_number?.toString() || (index + 1).toString(),  // CustomLabel
        categoryId,                                                      // *Category (numeric leaf ID)
        sanitizeForCSV((normalizedRow.title || "").substring(0, 80)),    // *Title
        "",                                                              // Relationship (empty for non-variation)
        "",                                                              // RelationshipDetails
        "",                                                              // ScheduleTime
        (() => {
          const cid = conditionMap[normalizedRow.condition || ""] || "3000";
          const numCat = parseInt(categoryId || "0");
          // Model kit categories only accept 1000 (New) or 1500 (New Other) — not 3000 (Used)
          if (MODEL_KIT_CATEGORIES.has(numCat) && cid === "3000") return "1500";
          return cid;
        })(),                                                              // *ConditionID
        skipImages ? "" : (normalizedRow.image_urls || []).join("|"),     // PicURL
        "",                                                              // VideoID
        toHtmlDescription(normalizedRow.description || ""),              // *Description
        "FixedPrice",                                                    // *Format
        "GTC",                                                           // *Duration
        normalizedRow.price?.toString() || "0",                          // *StartPrice
        "",                                                              // BuyItNowPrice
        normalizedRow.best_offer_enabled === true ? "1" : "0",           // BestOfferEnabled
        normalizedRow.best_offer_auto_accept?.toString() || "",          // BestOfferAutoAcceptPrice
        normalizedRow.minimum_best_offer?.toString() || "",              // MinimumBestOfferPrice
        "1",                                                             // *Quantity
        normalizedRow.best_offer_enabled === true ? "0" : "1",           // ImmediatePayRequired
        savedLocation,                                                   // *Location
        "Flat",                                                          // ShippingType — flat rate
        EBAY_SHIPPING_SERVICE,                                           // ShippingService-1:Option
        shippingCost,                                                    // ShippingService-1:Cost
        "",                                                              // ShippingService-2:Option
        "",                                                              // ShippingService-2:Cost
        (normalizedRow.handling_time ?? DEFAULT_HANDLING_TIME).toString(), // *DispatchTimeMax
        returnsAccepted ? "ReturnsAccepted" : "ReturnsNotAccepted",     // *ReturnsAcceptedOption
        returnsAccepted ? `Days_${returnPeriod}` : "",                   // ReturnsWithinOption
        returnsAccepted ? "MoneyBack" : "",                            // RefundOption
        returnsAccepted ? returnShippingPaidBy : "",                    // ShippingCostPaidByOption
      ];

      // Add item specifics values in header order
      // Note: eBay caps the Model field at 65 characters — truncate to avoid rejection
      const SPECIFIC_CHAR_LIMITS: Record<string, number> = {
        "Model": 65,
        "MPN": 65,
        "Series": 65,
      };
      const specificValues = Array.from(allSpecifics).map(s => {
        const val = sanitizeForCSV(specs[s] || "");
        const limit = SPECIFIC_CHAR_LIMITS[s];
        return limit ? val.substring(0, limit) : val;
      });

      return [...base, ...specificValues];
    });

    // Info row required by eBay's category template format
    const infoRows = [
      `Info,Version=1.0.0,Template=fx_category_template_EBAY_US`,
    ];

    // Build CSV with CRLF line endings - NO BOM
    const csvContent = [
      ...infoRows,
      fullHeaders.join(","),
      ...csvRows.map(row => row.map(cell => 
        `"${String(cell).replace(/"/g, '""')}"`
      ).join(","))
    ].join("\r\n");

    return csvContent;
  };

  // Keyword → eBay leaf category map (mirrors edge function logic, first match wins)
  // Used to auto-correct AI-hallucinated or missing category IDs before push.
  const KEYWORD_CATEGORY_MAP: Array<{ pattern: RegExp; categoryId: number; name: string }> = [
    { pattern: /knife|knives|cleaver|slicer|santoku|boning|paring|cutlery/i,                               categoryId: 177005, name: "Kitchen & Steak Knives" },
    { pattern: /ho[ -]?scale|ho[ -]?gauge/i,                                                               categoryId: 262318, name: "HO Scale Model Trains" },
    { pattern: /\bn[ -]?scale\b.*train|\bn[ -]?gauge\b.*train/i,                                           categoryId: 47006,  name: "N Scale Model Trains" },
    { pattern: /\bo[ -]?scale\b.*train|\bo[ -]?gauge\b.*train|lionel.*train/i,                             categoryId: 47004,  name: "O Scale Model Trains" },
    { pattern: /\bg[ -]?scale\b.*train|\bg[ -]?gauge\b.*train/i,                                           categoryId: 47002,  name: "G Scale Model Trains" },
    { pattern: /ship.*model.*kit|boat.*model.*kit|submarine.*kit|warship.*kit|destroyer.*kit/i,            categoryId: 37278,  name: "Ship/Boat Model Kits" },
    { pattern: /car.*model.*kit|truck.*model.*kit|dragster.*kit|stock.*car.*kit/i,                         categoryId: 51023,  name: "Car/Truck Model Kits" },
    { pattern: /figure.*kit|figurine.*kit|gundam/i,                                                        categoryId: 19063,  name: "Figure Model Kits" },
    { pattern: /model[ -]?kit|scale[ -]?model|plastic[ -]?kit|tank.*kit|aircraft.*kit|tamiya|revell|monogram|airfix/i, categoryId: 31787, name: "Military & Aircraft Model Kits" },
    { pattern: /\bblanket\b|fleece.*throw|throw.*blanket|sherpa.*blanket/i,                                categoryId: 20668,  name: "Blankets & Throws" },
    { pattern: /film.*camera|35mm.*camera|vintage.*camera|slr.*film|rangefinder.*camera/i,                categoryId: 15230,  name: "Vintage Cameras" },
    { pattern: /camcorder|handycam/i,                                                                      categoryId: 11724,  name: "Camcorders & Video Cameras" },
  ];

  const suggestCategoryFromTitle = (title: string): { categoryId: number; name: string } | null => {
    for (const entry of KEYWORD_CATEGORY_MAP) {
      if (entry.pattern.test(title || "")) return entry;
    }
    return null;
  };

  const getMissingCategoryLots = (sourceRows: EbayRow[] = rows): number[] => {
    const missing: number[] = [];
    sourceRows.forEach((row, idx) => {
      const extractedCategoryId = row.category?.match(/\d{3,}/)?.[0] || "";
      const fallbackCategoryId = defaultCategoryId.trim().match(/^\d{3,}$/) ? defaultCategoryId.trim() : "";
      const categoryId = extractedCategoryId || fallbackCategoryId;
      if (!categoryId) {
        missing.push(row.lot_number ?? (idx + 1));
      }
    });
    return missing;
  };

  // Get lots with deprecated/remapped categories and auto-fix them
  const getDeprecatedCategoryLots = (sourceRows: EbayRow[] = rows): { lotNumber: number; oldCat: number; newCat: number; label: string }[] => {
    const results: { lotNumber: number; oldCat: number; newCat: number; label: string }[] = [];
    sourceRows.forEach((row, idx) => {
      const catId = parseInt(row.category?.match(/\d{3,}/)?.[0] || "0");
      if (catId && DEPRECATED_CATEGORIES[catId]) {
        const dep = DEPRECATED_CATEGORIES[catId];
        results.push({
          lotNumber: row.lot_number ?? (idx + 1),
          oldCat: catId,
          newCat: dep.replacement,
          label: dep.label,
        });
      }
    });
    return results;
  };

  // Auto-fix deprecated categories in batch
  const fixDeprecatedCategories = async (sourceRows: EbayRow[] = rows): Promise<EbayRow[]> => {
    const deprecated = getDeprecatedCategoryLots(sourceRows);
    if (deprecated.length === 0) return sourceRows;

    const updates = deprecated.map(d => {
      const row = sourceRows.find((r, idx) => r.lot_number === d.lotNumber || idx === d.lotNumber - 1);
      if (!row) return null;
      return { id: row.id, newCat: String(d.newCat) };
    }).filter(Boolean) as { id: string; newCat: string }[];

    if (updates.length === 0) return sourceRows;

    await Promise.all(
      updates.map((u) =>
        supabase.from('ebay_batch_rows').update({ category: u.newCat }).eq('id', u.id)
      )
    );

    const updateMap = new Map(updates.map((u) => [u.id, u.newCat]));
    const updatedRows = sourceRows.map((row) => {
      const newCategory = updateMap.get(row.id);
      return newCategory ? { ...row, category: newCategory } : row;
    });

    onRowsChange(updatedRows);
    return updatedRows;
  };

  // Get lots with titles exceeding 80 characters
  const getOverlongTitleLots = (sourceRows: EbayRow[] = rows): number[] => {
    return sourceRows
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

  const bulkEnrichItemSpecifics = async (force = false) => {
    if (!projectId || rows.length === 0) return;

    const sparseRows = force
      ? rows
      : rows.filter((r) => Object.keys(r.item_specifics || {}).length < 3);

    if (sparseRows.length === 0) {
      toast({ title: "All enriched", description: "All listings already have 3+ item specifics." });
      return;
    }

    setEnriching(true);
    try {
      // Process in batches of 10 to avoid token limits
      const batchSize = 10;
      let totalUpdated = 0;
      let totalFailed = 0;

      for (let i = 0; i < sparseRows.length; i += batchSize) {
        const batch = sparseRows.slice(i, i + batchSize);
        
        const payload = batch.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          category: r.category,
          condition: r.condition,
          item_specifics: r.item_specifics,
          image_urls: r.image_urls,
        }));

        const { data, error } = await supabase.functions.invoke("enrich-ebay-batch", {
          body: { rows: payload },
        });

        if (error || !data?.enriched) {
          console.error("Enrich error:", error || data?.error);
          totalFailed += batch.length;
          continue;
        }

        const enriched = data.enriched as Array<{
          id: string;
          item_specifics: Record<string, string>;
          category_id?: number | null;
        }>;

        // Update each row in DB and local state
        for (const item of enriched) {
          const row = rows.find((r) => r.id === item.id);
          if (!row) continue;

          const mergedSpecifics = { ...(row.item_specifics || {}), ...item.item_specifics };
          const updatePayload: any = { item_specifics: mergedSpecifics };
          
          if (item.category_id && (force || !row.category?.match(/\d{3,}/))) {
            updatePayload.category = String(item.category_id);
          }

          const { error: updateError } = await supabase
            .from("ebay_batch_rows")
            .update(updatePayload)
            .eq("id", item.id);

          if (updateError) {
            totalFailed++;
          } else {
            totalUpdated++;
          }
        }

        // Update local state after each batch
        onRowsChange(
          rows.map((r) => {
            const hit = enriched.find((e) => e.id === r.id);
            if (!hit) return r;
            const merged = { ...(r.item_specifics || {}), ...hit.item_specifics };
            const updatedRow = { ...r, item_specifics: merged };
            if (hit.category_id && (force || !r.category?.match(/\d{3,}/))) {
              updatedRow.category = String(hit.category_id);
            }
            return updatedRow;
          })
        );
      }

      toast({
        title: "AI Enrichment complete",
        description: `Updated ${totalUpdated} listing(s) with item specifics.${totalFailed > 0 ? ` ${totalFailed} failed.` : ""}`,
        variant: totalFailed > 0 ? "destructive" : "default",
      });
    } catch (e) {
      console.error("Bulk enrich error:", e);
      toast({
        title: "Enrichment failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setEnriching(false);
    }
  };

  const downloadCSV = async () => {
    if (rows.length === 0) {
      toast({ title: "No data", description: "Add some listings first", variant: "destructive" });
      return;
    }

    let exportRows = rows;

    // Validation 0: Auto-fix deprecated categories before export, but do not block download
    const deprecated = getDeprecatedCategoryLots(exportRows);
    if (deprecated.length > 0) {
      exportRows = await fixDeprecatedCategories(exportRows);
      toast({
        title: "Deprecated categories auto-fixed",
        description: `Fixed ${deprecated.length} deprecated category ID(s) and continued the export.`,
        variant: "default",
      });
    }

    // Validation 1: Check for missing category IDs
    const missingLots = getMissingCategoryLots(exportRows);
    if (missingLots.length > 0) {
      const preview = missingLots.slice(0, 5).join(", ");
      toast({
        title: "Missing Category ID",
        description: `Add a numeric Category ID (or set a Default Category ID) for lot(s): ${preview}${missingLots.length > 5 ? "…" : ""}. eBay rejects uploads without leaf category IDs.`,
        variant: "destructive",
      });
      return;
    }

    // Validation 2: Check for overlong titles
    const overlongLots = getOverlongTitleLots(exportRows);
    if (overlongLots.length > 0) {
      const preview = overlongLots.slice(0, 5).join(", ");
      toast({
        title: "Title Too Long",
        description: `eBay requires titles under 80 characters. Fix lot(s): ${preview}${overlongLots.length > 5 ? "…" : ""}`,
        variant: "destructive",
      });
      return;
    }

    // Validation 3: Warn on missing required item specifics — non-blocking so wrong AI categories don't prevent export
    const missingSpecsLots = getMissingItemSpecificsLots(exportRows);
    if (missingSpecsLots.length > 0) {
      const preview = missingSpecsLots.slice(0, 3).map(l =>
        `#${l.lotNumber} (${l.missing.join(", ")})`
      ).join("; ");
      toast({
        title: "Warning: Possible Wrong Category",
        description: `Lots flagged for missing specifics (may be wrong AI category): ${preview}${missingSpecsLots.length > 3 ? "…" : ""}. CSV will still download — fix category IDs if eBay rejects.`,
        variant: "default",
      });
      // Non-blocking — fall through to export
    }

    // Validation 4: Check for location
    const normalizedLocation = itemLocation.trim() || localStorage.getItem(`ebay_location_${projectId}`) || "";
    if (!normalizedLocation) {
      toast({
        title: "Missing Location",
        description: "eBay requires an Item location (ZIP code or City, ST). Add it in the header, then re-download.",
        variant: "destructive",
      });
      return;
    }

    // Soft warning: remind about Business Policies profile names
    if (!shippingProfileName.trim() && !returnProfileName.trim() && !paymentProfileName.trim()) {
      toast({
        title: "Tip: Add Business Policy profile names",
        description: "If your eBay account uses Business Policies, add your Shipping, Return, and Payment profile names in the fields above — otherwise eBay may reject all rows.",
      });
    }

    // All validations passed - generate CSV and show preview
    const csvContent = generateCSVContent(excludeImages, exportRows);
    setFullCsvContent(csvContent);

    // Build preview: show #INFO rows + header + first 3 data rows
    const allLines = csvContent.split("\r\n");
    const previewLines = allLines.slice(0, Math.min(allLines.length, 7)); // 3 info + 1 header + 3 data
    setCsvPreviewContent(previewLines.join("\n"));

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    setPendingCSVBlob(blob);
    setShowCSVPreview(true);
  };

  const confirmDownloadCSV = () => {
    if (!pendingCSVBlob) return;
    const url = URL.createObjectURL(pendingCSVBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ebay-listings-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    const imageNote = excludeImages ? " (without images - add them in Seller Hub)" : "";
    toast({ title: "CSV Downloaded", description: `${rows.length} listings ready for Seller Hub Reports upload${imageNote}` });
    setShowCSVPreview(false);
    setPendingCSVBlob(null);
    setCsvPreviewContent("");
    setFullCsvContent("");
    setShowUploadInstructions(true);
  };
  // eBay condition name → numeric ID for Zapier
  const conditionToZapierMap: Record<string, string> = {
    "New": "1000", "New with tags": "1000", "New other": "1500",
    "New without tags": "1500", "Open box": "1500",
    "Certified refurbished": "2000", "Seller refurbished": "2500",
    "Used": "3000", "Pre-owned": "3000", "Pre-owned - Excellent": "3000",
    "Pre-owned - Good": "4000", "Pre-owned - Fair": "5000",
    "For parts": "7000", "For parts or not working": "7000",
  };

  const handleSendToZapier = async () => {
    if (rows.length === 0) {
      toast({ title: "No listings", description: "Add listings first.", variant: "destructive" });
      return;
    }
    if (!zapierWebhookUrl.trim()) {
      toast({ title: "Missing webhook URL", description: "Enter your Zapier webhook URL first.", variant: "destructive" });
      return;
    }

    // Persist the webhook URL
    localStorage.setItem(`ebay_zapier_webhook`, zapierWebhookUrl.trim());

    setSendingToZapier(true);
    let succeeded = 0;
    let failed = 0;

    for (const row of rows) {
      const categoryId = row.category?.match(/\d{3,}/)?.[0] || defaultCategoryId.trim() || "";
      const conditionId = conditionToZapierMap[row.condition || ""] || "3000";

      const payload = {
        itemTitle: (row.title || "").substring(0, 80),
        description: row.description || "",
        startPrice: row.price || 0,
        quantity: 1,
        categoryID: categoryId,
        condition: conditionId,
        duration: "GTC",
        paymentMethods: ["PayPal"],
        shippingType: row.shipping_type || "flat",
        shippingCost: row.shipping_type === "free" ? 0 : (row.shipping_cost || 0),
        returnDays: row.return_period || 30,
        returnsAccepted: row.returns_accepted !== false,
        bestOfferEnabled: row.best_offer_enabled !== false,
        bestOfferAutoAccept: row.best_offer_auto_accept || null,
        minimumBestOffer: row.minimum_best_offer || null,
        location: itemLocation.trim() || "",
        imageUrls: row.image_urls || [],
        sku: row.lot_number?.toString() || "",
        subtitle: row.subtitle || "",
        itemSpecifics: row.item_specifics || {},
      };

      try {
        const { data, error } = await supabase.functions.invoke("zapier-proxy", {
          body: {
            webhookUrl: zapierWebhookUrl.trim(),
            payload,
          },
        });
        if (error) throw error;
        succeeded++;
      } catch (e) {
        failed++;
        console.error("Zapier webhook error for lot", row.lot_number, e);
      }
    }

    setSendingToZapier(false);

    if (failed === 0) {
      toast({ title: "Sent to Zapier!", description: `${succeeded} listing(s) sent. Check your Zap history to confirm.` });
    } else {
      toast({ title: `Sent ${succeeded}, failed ${failed}`, description: "Check console for errors.", variant: "destructive" });
    }
  };

  const handlePushToEbay = async () => {
    if (rows.length === 0) {
      toast({ title: "No listings", description: "Add listings first.", variant: "destructive" });
      return;
    }
    const loc = itemLocation.trim() || localStorage.getItem(`ebay_location_${projectId}`) || "";
    if (!loc) {
      toast({ title: "Missing Location", description: "Set an Item Location (ZIP or City, ST) before pushing to eBay.", variant: "destructive" });
      return;
    }
    if (!confirm(`Push ${rows.length} listing(s) as drafts to your eBay Seller Hub?`)) return;

    setPublishing(true);
    try {
      // Step 1: Apply keyword-based category fix — corrects AI-hallucinated IDs by item type
      let pushRows = rows.map(r => {
        const suggested = suggestCategoryFromTitle(r.title);
        if (!suggested) return r;
        return { ...r, category: String(suggested.categoryId) };
      });

      // Step 2: Auto-fix remaining deprecated/parent categories
      const deprecated = getDeprecatedCategoryLots(pushRows);
      if (deprecated.length > 0) {
        pushRows = await fixDeprecatedCategories(pushRows);
      }

      // Step 2.5: Inject category-required item specifics defaults (e.g. Department for clothing)
      // Mirrors the CSV export path — ensures push path has same auto-fill as CSV.
      pushRows = pushRows.map(r => {
        const catId = parseInt(r.category?.match(/\d{3,}/)?.[0] || "0");
        const required = CATEGORY_REQUIRED_SPECIFICS[catId] || [];
        if (required.length === 0) return r;
        const specs = { ...(r.item_specifics || {}) };
        required.forEach(({ field, default: def }) => {
          if (def !== "" && !specs[field]) specs[field] = def;
        });
        return { ...r, item_specifics: specs };
      });

      // Step 3: Apply default category ID fallback for rows still missing a category
      const fallbackCatId = defaultCategoryId.trim().match(/^\d{3,}$/) ? defaultCategoryId.trim() : "";
      if (fallbackCatId) {
        pushRows = pushRows.map(r =>
          r.category?.match(/\d{3,}/) ? r : { ...r, category: fallbackCatId }
        );
      }

      // Step 4: Block push if any rows still have no valid category ID
      const missingLots = getMissingCategoryLots(pushRows);
      if (missingLots.length > 0) {
        const preview = missingLots.slice(0, 5).join(", ");
        toast({
          title: "Missing Category ID",
          description: `Set a numeric eBay category ID for lot(s): ${preview}${missingLots.length > 5 ? "…" : ""}. eBay rejects listings without a leaf category ID.`,
          variant: "destructive",
        });
        return;
      }

      const res = await fetch(
        "https://atgrxqfxysvppqoyvjdd.supabase.co/functions/v1/ebay-publish",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: pushRows }),
        }
      );
      if (!res.ok) {
        const errText = await res.text();
        toast({ title: "Push failed", description: errText.substring(0, 200), variant: "destructive" });
        return;
      }
      const { succeeded, failed, results } = await res.json();
      const succeededRows = results.filter((r: any) => r.success);
      const failedResults = results.filter((r: any) => !r.success);

      if (succeeded > 0) {
        const succeededIds = new Set(succeededRows.map((r: any) => r.id));
        onRowsChange(rows.map(r => succeededIds.has(r.id) ? { ...r, status: "published" } : r));
        setPendingDeleteIds({ ids: succeededRows.map((r: any) => r.id), count: succeeded });
      }

      if (failed > 0) {
        const allErrors = failedResults.map((r: any) => r.error || "Unknown").join(" || ");
        toast({
          title: `${succeeded} pushed, ${failed} failed`,
          description: allErrors.substring(0, 500),
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Push failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const confirmDeletePushed = async () => {
    if (!pendingDeleteIds) return;
    const { ids } = pendingDeleteIds;
    const { error } = await supabase.from("ebay_batch_rows").delete().in("id", ids);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      onRowsChange(rows.filter((r) => !ids.includes(r.id)));
      toast({ title: "Deleted", description: `${ids.length} pushed listing(s) removed from the app.` });
    }
    setPendingDeleteIds(null);
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

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Shipping Profile</Label>
              <Input
                placeholder="e.g. Standard Shipping"
                value={shippingProfileName}
                onChange={(e) => setShippingProfileName(e.target.value)}
                className="w-40"
                title="eBay Business Policy: Shipping profile name (Seller Hub → Account → Business policies)"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Return Profile</Label>
              <Input
                placeholder="e.g. 30 Day Returns"
                value={returnProfileName}
                onChange={(e) => setReturnProfileName(e.target.value)}
                className="w-36"
                title="eBay Business Policy: Return profile name (Seller Hub → Account → Business policies)"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Payment Profile</Label>
              <Input
                placeholder="e.g. eBay Payments"
                value={paymentProfileName}
                onChange={(e) => setPaymentProfileName(e.target.value)}
                className="w-36"
                title="eBay Business Policy: Payment profile name (Seller Hub → Account → Business policies)"
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
              <>
                <Button
                  variant="outline"
                  onClick={() => bulkEnrichItemSpecifics(false)}
                  disabled={enriching}
                  className="gap-2"
                >
                  {enriching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {enriching ? "Enriching…" : "Bulk AI Enrich"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => bulkEnrichItemSpecifics(true)}
                  disabled={enriching}
                  className="gap-2"
                >
                  {enriching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {enriching ? "Enriching…" : "Force Re-Enrich All"}
                </Button>
              </>
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
              <Button onClick={handlePushToEbay} disabled={publishing} className="gap-2 bg-green-600 hover:bg-green-700 text-white">
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {publishing ? "Pushing…" : "Push to eBay"}
              </Button>
            )}
            {rows.length > 0 && (
              <Button 
                variant="outline" 
                onClick={() => setShowZapierConfig(!showZapierConfig)}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Zapier
              </Button>
            )}
            {rows.length > 0 && (
              <Button variant="outline" onClick={handleClearAll}>
                Clear All
              </Button>
            )}
          </div>
        </div>

        {/* Zapier Webhook Config */}
        {showZapierConfig && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Zapier Webhook</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste your Zapier Catch Hook URL. Each listing will be sent as JSON with itemTitle, description, categoryID, condition, itemSpecifics, and all core fields.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="https://hooks.zapier.com/hooks/catch/..."
                value={zapierWebhookUrl}
                onChange={(e) => setZapierWebhookUrl(e.target.value)}
                className="flex-1"
              />
              <Button 
                onClick={handleSendToZapier} 
                disabled={sendingToZapier || !zapierWebhookUrl.trim()}
                className="gap-2"
              >
                {sendingToZapier ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sendingToZapier ? `Sending…` : `Send ${rows.length} to Zapier`}
              </Button>
            </div>
          </div>
        )}

        <Dialog open={showCSVPreview} onOpenChange={(open) => {
          setShowCSVPreview(open);
          if (!open) { setPendingCSVBlob(null); setCsvPreviewContent(""); setFullCsvContent(""); }
        }}>
          <DialogContent className="max-w-3xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                CSV Preview — First 3 Rows
              </DialogTitle>
            </DialogHeader>
            <div className="overflow-auto max-h-[55vh] rounded-md border border-border bg-muted/30 p-3">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground leading-relaxed">
                {csvPreviewContent}
              </pre>
            </div>
            <p className="text-xs text-muted-foreground">
              Verify the header row has <code className="bg-muted px-1 rounded">Category</code> (not "Category ID") and each data row has a numeric category value.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setShowCSVPreview(false); setPendingCSVBlob(null); setCsvPreviewContent(""); setFullCsvContent(""); }}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => {
                navigator.clipboard.writeText(fullCsvContent).then(() => {
                  toast({ title: "CSV copied to clipboard", description: "Paste into a text editor to inspect the raw content." });
                });
              }}>
                Copy Raw CSV
              </Button>
              <Button onClick={confirmDownloadCSV}>
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </div>
          </DialogContent>
        </Dialog>

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
              {/* Images Section with drag-and-drop and AI enhance */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs text-muted-foreground uppercase">
                    Images (drag to reorder, hover for AI)
                  </Label>
                  <ImageEnhancer
                    onImageGenerated={(url) => setEditingRow({ 
                      ...editingRow, 
                      image_urls: [...(editingRow.image_urls || []), url] 
                    })}
                    trigger={
                      <Button variant="outline" size="sm" className="gap-1 h-7">
                        <ImagePlus className="h-3 w-3" />
                        AI Generate
                      </Button>
                    }
                  />
                </div>
                {editingRow.image_urls && editingRow.image_urls.length > 0 ? (
                  <DraggableImageGrid
                    images={editingRow.image_urls}
                    onReorder={(newImages) => setEditingRow({ ...editingRow, image_urls: newImages })}
                    onRemove={(index) => {
                      const newImages = [...(editingRow.image_urls || [])];
                      newImages.splice(index, 1);
                      setEditingRow({ ...editingRow, image_urls: newImages });
                    }}
                    showEnhance={true}
                    size="md"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No images yet. Use AI Generate to create one.</p>
                )}
              </div>

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
                  shippingType: (editingRow.shipping_type as "flat" | "calculated" | "free") || DEFAULT_SHIPPING_TYPE,
                  shippingCost: editingRow.shipping_cost ?? DEFAULT_SHIPPING_COST,
                  handlingTime: editingRow.handling_time ?? DEFAULT_HANDLING_TIME,
                  returnsAccepted: editingRow.returns_accepted ?? DEFAULT_RETURNS_ACCEPTED,
                  returnPeriod: editingRow.return_period ?? DEFAULT_RETURN_PERIOD,
                  returnShipping: (editingRow.return_shipping as "buyer" | "seller") || DEFAULT_RETURN_SHIPPING,
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

      <Dialog open={!!pendingDeleteIds} onOpenChange={(open) => { if (!open) setPendingDeleteIds(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete pushed listings?</DialogTitle>
            <DialogDescription>
              {pendingDeleteIds?.count} listing(s) were pushed to eBay successfully. Verify they appear in your{" "}
              <a href="https://www.ebay.com/sh/lst/active" target="_blank" rel="noopener noreferrer" className="underline">
                eBay Seller Hub
              </a>{" "}
              before deleting. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDeleteIds(null)}>
              Keep them
            </Button>
            <Button variant="destructive" onClick={confirmDeletePushed}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete {pendingDeleteIds?.count} pushed listing(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
