import { useState, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Upload, 
  Store, 
  Facebook, 
  Gavel,
  X,
  Loader2,
  Sparkles,
  Download,
  Copy,
  Check,
  DollarSign,
  Plus,
  ImageIcon,
  Rocket
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { generateListing, uploadImage, saveListing, type Platform, type GeneratedListing } from "@/lib/api/listings";

const platforms = [
  { id: "ebay" as Platform, name: "eBay", icon: Store, color: "bg-platform-ebay", description: "Cassini-optimized draft" },
  { id: "facebook" as Platform, name: "Facebook", icon: Facebook, color: "bg-platform-facebook", description: "Marketplace + groups" },
  { id: "liveauctioneers" as Platform, name: "LiveAuctioneers", icon: Gavel, color: "bg-platform-auction", description: "CSV export" },
  { id: "denver" as Platform, name: "Denver Auctions", icon: Gavel, color: "bg-platform-auction", description: "Copy-paste tool" },
];

const DEFAULT_FB_GROUPS = [
  "Estate Sale Finds - Denver",
  "Colorado Antiques & Collectibles",
  "Denver Buy Sell Trade",
  "Front Range Marketplace",
  "Boulder County Buy Sell Trade",
  "Colorado Springs Marketplace",
  "Fort Collins Buy Sell Trade",
  "Vintage Colorado",
  "Denver Estate Sales",
  "Rocky Mountain Resellers",
  "Colorado Furniture Exchange",
  "Denver Antique Mall Sellers",
  "Aurora Marketplace",
  "Lakewood Buy Sell Trade",
  "Arvada Community Market",
  "Westminster Trading Post",
  "Thornton Marketplace",
  "Centennial Buy Sell Trade",
  "Littleton Community Sales",
  "Golden Colorado Marketplace"
];

export default function CreateListing() {
  const [images, setImages] = useState<{ file: File; preview: string; url?: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState<Platform | null>(null);
  const [generatedListing, setGeneratedListing] = useState<GeneratedListing | null>(null);
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  
  // eBay specific
  const [promotionRate, setPromotionRate] = useState("5.0");
  const [promotionType, setPromotionType] = useState<"flat" | "fluctuating">("flat");
  
  // Facebook specific
  const [selectedGroups, setSelectedGroups] = useState<string[]>(DEFAULT_FB_GROUPS);
  
  // LiveAuctioneers specific
  const [lotNumber, setLotNumber] = useState(1);
  const [csvRows, setCsvRows] = useState<any[]>([]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;

    const newImages = files.map(file => ({
      file,
      preview: URL.createObjectURL(file)
    }));

    setImages(prev => [...prev, ...newImages]);
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newImages = files.map(file => ({
      file,
      preview: URL.createObjectURL(file)
    }));

    setImages(prev => [...prev, ...newImages]);
  };

  const removeImage = (index: number) => {
    setImages(prev => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  };

  const clearAll = () => {
    images.forEach(img => URL.revokeObjectURL(img.preview));
    setImages([]);
    setGeneratedListing(null);
    setActivePlatform(null);
    setAdditionalContext("");
  };

  const handlePlatformClick = async (platform: Platform) => {
    if (images.length === 0) {
      toast({
        title: "No Photos",
        description: "Drop some photos first!",
        variant: "destructive"
      });
      return;
    }

    setProcessing(platform);
    setActivePlatform(platform);
    setGeneratedListing(null);

    try {
      // Upload images
      const uploadedImages = await Promise.all(
        images.map(async (img) => {
          if (img.url) return img;
          const url = await uploadImage(img.file);
          return { ...img, url };
        })
      );
      setImages(uploadedImages);
      const imageUrls = uploadedImages.map(img => img.url!);

      // Generate listing
      const listing = await generateListing(platform, imageUrls, additionalContext);
      setGeneratedListing(listing);

      // Auto-save as draft for eBay/Facebook
      if (platform === 'ebay' || platform === 'facebook') {
        await saveListing({
          platform,
          status: 'draft',
          title: listing.title,
          description: listing.description,
          price: listing.price,
          category: listing.category,
          condition: listing.condition,
          item_specifics: listing.itemSpecifics,
          promotion_rate: platform === 'ebay' ? parseFloat(promotionRate) : undefined,
          promotion_type: platform === 'ebay' ? promotionType : undefined,
          image_urls: imageUrls,
          facebook_groups: platform === 'facebook' ? selectedGroups : undefined
        });
      }

      // Auto-add to CSV for LiveAuctioneers
      if (platform === 'liveauctioneers') {
        setCsvRows(prev => [...prev, { 
          ...listing, 
          lotNumber,
          imageUrls
        }]);
        setLotNumber(prev => prev + 1);
      }

      toast({
        title: platform === 'liveauctioneers' ? `Lot ${lotNumber} Added to CSV` : "Draft Ready!",
        description: platform === 'liveauctioneers' 
          ? `${csvRows.length + 1} lots in CSV. Ready for export.`
          : "Review and launch when ready."
      });

    } catch (error) {
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive"
      });
    } finally {
      setProcessing(null);
    }
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const generateCSVContent = () => {
    // Official LiveAuctioneers column headers - EXACT FORMAT REQUIRED
    const headers = [
      'LotNum', 'Title', 'Description', 'LowEst', 'HighEst', 'StartPrice',
      'Condition', 'Consigner', 'ImageFile.1', 'ImageFile.2', 'ImageFile.3', 'ImageFile.4',
      'Buy Now Price', 'Exclude From Buy Now', 'Reserve Price',
      'Height', 'Width', 'Depth', 'Dimension Unit', 'Weight', 'Weight Unit',
      'Domestic Flat Shipping Price', 'Quantity', 'Category', 'Origin',
      'Style & Period', 'Creator', 'Materials & Techniques', 'Lot Reference Number', 'Location Nickname'
    ];

    const rows = csvRows.map(r => {
      const lotNum = r.lotNumber || '';
      return [
        lotNum,
        (r.title || '').substring(0, 100),
        r.description || '',
        r.lowEst || '',
        r.highEst || '',
        r.startPrice || '',
        r.condition || '',
        r.consigner || 'JSG',
        r.imageUrls?.[0] ? `${lotNum}_1` : '',
        r.imageUrls?.[1] ? `${lotNum}_2` : '',
        r.imageUrls?.[2] ? `${lotNum}_3` : '',
        r.imageUrls?.[3] ? `${lotNum}_4` : '',
        '', // Buy Now Price
        '', // Exclude From Buy Now
        '', // Reserve Price
        r.height || '',
        r.width || '',
        r.depth || '',
        r.dimensionUnit || '',
        r.weight || '',
        r.weightUnit || '',
        '', // Domestic Flat Shipping
        '1', // Quantity
        r.category || '',
        r.origin || '',
        r.stylePeriod || '',
        r.creator || '',
        r.materials || '',
        '', // Lot Reference Number
        r.locationNickname || 'Highlands Ranch'
      ];
    });

    return { headers, rows };
  };

  const downloadCSV = () => {
    if (csvRows.length === 0) {
      toast({ title: "No Data", description: "Add items first", variant: "destructive" });
      return;
    }

    const { headers, rows } = generateCSVContent();
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `liveauctioneers-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({ title: "CSV Downloaded!", description: `${csvRows.length} lots exported` });
  };

  const copyCSVToClipboard = () => {
    if (csvRows.length === 0) {
      toast({ title: "No Data", description: "Add items first", variant: "destructive" });
      return;
    }

    const { headers, rows } = generateCSVContent();
    // Use tab-separated values for Google Sheets paste
    const tsv = [headers, ...rows].map(r => r.map(c => String(c).replace(/\t/g, ' ')).join('\t')).join('\n');
    
    navigator.clipboard.writeText(tsv);
    setCopied('csv');
    setTimeout(() => setCopied(null), 2000);
    
    toast({ title: "Copied to Clipboard!", description: "Paste into Google Sheets (Ctrl+V)" });
  };

  const toggleGroup = (group: string) => {
    setSelectedGroups(prev => 
      prev.includes(group) 
        ? prev.filter(g => g !== group)
        : prev.length < 20 ? [...prev, group] : prev
    );
  };

  return (
    <MainLayout 
      title="AI Listing Creator" 
      subtitle="Drop photos → Hit platform → Done"
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative rounded-xl border-2 border-dashed transition-all duration-300 min-h-[200px]",
            isDragging 
              ? "border-primary bg-primary/5 scale-[1.02]" 
              : "border-border bg-card hover:border-muted-foreground/50",
            images.length === 0 ? "p-12" : "p-4"
          )}
        >
          {images.length === 0 ? (
            <label className="flex flex-col items-center justify-center cursor-pointer">
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <div className={cn(
                "rounded-full p-6 mb-4 transition-colors",
                isDragging ? "bg-primary/20" : "bg-secondary"
              )}>
                <ImageIcon className={cn(
                  "h-12 w-12 transition-colors",
                  isDragging ? "text-primary" : "text-muted-foreground"
                )} />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                {isDragging ? "Drop photos here!" : "Drag & Drop Photos"}
              </h3>
              <p className="text-muted-foreground text-sm">
                or click to browse • Supports multiple images
              </p>
            </label>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{images.length} photo(s)</span>
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Clear All
                </Button>
              </div>
              <div className="grid gap-3 grid-cols-4 sm:grid-cols-6 md:grid-cols-8">
                {images.map((img, index) => (
                  <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
                    <img src={img.preview} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(index)}
                      className="absolute top-1 right-1 p-1 bg-background/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {img.url && (
                      <Check className="absolute bottom-1 left-1 h-4 w-4 text-green-500" />
                    )}
                  </div>
                ))}
                <label className="relative aspect-square cursor-pointer rounded-lg border-2 border-dashed border-border bg-secondary/30 hover:border-primary/50 flex items-center justify-center">
                  <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                  <Plus className="h-6 w-6 text-muted-foreground" />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Optional Context */}
        {images.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4">
            <Input
              placeholder="Optional: Add details AI should know (brand, model, measurements, provenance...)"
              value={additionalContext}
              onChange={(e) => setAdditionalContext(e.target.value)}
              className="bg-transparent border-0 focus-visible:ring-0 text-sm"
            />
          </div>
        )}

        {/* Platform Buttons */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {platforms.map((platform) => (
            <Button
              key={platform.id}
              onClick={() => handlePlatformClick(platform.id)}
              disabled={processing !== null || images.length === 0}
              variant="outline"
              className={cn(
                "h-auto py-6 flex flex-col gap-2 relative overflow-hidden group",
                processing === platform.id && "border-primary"
              )}
            >
              <div className={cn(
                "absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity",
                platform.color
              )} />
              {processing === platform.id ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <platform.icon className="h-8 w-8" />
              )}
              <span className="font-semibold">{platform.name}</span>
              <span className="text-xs text-muted-foreground">{platform.description}</span>
            </Button>
          ))}
        </div>

        {/* LiveAuctioneers CSV Status */}
        {csvRows.length > 0 && (
          <div className="rounded-xl border border-primary/50 bg-primary/5 p-4 flex items-center justify-between">
            <div>
              <span className="font-semibold text-foreground">LiveAuctioneers CSV</span>
              <span className="text-muted-foreground ml-2">{csvRows.length} lots ready</span>
              <span className="text-muted-foreground ml-2">• Next lot: #{lotNumber}</span>
            </div>
            <div className="flex gap-2">
              <Input
                type="number"
                value={lotNumber}
                onChange={(e) => setLotNumber(parseInt(e.target.value) || 1)}
                className="w-20"
              />
              <Button variant="outline" onClick={copyCSVToClipboard}>
                {copied === 'csv' ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied === 'csv' ? 'Copied!' : 'Copy for Sheets'}
              </Button>
              <Button variant="gold" onClick={downloadCSV}>
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </div>
          </div>
        )}

        {/* Generated Listing Preview */}
        {generatedListing && activePlatform && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  {activePlatform === 'liveauctioneers' ? `Lot ${lotNumber - 1} Added` : 'Draft Ready'}
                </h2>
                <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary uppercase">
                  {activePlatform}
                </span>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">TITLE</Label>
                    {activePlatform === "denver" && (
                      <Button variant="ghost" size="sm" className="h-6" onClick={() => handleCopy(generatedListing.title, "Title")}>
                        {copied === "Title" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    )}
                  </div>
                  <p className="font-medium">{generatedListing.title}</p>
                  <span className="text-xs text-muted-foreground">{generatedListing.title.length} chars</span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">DESCRIPTION</Label>
                    {activePlatform === "denver" && (
                      <Button variant="ghost" size="sm" className="h-6" onClick={() => handleCopy(generatedListing.description, "Description")}>
                        {copied === "Description" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {generatedListing.description}
                  </p>
                </div>

                {(generatedListing.price || generatedListing.lowEst) && (
                  <div className="flex gap-4 pt-2 border-t border-border">
                    {generatedListing.price && (
                      <div>
                        <Label className="text-xs text-muted-foreground">PRICE</Label>
                        <p className="font-semibold text-primary">${generatedListing.price}</p>
                      </div>
                    )}
                    {generatedListing.lowEst && (
                      <div>
                        <Label className="text-xs text-muted-foreground">ESTIMATE</Label>
                        <p className="font-semibold">${generatedListing.lowEst} - ${generatedListing.highEst}</p>
                      </div>
                    )}
                    {generatedListing.startPrice && (
                      <div>
                        <Label className="text-xs text-muted-foreground">START</Label>
                        <p className="font-semibold">${generatedListing.startPrice}</p>
                      </div>
                    )}
                    {generatedListing.category && (
                      <div>
                        <Label className="text-xs text-muted-foreground">CATEGORY</Label>
                        <p className="text-sm">{generatedListing.category}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Platform-specific actions */}
            <div className="space-y-4">
              {activePlatform === "denver" && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <h3 className="font-semibold mb-4">Quick Copy for DOA</h3>
                  <Button 
                    variant="gold" 
                    className="w-full"
                    onClick={() => handleCopy(`${generatedListing.title}\n\n${generatedListing.description}`, "All")}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    {copied === "All" ? "Copied!" : "Copy Title + Description"}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    Paste directly into Denver Online Auctions lot box
                  </p>
                </div>
              )}

              {activePlatform === "facebook" && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <h3 className="font-semibold mb-2">Groups to Post ({selectedGroups.length}/20)</h3>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {DEFAULT_FB_GROUPS.map(group => (
                      <label key={group} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-secondary/50 p-1 rounded">
                        <Checkbox 
                          checked={selectedGroups.includes(group)}
                          onCheckedChange={() => toggleGroup(group)}
                        />
                        <span className="truncate">{group}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {activePlatform === "ebay" && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <h3 className="font-semibold mb-4">eBay Promotion</h3>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Label className="text-xs">Rate %</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={promotionRate}
                        onChange={(e) => setPromotionRate(e.target.value)}
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Type</Label>
                      <div className="flex gap-1 mt-1">
                        <Button
                          variant={promotionType === "flat" ? "gold" : "outline"}
                          size="sm"
                          className="flex-1"
                          onClick={() => setPromotionType("flat")}
                        >
                          Flat
                        </Button>
                        <Button
                          variant={promotionType === "fluctuating" ? "gold" : "outline"}
                          size="sm"
                          className="flex-1"
                          onClick={() => setPromotionType("fluctuating")}
                        >
                          Dynamic
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Next Item Button */}
              <Button 
                variant="outline" 
                className="w-full"
                onClick={clearAll}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Start Next Item
              </Button>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}