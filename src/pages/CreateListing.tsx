import { useState, useCallback, useEffect } from "react";
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
  Rocket,
  Camera,
  FolderArchive,
  Cloud
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { generateListing, uploadImage, saveListing, type Platform, type GeneratedListing } from "@/lib/api/listings";
import { CameraCapture } from "@/components/CameraCapture";
import { LiveAuctioneersCaptureMode } from "@/components/LiveAuctioneersCaptureMode";
import { supabase } from "@/integrations/supabase/client";
import JSZip from "jszip";
import { saveAs } from "file-saver";

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
  
  // LiveAuctioneers specific - cloud batch (real-time saving)
  const [lotNumber, setLotNumber] = useState(1);
  const [dbBatchRows, setDbBatchRows] = useState<any[]>([]);
  const [loadingBatch, setLoadingBatch] = useState(true);
  const [savingLot, setSavingLot] = useState(false);
  
  // Denver Auctions specific
  const [denverLotNumber, setDenverLotNumber] = useState(1);
  const [denverLots, setDenverLots] = useState<any[]>([]);
  const [selectedDenverLot, setSelectedDenverLot] = useState<number | null>(null);

  // LiveAuctioneers Quick Capture mode
  const [laQuickCaptureOpen, setLaQuickCaptureOpen] = useState(false);

  // Fetch batch rows from database on mount
  useEffect(() => {
    const fetchBatchRows = async () => {
      try {
        const { data, error } = await supabase
          .from('la_batch_rows')
          .select('*')
          .order('lot_number', { ascending: true });
        
        if (error) throw error;
        setDbBatchRows(data || []);
        
        // Set next lot number based on existing data
        if (data && data.length > 0) {
          const maxLot = Math.max(...data.map(r => r.lot_number));
          setLotNumber(maxLot + 1);
        }
      } catch (error) {
        console.error('Error fetching batch rows:', error);
      } finally {
        setLoadingBatch(false);
      }
    };
    
    fetchBatchRows();
  }, []);

  // Real-time save to cloud database
  const saveToCloudBatch = async (listing: GeneratedListing, imageUrls: string[], currentLotNumber: number) => {
    setSavingLot(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const rowToInsert = {
        lot_number: currentLotNumber,
        title: (listing.title || '').substring(0, 100),
        description: listing.description || '',
        low_est: listing.lowEst || 0,
        high_est: listing.highEst || 0,
        start_price: listing.startPrice || 5,
        condition: listing.condition || '',
        consignor: listing.consigner || 'JSG',
        height: String(listing.height || ''),
        width: String(listing.width || ''),
        depth: String(listing.depth || ''),
        dimension_unit: listing.dimensionUnit || '',
        weight: String(listing.weight || ''),
        weight_unit: listing.weightUnit || '',
        category: listing.category || '',
        image_urls: imageUrls,
        created_by: user?.id
      };

      const { data, error } = await supabase
        .from('la_batch_rows')
        .insert([rowToInsert])
        .select()
        .single();

      if (error) throw error;

      // Add to local state immediately
      if (data) {
        setDbBatchRows(prev => [...prev, data]);
      }
      
      return data;
    } catch (error) {
      console.error("Error saving to cloud:", error);
      toast({ 
        title: "Cloud Save Failed", 
        description: "Lot generated but cloud save failed. Try again.",
        variant: "destructive"
      });
      return null;
    } finally {
      setSavingLot(false);
    }
  };

  const handleLaQuickCaptureLot = async (lot: {
    listing: GeneratedListing;
    imageUrls: string[];
    lotNumber: number;
  }) => {
    // Save directly to cloud
    const saved = await saveToCloudBatch(lot.listing, lot.imageUrls, lot.lotNumber);
    
    if (saved) {
      setLotNumber(prev => prev + 1);
      toast({
        title: `Lot ${lot.lotNumber} Saved to Cloud`,
        description: `${dbBatchRows.length + 1} lots in batch. Auto-saved.`
      });
    }
    
    setLaQuickCaptureOpen(false);
    setGeneratedListing(lot.listing);
    setActivePlatform('liveauctioneers');
  };

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

      // Auto-save to cloud batch for LiveAuctioneers
      if (platform === 'liveauctioneers') {
        const saved = await saveToCloudBatch(listing, imageUrls, lotNumber);
        if (saved) {
          setLotNumber(prev => prev + 1);
        }
      }

      // Auto-add to batch for Denver Auctions
      if (platform === 'denver') {
        const newLot = {
          ...listing,
          lotNumber: denverLotNumber,
          imageUrls
        };
        setDenverLots(prev => [...prev, newLot]);
        setSelectedDenverLot(denverLotNumber);
        setDenverLotNumber(prev => prev + 1);
      }

      const toastMessages: Record<Platform, { title: string; description: string }> = {
        liveauctioneers: {
          title: `Lot ${lotNumber} Saved to Cloud`,
          description: `${dbBatchRows.length + 1} lots in batch. Auto-saved.`
        },
        denver: {
          title: `Lot ${denverLotNumber} Added to Batch`,
          description: `${denverLots.length + 1} lots ready. Click to copy fields.`
        },
        ebay: { title: "Draft Ready!", description: "Review and launch when ready." },
        facebook: { title: "Draft Ready!", description: "Review and launch when ready." }
      };

      toast(toastMessages[platform]);

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

  const clearBatch = async () => {
    if (!confirm('Clear all batch data? This cannot be undone.')) return;
    
    try {
      const { error } = await supabase
        .from('la_batch_rows')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows
      
      if (error) throw error;
      
      setDbBatchRows([]);
      setLotNumber(1);
      toast({ title: "Batch Cleared" });
    } catch (error) {
      console.error("Error clearing batch:", error);
      toast({ 
        title: "Clear Failed", 
        description: error instanceof Error ? error.message : "Could not clear batch",
        variant: "destructive"
      });
    }
  };

  const downloadBatchCSV = () => {
    if (dbBatchRows.length === 0) {
      toast({ title: "No Data", description: "Batch is empty", variant: "destructive" });
      return;
    }

    // Find the maximum number of images across all lots
    const maxImages = Math.max(...dbBatchRows.map(r => (r.image_urls || []).length), 4);
    
    // Build dynamic ImageFile columns
    const imageColumns = Array.from({ length: maxImages }, (_, i) => `ImageFile.${i + 1}`);
    
    // Official LiveAuctioneers column headers - EXACT FORMAT REQUIRED
    const headers = [
      'LotNum', 'Title', 'Description', 'LowEst', 'HighEst', 'StartPrice',
      'Condition', 'Consigner', 
      ...imageColumns,
      'Buy Now Price', 'Exclude From Buy Now', 'Reserve Price',
      'Height', 'Width', 'Depth', 'Dimension Unit', 'Weight', 'Weight Unit',
      'Domestic Flat Shipping Price', 'Quantity', 'Category', 'Origin',
      'Style & Period', 'Creator', 'Materials & Techniques', 'Lot Reference Number', 'Location Nickname'
    ];

    const rows = dbBatchRows.map(r => {
      const lotNum = r.lot_number || '';
      
      // Generate image filename entries for all columns
      const imageEntries = Array.from({ length: maxImages }, (_, i) => 
        (r.image_urls || [])[i] ? `${lotNum}_${i + 1}` : ''
      );
      
      return [
        lotNum,
        (r.title || '').substring(0, 100),
        r.description || '',
        r.low_est || '',
        r.high_est || '',
        r.start_price || 5,
        r.condition || '',
        r.consignor || 'JSG',
        ...imageEntries,
        '', // Buy Now Price
        '', // Exclude From Buy Now
        '', // Reserve Price
        r.height || '',
        r.width || '',
        r.depth || '',
        r.dimension_unit || '',
        r.weight || '',
        r.weight_unit || '',
        '', // Domestic Flat Shipping
        '1', // Quantity
        r.category || '',
        '', // Origin
        '', // Style & Period
        '', // Creator
        '', // Materials & Techniques
        '', // Lot Reference Number
        'Highlands Ranch' // Location Nickname
      ];
    });

    const csvContent = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `liveauctioneers_batch_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    toast({ title: "CSV Downloaded", description: `${dbBatchRows.length} lots exported with images` });
  };

  const [downloadingImages, setDownloadingImages] = useState(false);

  const downloadImagesZip = async () => {
    if (dbBatchRows.length === 0) {
      toast({ title: "No Data", description: "Batch is empty", variant: "destructive" });
      return;
    }

    setDownloadingImages(true);
    toast({ title: "Preparing Images...", description: "Downloading and packaging images" });

    try {
      const zip = new JSZip();
      
      // Process each lot
      for (const row of dbBatchRows) {
        const lotNum = row.lot_number;
        const imageUrls = row.image_urls || [];
        
        // Download each image and add to zip with correct filename
        for (let i = 0; i < imageUrls.length; i++) {
          try {
            const response = await fetch(imageUrls[i]);
            const blob = await response.blob();
            // LA accepts jpg, png, gif - detect from content-type or default to jpg
            const contentType = response.headers.get('content-type') || 'image/jpeg';
            const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg';
            const filename = `${lotNum}_${i + 1}.${ext}`;
            zip.file(filename, blob);
          } catch (err) {
            console.error(`Failed to download image ${lotNum}_${i + 1}:`, err);
          }
        }
      }

      // Generate and download the zip
      const content = await zip.generateAsync({ type: "blob" });
      const dateStr = new Date().toISOString().split('T')[0];
      saveAs(content, `liveauctioneers-images-${dateStr}.zip`);

      const imageCount = dbBatchRows.reduce((sum, r) => sum + ((r.image_urls)?.length || 0), 0);
      toast({ 
        title: "Images Downloaded!", 
        description: `ZIP file with ${imageCount} images ready for LA upload`
      });
    } catch (error) {
      console.error("Error creating ZIP:", error);
      toast({ 
        title: "Download Failed", 
        description: "Could not create image ZIP file",
        variant: "destructive"
      });
    } finally {
      setDownloadingImages(false);
    }
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
            <div className="flex flex-col items-center justify-center">
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
                {isDragging ? "Drop photos here!" : "Add Photos"}
              </h3>
              <p className="text-muted-foreground text-sm mb-4">
                Drop files, browse, or take a photo
              </p>
              <div className="flex gap-3">
                <CameraCapture 
                  onCapture={(files) => {
                    const newImages = files.map(file => ({
                      file,
                      preview: URL.createObjectURL(file)
                    }));
                    setImages(prev => [...prev, ...newImages]);
                  }}
                />
                <label className="cursor-pointer">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <Button variant="outline" size="lg" asChild>
                    <span className="flex items-center gap-2">
                      <Upload className="h-5 w-5" />
                      Browse Files
                    </span>
                  </Button>
                </label>
              </div>
            </div>
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

        {/* LiveAuctioneers Quick Capture Mode */}
        {laQuickCaptureOpen && (
          <LiveAuctioneersCaptureMode
            lotNumber={lotNumber}
            onLotComplete={handleLaQuickCaptureLot}
            onClose={() => setLaQuickCaptureOpen(false)}
          />
        )}

        {/* LiveAuctioneers Cloud Batch */}
        <div className={cn(
          "rounded-xl border p-4 space-y-4 transition-colors",
          dbBatchRows.length > 0 ? "border-primary/50 bg-primary/5" : "border-border bg-card"
        )}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Cloud className="h-5 w-5 text-primary" />
                <span className="font-semibold text-foreground">LiveAuctioneers Cloud Batch</span>
                {savingLot && (
                  <span className="flex items-center gap-1 text-xs text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Saving...
                  </span>
                )}
              </div>
              <span className="text-muted-foreground text-sm">
                {loadingBatch ? 'Loading...' : (
                  dbBatchRows.length > 0 
                    ? `${dbBatchRows.length} lots saved • Next: #${lotNumber} • Auto-saves instantly`
                    : 'Lots auto-save to cloud instantly • Never lose work'
                )}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button 
                variant="gold" 
                onClick={() => setLaQuickCaptureOpen(true)}
                className="gap-2"
              >
                <Camera className="h-4 w-4" />
                Quick Capture Lot #{lotNumber}
              </Button>
              <Input
                type="number"
                value={lotNumber}
                onChange={(e) => setLotNumber(parseInt(e.target.value) || 1)}
                className="w-20"
              />
            </div>
          </div>

          {/* Saved batch rows */}
          {dbBatchRows.length > 0 && (
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" />
                  {dbBatchRows.length} lots in cloud batch
                </span>
                <div className="flex gap-2">
                  <Button variant="gold" onClick={downloadBatchCSV} className="gap-2">
                    <Download className="h-4 w-4" />
                    Download CSV
                  </Button>
                  <Button variant="outline" onClick={downloadImagesZip} disabled={downloadingImages}>
                    {downloadingImages ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FolderArchive className="h-4 w-4 mr-2" />
                    )}
                    Images ZIP
                  </Button>
                  <Button variant="outline" onClick={clearBatch}>
                    Clear All
                  </Button>
                </div>
              </div>
              
              {/* Batch preview */}
              <div className="max-h-40 overflow-y-auto space-y-1">
                {dbBatchRows.map((row) => (
                  <div key={row.id} className="text-xs flex justify-between items-center py-1 px-2 bg-background/50 rounded">
                    <span className="font-mono">#{row.lot_number}</span>
                    <span className="truncate flex-1 mx-2">{row.title}</span>
                    <span className="text-muted-foreground">${row.low_est}-${row.high_est}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Denver Auctions Batch */}
        {denverLots.length > 0 && (
          <div className="rounded-xl border border-amber-500/50 bg-amber-500/5 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-foreground">Denver Auctions Batch</span>
                <span className="text-muted-foreground ml-2">{denverLots.length} lots ready</span>
                <span className="text-muted-foreground ml-2">• Next lot: #{denverLotNumber}</span>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={denverLotNumber}
                  onChange={(e) => setDenverLotNumber(parseInt(e.target.value) || 1)}
                  className="w-20"
                />
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    setDenverLots([]);
                    setSelectedDenverLot(null);
                  }}
                >
                  Clear All
                </Button>
              </div>
            </div>
            
            {/* Lot List */}
            <div className="flex flex-wrap gap-2">
              {denverLots.map((lot, index) => (
                <Button
                  key={index}
                  variant={selectedDenverLot === lot.lotNumber ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedDenverLot(lot.lotNumber)}
                >
                  Lot #{lot.lotNumber}
                </Button>
              ))}
            </div>

            {/* Selected Lot Details */}
            {selectedDenverLot && (
              <div className="border border-border rounded-lg p-4 bg-card space-y-3">
                {denverLots.filter(l => l.lotNumber === selectedDenverLot).map((lot, idx) => (
                  <div key={idx} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">Lot #{lot.lotNumber}</h3>
                    </div>
                    
                    <div className="grid gap-3">
                      <div className="flex items-center justify-between p-2 bg-secondary/30 rounded">
                        <div className="flex-1 min-w-0">
                          <Label className="text-xs text-muted-foreground">TITLE</Label>
                          <p className="font-medium truncate">{lot.title}</p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleCopy(lot.title, `denver-title-${lot.lotNumber}`)}
                        >
                          {copied === `denver-title-${lot.lotNumber}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>

                      <div className="flex items-center justify-between p-2 bg-secondary/30 rounded">
                        <div className="flex-1 min-w-0">
                          <Label className="text-xs text-muted-foreground">STARTING BID</Label>
                          <p className="font-semibold text-primary">${lot.startingBid || 5}</p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleCopy(String(lot.startingBid || 5), `denver-bid-${lot.lotNumber}`)}
                        >
                          {copied === `denver-bid-${lot.lotNumber}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>

                      <div className="flex items-start justify-between p-2 bg-secondary/30 rounded">
                        <div className="flex-1 min-w-0">
                          <Label className="text-xs text-muted-foreground">DESCRIPTION</Label>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap max-h-24 overflow-y-auto">{lot.description}</p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleCopy(lot.description, `denver-desc-${lot.lotNumber}`)}
                        >
                          {copied === `denver-desc-${lot.lotNumber}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Generated Listing Preview */}
        {generatedListing && activePlatform && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  {activePlatform === 'liveauctioneers' ? `Lot ${lotNumber - 1} Saved` : 'Draft Ready'}
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
                    {generatedListing.condition && (
                      <div>
                        <Label className="text-xs text-muted-foreground">CONDITION</Label>
                        <p className="text-sm">{generatedListing.condition}</p>
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
