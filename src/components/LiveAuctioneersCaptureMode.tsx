import { useRef, useState, useCallback, useEffect } from "react";
import { Camera, X, SwitchCamera, Check, Plus, Loader2, Gavel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadImage, generateListing, type GeneratedListing } from "@/lib/api/listings";
import { toast } from "@/hooks/use-toast";

interface LiveAuctioneersCaptureProps {
  lotNumber: number;
  onLotComplete: (lot: {
    listing: GeneratedListing;
    imageUrls: string[];
    lotNumber: number;
  }) => void;
  onClose: () => void;
}

export function LiveAuctioneersCaptureMode({ 
  lotNumber, 
  onLotComplete, 
  onClose 
}: LiveAuctioneersCaptureProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [capturedPhotos, setCapturedPhotos] = useState<{ blob: Blob; preview: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  const processAndSubmit = useCallback(async () => {
    if (capturedPhotos.length === 0) {
      toast({
        title: "No Photos",
        description: "Take at least one photo first",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    stopCamera();

    try {
      // Step 1: Upload all photos
      setProcessingStatus(`Uploading ${capturedPhotos.length} photo(s)...`);
      const uploadedUrls = await Promise.all(
        capturedPhotos.map(async (photo, index) => {
          const file = new File([photo.blob], `lot-${lotNumber}-${index + 1}.jpg`, {
            type: "image/jpeg"
          });
          return uploadImage(file);
        })
      );

      // Step 2: Generate listing with AI
      setProcessingStatus("AI analyzing item...");
      const listing = await generateListing('liveauctioneers', uploadedUrls);

      // Step 3: Complete!
      setProcessingStatus("Done!");
      
      onLotComplete({
        listing,
        imageUrls: uploadedUrls,
        lotNumber
      });

      toast({
        title: `Lot ${lotNumber} Added!`,
        description: listing.title?.substring(0, 50) + "..."
      });

    } catch (error) {
      console.error("Processing error:", error);
      toast({
        title: "Processing Failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive"
      });
      setIsProcessing(false);
      setProcessingStatus("");
      // Restart camera so they can try again
      startCamera(facingMode);
    }
  }, [capturedPhotos, lotNumber, stopCamera, onLotComplete, startCamera, facingMode]);

  const handleCancel = useCallback(() => {
    capturedPhotos.forEach(p => URL.revokeObjectURL(p.preview));
    stopCamera();
    onClose();
  }, [capturedPhotos, stopCamera, onClose]);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Processing screen
  if (isProcessing) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center">
        <div className="text-center space-y-6">
          <div className="relative">
            <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto" />
            <Gavel className="h-6 w-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">Processing Lot #{lotNumber}</h2>
            <p className="text-muted-foreground">{processingStatus}</p>
          </div>
          <div className="flex gap-2 justify-center">
            {capturedPhotos.map((photo, i) => (
              <img 
                key={i}
                src={photo.preview}
                alt=""
                className="w-16 h-16 rounded-lg object-cover border border-border"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

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
            {capturedPhotos.length}/4
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
        {/* Capture button row */}
        <div className="flex items-center justify-center gap-6">
          {capturedPhotos.length > 0 && capturedPhotos.length < 4 && (
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
              onClick={processAndSubmit}
              className="bg-primary hover:bg-primary/90 px-8"
            >
              <Check className="h-5 w-5 mr-2" />
              Process Lot #{lotNumber}
            </Button>
          )}
        </div>

        <p className="text-center text-white/50 text-xs">
          {capturedPhotos.length === 0 
            ? "Take photos of the item (up to 4)" 
            : `${capturedPhotos.length} photo${capturedPhotos.length > 1 ? 's' : ''} ready • Tap "Process" when done`
          }
        </p>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
