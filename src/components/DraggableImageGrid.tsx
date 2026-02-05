 import { useState } from "react";
 import { GripVertical, X, Sparkles } from "lucide-react";
 import { Button } from "@/components/ui/button";
 import { cn } from "@/lib/utils";
 import { ImageEnhancer } from "./ImageEnhancer";
 
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
             className={cn(sizeClasses[size], "object-cover rounded-lg border border-border")}
             draggable={false}
           />
           
           {/* Drag Handle */}
           <div className="absolute top-0 left-0 right-0 flex justify-center">
             <div className="bg-black/60 rounded-b px-1 py-0.5">
               <GripVertical className="h-3 w-3 text-white" />
             </div>
           </div>
           
           {/* Position Badge */}
           <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] bg-primary text-primary-foreground px-1.5 rounded">
             {i + 1}
           </span>
 
           {/* Action Buttons (visible on hover) */}
           <div className="absolute top-0 right-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
             {showEnhance && (
               <ImageEnhancer
                 imageUrl={url}
                 onImageGenerated={(newUrl) => handleEnhanced(i, newUrl)}
                 trigger={
                   <button
                     className="w-5 h-5 bg-primary rounded-bl flex items-center justify-center hover:bg-primary/80"
                     title="Enhance with AI"
                   >
                     <Sparkles className="h-3 w-3 text-primary-foreground" />
                   </button>
                 }
               />
             )}
             {onRemove && (
               <button
                 onClick={() => onRemove(i)}
                 className="w-5 h-5 bg-destructive rounded-bl flex items-center justify-center hover:bg-destructive/80"
                 title="Remove image"
               >
                 <X className="h-3 w-3 text-white" />
               </button>
             )}
           </div>
         </div>
       ))}
     </div>
   );
 }