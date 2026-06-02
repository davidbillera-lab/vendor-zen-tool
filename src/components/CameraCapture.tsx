import { useRef, useState, useCallback, useEffect } from "react";
import { Camera, X, SwitchCamera, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CapturedPhoto {
  blob: Blob;
  preview: string;
}

interface CameraCaptureProps {
  onCapture: (files: File[]) => void;
  disabled?: boolean;
  /** Visual size of the trigger button. Defaults to "lg" (the empty-state look). */
  size?: "sm" | "lg";
  /** Trigger button label. Defaults to "Take Photos". */
  label?: string;
  /** Trigger button variant. Defaults to "outline". */
  variant?: "outline" | "default";
}

export function CameraCapture({
  onCapture,
  disabled,
  size = "lg",
  label = "Take Photos",
  variant = "outline",
}: CameraCaptureProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = useCallback(async (facing: "user" | "environment") => {
    try {
      // Stop existing stream
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
      // Fallback to file input if camera fails
      setIsOpen(false);
    }
  }, [stream]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    // Clean up preview URLs
    capturedPhotos.forEach(photo => URL.revokeObjectURL(photo.preview));
    setCapturedPhotos([]);
    setIsOpen(false);
  }, [stream, capturedPhotos]);

  const switchCamera = useCallback(() => {
    const newFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    startCamera(newFacing);
  }, [facingMode, startCamera]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Get the smallest dimension to create a square
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Calculate center crop offsets
    const offsetX = (video.videoWidth - size) / 2;
    const offsetY = (video.videoHeight - size) / 2;

    // Draw the square portion from center of video
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

  const confirmPhotos = useCallback(() => {
    if (capturedPhotos.length === 0) return;

    // Convert blobs to Files
    const files = capturedPhotos.map((photo, index) => 
      new File([photo.blob], `photo-${Date.now()}-${index}.jpg`, {
        type: "image/jpeg"
      })
    );
    
    onCapture(files);
    
    // Clean up
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    capturedPhotos.forEach(photo => URL.revokeObjectURL(photo.preview));
    setCapturedPhotos([]);
    setIsOpen(false);
  }, [capturedPhotos, onCapture, stream]);

  useEffect(() => {
    if (isOpen && !stream) {
      startCamera(facingMode);
    }
  }, [isOpen, stream, facingMode, startCamera]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      capturedPhotos.forEach(photo => URL.revokeObjectURL(photo.preview));
    };
  }, [stream, capturedPhotos]);

  if (!isOpen) {
    return (
      <Button
        variant={variant}
        size={size}
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2",
          variant === "outline" && "border-primary/30 hover:bg-primary/10"
        )}
      >
        <Camera className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
        {label}
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-black/50">
        <Button
          variant="ghost"
          size="icon"
          onClick={stopCamera}
          className="text-white hover:bg-white/20"
        >
          <X className="h-6 w-6" />
        </Button>
        <span className="text-white font-medium">
          {capturedPhotos.length > 0 ? `${capturedPhotos.length} photo${capturedPhotos.length > 1 ? 's' : ''}` : '1:1'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={switchCamera}
          className="text-white hover:bg-white/20"
        >
          <SwitchCamera className="h-6 w-6" />
        </Button>
      </div>

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
          {/* Square frame overlay */}
          <div className="absolute inset-0 border-2 border-white/50 pointer-events-none" />
          {/* Grid lines */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
            <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
            <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
          </div>
        </div>
      </div>

      {/* Photo thumbnails */}
      {capturedPhotos.length > 0 && (
        <div className="px-4 py-2 bg-black/70">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {capturedPhotos.map((photo, index) => (
              <div key={index} className="relative flex-shrink-0">
                <img 
                  src={photo.preview} 
                  alt={`Photo ${index + 1}`}
                  className="w-16 h-16 object-cover rounded-md border border-white/30"
                />
                <button
                  onClick={() => removePhoto(index)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="p-6 bg-black/50">
        {/* Hint — makes it obvious the shutter is tapped repeatedly */}
        <p className="text-center text-white/70 text-xs mb-3">
          {capturedPhotos.length > 0
            ? "Tap to keep adding — hit Done when you're finished"
            : "Tap the shutter. You can take several in a row."}
        </p>
        <div className="relative flex items-center justify-center">
          {/* Shutter — the primary, repeated action */}
          <button
            onClick={capturePhoto}
            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <div className="w-16 h-16 rounded-full bg-white" />
          </button>

          {/* Done — only the exit, parked in the corner so it doesn't read as "Use Photo" */}
          {capturedPhotos.length > 0 && (
            <Button
              size="sm"
              onClick={confirmPhotos}
              className="absolute right-0 bg-primary hover:bg-primary/90"
            >
              <Check className="h-4 w-4 mr-1" />
              Done · {capturedPhotos.length}
            </Button>
          )}
        </div>
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
