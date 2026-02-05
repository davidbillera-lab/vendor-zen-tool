 import { useState } from "react";
 import { GripVertical, X, Sparkles } from "lucide-react";
 import { Button } from "@/components/ui/button";
 import { cn } from "@/lib/utils";
 import { ImageEnhancer } from "./ImageEnhancer";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
 
 interface DraggableImageGridProps {
   images: string[];
   onReorder: (images: string[]) => void;
   onRemove?: (index: number) => void;
   onEnhance?: (index: number, newUrl: string) => void;
   showEnhance?: boolean;
   size?: 'sm' | 'md' | 'lg';
 }
 
 export function DraggableImageGrid({ 
   images, 
   onReorder, 
   onRemove,
   onEnhance,
   showEnhance = true,
   size = 'md'
 }: DraggableImageGridProps) {
   const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
   const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
 
   const sizeClasses = {
     sm: 'w-16 h-16',
     md: 'w-20 h-20',
     lg: 'w-24 h-24',
   };
 
   const handleDragStart = (index: number) => {
     setDraggedIndex(index);
    setIsDragging(true);
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
    setIsDragging(false);
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
 
   return (
     <div className="flex gap-2 overflow-x-auto pb-2">
       {images.map((url, i) => (
        <HoverCard key={`${url}-${i}`} openDelay={300} closeDelay={100}>
          <HoverCardTrigger asChild>
            <div
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragEnd={handleDragEnd}
              onDragLeave={handleDragLeave}
              className={cn(
                "relative flex-shrink-0 cursor-grab active:cursor-grabbing transition-all",
                draggedIndex === i && "opacity-50 scale-95",
                dragOverIndex === i && "ring-2 ring-primary ring-offset-2"
              )}
            >
              <img
                src={url}
                alt={`Image ${i + 1}`}
                className={cn(sizeClasses[size], "object-cover rounded-lg border border-border")}
                draggable={false}
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

              {/* Remove Button - Always visible on corner */}
              {onRemove && !isDragging && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(i);
                  }}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-destructive rounded-full flex items-center justify-center hover:bg-destructive/80 shadow-md"
                  title="Remove image"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              )}
             </div>
          </HoverCardTrigger>
          {showEnhance && !isDragging && (
            <HoverCardContent side="top" className="w-auto p-2">
               <ImageEnhancer
                 imageUrl={url}
                 onImageGenerated={(newUrl) => handleEnhanced(i, newUrl)}
                 trigger={
                  <Button size="sm" variant="outline" className="gap-1">
                    <Sparkles className="h-3 w-3" />
                    AI Enhance
                  </Button>
                 }
               />
            </HoverCardContent>
          )}
        </HoverCard>
       ))}
     </div>
   );
 }