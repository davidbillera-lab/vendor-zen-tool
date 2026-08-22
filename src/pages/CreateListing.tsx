import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
  Cloud,
  Edit,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Clock,
  Send,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Pencil
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { generateListing, uploadImage, saveListing, type Platform, type GeneratedListing } from "@/lib/api/listings";
import { CameraCapture } from "@/components/CameraCapture";
import { LiveAuctioneersCaptureMode } from "@/components/LiveAuctioneersCaptureMode";
import { AIGuardrailPrompt } from "@/components/AIGuardrailPrompt";
import { ProjectManager, type Project } from "@/components/BatchManager";
import { LALotEditor } from "@/components/LALotEditor";
import { DenverLotEditor } from "@/components/DenverLotEditor";
import { supabase } from "@/integrations/supabase/client";
import { ImageEditor } from "@/components/ImageEditor";

import { saveAs } from "file-saver";
import { EbayBatchPanel } from "@/components/ebay/EbayBatchPanel";
import { CrossPostPanel } from "@/components/crosspost/CrossPostPanel";
import { EbayItemSpecificsEditor } from "@/components/ebay/EbayItemSpecificsEditor";
import { EbayShippingSettings, type ShippingSettings } from "@/components/ebay/EbayShippingSettings";
import { captureCorrection, diffCorrection } from "@/lib/hermes/captureCorrection";
import { verifyDoaLot, changedFields, type DoaVerifyResult } from "@/lib/doa/verifyLot";
import { DoaVerifyDialog } from "@/components/DoaVerifyDialog";
import { 
  normalizeAndValidateBatch, 
  generateLiveAuctioneersCSV, 
  downloadCSV,
  formatValidationErrors,
  type ValidationIssue 
} from "@/lib/liveauctioneers-csv";

