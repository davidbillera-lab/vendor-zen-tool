import { useRef } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CameraCaptureProps {
  onCapture: (files: File[]) => void;
  disabled?: boolean;
}

export function CameraCapture({ onCapture, disabled }: CameraCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onCapture(Array.from(files));
    }
    // Reset input so same file can be selected again
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleCapture}
        className="hidden"
        id="camera-input"
        disabled={disabled}
      />
      <Button
        variant="outline"
        size="lg"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="flex items-center gap-2 border-primary/30 hover:bg-primary/10"
      >
        <Camera className="h-5 w-5" />
        Take Photo
      </Button>
    </>
  );
}
