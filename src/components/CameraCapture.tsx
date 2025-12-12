import { useRef, useState, useCallback, useEffect } from "react";
import { Camera, X, SwitchCamera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CameraCaptureProps {
  onCapture: (files: File[]) => void;
  disabled?: boolean;
}

export function CameraCapture({ onCapture, disabled }: CameraCaptureProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
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
    setCapturedImage(null);
    setIsOpen(false);
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

    const imageData = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(imageData);
  }, []);

  const confirmPhoto = useCallback(() => {
    if (!capturedImage) return;

    // Convert base64 to File
    fetch(capturedImage)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], `photo-${Date.now()}.jpg`, {
          type: "image/jpeg"
        });
        onCapture([file]);
        stopCamera();
      });
  }, [capturedImage, onCapture, stopCamera]);

  const retakePhoto = useCallback(() => {
    setCapturedImage(null);
  }, []);

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
    };
  }, [stream]);

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="lg"
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className="flex items-center gap-2 border-primary/30 hover:bg-primary/10"
      >
        <Camera className="h-5 w-5" />
        Take Photo
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
        <span className="text-white font-medium">1:1</span>
        {!capturedImage && (
          <Button
            variant="ghost"
            size="icon"
            onClick={switchCamera}
            className="text-white hover:bg-white/20"
          >
            <SwitchCamera className="h-6 w-6" />
          </Button>
        )}
        {capturedImage && <div className="w-10" />}
      </div>

      {/* Viewfinder */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        {capturedImage ? (
          <img 
            src={capturedImage} 
            alt="Captured" 
            className="w-full max-w-md aspect-square object-cover"
          />
        ) : (
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
        )}
      </div>

      {/* Controls */}
      <div className="p-6 bg-black/50 flex items-center justify-center gap-8">
        {capturedImage ? (
          <>
            <Button
              variant="outline"
              size="lg"
              onClick={retakePhoto}
              className="border-white/30 text-white hover:bg-white/20"
            >
              Retake
            </Button>
            <Button
              size="lg"
              onClick={confirmPhoto}
              className="bg-primary hover:bg-primary/90"
            >
              <Check className="h-5 w-5 mr-2" />
              Use Photo
            </Button>
          </>
        ) : (
          <button
            onClick={capturePhoto}
            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <div className="w-16 h-16 rounded-full bg-white" />
          </button>
        )}
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