const platforms = [
  { id: "ebay" as Platform, name: "eBay", icon: Store, color: "bg-platform-ebay", description: "Cassini-optimized draft" },
  { id: "facebook" as Platform, name: "Facebook", icon: Facebook, color: "bg-platform-facebook", description: "Marketplace + groups" },
  { id: "liveauctioneers" as Platform, name: "LiveAuctioneers", icon: Gavel, color: "bg-platform-auction", description: "CSV export" },
  { id: "denver" as Platform, name: "Denver Auctions", icon: Gavel, color: "bg-platform-auction", description: "Copy-paste tool" },
  { id: "mercari" as Platform, name: "Mercari", icon: ShoppingBag, color: "bg-red-400/20", description: "Queue for Mercari agent" },
  { id: "poshmark" as Platform, name: "Poshmark", icon: Tag, color: "bg-pink-500/20", description: "Queue for Poshmark agent" },
  { id: "etsy" as Platform, name: "Etsy", icon: Tag, color: "bg-orange-400/20", description: "Publish via Etsy API" },
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
  const [searchParams] = useSearchParams();
  const projectIdFromUrl = searchParams.get('project');
  
  const [images, setImages] = useState<{ file: File; preview: string; url?: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState<Platform | null>(null);
  const [generatedListing, setGeneratedListing] = useState<GeneratedListing | null>(null);
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  
  // eBay specific
  const [promotionRate, setPromotionRate] = useState("2.1");
  const [promotionType, setPromotionType] = useState<"flat" | "fluctuating">("flat");
  // Optional internal/Custom SKU — lands in eBay's "Custom Label (SKU)". Never required, never blocks a push.
  const [customSku, setCustomSku] = useState("");
  
  // Facebook specific
  const [selectedGroups, setSelectedGroups] = useState<string[]>(DEFAULT_FB_GROUPS);
  
  // LiveAuctioneers specific - cloud batch (real-time saving)
  const [lotNumber, setLotNumber] = useState(1);
  const [dbBatchRows, setDbBatchRows] = useState<any[]>([]);
  const [loadingBatch, setLoadingBatch] = useState(true);
  const [savingLot, setSavingLot] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [initialProjectLoaded, setInitialProjectLoaded] = useState(false);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [imageEditorIndex, setImageEditorIndex] = useState(0);
  
  // Load project from URL parameter
  useEffect(() => {
    const loadProjectFromUrl = async () => {
      if (!projectIdFromUrl || initialProjectLoaded) return;
      
      try {
        const { data, error } = await supabase
          .from('la_batches')
          .select('*')
          .eq('id', projectIdFromUrl)
          .single();
        
        if (error) throw error;
        
        if (data) {
          setSelectedProject({
            ...data,
            lot_count: 0,
            platforms: data.platforms || []
          });
        }
      } catch (error) {
        console.error('Error loading project from URL:', error);
      } finally {
        setInitialProjectLoaded(true);
      }
    };
    
    loadProjectFromUrl();
  }, [projectIdFromUrl, initialProjectLoaded]);
  
  // Denver Auctions specific - now also cloud-based
  const [denverLotNumber, setDenverLotNumber] = useState(1);
  const [denverLots, setDenverLots] = useState<any[]>([]);
  const [editingDenverLot, setEditingDenverLot] = useState<any | null>(null);
  // AI Verify straight from the lot card — no save-then-reopen round trip.
  const [denverVerifyingId, setDenverVerifyingId] = useState<string | null>(null);
  const [denverVerify, setDenverVerify] = useState<{ lot: any; result: DoaVerifyResult } | null>(null);
  const [loadingDenver, setLoadingDenver] = useState(false);
  const [selectedDenverLot, setSelectedDenverLot] = useState<number | null>(null);

  // eBay batch mode
  const [ebayLotNumber, setEbayLotNumber] = useState(1);

  // Cross-post preselection (Mercari / Poshmark / Etsy paths auto-check the platform in CrossPostPanel)
  const [crossPostPreselect, setCrossPostPreselect] = useState<string | null>(null);
  const [ebayRows, setEbayRows] = useState<any[]>([]);
  // The ebay_batch_rows id that belongs to the CURRENT on-screen generatedListing.
  // Every DB write driven by generatedListing (debounced sync, verify, refine) MUST
  // key on this id — targeting ebayRows[length-1] wrote item N+1's text onto row N
  // whenever the insert round-trip outran the 600ms debounce (2026-07-05 purse batch).
  const [activeEbayRowId, setActiveEbayRowId] = useState<string | null>(null);
  const [loadingEbay, setLoadingEbay] = useState(false);
  const [ebayShippingSettings, setEbayShippingSettings] = useState<ShippingSettings>({
    shippingType: "flat",
    shippingCost: 9.98,
    handlingTime: 1,
    returnsAccepted: true,
    returnPeriod: 30,
    returnShipping: "seller",
  });
  const [ebayItemSpecifics, setEbayItemSpecifics] = useState<Record<string, string>>({});

  // LiveAuctioneers Quick Capture mode
  const [laQuickCaptureOpen, setLaQuickCaptureOpen] = useState(false);
  const [editingLaLot, setEditingLaLot] = useState<any | null>(null);
  
  // LiveAuctioneers CSV validation state
  const [csvValidationIssues, setCsvValidationIssues] = useState<ValidationIssue[]>([]);
  const [csvValidated, setCsvValidated] = useState(false);

  // eBay AI verify & refine state
  const [ebayVerifying, setEbayVerifying] = useState(false);
  const [ebayRefining, setEbayRefining] = useState(false);
  const [ebayVerifyResult, setEbayVerifyResult] = useState<{ verified: boolean; confidence: string; notes: string } | null>(null);
  const [ebayRefinePrompt, setEbayRefinePrompt] = useState("");

  // Master prompt for AI guardrails
  const [masterPrompt, setMasterPrompt] = useState("");
  const [masterPromptDraft, setMasterPromptDraft] = useState("");
  const [masterPromptOpen, setMasterPromptOpen] = useState(false);
  const [savingMasterPrompt, setSavingMasterPrompt] = useState(false);

  // Load master prompt when project changes
  useEffect(() => {
    if (selectedProject?.master_prompt) {
      setMasterPrompt(selectedProject.master_prompt);
      setMasterPromptDraft(selectedProject.master_prompt);
    } else {
      setMasterPrompt("");
      setMasterPromptDraft("");
    }
  }, [selectedProject?.id]);

  // Fetch Denver lots when project changes
  useEffect(() => {
    const fetchDenverLots = async () => {
      if (!selectedProject?.id) {
        setDenverLots([]);
        setDenverLotNumber(1);
        return;
      }
      
      setLoadingDenver(true);
      try {
        const { data, error } = await supabase
          .from('denver_batch_rows')
          .select('*')
          .eq('batch_id', selectedProject.id)
          .order('lot_number', { ascending: true });
        
        if (error) throw error;
        setDenverLots(data || []);
        
        if (data && data.length > 0) {
          const maxLot = Math.max(...data.map(r => r.lot_number));
          setDenverLotNumber(maxLot + 1);
        } else {
          setDenverLotNumber(1);
        }
      } catch (error) {
        console.error('Error fetching Denver lots:', error);
      } finally {
        setLoadingDenver(false);
      }
    };
    
    fetchDenverLots();
  }, [selectedProject?.id]);

  // Real-time subscription: refresh Denver lot status when agent updates rows
  useEffect(() => {
    if (!selectedProject?.id) return;

    const channel = supabase
      .channel(`denver_status_${selectedProject.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'denver_batch_rows', filter: `batch_id=eq.${selectedProject.id}` },
        (payload) => {
          setDenverLots(prev =>
            prev.map(lot => lot.id === payload.new.id ? { ...lot, ...payload.new } : lot)
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedProject?.id]);

  const requeueDenverLot = async (lotId: string) => {
    const { error } = await supabase
      .from('denver_batch_rows')
      .update({ status: 'pending', error_log: null })
      .eq('id', lotId);

    if (!error) {
      setDenverLots(prev =>
        prev.map(l => l.id === lotId ? { ...l, status: 'pending', error_log: null } : l)
      );
      toast({ title: "Lot re-queued", description: "It will be picked up on the next agent run." });
    }
  };

  const getDenverStatusBadge = (status: string | null) => {
    switch (status) {
      case 'completed':  return <span className="text-xs font-medium bg-green-500/20 text-green-600 px-1.5 py-0.5 rounded-full">done</span>;
      case 'failed':     return <span className="text-xs font-medium bg-red-500/20 text-red-600 px-1.5 py-0.5 rounded-full">failed</span>;
      case 'in_progress': return <span className="text-xs font-medium bg-blue-500/20 text-blue-600 px-1.5 py-0.5 rounded-full">running</span>;
      default:           return <span className="text-xs font-medium bg-amber-500/20 text-amber-600 px-1.5 py-0.5 rounded-full">pending</span>;
    }
  };

  // Fetch eBay batch rows when project changes
  useEffect(() => {
    const fetchEbayRows = async () => {
      if (!selectedProject?.id) {
        setEbayRows([]);
        setEbayLotNumber(1);
        return;
      }
      
      setLoadingEbay(true);
      try {
        const { data, error } = await supabase
          .from('ebay_batch_rows')
          .select('*')
          .eq('batch_id', selectedProject.id)
          .neq('status', 'archived')
          .order('lot_number', { ascending: true });
        
        if (error) throw error;
        setEbayRows(data || []);
        
        if (data && data.length > 0) {
          const maxLot = Math.max(...data.map(r => r.lot_number));
          setEbayLotNumber(maxLot + 1);
        } else {
          setEbayLotNumber(1);
        }
      } catch (error) {
        console.error('Error fetching eBay rows:', error);
      } finally {
        setLoadingEbay(false);
      }
    };
    
    fetchEbayRows();
  }, [selectedProject?.id]);

  // Fetch batch rows when selected project changes
  useEffect(() => {
    const fetchBatchRows = async () => {
      if (!selectedProject?.id) {
        setDbBatchRows([]);
        setLotNumber(1);
        setLoadingBatch(false);
        return;
      }
      
      setLoadingBatch(true);
      try {
        const { data, error } = await supabase
          .from('la_batch_rows')
          .select('*')
          .eq('batch_id', selectedProject.id)
          .order('lot_number', { ascending: true });
        
        if (error) throw error;
        setDbBatchRows(data || []);
        
        // Set next lot number based on existing data
        if (data && data.length > 0) {
          const maxLot = Math.max(...data.map(r => r.lot_number));
          setLotNumber(maxLot + 1);
        } else {
          setLotNumber(1);
        }
      } catch (error) {
        console.error('Error fetching batch rows:', error);
      } finally {
        setLoadingBatch(false);
      }
    };
    
    fetchBatchRows();
  }, [selectedProject?.id]);

  // Real-time save to cloud database
  const saveToCloudBatch = async (listing: GeneratedListing, imageUrls: string[], currentLotNumber: number) => {
    if (!selectedProject?.id) {
      toast({ 
        title: "No Project Selected", 
        description: "Select or create a project first",
        variant: "destructive"
      });
      return null;
    }
    
    setSavingLot(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const rowToInsert = {
        batch_id: selectedProject.id,
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
        
        // Update batch lot_count
        await supabase
          .from('la_batches')
          .update({ lot_count: dbBatchRows.length + 1, updated_at: new Date().toISOString() })
          .eq('id', selectedProject.id);
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
    setActiveEbayRowId(null);
    setActivePlatform(null);
    setAdditionalContext("");
  };

  function dataURLtoFile(dataUrl: string, filename: string): File {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)![1];
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    return new File([array], filename, { type: mime });
  }

  function handleImageEditorSave(updatedUrls: string[]) {
    setImages(prev => {
      prev.forEach(img => { if (img.preview.startsWith('blob:')) URL.revokeObjectURL(img.preview); });
      return updatedUrls.map((url, i) => {
        const original = prev[i];
        const filename = original?.file?.name ?? `photo-${i + 1}.jpg`;
        const newFile = dataURLtoFile(url, filename);
        // Drop any previously-uploaded URL: the upload step skips images that
        // already have one, which would publish the stale un-edited photo.
        return { file: newFile, preview: url, url: undefined };
      });
    });
    setImageEditorOpen(false);
  }

  const handlePlatformClick = async (platform: Platform) => {
    if (!selectedProject?.id) {
      toast({
        title: "No Project Selected",
        description: "Please select or create a project first to keep your listings organized",
        variant: "destructive"
      });
      return;
    }
    
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
    setActiveEbayRowId(null); // new item — no row belongs to the upcoming listing yet

    // Mercari / Poshmark / Etsy use the cross-post pipeline (clean base listing, then CrossPostPanel handles dispatch)
    const isCrossPostOnly = platform === 'mercari' || platform === 'poshmark' || platform === 'etsy';
    setCrossPostPreselect(isCrossPostOnly ? platform : null);

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

      // Generate listing — Mercari/Poshmark/Etsy use the 'facebook' prompt as a neutral base listing
      // (the generate-listing edge function only supports ebay | facebook | liveauctioneers | denver)
      const generationPlatform: Platform = isCrossPostOnly ? 'facebook' : platform;
      const listing = await generateListing(generationPlatform, imageUrls, additionalContext, masterPrompt || undefined);
      setGeneratedListing(listing);

      // Gate the success toast on the platform save actually succeeding — a
      // failed insert must never end the flow on a success message.
      let platformSaveOk = true;

      // Auto-save eBay to batch for bulk export
      if (platform === 'ebay') {
        if (!selectedProject?.id) {
          toast({ 
            title: "No Project Selected", 
            description: "Select or create a project first for eBay batch",
            variant: "destructive"
          });
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          
          // Set item specifics from AI
          if (listing.itemSpecifics) {
            setEbayItemSpecifics(listing.itemSpecifics as Record<string, string>);
          }
          
          // Use numeric categoryId from AI if available, otherwise fall back to category string
          const categoryValue = listing.categoryId 
            ? String(listing.categoryId) 
            : (listing.category || '');
          
          const { data, error } = await supabase
            .from('ebay_batch_rows')
            .insert({
              batch_id: selectedProject.id,
              lot_number: ebayLotNumber,
              title: listing.title || '',
              description: listing.description || '',
              price: listing.price || 0,
              category: categoryValue,
              condition: listing.condition || '',
              item_specifics: listing.itemSpecifics || {},
              image_urls: imageUrls,
              shipping_type: ebayShippingSettings.shippingType,
              shipping_cost: ebayShippingSettings.shippingCost,
              handling_time: ebayShippingSettings.handlingTime,
              returns_accepted: ebayShippingSettings.returnsAccepted,
              return_period: ebayShippingSettings.returnPeriod,
              return_shipping: ebayShippingSettings.returnShipping,
              promotion_rate: Number.isFinite(parseFloat(promotionRate)) ? parseFloat(promotionRate) : null,
              promotion_type: promotionType,
              custom_sku: customSku.trim() || null,
              injected_correction_ids: listing.injectedCorrectionIds?.length
                ? listing.injectedCorrectionIds
                : null,
              created_by: user?.id
            })
            .select()
            .single();

          if (!error && data) {
            setEbayRows(prev => [...prev, data]);
            setActiveEbayRowId(data.id);
            setEbayLotNumber(prev => prev + 1);
            setCustomSku("");
            // v2.4: durably log which corrections shaped this row + bump times_injected.
            // Fire-and-forget — a logging failure must never block the listing flow.
            if (listing.injectedCorrectionIds?.length) {
              supabase.rpc('record_correction_injections', {
                p_row_id: String(data.id),
                p_platform: 'ebay',
                p_ids: listing.injectedCorrectionIds,
              }).then(({ error: rpcErr }) => {
                if (rpcErr) console.warn('record_correction_injections skipped (non-blocking):', rpcErr.message);
              });
            }
          } else if (error) {
            // Never swallow a save failure silently — a rejected insert here
            // looks exactly like "nothing saves" to the operator (no row added,
            // lot number stuck, no eBay push button). Surface it loudly.
            platformSaveOk = false;
            console.error('eBay batch row save failed:', error);
            toast({
              title: "Listing didn't save to eBay batch",
              description: error.message || "The item was not added to the batch. Try again or contact support.",
              variant: "destructive"
            });
          }
        }
      }

      // Auto-save Facebook draft
      if (platform === 'facebook') {
        await saveListing({
          platform,
          status: 'draft',
          title: listing.title,
          description: listing.description,
          price: listing.price,
          category: listing.category,
          condition: listing.condition,
          item_specifics: listing.itemSpecifics,
          image_urls: imageUrls,
          facebook_groups: selectedGroups,
          project_id: selectedProject?.id
        });
      }

      // Auto-save to cloud batch for LiveAuctioneers
      if (platform === 'liveauctioneers') {
        if (!selectedProject?.id) {
          toast({ 
            title: "No Project Selected", 
            description: "Select or create a project first for LiveAuctioneers",
            variant: "destructive"
          });
        } else {
          const saved = await saveToCloudBatch(listing, imageUrls, lotNumber);
          if (saved) {
            setLotNumber(prev => prev + 1);
          } else {
            platformSaveOk = false; // saveToCloudBatch already toasted the failure
          }
        }
      }

      // Auto-save to cloud for Denver Auctions
      if (platform === 'denver') {
        if (!selectedProject?.id) {
          toast({ 
            title: "No Project Selected", 
            description: "Select or create a project first",
            variant: "destructive"
          });
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          const { data, error } = await supabase
            .from('denver_batch_rows')
            .insert({
              batch_id: selectedProject.id,
              lot_number: denverLotNumber,
              title: listing.title || '',
              description: listing.description || '',
              starting_bid: listing.startingBid || 5,
              image_urls: imageUrls,
              created_by: user?.id
            })
            .select()
            .single();
          
          if (!error && data) {
            setDenverLots(prev => [...prev, data]);
            setDenverLotNumber(prev => prev + 1);
          } else if (error) {
            platformSaveOk = false;
            console.error('Denver batch row save failed:', error);
            toast({
              title: "Lot didn't save to Denver batch",
              description: error.message || "The lot was not added. Try again.",
              variant: "destructive"
            });
          }
        }
      }

      const toastMessages: Partial<Record<Platform, { title: string; description: string }>> = {
        liveauctioneers: {
          title: `Lot ${lotNumber} Saved to Cloud`,
          description: `${dbBatchRows.length + 1} lots in batch. Auto-saved.`
        },
        denver: {
          title: `Lot ${denverLotNumber} Added to Batch`,
          description: `${denverLots.length + 1} lots ready. Click to copy fields.`
        },
        ebay: { 
          title: `Listing #${ebayLotNumber} Saved`, 
          description: `${ebayRows.length + 1} eBay listings in batch. Export CSV when ready.` 
        },
        facebook: { title: "Draft Ready!", description: "Review and launch when ready." },
        mercari: { title: "Listing Ready", description: "Select Mercari in the cross-post panel below to queue it." },
        poshmark: { title: "Listing Ready", description: "Select Poshmark in the cross-post panel below to queue it." },
        etsy: { title: "Listing Ready", description: "Select Etsy in the cross-post panel below to publish." }
      };

      const msg = toastMessages[platform];
      if (msg && platformSaveOk) toast(msg);

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
    if (!selectedProject?.id) return;
    if (!confirm('Clear all lots in this project? This cannot be undone.')) return;
    
    try {
      const { error } = await supabase
        .from('la_batch_rows')
        .delete()
        .eq('batch_id', selectedProject.id);
      
      if (error) throw error;
      
      setDbBatchRows([]);
      setLotNumber(1);
      
      // Update project lot_count
      await supabase
        .from('la_batches')
        .update({ lot_count: 0 })
        .eq('id', selectedProject.id);
        
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

  // eBay: Verify listing with second LLM
  const handleEbayVerify = async () => {
    if (!generatedListing || !activePlatform) return;
    // Resolve the row by the id captured at insert — never by position.
    const lastEbayRow = ebayRows.find(r => r.id === activeEbayRowId) ?? null;

    setEbayVerifying(true);
    setEbayVerifyResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expired');

      const verifyResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-listing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          currentListing: {
            title: generatedListing.title,
            description: generatedListing.description,
            price: generatedListing.price,
            categoryId: lastEbayRow?.category,
            condition: generatedListing.condition,
            itemSpecifics: generatedListing.itemSpecifics || lastEbayRow?.item_specifics,
          },
          correctionPrompt: ebayRefinePrompt || '',
          imageUrls: lastEbayRow?.image_urls || images.map(i => i.url).filter(Boolean),
          platform: 'ebay',
          mode: 'verify',
          masterPrompt: masterPrompt || undefined
        })
      });
      if (!verifyResp.ok) {
        const errBody = await verifyResp.json().catch(() => ({}));
        throw new Error(errBody.error || `Verify request failed (${verifyResp.status})`);
      }
      const data = await verifyResp.json();

      const refined = data.correctedListing ?? {};
      setEbayVerifyResult({
        verified: data.passed,
        confidence: data.confidence,
        notes: data.report
      });

      // Update generatedListing with verified/corrected data
      const updates: any = {};
      if (refined.title) updates.title = refined.title.substring(0, 80);
      if (refined.description) updates.description = refined.description;
      if (refined.price) updates.price = refined.price;
      if (refined.categoryId) updates.category = String(refined.categoryId);
      if (refined.condition) updates.condition = refined.condition;
      if (refined.itemSpecifics) updates.item_specifics = refined.itemSpecifics;

      if (Object.keys(updates).length > 0) {
        setGeneratedListing(prev => prev ? {
          ...prev,
          title: updates.title || prev.title,
          description: updates.description || prev.description,
          price: updates.price || prev.price,
          condition: updates.condition || prev.condition,
          itemSpecifics: updates.item_specifics || prev.itemSpecifics,
        } : prev);
        // Keep the specifics editor in step — the settings sync writes
        // ebayItemSpecifics to the row and must not resurrect pre-verify values.
        if (updates.item_specifics) setEbayItemSpecifics(updates.item_specifics);

        // Sync to DB row if one exists
        if (lastEbayRow) {
          const { error: updateError } = await supabase
            .from('ebay_batch_rows')
            .update(updates)
            .eq('id', lastEbayRow.id);
          if (!updateError) {
            setEbayRows(prev => prev.map(r => r.id === lastEbayRow.id ? { ...r, ...updates } : r));
          }
        }
      }

      // Hermes Stage 1 — capture the accepted verify correction so generation
      // learns from it. Without this the loop never sees corrections made here.
      const verifyDiff = diffCorrection(
        { title: generatedListing.title, specifics: generatedListing.itemSpecifics || lastEbayRow?.item_specifics },
        { title: refined.title, specifics: refined.itemSpecifics },
      );
      if (verifyDiff) {
        captureCorrection({
          source: "ai_verify",
          category: lastEbayRow?.category ?? null,
          wrongTitle: generatedListing.title,
          correctedTitle: refined.title ? String(refined.title) : generatedListing.title,
          wrongSpecifics: generatedListing.itemSpecifics || lastEbayRow?.item_specifics || null,
          correctedSpecifics: refined.itemSpecifics || generatedListing.itemSpecifics || null,
          imageUrls: lastEbayRow?.image_urls || images.map(i => i.url).filter(Boolean),
          rowId: lastEbayRow?.id ?? null,
          injectedCorrectionIds: (lastEbayRow as any)?.injected_correction_ids ?? null,
          correctedField: verifyDiff.correctedField,
        });
      }

      toast({
        title: data.passed ? "✅ Verification Confirmed" : "🔄 Corrections Applied",
        description: data.report || (data.passed ? "AI confirmed the identification is correct" : "Listing updated with corrections"),
      });
    } catch (error) {
      toast({
        title: "Verification Failed",
        description: error instanceof Error ? error.message : "Could not verify",
        variant: "destructive"
      });
    } finally {
      setEbayVerifying(false);
    }
  };

  /** DOA AI Verify from the lot card. Fetches the audit; nothing changes until accepted. */
  const handleDenverVerify = async (lot: any) => {
    setDenverVerifyingId(lot.id);
    try {
      const result = await verifyDoaLot(
        {
          title: lot.title || '',
          description: lot.description || '',
          starting_bid: lot.starting_bid ?? 5,
          image_urls: lot.image_urls || [],
        },
        masterPrompt,
      );
      setDenverVerify({ lot, result });
    } catch (error) {
      toast({
        title: "Verification Failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setDenverVerifyingId(null);
    }
  };

  /** Persists accepted corrections to the lot and feeds the Hermes loop. */
  const handleDenverVerifyAccept = async () => {
    if (!denverVerify) return;
    const { lot, result } = denverVerify;
    const before = {
      title: lot.title || '',
      description: lot.description || '',
      starting_bid: lot.starting_bid ?? 5,
    };
    const changed = changedFields(before, result.corrected);
    setDenverVerify(null);

    if (changed.length === 0) {
      toast({ title: "No changes needed", description: "AI confirmed the lot looks correct." });
      return;
    }

    const updates: Record<string, any> = {};
    if (result.corrected.title !== undefined) updates.title = result.corrected.title;
    if (result.corrected.description !== undefined) updates.description = result.corrected.description;
    if (result.corrected.starting_bid !== undefined) updates.starting_bid = result.corrected.starting_bid;

    const { data, error } = await supabase
      .from('denver_batch_rows')
      .update(updates)
      .eq('id', lot.id)
      .select()
      .single();

    if (error) {
      toast({ title: "Could not save corrections", description: error.message, variant: "destructive" });
      return;
    }

    setDenverLots(prev => prev.map(r => r.id === lot.id ? { ...r, ...data } : r));

    const titleChanged = changed.includes("title");
    const otherChanged = changed.includes("description") || changed.includes("starting_bid");
    // Hermes Stage 1 — only accepted corrections teach the loop. Description/bid
    // changes ride in wrong/correctedSpecifics (DOA's equivalent of eBay's item
    // specifics slot) so they aren't silently dropped when title didn't change.
    captureCorrection({
      source: "ai_verify",
      platform: "denver",
      wrongTitle: before.title,
      correctedTitle: result.corrected.title ?? before.title,
      wrongSpecifics: otherChanged
        ? { description: before.description, starting_bid: String(before.starting_bid) }
        : undefined,
      correctedSpecifics: otherChanged
        ? {
            description: result.corrected.description ?? before.description,
            starting_bid: String(result.corrected.starting_bid ?? before.starting_bid),
          }
        : undefined,
      correctionNote: result.report || undefined,
      imageUrls: lot.image_urls || [],
      rowId: lot.id,
      correctedField: titleChanged && otherChanged ? "both" : titleChanged ? "title" : "specifics",
    });

    toast({ title: "Corrections saved", description: `Updated: ${changed.join(", ")}` });
  };

  // eBay: Refine listing with prompt
  const handleEbayRefine = async () => {
    if (!ebayRefinePrompt.trim() || !generatedListing) return;
    // Resolve the row by the id captured at insert — never by position.
    const lastEbayRow = ebayRows.find(r => r.id === activeEbayRowId) ?? null;

    setEbayRefining(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expired');

      const refineResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-listing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          currentListing: {
            title: generatedListing.title,
            description: generatedListing.description,
            price: generatedListing.price,
            categoryId: lastEbayRow?.category,
            condition: generatedListing.condition,
            itemSpecifics: generatedListing.itemSpecifics || lastEbayRow?.item_specifics,
          },
          correctionPrompt: ebayRefinePrompt,
          imageUrls: lastEbayRow?.image_urls || images.map(i => i.url).filter(Boolean),
          platform: 'ebay',
          mode: 'refine',
          masterPrompt: masterPrompt || undefined
        })
      });
      if (!refineResp.ok) {
        const errBody = await refineResp.json().catch(() => ({}));
        throw new Error(errBody.error || `Refine request failed (${refineResp.status})`);
      }
      const data = await refineResp.json();

      const refined = data.listing ?? {};
      const updates: any = {};
      if (refined.title) updates.title = String(refined.title).substring(0, 80);
      if (refined.description) updates.description = refined.description;
      if (refined.price != null) updates.price = refined.price;
      if (refined.categoryId) updates.category = String(refined.categoryId);
      if (refined.condition) updates.condition = refined.condition;
      if (refined.itemSpecifics) updates.item_specifics = refined.itemSpecifics;

      if (Object.keys(updates).length > 0) {
        setGeneratedListing(prev => prev ? {
          ...prev,
          title: updates.title || prev.title,
          description: updates.description || prev.description,
          price: updates.price ?? prev.price,
          condition: updates.condition || prev.condition,
          itemSpecifics: updates.item_specifics || prev.itemSpecifics,
        } : prev);
        // Keep the specifics editor in step — the settings sync writes
        // ebayItemSpecifics to the row and must not resurrect pre-refine values.
        if (updates.item_specifics) setEbayItemSpecifics(updates.item_specifics);

        // Sync to DB row if one exists
        if (lastEbayRow) {
          const { error: updateError } = await supabase
            .from('ebay_batch_rows')
            .update(updates)
            .eq('id', lastEbayRow.id);
          if (!updateError) {
            setEbayRows(prev => prev.map(r => r.id === lastEbayRow.id ? { ...r, ...updates } : r));
          }
        }
      }

      // Hermes Stage 1 — capture the human-driven correction. The typed prompt is
      // the strongest signal we get (it states the intent), so it is stored as the
      // correction note even when only one field ends up changing.
      const refineDiff = diffCorrection(
        { title: generatedListing.title, specifics: generatedListing.itemSpecifics || lastEbayRow?.item_specifics },
        { title: refined.title, specifics: refined.itemSpecifics },
      );
      if (refineDiff) {
        captureCorrection({
          source: "refine",
          category: lastEbayRow?.category ?? null,
          wrongTitle: generatedListing.title,
          correctedTitle: refined.title ? String(refined.title) : generatedListing.title,
          wrongSpecifics: generatedListing.itemSpecifics || lastEbayRow?.item_specifics || null,
          correctedSpecifics: refined.itemSpecifics || generatedListing.itemSpecifics || null,
          correctionNote: ebayRefinePrompt.trim(),
          imageUrls: lastEbayRow?.image_urls || images.map(i => i.url).filter(Boolean),
          rowId: lastEbayRow?.id ?? null,
          injectedCorrectionIds: (lastEbayRow as any)?.injected_correction_ids ?? null,
          correctedField: refineDiff.correctedField,
        });
      }

      setEbayRefinePrompt("");
      toast({ title: "Listing Refined", description: "Updated based on your feedback" });
    } catch (error) {
      toast({
        title: "Refinement Failed",
        description: error instanceof Error ? error.message : "Could not refine",
        variant: "destructive"
      });
    } finally {
      setEbayRefining(false);
    }
  };

  const validateLACSV = useCallback(() => {
    if (dbBatchRows.length === 0) {
      toast({ title: "No Data", description: "Batch is empty", variant: "destructive" });
      return;
    }

    const { issues } = normalizeAndValidateBatch(dbBatchRows);
    setCsvValidationIssues(issues);
    setCsvValidated(true);

    if (issues.length === 0) {
      toast({ 
        title: "Validation Passed", 
        description: `${dbBatchRows.length} lots ready for export` 
      });
    } else {
      toast({ 
        title: "Validation Issues Found", 
        description: `${issues.length} issue(s) need attention`,
        variant: "destructive"
      });
    }
  }, [dbBatchRows]);

  // Export LiveAuctioneers CSV with normalized data
  const exportLACSV = useCallback(() => {
    if (dbBatchRows.length === 0) {
      toast({ title: "No Data", description: "Batch is empty", variant: "destructive" });
      return;
    }

    const { normalizedRows, issues } = normalizeAndValidateBatch(dbBatchRows);
    
    // Block export if there are validation issues
    if (issues.length > 0) {
      setCsvValidationIssues(issues);
      setCsvValidated(true);
      toast({ 
        title: "Export Blocked", 
        description: `Fix ${issues.length} validation issue(s) before exporting`,
        variant: "destructive"
      });
      return;
    }

    // Generate and download CSV
    const csvContent = generateLiveAuctioneersCSV(normalizedRows);
    downloadCSV(csvContent, 'liveauctioneers_upload.csv');
    
    toast({ 
      title: "CSV Downloaded", 
      description: `${dbBatchRows.length} lots exported successfully` 
    });
  }, [dbBatchRows]);

  // Clear validation when batch changes
  useEffect(() => {
    setCsvValidated(false);
    setCsvValidationIssues([]);
  }, [dbBatchRows]);

  // Debounced eBay DB sync — keeps the ebay_batch_rows row in sync as user edits inline
  const ebayDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!generatedListing) return;
    // Only ever sync to the row created FOR this listing. ebayRows[length-1] here
    // raced the insert: the effect armed with item N+1's text while row N was
    // still last, and a >600ms insert let the timer clobber row N.
    if (!activeEbayRowId) return;
    if (ebayDebounceRef.current) clearTimeout(ebayDebounceRef.current);
    ebayDebounceRef.current = setTimeout(async () => {
      const updates = {
        title: generatedListing.title,
        description: generatedListing.description,
        price: generatedListing.price,
        custom_sku: customSku.trim() || null,
      };
      const { error } = await supabase.from('ebay_batch_rows').update(updates).eq('id', activeEbayRowId);
      // Keep local batch state in step with the DB — the batch panel and CSV
      // export read ebayRows, which otherwise holds the pre-edit values.
      if (!error) {
        setEbayRows(prev => prev.map(r => r.id === activeEbayRowId ? { ...r, ...updates } : r));
      }
    }, 600);
    return () => { if (ebayDebounceRef.current) clearTimeout(ebayDebounceRef.current); };
  }, [generatedListing, activeEbayRowId, customSku]);

  // Debounced sync of the post-generation eBay controls (item specifics,
  // shipping & returns, promotion) to the CURRENT row. Operator decision
  // 2026-07-12: these controls EDIT the on-screen listing — the state also
  // carries forward as the defaults for the next item, as before.
  const ebaySettingsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeEbayRowId) return;
    if (ebaySettingsDebounceRef.current) clearTimeout(ebaySettingsDebounceRef.current);
    ebaySettingsDebounceRef.current = setTimeout(async () => {
      const rate = parseFloat(promotionRate);
      const updates = {
        item_specifics: ebayItemSpecifics,
        shipping_type: ebayShippingSettings.shippingType,
        shipping_cost: ebayShippingSettings.shippingCost,
        handling_time: ebayShippingSettings.handlingTime,
        returns_accepted: ebayShippingSettings.returnsAccepted,
        return_period: ebayShippingSettings.returnPeriod,
        return_shipping: ebayShippingSettings.returnShipping,
        promotion_rate: Number.isFinite(rate) ? rate : null,
        promotion_type: promotionType,
      };
      const { error } = await supabase.from('ebay_batch_rows').update(updates).eq('id', activeEbayRowId);
      if (!error) {
        setEbayRows(prev => prev.map(r => r.id === activeEbayRowId ? { ...r, ...updates } : r));
      }
    }, 600);
    return () => { if (ebaySettingsDebounceRef.current) clearTimeout(ebaySettingsDebounceRef.current); };
  }, [ebayItemSpecifics, ebayShippingSettings, promotionRate, promotionType, activeEbayRowId]);

  const [downloadingImages, setDownloadingImages] = useState(false);
  const [zipProgress, setZipProgress] = useState({ current: 0, total: 0, failed: 0, phase: '' });
  const [downloadingDenverImages, setDownloadingDenverImages] = useState(false);
  const [denverZipProgress, setDenverZipProgress] = useState({ current: 0, total: 0, failed: 0, phase: '' });

  const downloadImagesZip = async () => {
    if (dbBatchRows.length === 0) {
      toast({ title: "No Data", description: "Batch is empty", variant: "destructive" });
      return;
    }

    if (!selectedProject?.id) {
      toast({ title: "No Project", description: "No batch selected", variant: "destructive" });
      return;
    }

    // Build flat list of all images across all lots
    const imageItems: { url: string; filename: string }[] = [];
    for (const row of dbBatchRows) {
      const urls = (row.image_urls || []) as string[];
      for (let i = 0; i < urls.length; i++) {
        const paddedIndex = (i + 1).toString().padStart(2, '0');
        imageItems.push({ url: urls[i], filename: `${row.lot_number}_${paddedIndex}.jpg` });
      }
    }

    if (imageItems.length === 0) {
      toast({ title: "No Images", description: "None of the lots in this batch have images saved.", variant: "destructive" });
      return;
    }

    setDownloadingImages(true);
    setZipProgress({ current: 0, total: imageItems.length, failed: 0, phase: 'Downloading images' });

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let completed = 0;
      let failed = 0;

      // Fetch images in parallel batches of 8
      const BATCH = 8;
      for (let i = 0; i < imageItems.length; i += BATCH) {
        const batch = imageItems.slice(i, i + BATCH);
        await Promise.all(batch.map(async ({ url, filename }) => {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            zip.file(filename, blob);
            completed++;
          } catch {
            failed++;
          }
          setZipProgress({ current: completed + failed, total: imageItems.length, failed, phase: 'Downloading images' });
        }));
      }

      setZipProgress({ current: imageItems.length, total: imageItems.length, failed, phase: 'Building ZIP' });
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const dateStr = new Date().toISOString().split('T')[0];
      saveAs(blob, `liveauctioneers-images-${dateStr}.zip`);

      if (failed > 0) {
        toast({
          title: "Images Downloaded (with failures)",
          description: `${completed} of ${imageItems.length} images included — ${failed} failed. Extract ZIP first, then upload to LiveAuctioneers`,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Images Downloaded!",
          description: `All ${completed} images included — extract the ZIP first, then upload to LiveAuctioneers`
        });
      }
    } catch (error) {
      console.error("Error creating ZIP:", error);
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Could not create image ZIP file",
        variant: "destructive"
      });
    } finally {
      setDownloadingImages(false);
      setZipProgress({ current: 0, total: 0, failed: 0, phase: '' });
    }
  };

  const downloadDenverImagesZip = async () => {
    if (denverLots.length === 0) {
      toast({ title: "No Data", description: "Batch is empty", variant: "destructive" });
      return;
    }
    if (!selectedProject?.id) {
      toast({ title: "No Project", description: "No batch selected", variant: "destructive" });
      return;
    }

    // Build flat list of all images across all lots
    const imageItems: { url: string; filename: string }[] = [];
    for (const lot of denverLots) {
      const urls = (lot.image_urls || []) as string[];
      for (let i = 0; i < urls.length; i++) {
        const paddedIndex = (i + 1).toString().padStart(2, '0');
        imageItems.push({ url: urls[i], filename: `${lot.lot_number}_${paddedIndex}.jpg` });
      }
    }

    if (imageItems.length === 0) {
      toast({ title: "No Images", description: "None of the lots in this batch have images saved.", variant: "destructive" });
      return;
    }

    setDownloadingDenverImages(true);
    setDenverZipProgress({ current: 0, total: imageItems.length, failed: 0, phase: 'Downloading images' });

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let completed = 0;
      let failed = 0;

      // Fetch images in parallel batches of 8
      const BATCH = 8;
      for (let i = 0; i < imageItems.length; i += BATCH) {
        const batch = imageItems.slice(i, i + BATCH);
        await Promise.all(batch.map(async ({ url, filename }) => {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            zip.file(filename, blob);
            completed++;
          } catch {
            failed++;
          }
          setDenverZipProgress({ current: completed + failed, total: imageItems.length, failed, phase: 'Downloading images' });
        }));
      }

      setDenverZipProgress({ current: imageItems.length, total: imageItems.length, failed, phase: 'Building ZIP' });
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const dateStr = new Date().toISOString().split('T')[0];
      saveAs(blob, `doa-images-${dateStr}.zip`);

      if (failed > 0) {
        toast({
          title: "Images Downloaded (with failures)",
          description: `${completed} of ${imageItems.length} images included — ${failed} failed to download`,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Images Downloaded!",
          description: `All ${completed} images included — drop the ZIP into the DOA Bulk Image Uploader folder`
        });
      }
    } catch (error) {
      console.error("Error creating Denver ZIP:", error);
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Could not create image ZIP file",
        variant: "destructive"
      });
    } finally {
      setDownloadingDenverImages(false);
      setDenverZipProgress({ current: 0, total: 0, failed: 0, phase: '' });
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
            images.length === 0 ? "p-6 md:p-12" : "p-3 md:p-4"
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
                Snap several photos in a row, or upload from your library
              </p>
              <div className="flex gap-3">
                <CameraCapture
                  variant="default"
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
                <div className="flex items-center gap-2">
                  <CameraCapture
                    size="sm"
                    onCapture={(files) => {
                      const newImages = files.map(file => ({
                        file,
                        preview: URL.createObjectURL(file)
                      }));
                      setImages(prev => [...prev, ...newImages]);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setImageEditorIndex(0); setImageEditorOpen(true); }}
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Prep Photos
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearAll}>
                    Clear All
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                {images.map((img, index) => (
                  <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
                    <img src={img.preview} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => { setImageEditorIndex(index); setImageEditorOpen(true); }}
                      className="absolute top-1 left-1 p-1 bg-primary/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Edit in Photo Studio"
                    >
                      <Pencil className="h-3 w-3 text-white" />
                    </button>
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

        {/* AI Guardrail — shared for Facebook, Mercari, Poshmark, Etsy */}
        {selectedProject && images.length > 0 && (
          ['facebook', 'mercari', 'poshmark', 'etsy'].includes(activePlatform || '') || !activePlatform
        ) && (
          <AIGuardrailPrompt
            projectId={selectedProject.id}
            masterPrompt={masterPrompt}
            onMasterPromptChange={(prompt) => {
              setMasterPrompt(prompt);
              setMasterPromptDraft(prompt);
              setSelectedProject(prev => prev ? { ...prev, master_prompt: prompt || null } : prev);
            }}
          />
        )}

        {/* Platform Buttons */}
        {!selectedProject && (
          <div className="rounded-xl border-2 border-dashed border-amber-500/50 bg-amber-500/10 p-6 text-center">
            <Cloud className="h-10 w-10 mx-auto mb-3 text-amber-500" />
            <h3 className="font-semibold text-lg mb-1">Select or Create a Project First</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Projects keep your listings organized and prevent mixing data between different sales
            </p>
            <ProjectManager
              selectedProjectId={null}
              onSelectProject={setSelectedProject}
            />
          </div>
        )}
        
        <div className={cn(
          "grid gap-3 grid-cols-2 lg:grid-cols-4",
          !selectedProject && "opacity-50 pointer-events-none"
        )}>
          {platforms.map((platform) => (
            <Button
              key={platform.id}
              onClick={() => handlePlatformClick(platform.id)}
              disabled={processing !== null || images.length === 0 || !selectedProject}
              variant="outline"
              className={cn(
                "h-auto py-4 md:py-6 flex flex-col gap-1 md:gap-2 relative overflow-hidden group",
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
                <platform.icon className="h-6 w-6 md:h-8 md:w-8" />
              )}
              <span className="font-semibold text-xs md:text-sm">{platform.name}</span>
              <span className="text-[10px] md:text-xs text-muted-foreground hidden sm:block">{platform.description}</span>
            </Button>
          ))}
        </div>

        {/* LiveAuctioneers Quick Capture Mode */}
        {laQuickCaptureOpen && (
          <LiveAuctioneersCaptureMode
            lotNumber={lotNumber}
            onLotComplete={handleLaQuickCaptureLot}
            onClose={() => setLaQuickCaptureOpen(false)}
            masterPrompt={masterPrompt}
          />
        )}

        {/* LiveAuctioneers Cloud Batch */}
        <div className={cn(
          "rounded-xl border p-4 space-y-4 transition-colors",
          dbBatchRows.length > 0 ? "border-primary/50 bg-primary/5" : "border-border bg-card"
        )}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ProjectManager
                selectedProjectId={selectedProject?.id || null}
                onSelectProject={setSelectedProject}
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">
                    {selectedProject ? selectedProject.name : 'No Project Selected'}
                  </span>
                  {savingLot && (
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving...
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground text-sm">
                  {!selectedProject ? 'Select or create a project to start' : 
                    loadingBatch ? 'Loading...' : (
                      dbBatchRows.length > 0 
                        ? `${dbBatchRows.length} LA lots • Next: #${lotNumber}`
                        : 'Ready • Lots auto-save instantly'
                    )
                  }
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button 
                variant="gold" 
                onClick={() => setLaQuickCaptureOpen(true)}
                disabled={!selectedProject}
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
                disabled={!selectedProject}
              />
            </div>
          </div>

          {/* Master Prompt / AI Guardrails */}
          {selectedProject && (
            <AIGuardrailPrompt
              projectId={selectedProject.id}
              masterPrompt={masterPrompt}
              onMasterPromptChange={(prompt) => {
                setMasterPrompt(prompt);
                setMasterPromptDraft(prompt);
                setSelectedProject(prev => prev ? { ...prev, master_prompt: prompt || null } : prev);
              }}
            />
          )}

          {/* Saved batch rows */}
          {dbBatchRows.length > 0 && (
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" />
                  {dbBatchRows.length} lots in cloud batch
                </span>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={validateLACSV} className="gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Validate CSV
                  </Button>
                  <Button 
                    variant="gold" 
                    onClick={exportLACSV} 
                    className="gap-2"
                    disabled={csvValidated && csvValidationIssues.length > 0}
                  >
                    <Download className="h-4 w-4" />
                    Export LiveAuctioneers CSV
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
                {downloadingImages && zipProgress.total > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{zipProgress.phase}: {zipProgress.current}/{zipProgress.total}</span>
                      {zipProgress.failed > 0 && (
                        <span className="text-destructive">{zipProgress.failed} failed</span>
                      )}
                      <span>{Math.round((zipProgress.current / zipProgress.total) * 100)}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${(zipProgress.current / zipProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Validation Issues Display */}
              {csvValidated && csvValidationIssues.length > 0 && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-destructive font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    {csvValidationIssues.length} Validation Issue{csvValidationIssues.length > 1 ? 's' : ''}
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1 text-xs font-mono">
                    {csvValidationIssues.map((issue, idx) => (
                      <div key={idx} className="text-destructive/90">
                        Row {issue.row} (LotNum {issue.lotNum}): {issue.column} - {issue.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Validation Success Display */}
              {csvValidated && csvValidationIssues.length === 0 && (
                <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-3">
                  <div className="flex items-center gap-2 text-green-600 font-medium">
                    <CheckCircle className="h-4 w-4" />
                    All {dbBatchRows.length} lots passed validation - ready for export
                  </div>
                </div>
              )}
              
              {/* Batch preview - click to edit */}
              <div className="max-h-60 overflow-y-auto space-y-1">
                {dbBatchRows.map((row) => (
                  <div 
                    key={row.id} 
                    onClick={() => setEditingLaLot(row)}
                    className="text-xs flex justify-between items-center py-2 px-3 bg-background/50 rounded cursor-pointer hover:bg-primary/10 hover:border-primary/30 border border-transparent transition-colors group"
                  >
                    <span className="font-mono font-semibold">#{row.lot_number}</span>
                    <span className="truncate flex-1 mx-3">{row.title}</span>
                    <span className="text-muted-foreground">${row.low_est}-${row.high_est}</span>
                    <Edit className="h-3 w-3 ml-2 opacity-0 group-hover:opacity-100 text-primary transition-opacity" />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">
                Click any lot to edit • All fields editable
              </p>
            </div>
          )}
        </div>

        {/* Denver Auctions Batch */}
        {(denverLots.length > 0 || selectedProject) && (
          <div className="rounded-xl border border-amber-500/50 bg-amber-500/5 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="font-semibold text-foreground">Denver Auctions</span>
                <span className="text-muted-foreground ml-2">
                  {denverLots.length} lots • Next: #{denverLotNumber}
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Input
                  type="number"
                  value={denverLotNumber}
                  onChange={(e) => setDenverLotNumber(parseInt(e.target.value) || 1)}
                  className="w-20"
                  disabled={!selectedProject}
                />
                {denverLots.length > 0 && (
                  <>
                    <Button
                      variant="gold"
                      size="sm"
                      className="gap-2"
                      onClick={() => {
                        if (denverLots.length === 0) {
                          toast({ title: "No Data", description: "No Denver lots to export", variant: "destructive" });
                          return;
                        }
                        // Generate Denver CSV matching denver_batch_rows import format
                        const headers = ["lot_number", "title", "description", "image_urls", "status"];
                        const csvRows = denverLots
                          .sort((a: any, b: any) => a.lot_number - b.lot_number)
                          .map((lot: any) => {
                            const escape = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
                            // Format images as a JSON array string, with escaped inner quotes for CSV
                            const urls = (lot.image_urls || []).filter(Boolean);
                            const jsonArray = `[${urls.map((u: string) => `""${u}""`).join(',')}]`;
                            const imagesCell = `"${jsonArray}"`;
                            return [
                              lot.lot_number,
                              escape(lot.title || ''),
                              escape(lot.description || ''),
                              imagesCell,
                              'pending',
                            ].join(',');
                          });
                        const csvContent = [headers.join(','), ...csvRows].join('\r\n');
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
                        saveAs(blob, `denver-auctions-${selectedProject?.name || 'batch'}.csv`);
                        toast({ title: "CSV Downloaded", description: `${denverLots.length} Denver lots exported` });
                      }}
                    >
                      <Download className="h-4 w-4" />
                      Export Denver CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={downloadDenverImagesZip}
                      disabled={downloadingDenverImages}
                    >
                      {downloadingDenverImages ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderArchive className="h-4 w-4" />
                      )}
                      Images ZIP
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (!selectedProject?.id) return;
                        if (!confirm('Clear all Denver lots?')) return;
                        await supabase.from('denver_batch_rows').delete().eq('batch_id', selectedProject.id);
                        setDenverLots([]);
                        setDenverLotNumber(1);
                      }}
                    >
                      Clear All
                    </Button>
                  </>
                )}
              </div>
              {downloadingDenverImages && denverZipProgress.total > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{denverZipProgress.phase}: {denverZipProgress.current}/{denverZipProgress.total}</span>
                    {denverZipProgress.failed > 0 && (
                      <span className="text-destructive">{denverZipProgress.failed} failed</span>
                    )}
                    <span>{Math.round((denverZipProgress.current / denverZipProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${(denverZipProgress.current / denverZipProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
            )}
            </div>
            {/* AI Guardrail for Denver */}
            {selectedProject && (
              <AIGuardrailPrompt
                projectId={selectedProject.id}
                masterPrompt={masterPrompt}
                onMasterPromptChange={(prompt) => {
                  setMasterPrompt(prompt);
                  setMasterPromptDraft(prompt);
                  setSelectedProject(prev => prev ? { ...prev, master_prompt: prompt || null } : prev);
                }}
              />
            )}

            {/* Lot List - inline editable like LA */}
            {denverLots.length > 0 && (
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">{denverLots.length} lots in batch</span>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {denverLots.map((lot: any) => (
                    <Button
                      key={lot.id}
                      variant={selectedDenverLot === lot.lot_number ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedDenverLot(lot.lot_number)}
                      className="gap-1.5"
                    >
                      Lot #{lot.lot_number}
                      {getDenverStatusBadge(lot.status)}
                    </Button>
                  ))}
                </div>

                {/* Selected Lot Details */}
                {selectedDenverLot && (
                  <div className="border border-border rounded-lg p-4 bg-card space-y-3">
                    {denverLots.filter(l => l.lot_number === selectedDenverLot).map((lot) => (
                      <div key={lot.id} className="space-y-3">
                          <div className="flex items-center justify-between">
                          <h3 className="font-semibold">Lot #{lot.lot_number}</h3>
                          <div className="flex items-center gap-2">
                            {getDenverStatusBadge(lot.status)}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs gap-1"
                              onClick={() => handleDenverVerify(lot)}
                              disabled={denverVerifyingId === lot.id}
                              title="Check the ID, damage disclosure, and opening bid"
                            >
                              {denverVerifyingId === lot.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <ShieldCheck className="h-3 w-3" />}
                              Verify
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs gap-1"
                              onClick={() => setEditingDenverLot(lot)}
                            >
                              <Edit className="h-3 w-3" />
                              Edit
                            </Button>
                            {lot.status === 'failed' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-xs gap-1"
                                onClick={() => requeueDenverLot(lot.id)}
                              >
                                <RefreshCw className="h-3 w-3" />
                                Re-queue
                              </Button>
                            )}
                          </div>
                        </div>

                        {lot.error_log && (
                          <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-600">
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span className="break-all">{lot.error_log}</span>
                          </div>
                        )}

                        <div className="grid gap-3">
                          <div className="flex items-center justify-between p-2 bg-secondary/30 rounded">
                            <div className="flex-1 min-w-0">
                              <Label className="text-xs text-muted-foreground">TITLE</Label>
                              <p className="font-medium truncate">{lot.title}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => handleCopy(lot.title, `denver-title-${lot.lot_number}`)}>
                              {copied === `denver-title-${lot.lot_number}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>

                          <div className="flex items-center justify-between p-2 bg-secondary/30 rounded">
                            <div className="flex-1 min-w-0">
                              <Label className="text-xs text-muted-foreground">STARTING BID</Label>
                              <p className="font-semibold text-primary">${lot.starting_bid || 5}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => handleCopy(String(lot.starting_bid || 5), `denver-bid-${lot.lot_number}`)}>
                              {copied === `denver-bid-${lot.lot_number}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>

                          <div className="flex items-start justify-between p-2 bg-secondary/30 rounded">
                            <div className="flex-1 min-w-0">
                              <Label className="text-xs text-muted-foreground">DESCRIPTION</Label>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap max-h-24 overflow-y-auto">{lot.description}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => handleCopy(lot.description || '', `denver-desc-${lot.lot_number}`)}>
                              {copied === `denver-desc-${lot.lot_number}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* AI Guardrail for eBay */}
        {selectedProject && (loadingEbay || ebayRows.length > 0 || activePlatform === 'ebay') && (
          <AIGuardrailPrompt
            projectId={selectedProject.id}
            masterPrompt={masterPrompt}
            onMasterPromptChange={(prompt) => {
              setMasterPrompt(prompt);
              setMasterPromptDraft(prompt);
              setSelectedProject(prev => prev ? { ...prev, master_prompt: prompt || null } : prev);
            }}
          />
        )}

        {/* eBay Batch Panel - keep visible for saved project rows, not only new generation in this session */}
        {selectedProject && (loadingEbay || ebayRows.length > 0 || activePlatform === 'ebay') && (
          <EbayBatchPanel
            projectId={selectedProject.id}
            rows={ebayRows}
            onRowsChange={setEbayRows}
            nextLotNumber={ebayLotNumber}
            onLotNumberChange={setEbayLotNumber}
            masterPrompt={masterPrompt}
          />
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
                  <Textarea
                    value={generatedListing.title}
                    onChange={e => setGeneratedListing(prev => prev ? { ...prev, title: e.target.value } : prev)}
                    className="font-medium resize-none"
                    rows={2}
                  />
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
                  <Textarea
                    value={generatedListing.description}
                    onChange={e => setGeneratedListing(prev => prev ? { ...prev, description: e.target.value } : prev)}
                    className="text-sm text-muted-foreground min-h-[8rem] resize-none"
                  />
                </div>

                {(generatedListing.price || generatedListing.lowEst) && (
                  <div className="flex gap-4 pt-2 border-t border-border">
                    {generatedListing.price && (
                      <div>
                        <Label className="text-xs text-muted-foreground">PRICE</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={generatedListing.price ?? ''}
                          onChange={e => setGeneratedListing(prev => prev ? { ...prev, price: parseFloat(e.target.value) || 0 } : prev)}
                          className="font-semibold text-primary w-28"
                        />
                        {generatedListing.priceComps?.source === "ebay_active" && generatedListing.priceComps.low != null && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Market range ${generatedListing.priceComps.low}–${generatedListing.priceComps.high}
                            {generatedListing.priceComps.sampleSize ? ` · ${generatedListing.priceComps.sampleSize} eBay listings` : ''}
                          </p>
                        )}
                        {generatedListing.priceComps?.source === "ai_estimate" && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            AI estimate — no live comps found
                          </p>
                        )}
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
                        <Input
                          value={generatedListing.condition ?? ''}
                          onChange={e => setGeneratedListing(prev => prev ? { ...prev, condition: e.target.value } : prev)}
                          className="text-sm"
                        />
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
                  <h3 className="font-semibold mb-2">Lot #{denverLotNumber - 1} Saved</h3>
                  <p className="text-sm text-muted-foreground">
                    Click the lot in the Denver Auctions batch list above to edit any field.
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
                <div className="space-y-4">
                  {/* AI Verify & Refine */}
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        AI Verification & Refinement
                      </h3>
                      <Button
                        variant="gold"
                        size="sm"
                        onClick={handleEbayVerify}
                        disabled={ebayVerifying || ebayRefining || !generatedListing}
                        className="gap-2"
                      >
                        {ebayVerifying ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                        {ebayVerifying ? 'Verifying...' : 'Verify with AI'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cross-check the identification with a second AI model, or tell the AI what to fix
                    </p>

                    {/* Verification result */}
                    {ebayVerifyResult && (
                      <div className={cn(
                        "rounded-lg border p-3 text-sm",
                        ebayVerifyResult.verified
                          ? "border-green-500/50 bg-green-500/10 text-green-700"
                          : "border-amber-500/50 bg-amber-500/10 text-amber-700"
                      )}>
                        <div className="flex items-center gap-2 font-medium mb-1">
                          {ebayVerifyResult.verified ? (
                            <><CheckCircle className="h-4 w-4" /> Verified ({ebayVerifyResult.confidence} confidence)</>
                          ) : (
                            <><RefreshCw className="h-4 w-4" /> Corrections Applied ({ebayVerifyResult.confidence} confidence)</>
                          )}
                        </div>
                        <p className="text-xs">{ebayVerifyResult.notes}</p>
                      </div>
                    )}

                    {/* Refinement prompt */}
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Tell the AI what to fix... e.g. 'That's a Lionel O-gauge locomotive, not HO scale' or 'Add more detail about the patina'"
                        value={ebayRefinePrompt}
                        onChange={(e) => setEbayRefinePrompt(e.target.value)}
                        className="min-h-[60px] text-sm"
                        rows={2}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleEbayRefine}
                        disabled={!ebayRefinePrompt.trim() || ebayRefining || ebayVerifying || ebayRows.length === 0}
                        className="shrink-0 self-end h-10 w-10"
                      >
                        {ebayRefining ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Item Specifics */}
                  <div className="rounded-xl border border-border bg-card p-6">
                    <EbayItemSpecificsEditor
                      itemSpecifics={ebayItemSpecifics}
                      onChange={setEbayItemSpecifics}
                    />
                    {/* Custom SKU — shown as the last item specific. Optional, never blocks a push. */}
                    <div className="mt-4 pt-4 border-t border-border">
                      <Label className="text-xs">Custom SKU (optional)</Label>
                      <Input
                        value={customSku}
                        onChange={(e) => setCustomSku(e.target.value)}
                        placeholder="Your internal SKU — leave blank to skip"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Maps to eBay's "Custom Label (SKU)". Optional.
                      </p>
                    </div>
                  </div>

                  {/* Shipping & Returns */}
                  <div className="rounded-xl border border-border bg-card p-6">
                    <EbayShippingSettings
                      settings={ebayShippingSettings}
                      onChange={setEbayShippingSettings}
                    />
                  </div>

                  {/* Promotion */}
                  <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="font-semibold mb-4">Promotion</h3>
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

        {generatedListing && (
          <CrossPostPanel
            listing={generatedListing}
            images={images.filter(i => i.url).map(i => i.url!)}
            projectId={selectedProject?.id}
            preselectedPlatform={crossPostPreselect ?? undefined}
          />
        )}
      </div>

      {/* LA Lot Editor Modal */}
      {editingLaLot && (
        <LALotEditor
          lot={editingLaLot}
          onClose={() => setEditingLaLot(null)}
          onUpdate={(updatedLot) => {
            setDbBatchRows(prev => prev.map(r => r.id === updatedLot.id ? updatedLot : r));
          }}
          onDelete={(lotId) => {
            setDbBatchRows(prev => prev.filter(r => r.id !== lotId));
          }}
          masterPrompt={masterPrompt}
        />
      )}

      {/* Denver Lot Editor Modal */}
      {editingDenverLot && (
        <DenverLotEditor
          lot={editingDenverLot}
          onClose={() => setEditingDenverLot(null)}
          onUpdate={(updatedLot) => {
            setDenverLots(prev => prev.map(r => r.id === updatedLot.id ? updatedLot : r));
          }}
          onDelete={(lotId) => {
            setDenverLots(prev => prev.filter(r => r.id !== lotId));
          }}
          masterPrompt={masterPrompt}
        />
      )}

      <DoaVerifyDialog
        result={denverVerify?.result ?? null}
        lotLabel={denverVerify ? `Lot #${denverVerify.lot.lot_number}` : ""}
        onAccept={handleDenverVerifyAccept}
        onReject={() => setDenverVerify(null)}
      />

      {imageEditorOpen && (
        <ImageEditor
          images={images.map(img => img.preview)}
          initialIndex={imageEditorIndex}
          onSave={handleImageEditorSave}
          onCancel={() => setImageEditorOpen(false)}
        />
      )}
    </MainLayout>
  );
}
