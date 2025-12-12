import { useRef } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CameraCaptureProps {
  onCapture: (files: File[]) => void;
  disabled?: boolean;
}

// Crop image to 1:1 square ratio (center crop)
const cropToSquare = (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const offsetX = (img.width - size) / 2;
      const offsetY = (img.height - size) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, offsetX, offsetY, size, size, 0, 0, size, size);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            const croppedFile = new File([blob], file.name, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(croppedFile);
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        0.9
      );
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
};

export function CameraCapture({ onCapture, disabled }: CameraCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Crop all images to 1:1 ratio
      const croppedFiles = await Promise.all(
        Array.from(files).map((file) => cropToSquare(file))
      );
      onCapture(croppedFiles);
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
