import { useState } from "react";
import { GripVertical, X, Pencil } from "lucide-react";
import { ImageEditor } from "./ImageEditor";
import { cn } from "@/lib/utils";

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
  showEnhance = true,
  size = 'md',
  onEditPhoto,
}: DraggableImageGridProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editorIndex, setEditorIndex] = useState<number | null>(null);

  const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-20 h-20',
    lg: 'w-24 h-24',
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

  const handleEditorSave = (updatedImages: string[]) => {
    if (onEditPhoto && editorIndex !== null) {
      onEditPhoto(editorIndex, updatedImages);
    } else {
      onReorder(updatedImages);
    }
    setEditorIndex(null);
  };

  if (images.length === 0) return null;

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
              onClick={() => showEnhance && setEditorIndex(i)}
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

            {/* Quick action buttons (visible on hover) */}
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {showEnhance && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditorIndex(i);
                  }}
                  className="h-6 w-6 bg-primary rounded-full flex items-center justify-center hover:bg-primary/80 shadow-md"
                  title="Edit image"
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

      {editorIndex !== null && (
        <ImageEditor
          images={images}
          initialIndex={editorIndex}
          onSave={handleEditorSave}
          onCancel={() => setEditorIndex(null)}
        />
      )}
    </>
  );
}
