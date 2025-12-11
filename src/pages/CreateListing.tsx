import { useState } from "react";
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
  Plus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { generateListing, uploadImage, saveListing, type Platform, type GeneratedListing } from "@/lib/api/listings";

const platforms = [
  { id: "ebay" as Platform, name: "eBay", icon: Store, color: "border-platform-ebay bg-platform-ebay/10", description: "Draft listings with Cassini optimization" },
  { id: "facebook" as Platform, name: "Facebook", icon: Facebook, color: "border-platform-facebook bg-platform-facebook/10", description: "Marketplace + 20 group posting" },
  { id: "liveauctioneers" as Platform, name: "LiveAuctioneers", icon: Gavel, color: "border-platform-auction bg-platform-auction/10", description: "CSV export with lot numbers" },
  { id: "denver" as Platform, name: "Denver Auctions", icon: Gavel, color: "border-platform-auction bg-platform-auction/10", description: "Copy-paste tool for lot boxes" },
];

export default function CreateListing() {
  const [activePlatform, setActivePlatform] = useState<Platform>("ebay");
  const [images, setImages] = useState<{ file: File; preview: string; url?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedListing, setGeneratedListing] = useState<GeneratedListing | null>(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  
  // eBay specific
  const [promotionRate, setPromotionRate] = useState("");
  const [promotionType, setPromotionType] = useState<"flat" | "fluctuating">("flat");
  
  // LiveAuctioneers specific
  const [lotNumber, setLotNumber] = useState(1);
  const [csvRows, setCsvRows] = useState<any[]>([]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const uploadAllImages = async () => {
    setUploading(true);
    try {
      const uploadedImages = await Promise.all(
        images.map(async (img) => {
          if (img.url) return img;
          const url = await uploadImage(img.file);
          return { ...img, url };
        })
      );
      setImages(uploadedImages);
      return uploadedImages.map(img => img.url!);
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload images",
        variant: "destructive"
      });
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (images.length === 0) {
      toast({
        title: "No Images",
        description: "Please upload at least one image",
        variant: "destructive"
      });
      return;
    }

    setGenerating(true);
    try {
      const imageUrls = await uploadAllImages();
      const listing = await generateListing(activePlatform, imageUrls, additionalContext);
      setGeneratedListing(listing);
      toast({
        title: "Listing Generated!",
        description: "AI has created your listing. Review and save when ready."
      });
    } catch (error) {
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate listing",
        variant: "destructive"
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!generatedListing) return;

    try {
      await saveListing({
        platform: activePlatform,
        status: 'draft',
        title: generatedListing.title,
        description: generatedListing.description,
        price: generatedListing.price,
        category: generatedListing.category,
        condition: generatedListing.condition,
        item_specifics: generatedListing.itemSpecifics,
        promotion_rate: promotionRate ? parseFloat(promotionRate) : undefined,
        promotion_type: promotionType,
        image_urls: images.map(i => i.url!).filter(Boolean),
        lot_number: activePlatform === 'liveauctioneers' ? lotNumber : undefined,
        csv_row_data: activePlatform === 'liveauctioneers' ? {
          estimateLow: generatedListing.estimateLow,
          estimateHigh: generatedListing.estimateHigh
        } : undefined
      });
      toast({
        title: "Draft Saved!",
        description: "Your listing has been saved as a draft."
      });
      
      // Reset for next item
      if (activePlatform === 'liveauctioneers') {
        setCsvRows(prev => [...prev, { ...generatedListing, lotNumber, imageUrl: images[0]?.url }]);
        setLotNumber(prev => prev + 1);
      }
      
      setGeneratedListing(null);
      setImages([]);
      setAdditionalContext("");
    } catch (error) {
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Failed to save draft",
        variant: "destructive"
      });
    }
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
    toast({ title: "Copied!", description: `${field} copied to clipboard` });
  };

  const downloadCSV = () => {
    if (csvRows.length === 0) {
      toast({
        title: "No Data",
        description: "Add items to the CSV first",
        variant: "destructive"
      });
      return;
    }

    const headers = ['Lot Number', 'Title', 'Description', 'Category', 'Low Estimate', 'High Estimate', 'Image URL'];
    const rows = csvRows.map(r => [
      r.lotNumber,
      r.title,
      r.description,
      r.category || '',
      r.estimateLow || '',
      r.estimateHigh || '',
      r.imageUrl || ''
    ]);

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

  return (
    <MainLayout 
      title="AI Listing Creator" 
      subtitle="Upload photos and let AI generate optimized listings"
    >
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Platform Mode Selector */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 font-serif text-lg font-semibold text-foreground">Select Platform Mode</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {platforms.map((platform) => (
              <button
                key={platform.id}
                type="button"
                onClick={() => {
                  setActivePlatform(platform.id);
                  setGeneratedListing(null);
                }}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border-2 p-4 transition-all duration-200 text-left",
                  activePlatform === platform.id
                    ? platform.color + " border-opacity-100 ring-2 ring-primary/20"
                    : "border-border bg-secondary/30 hover:border-muted-foreground/30"
                )}
              >
                <div className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg",
                  activePlatform === platform.id ? "bg-background/50" : "bg-background"
                )}>
                  <platform.icon className="h-5 w-5 text-foreground" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{platform.name}</p>
                  <p className="text-xs text-muted-foreground">{platform.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left Column - Input */}
          <div className="space-y-6">
            {/* Photo Upload */}
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 font-serif text-lg font-semibold text-foreground">Upload Photos</h2>
              
              <div className="grid gap-3 grid-cols-3 sm:grid-cols-4">
                {images.map((img, index) => (
                  <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-border">
                    <img src={img.preview} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(index)}
                      className="absolute top-1 right-1 p-1 bg-background/80 rounded-full hover:bg-background"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    {img.url && (
                      <div className="absolute bottom-1 left-1">
                        <Check className="h-4 w-4 text-green-500" />
                      </div>
                    )}
                  </div>
                ))}
                
                <label className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-border bg-secondary/30 transition-colors hover:border-primary/50 hover:bg-secondary/50">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <Upload className="mb-1 h-6 w-6 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Add</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Additional Context */}
            <div className="rounded-xl border border-border bg-card p-6">
              <Label htmlFor="context" className="mb-2 block">Additional Context (Optional)</Label>
              <Textarea
                id="context"
                placeholder="Add any details AI should know: brand, model, age, provenance, measurements, etc."
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                rows={3}
              />
            </div>

            {/* Platform-Specific Options */}
            {activePlatform === "ebay" && (
              <div className="rounded-xl border border-border bg-card p-6">
                <h3 className="mb-4 font-medium text-foreground">eBay Options</h3>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Label>Promotion Rate (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="e.g., 5.0"
                        value={promotionRate}
                        onChange={(e) => setPromotionRate(e.target.value)}
                      />
                    </div>
                    <div className="flex-1">
                      <Label>Promotion Type</Label>
                      <div className="flex gap-2 mt-2">
                        <Button
                          type="button"
                          variant={promotionType === "flat" ? "gold" : "outline"}
                          size="sm"
                          onClick={() => setPromotionType("flat")}
                        >
                          Flat
                        </Button>
                        <Button
                          type="button"
                          variant={promotionType === "fluctuating" ? "gold" : "outline"}
                          size="sm"
                          onClick={() => setPromotionType("fluctuating")}
                        >
                          Fluctuating
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activePlatform === "liveauctioneers" && (
              <div className="rounded-xl border border-border bg-card p-6">
                <h3 className="mb-4 font-medium text-foreground">LiveAuctioneers Options</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Current Lot Number</Label>
                    <Input
                      type="number"
                      value={lotNumber}
                      onChange={(e) => setLotNumber(parseInt(e.target.value) || 1)}
                      className="w-24 mt-1"
                    />
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">CSV Rows: {csvRows.length}</p>
                    {csvRows.length > 0 && (
                      <Button variant="outline" size="sm" onClick={downloadCSV} className="mt-2">
                        <Download className="h-4 w-4 mr-1" />
                        Download CSV
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={images.length === 0 || generating || uploading}
              variant="gold"
              size="lg"
              className="w-full"
            >
              {generating || uploading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  {uploading ? "Uploading..." : "Generating..."}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-5 w-5" />
                  Generate Listing with AI
                </>
              )}
            </Button>
          </div>

          {/* Right Column - Output */}
          <div className="space-y-6">
            {generatedListing ? (
              <>
                <div className="rounded-xl border border-border bg-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-serif text-lg font-semibold text-foreground">Generated Listing</h2>
                    <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary uppercase">
                      {activePlatform}
                    </span>
                  </div>

                  <div className="space-y-4">
                    {/* Title */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label>Title</Label>
                        {activePlatform === "denver" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(generatedListing.title, "Title")}
                          >
                            {copied === "Title" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        )}
                      </div>
                      <div className="p-3 rounded-lg bg-secondary/50 text-sm">
                        {generatedListing.title}
                        <span className="text-xs text-muted-foreground ml-2">
                          ({generatedListing.title.length} chars)
                        </span>
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label>Description</Label>
                        {activePlatform === "denver" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(generatedListing.description, "Description")}
                          >
                            {copied === "Description" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        )}
                      </div>
                      <div className="p-3 rounded-lg bg-secondary/50 text-sm max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {generatedListing.description}
                      </div>
                    </div>

                    {/* Price/Estimates */}
                    {(generatedListing.price || generatedListing.estimateLow) && (
                      <div className="flex gap-4">
                        {generatedListing.price && (
                          <div className="flex-1">
                            <Label>Suggested Price</Label>
                            <div className="flex items-center gap-1 p-3 rounded-lg bg-secondary/50">
                              <DollarSign className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold">{generatedListing.price}</span>
                            </div>
                          </div>
                        )}
                        {generatedListing.estimateLow && (
                          <div className="flex-1">
                            <Label>Estimate Range</Label>
                            <div className="flex items-center gap-1 p-3 rounded-lg bg-secondary/50">
                              <DollarSign className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold">
                                {generatedListing.estimateLow} - {generatedListing.estimateHigh}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Category & Condition */}
                    {(generatedListing.category || generatedListing.condition) && (
                      <div className="flex gap-4">
                        {generatedListing.category && (
                          <div className="flex-1">
                            <Label>Category</Label>
                            <div className="p-3 rounded-lg bg-secondary/50 text-sm">
                              {generatedListing.category}
                            </div>
                          </div>
                        )}
                        {generatedListing.condition && (
                          <div className="flex-1">
                            <Label>Condition</Label>
                            <div className="p-3 rounded-lg bg-secondary/50 text-sm">
                              {generatedListing.condition}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Item Specifics */}
                    {generatedListing.itemSpecifics && Object.keys(generatedListing.itemSpecifics).length > 0 && (
                      <div>
                        <Label>Item Specifics</Label>
                        <div className="p-3 rounded-lg bg-secondary/50 text-sm space-y-1">
                          {Object.entries(generatedListing.itemSpecifics).map(([key, value]) => (
                            <div key={key} className="flex justify-between">
                              <span className="text-muted-foreground">{key}:</span>
                              <span>{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setGeneratedListing(null)}
                  >
                    Regenerate
                  </Button>
                  <Button
                    variant="gold"
                    className="flex-1"
                    onClick={handleSaveDraft}
                  >
                    {activePlatform === "liveauctioneers" ? (
                      <>
                        <Plus className="h-4 w-4 mr-1" />
                        Add to CSV
                      </>
                    ) : (
                      "Save Draft"
                    )}
                  </Button>
                </div>

                {/* Denver-specific copy all button */}
                {activePlatform === "denver" && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleCopy(`${generatedListing.title}\n\n${generatedListing.description}`, "All")}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Title & Description
                  </Button>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
                <Sparkles className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-medium text-foreground mb-2">Ready to Generate</h3>
                <p className="text-sm text-muted-foreground">
                  Upload photos and click generate to create an AI-optimized listing for {platforms.find(p => p.id === activePlatform)?.name}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}