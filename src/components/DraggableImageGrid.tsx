import { useState } from "react";
import { GripVertical, X, RotateCw, Loader2, ZoomIn, Pencil } from "lucide-react";
import { PhotoStudio } from "./PhotoStudio";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ImageEnhancer } from "./ImageEnhancer";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DraggableImageGridProps {
  images: string[];
  onReorder: (images: string[]) => void;
  onRemove?: (index: number) => void;
  onEnhance?: (index: number, newUrl: string) => void;
  showEnhance?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onEditPhoto?: (index: number, newUrls: string[]) => void;
}
 
 export function DraggableImageGrid({
   images,
   onReorder,
   onRemove,
   onEnhance,
   showEnhance = true,
   size = 'md',
   onEditPhoto,
}: DraggableImageGridProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [rotatingIndex, setRotatingIndex] = useState<number | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [studioIndex, setStudioIndex] = useState<number | null>(null);

  const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-20 h-20',
    lg: 'w-24 h-24',
  };

  const rotateImage = async (imageUrl: string, degrees: number = 90): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Swap width and height for 90/270 degree rotations
        if (degrees === 90 || degrees === 270) {
          canvas.width = img.height;
          canvas.height = img.width;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageUrl;
    });
  };

  const handleRotate = async (index: number) => {
    setRotatingIndex(index);
    try {
      const rotatedUrl = await rotateImage(images[index]);
      const newImages = [...images];
      newImages[index] = rotatedUrl;
      onReorder(newImages);
      toast({ title: "Image rotated", description: "Rotated 90° clockwise" });
    } catch (error) {
      console.error('Rotation error:', error);
      toast({ 
        title: "Rotation failed", 
        description: "Could not rotate this image. It may be from another domain.",
        variant: "destructive" 
      });
    } finally {
      setRotatingIndex(null);
    }
  };
 
   const handleDragStart = (index: number) => {
     setDraggedIndex(index);
   };
 
   const handleDragOver = (e: React.DragEvent, index: number) => {
     e.preventDefault();
     if (draggedIndex !== null && draggedIndex !== index) {
       setDragOverIndex(index);
     }
   };
 
   const handleDragEnd = () => {
     if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
       const newImages = [...images];
       const [draggedItem] = newImages.splice(draggedIndex, 1);
       newImages.splice(dragOverIndex, 0, draggedItem);
       onReorder(newImages);
     }
     setDraggedIndex(null);
     setDragOverIndex(null);
   };
 
   const handleDragLeave = () => {
     setDragOverIndex(null);
   };
 
   const handleEnhanced = (index: number, newUrl: string) => {
     if (onEnhance) {
       onEnhance(index, newUrl);
     } else {
       // Replace the image in the array
       const newImages = [...images];
       newImages[index] = newUrl;
       onReorder(newImages);
     }
   };
 
  if (images.length === 0) {
    return null;
  }

  const selectedImage = selectedImageIndex !== null ? images[selectedImageIndex] : null;

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {images.map((url, i) => (
          <div
            key={`${url}-${i}`}
            draggable
            onDragStart={() => handleDragStart(i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
            className={cn(
              "relative flex-shrink-0 cursor-grab active:cursor-grabbing transition-all group",
              draggedIndex === i && "opacity-50 scale-95",
              dragOverIndex === i && "ring-2 ring-primary ring-offset-2"
            )}
          >
            <img
              src={url}
              alt={`Image ${i + 1}`}
              className={cn(sizeClasses[size], "object-cover rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity")}
              draggable={false}
              onClick={() => setSelectedImageIndex(i)}
            />
            
            {/* Drag Handle */}
            <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none">
              <div className="bg-black/60 rounded-b px-1 py-0.5">
                <GripVertical className="h-3 w-3 text-white" />
              </div>
            </div>
            
            {/* Position Badge */}
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] bg-primary text-primary-foreground px-1.5 rounded pointer-events-none">
              {i + 1}
            </span>

            {/* Expand indicator on hover */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <div className="bg-black/50 rounded-full p-1">
                <ZoomIn className="h-4 w-4 text-white" />
              </div>
            </div>

            {/* Quick action buttons (visible on hover) */}
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {onEditPhoto && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setStudioIndex(i);
                  }}
                  className="h-6 w-6 bg-primary rounded-full flex items-center justify-center hover:bg-primary/80 shadow-md"
                  title="Edit in Photo Studio"
                >
                  <Pencil className="h-3 w-3 text-white" />
                </button>
              )}
              {onRemove && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(i);
                  }}
                  className="h-6 w-6 bg-destructive rounded-full flex items-center justify-center hover:bg-destructive/80 shadow-md"
                  title="Remove image"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {studioIndex !== null && onEditPhoto && (
        <PhotoStudio
          images={images}
          initialIndex={studioIndex}
          onSave={(updated) => {
            onEditPhoto(studioIndex, updated);
            setStudioIndex(null);
          }}
          onCancel={() => setStudioIndex(null)}
        />
      )}

      {/* Lightbox Dialog for editing */}
      <Dialog open={selectedImageIndex !== null} onOpenChange={(open) => !open && setSelectedImageIndex(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Image {selectedImageIndex !== null ? selectedImageIndex + 1 : ''}</DialogTitle>
          </DialogHeader>
          {selectedImage && selectedImageIndex !== null && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <img
                  src={selectedImage}
                  alt={`Image ${selectedImageIndex + 1}`}
                  className="max-h-[60vh] max-w-full object-contain rounded-lg border border-border"
                />
              </div>
              <div className="flex justify-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleRotate(selectedImageIndex)}
                  disabled={rotatingIndex === selectedImageIndex}
                >
                  {rotatingIndex === selectedImageIndex ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCw className="h-4 w-4 mr-2" />
                  )}
                  Rotate 90°
                </Button>
                {showEnhance && (
                  <ImageEnhancer
                    imageUrl={selectedImage}
                    onImageGenerated={(newUrl) => {
                      handleEnhanced(selectedImageIndex, newUrl);
                    }}
                    trigger={
                      <Button variant="outline">
                        <span className="mr-2">✨</span>
                        AI Enhance
                      </Button>
                    }
                  />
                )}
                {onRemove && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      onRemove(selectedImageIndex);
                      setSelectedImageIndex(null);
                    }}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}