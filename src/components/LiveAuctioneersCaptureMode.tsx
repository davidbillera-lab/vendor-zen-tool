import { useRef, useState, useCallback, useEffect } from "react";
import { Camera, X, SwitchCamera, Check, Plus, Loader2, Gavel, Send, MessageSquare, Sparkles, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { uploadImage, generateListing, type GeneratedListing } from "@/lib/api/listings";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DraggableImageGrid } from "./DraggableImageGrid";
import { ImageEnhancer } from "./ImageEnhancer";

interface LiveAuctioneersCaptureProps {
  lotNumber: number;
  onLotComplete: (lot: {
    listing: GeneratedListing;
    imageUrls: string[];
    lotNumber: number;
  }) => void;
  onClose: () => void;
  masterPrompt?: string | null;
}

type CaptureStep = 'capture' | 'review' | 'processing' | 'confirm';

export function LiveAuctioneersCaptureMode({ 
  lotNumber, 
  onLotComplete, 
  onClose 
}: LiveAuctioneersCaptureProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [capturedPhotos, setCapturedPhotos] = useState<{ blob: Blob; preview: string }[]>([]);
  const [step, setStep] = useState<CaptureStep>('capture');
  const [processingStatus, setProcessingStatus] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [generatedListing, setGeneratedListing] = useState<GeneratedListing | null>(null);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [correctionPrompt, setCorrectionPrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number[]>([]);
  const [isStartingProcess, setIsStartingProcess] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instructionsInputRef = useRef<HTMLInputElement>(null);
  const correctionInputRef = useRef<HTMLInputElement>(null);

  const startCamera = useCallback(async (facing: "user" | "environment") => {
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1080 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 1 }
        },
        audio: false
      });

      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      toast({
        title: "Camera Error",
        description: "Could not access camera. Please check permissions.",
        variant: "destructive"
      });
      onClose();
    }
  }, [stream, onClose]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  const switchCamera = useCallback(() => {
    const newFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    startCamera(newFacing);
  }, [facingMode, startCamera]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const offsetX = (video.videoWidth - size) / 2;
    const offsetY = (video.videoHeight - size) / 2;

    ctx.drawImage(video, offsetX, offsetY, size, size, 0, 0, size, size);

    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedPhotos(prev => [...prev, {
          blob,
          preview: URL.createObjectURL(blob)
        }]);
      }
    }, "image/jpeg", 0.9);
  }, []);

  const removePhoto = useCallback((index: number) => {
    setCapturedPhotos(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const goToReview = useCallback(() => {
    if (capturedPhotos.length === 0) {
      toast({
        title: "No Photos",
        description: "Take at least one photo first",
        variant: "destructive"
      });
      return;
    }
    stopCamera();
    setStep('review');
    // Focus the instructions input after transition
    setTimeout(() => instructionsInputRef.current?.focus(), 100);
  }, [capturedPhotos.length, stopCamera]);

  const processLot = useCallback(async () => {
    setIsStartingProcess(true);
    
    // Small delay to show button feedback before transitioning
    await new Promise(resolve => setTimeout(resolve, 200));
    
    setStep('processing');
    setIsStartingProcess(false);
    setUploadProgress(new Array(capturedPhotos.length).fill(0));

    try {
      // Step 1: Upload all photos with progress tracking
      setProcessingStatus(`Uploading photos...`);
      const urls: string[] = [];
      
      for (let index = 0; index < capturedPhotos.length; index++) {
        const photo = capturedPhotos[index];
        setProcessingStatus(`Uploading photo ${index + 1} of ${capturedPhotos.length}...`);
        
        const file = new File([photo.blob], `lot-${lotNumber}-${index + 1}.jpg`, {
          type: "image/jpeg"
        });
        
        const url = await uploadImage(file);
        urls.push(url);
        
        // Update progress for this photo
        setUploadProgress(prev => {
          const updated = [...prev];
          updated[index] = 100;
          return updated;
        });
      }
      
      setUploadedUrls(urls);

      // Step 2: Generate listing with AI (including special instructions)
      setProcessingStatus("AI analyzing item...");
      const listing = await generateListing('liveauctioneers', urls, specialInstructions || undefined);
      setGeneratedListing(listing);

      // Step 3: Go to confirm step
      setStep('confirm');

    } catch (error) {
      console.error("Processing error:", error);
      toast({
        title: "Processing Failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive"
      });
      setStep('review');
      setIsStartingProcess(false);
    }
  }, [capturedPhotos, lotNumber, specialInstructions]);

  const handleEditField = (field: string, currentValue: string | number | undefined) => {
    setEditField(field);
    setEditValue(String(currentValue || ''));
  };

  const saveEdit = () => {
    if (!editField || !generatedListing) return;
    
    const updated = { ...generatedListing };
    const numericFields = ['lowEst', 'highEst', 'startPrice', 'height', 'width', 'depth', 'weight'];
    
    if (numericFields.includes(editField)) {
      (updated as any)[editField] = parseFloat(editValue) || undefined;
    } else {
      (updated as any)[editField] = editValue;
    }
    
    setGeneratedListing(updated);
    setEditField(null);
    setEditValue("");
  };

  const refineListing = useCallback(async () => {
    if (!correctionPrompt.trim() || !generatedListing) return;
    
    setIsRefining(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-listing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          currentListing: generatedListing,
          correctionPrompt: correctionPrompt.trim(),
          imageUrls: uploadedUrls,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to refine listing');
      }

      const data = await response.json();
      setGeneratedListing(data.listing);
      setCorrectionPrompt("");
      toast({
        title: "Listing Updated",
        description: "AI has refined your listing based on your feedback",
      });
    } catch (error) {
      console.error("Refinement error:", error);
      toast({
        title: "Refinement Failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsRefining(false);
    }
  }, [correctionPrompt, generatedListing, uploadedUrls]);

  const finalizeLot = useCallback(() => {
    if (!generatedListing) return;

    onLotComplete({
      listing: generatedListing,
      imageUrls: uploadedUrls,
      lotNumber
    });

    toast({
      title: `Lot ${lotNumber} Added!`,
      description: generatedListing.title?.substring(0, 50) + "..."
    });
  }, [generatedListing, uploadedUrls, lotNumber, onLotComplete]);

  const handleCancel = useCallback(() => {
    capturedPhotos.forEach(p => URL.revokeObjectURL(p.preview));
    stopCamera();
    onClose();
  }, [capturedPhotos, stopCamera, onClose]);

  const backToCapture = useCallback(() => {
    setStep('capture');
    startCamera(facingMode);
  }, [startCamera, facingMode]);

  useEffect(() => {
    if (step === 'capture') {
      startCamera(facingMode);
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // STEP: Processing
  if (step === 'processing') {
    const uploadedCount = uploadProgress.filter(p => p === 100).length;
    const isUploading = processingStatus.includes('Uploading');
    
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center">
        <div className="text-center space-y-6 max-w-md px-4">
          <div className="relative">
            <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto" />
            <Gavel className="h-6 w-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">Processing Lot #{lotNumber}</h2>
            <p className="text-muted-foreground">{processingStatus}</p>
            {isUploading && (
              <p className="text-sm text-primary mt-1">
                {uploadedCount} of {capturedPhotos.length} uploaded
              </p>
            )}
          </div>
          
          {/* Photo upload progress */}
          <div className="flex gap-2 justify-center flex-wrap max-w-sm mx-auto">
            {capturedPhotos.map((photo, i) => (
              <div key={i} className="relative">
                <img 
                  src={photo.preview}
                  alt=""
                  className={cn(
                    "w-14 h-14 rounded-lg object-cover border-2 transition-all",
                    uploadProgress[i] === 100 
                      ? "border-green-500 opacity-100" 
                      : "border-border opacity-50"
                  )}
                />
                {uploadProgress[i] === 100 ? (
                  <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                    <Check className="h-3 w-3 text-white" />
                  </div>
                ) : isUploading && uploadProgress[i] === 0 && i === uploadedCount ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          
          {/* Progress bar */}
          {isUploading && (
            <div className="w-full max-w-xs mx-auto">
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(uploadedCount / capturedPhotos.length) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // STEP: Confirm/Edit
  if (step === 'confirm' && generatedListing) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => setStep('review')}>
            ← Back
          </Button>
          <div className="text-center">
            <span className="text-primary font-bold">Lot #{lotNumber}</span>
            <span className="text-muted-foreground text-sm ml-2">Review & Edit</span>
          </div>
          <Button variant="ghost" size="icon" onClick={handleCancel}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Photos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground uppercase">
                Images (drag to reorder, hover for AI)
              </span>
              <ImageEnhancer
                onImageGenerated={(url) => setUploadedUrls(prev => [...prev, url])}
                trigger={
                  <Button variant="outline" size="sm" className="gap-1 h-7">
                    <ImagePlus className="h-3 w-3" />
                    AI Generate
                  </Button>
                }
              />
            </div>
            <DraggableImageGrid
              images={uploadedUrls.length > 0 ? uploadedUrls : capturedPhotos.map(p => p.preview)}
              onReorder={(newUrls) => {
                if (uploadedUrls.length > 0) {
                  setUploadedUrls(newUrls);
                }
              }}
              onRemove={(index) => {
                if (uploadedUrls.length > 0) {
                  setUploadedUrls(prev => prev.filter((_, i) => i !== index));
                }
              }}
              showEnhance={uploadedUrls.length > 0}
              size="md"
            />
          </div>

          {/* Editable Fields */}
          <div className="space-y-3">
            <EditableField 
              label="Title" 
              value={generatedListing.title} 
              maxLength={100}
              isEditing={editField === 'title'}
              editValue={editValue}
              onEdit={() => handleEditField('title', generatedListing.title)}
              onSave={saveEdit}
              onCancel={() => setEditField(null)}
              onChange={setEditValue}
            />
            
            <EditableField 
              label="Description" 
              value={generatedListing.description} 
              multiline
              isEditing={editField === 'description'}
              editValue={editValue}
              onEdit={() => handleEditField('description', generatedListing.description)}
              onSave={saveEdit}
              onCancel={() => setEditField(null)}
              onChange={setEditValue}
            />

            <div className="grid grid-cols-3 gap-3">
              <EditableField 
                label="Low Est" 
                value={generatedListing.lowEst ? `$${generatedListing.lowEst}` : '-'} 
                isEditing={editField === 'lowEst'}
                editValue={editValue}
                onEdit={() => handleEditField('lowEst', generatedListing.lowEst)}
                onSave={saveEdit}
                onCancel={() => setEditField(null)}
                onChange={setEditValue}
                type="number"
              />
              <EditableField 
                label="High Est" 
                value={generatedListing.highEst ? `$${generatedListing.highEst}` : '-'} 
                isEditing={editField === 'highEst'}
                editValue={editValue}
                onEdit={() => handleEditField('highEst', generatedListing.highEst)}
                onSave={saveEdit}
                onCancel={() => setEditField(null)}
                onChange={setEditValue}
                type="number"
              />
              <EditableField 
                label="Start" 
                value={generatedListing.startPrice ? `$${generatedListing.startPrice}` : '-'} 
                isEditing={editField === 'startPrice'}
                editValue={editValue}
                onEdit={() => handleEditField('startPrice', generatedListing.startPrice)}
                onSave={saveEdit}
                onCancel={() => setEditField(null)}
                onChange={setEditValue}
                type="number"
              />
            </div>

            <EditableField 
              label="Condition" 
              value={generatedListing.condition || '-'} 
              isEditing={editField === 'condition'}
              editValue={editValue}
              onEdit={() => handleEditField('condition', generatedListing.condition)}
              onSave={saveEdit}
              onCancel={() => setEditField(null)}
              onChange={setEditValue}
            />

            <EditableField 
              label="Category" 
              value={generatedListing.category || '-'} 
              isEditing={editField === 'category'}
              editValue={editValue}
              onEdit={() => handleEditField('category', generatedListing.category)}
              onSave={saveEdit}
              onCancel={() => setEditField(null)}
              onChange={setEditValue}
            />

            {/* Dimensions */}
            <div className="grid grid-cols-4 gap-2">
              <EditableField 
                label="Height" 
                value={generatedListing.height || '-'} 
                isEditing={editField === 'height'}
                editValue={editValue}
                onEdit={() => handleEditField('height', generatedListing.height)}
                onSave={saveEdit}
                onCancel={() => setEditField(null)}
                onChange={setEditValue}
                type="number"
              />
              <EditableField 
                label="Width" 
                value={generatedListing.width || '-'} 
                isEditing={editField === 'width'}
                editValue={editValue}
                onEdit={() => handleEditField('width', generatedListing.width)}
                onSave={saveEdit}
                onCancel={() => setEditField(null)}
                onChange={setEditValue}
                type="number"
              />
              <EditableField 
                label="Depth" 
                value={generatedListing.depth || '-'} 
                isEditing={editField === 'depth'}
                editValue={editValue}
                onEdit={() => handleEditField('depth', generatedListing.depth)}
                onSave={saveEdit}
                onCancel={() => setEditField(null)}
                onChange={setEditValue}
                type="number"
              />
              <EditableField 
                label="Unit" 
                value={generatedListing.dimensionUnit || 'in'} 
                isEditing={editField === 'dimensionUnit'}
                editValue={editValue}
                onEdit={() => handleEditField('dimensionUnit', generatedListing.dimensionUnit)}
                onSave={saveEdit}
                onCancel={() => setEditField(null)}
                onChange={setEditValue}
              />
            </div>
          </div>
        </div>

        {/* AI Correction Chat Bar */}
        <div className="p-4 border-t border-border bg-secondary/30">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Ask AI to make changes</span>
          </div>
          <div className="flex gap-2">
            <Input
              ref={correctionInputRef}
              placeholder="e.g., 'Make the title shorter' or 'Add more detail about the condition'"
              value={correctionPrompt}
              onChange={(e) => setCorrectionPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isRefining && refineListing()}
              disabled={isRefining}
              className="flex-1"
            />
            <Button 
              onClick={refineListing}
              disabled={!correctionPrompt.trim() || isRefining}
              size="icon"
            >
              {isRefining ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Or tap any field above to edit directly
          </p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <Button 
            size="lg" 
            className="w-full bg-primary hover:bg-primary/90"
            onClick={finalizeLot}
            disabled={isRefining}
          >
            <Check className="h-5 w-5 mr-2" />
            Add Lot #{lotNumber} to CSV
          </Button>
        </div>
      </div>
    );
  }

  // STEP: Review (add instructions before processing)
  if (step === 'review') {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={backToCapture}>
            ← Back
          </Button>
          <div className="text-center">
            <span className="text-primary font-bold">Lot #{lotNumber}</span>
            <span className="text-muted-foreground text-sm ml-2">Add Details</span>
          </div>
          <Button variant="ghost" size="icon" onClick={handleCancel}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Photos */}
        <div className="p-4 border-b border-border">
          <div className="flex gap-2 overflow-x-auto">
            {capturedPhotos.map((photo, i) => (
              <div key={i} className="relative flex-shrink-0">
                <img 
                  src={photo.preview}
                  alt=""
                  className="w-20 h-20 rounded-lg object-cover border border-border"
                />
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] bg-primary text-primary-foreground px-1.5 rounded">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {capturedPhotos.length} photos for Lot #{lotNumber}
          </p>
        </div>

        {/* Instructions Chat Area */}
        <div className="flex-1 p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-5 w-5 text-primary" />
            <span className="font-medium">Special Instructions for AI</span>
          </div>
          
          <div className="flex-1 bg-secondary/30 rounded-lg p-4 mb-4">
            <p className="text-sm text-muted-foreground mb-3">
              Add any details the AI should know:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 mb-4">
              <li>• Dimensions: "12 inches tall, 8 inches wide"</li>
              <li>• Condition: "Small chip on base, crack on handle"</li>
              <li>• Brand/Maker: "Signed Tiffany & Co."</li>
              <li>• Period: "Art Deco, circa 1920s"</li>
              <li>• Material: "Sterling silver, 925"</li>
            </ul>
            
            {specialInstructions && (
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mt-3">
                <p className="text-sm font-medium text-primary">Your notes:</p>
                <p className="text-sm mt-1">{specialInstructions}</p>
              </div>
            )}
          </div>
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-border">
          <div className="flex gap-2 mb-3">
            <Input
              ref={instructionsInputRef}
              placeholder="Type dimensions, condition notes, or special details..."
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              className="flex-1"
              onKeyDown={(e) => e.key === 'Enter' && !isStartingProcess && processLot()}
              disabled={isStartingProcess}
            />
          </div>
          <Button 
            size="lg" 
            className="w-full bg-primary hover:bg-primary/90"
            onClick={processLot}
            disabled={isStartingProcess}
          >
            {isStartingProcess ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Gavel className="h-5 w-5 mr-2" />
                Process with AI
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {isStartingProcess 
              ? "Preparing to upload photos..." 
              : specialInstructions 
                ? "Instructions will be included" 
                : "Or skip and let AI analyze photos only"
            }
          </p>
        </div>
      </div>
    );
  }

  // STEP: Capture
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-black/50">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCancel}
          className="text-white hover:bg-white/20"
        >
          <X className="h-6 w-6" />
        </Button>
        <div className="text-center">
          <span className="text-primary font-bold">Lot #{lotNumber}</span>
          <span className="text-white/70 text-sm ml-2">LiveAuctioneers</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={switchCamera}
          className="text-white hover:bg-white/20"
        >
          <SwitchCamera className="h-6 w-6" />
        </Button>
      </div>

      {/* Photo count & thumbnails */}
      {capturedPhotos.length > 0 && (
        <div className="px-4 py-2 bg-black/30 flex items-center gap-2 overflow-x-auto">
          {capturedPhotos.map((photo, index) => (
            <div key={index} className="relative flex-shrink-0">
              <img 
                src={photo.preview} 
                alt="" 
                className="w-14 h-14 rounded-lg object-cover border-2 border-primary"
              />
              <button
                onClick={() => removePhoto(index)}
                className="absolute -top-1 -right-1 w-5 h-5 bg-destructive rounded-full flex items-center justify-center"
              >
                <X className="h-3 w-3 text-white" />
              </button>
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] bg-black/80 text-white px-1 rounded">
                {index + 1}
              </span>
            </div>
          ))}
          <div className="flex-shrink-0 text-white/50 text-sm px-2">
            {capturedPhotos.length} photos
          </div>
        </div>
      )}

      {/* Viewfinder */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <div className="relative w-full max-w-md aspect-square">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 border-2 border-primary/50 pointer-events-none" />
          {/* Grid lines */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
            <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
            <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="p-4 bg-black/50 space-y-4">
        <div className="flex items-center justify-center gap-6">
          {capturedPhotos.length > 0 && (
            <Button
              variant="outline"
              size="lg"
              onClick={capturePhoto}
              className="border-white/30 text-white hover:bg-white/20"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Photo
            </Button>
          )}
          
          {capturedPhotos.length === 0 ? (
            <button
              onClick={capturePhoto}
              className="w-20 h-20 rounded-full border-4 border-primary flex items-center justify-center hover:bg-primary/10 transition-colors"
            >
              <div className="w-16 h-16 rounded-full bg-primary" />
            </button>
          ) : (
            <Button
              size="lg"
              onClick={goToReview}
              className="bg-primary hover:bg-primary/90 px-8"
            >
              <Check className="h-5 w-5 mr-2" />
              Next: Add Details
            </Button>
          )}
        </div>

        <p className="text-center text-white/50 text-xs">
          {capturedPhotos.length === 0 
            ? "Take photos of the item" 
            : `${capturedPhotos.length} photo${capturedPhotos.length > 1 ? 's' : ''} • Tap "Next" to add details`
          }
        </p>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

// Editable field component
function EditableField({ 
  label, 
  value, 
  maxLength,
  multiline,
  type = 'text',
  isEditing,
  editValue,
  onEdit,
  onSave,
  onCancel,
  onChange
}: {
  label: string;
  value: string | number | undefined;
  maxLength?: number;
  multiline?: boolean;
  type?: 'text' | 'number';
  isEditing: boolean;
  editValue: string;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
}) {
  if (isEditing) {
    return (
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground uppercase">{label}</label>
        <div className="flex gap-2">
          {multiline ? (
            <textarea
              value={editValue}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 min-h-[80px] px-3 py-2 bg-secondary border border-border rounded-md text-sm"
              autoFocus
            />
          ) : (
            <Input
              type={type}
              value={editValue}
              onChange={(e) => onChange(e.target.value)}
              maxLength={maxLength}
              autoFocus
              className="flex-1"
            />
          )}
          <Button size="sm" onClick={onSave}>
            <Check className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {maxLength && (
          <p className="text-xs text-muted-foreground">{editValue.length}/{maxLength}</p>
        )}
      </div>
    );
  }

  return (
    <div 
      className="p-3 bg-secondary/30 rounded-lg cursor-pointer hover:bg-secondary/50 transition-colors"
      onClick={onEdit}
    >
      <label className="text-xs text-muted-foreground uppercase block mb-1">{label}</label>
      <p className={cn(
        "text-sm",
        multiline ? "whitespace-pre-wrap" : "truncate",
        !value || value === '-' ? "text-muted-foreground italic" : ""
      )}>
        {value || 'Tap to add'}
      </p>
    </div>
  );
}
