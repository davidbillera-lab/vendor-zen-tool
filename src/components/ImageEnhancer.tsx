 import { useState } from "react";
 import { 
   Sparkles, 
   Wand2, 
   Loader2, 
   X, 
   Download,
   RefreshCw,
   ImagePlus
 } from "lucide-react";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { Label } from "@/components/ui/label";
 import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
 } from "@/components/ui/dialog";
 import { supabase } from "@/integrations/supabase/client";
 import { toast } from "@/hooks/use-toast";
 import { cn } from "@/lib/utils";
 
 interface ImageEnhancerProps {
   imageUrl?: string;
   onImageGenerated: (url: string) => void;
   trigger?: React.ReactNode;
 }
 
 export function ImageEnhancer({ imageUrl, onImageGenerated, trigger }: ImageEnhancerProps) {
   const [isOpen, setIsOpen] = useState(false);
   const [isProcessing, setIsProcessing] = useState(false);
   const [prompt, setPrompt] = useState("");
   const [generatedImage, setGeneratedImage] = useState<string | null>(null);
   const [mode, setMode] = useState<'enhance' | 'generate' | 'edit'>(imageUrl ? 'enhance' : 'generate');
 
   const handleProcess = async () => {
     if (mode !== 'generate' && !imageUrl) {
       toast({ title: "No image selected", variant: "destructive" });
       return;
     }
     
     if (mode === 'generate' && !prompt.trim()) {
       toast({ title: "Please enter a description", variant: "destructive" });
       return;
     }
 
     setIsProcessing(true);
     setGeneratedImage(null);
 
     try {
       const { data: { session } } = await supabase.auth.getSession();
       if (!session) throw new Error("Not authenticated");
 
       const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enhance-image`, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'Authorization': `Bearer ${session.access_token}`,
         },
         body: JSON.stringify({
           imageUrl: imageUrl || '',
           prompt: prompt.trim(),
           mode,
         }),
       });
 
       if (!response.ok) {
         const error = await response.json();
         throw new Error(error.error || 'Failed to process image');
       }
 
       const data = await response.json();
       setGeneratedImage(data.imageUrl);
       
       toast({ 
         title: mode === 'generate' ? "Image Generated" : "Image Enhanced", 
         description: data.message || "Your image is ready" 
       });
     } catch (error) {
       console.error("Image processing error:", error);
       toast({
         title: "Processing Failed",
         description: error instanceof Error ? error.message : "Something went wrong",
         variant: "destructive",
       });
     } finally {
       setIsProcessing(false);
     }
   };
 
   const handleUseImage = () => {
     if (generatedImage) {
       onImageGenerated(generatedImage);
       setIsOpen(false);
       setGeneratedImage(null);
       setPrompt("");
     }
   };
 
   const handleClose = () => {
     setIsOpen(false);
     setGeneratedImage(null);
     setPrompt("");
   };
 
   return (
     <>
       {trigger ? (
         <div onClick={() => setIsOpen(true)}>{trigger}</div>
       ) : (
         <Button
           variant="outline"
           size="sm"
           onClick={() => setIsOpen(true)}
           className="gap-2"
         >
           <Sparkles className="h-4 w-4" />
           AI Image
         </Button>
       )}
 
       <Dialog open={isOpen} onOpenChange={handleClose}>
         <DialogContent className="max-w-2xl">
           <DialogHeader>
             <DialogTitle className="flex items-center gap-2">
               <Sparkles className="h-5 w-5 text-primary" />
               AI Image Studio
             </DialogTitle>
           </DialogHeader>
 
           <div className="space-y-4">
             {/* Mode Selection */}
             <div className="flex gap-2">
               {imageUrl && (
                 <>
                   <Button
                     variant={mode === 'enhance' ? 'default' : 'outline'}
                     size="sm"
                     onClick={() => setMode('enhance')}
                   >
                     <Wand2 className="h-4 w-4 mr-1" />
                     Enhance
                   </Button>
                   <Button
                     variant={mode === 'edit' ? 'default' : 'outline'}
                     size="sm"
                     onClick={() => setMode('edit')}
                   >
                     <RefreshCw className="h-4 w-4 mr-1" />
                     Edit
                   </Button>
                 </>
               )}
               <Button
                 variant={mode === 'generate' ? 'default' : 'outline'}
                 size="sm"
                 onClick={() => setMode('generate')}
               >
                 <ImagePlus className="h-4 w-4 mr-1" />
                 Generate New
               </Button>
             </div>
 
             {/* Original Image Preview */}
             {mode !== 'generate' && imageUrl && (
               <div>
                 <Label className="text-xs text-muted-foreground uppercase mb-2 block">Original Image</Label>
                 <img 
                   src={imageUrl} 
                   alt="Original" 
                   className="w-32 h-32 object-cover rounded-lg border border-border"
                 />
               </div>
             )}
 
             {/* Prompt Input */}
             <div>
               <Label className="text-xs text-muted-foreground uppercase mb-2 block">
                 {mode === 'generate' 
                   ? 'Describe the image you want' 
                   : mode === 'enhance' 
                     ? 'Enhancement instructions (optional)' 
                     : 'What changes do you want?'}
               </Label>
               <Input
                 value={prompt}
                 onChange={(e) => setPrompt(e.target.value)}
                 placeholder={
                   mode === 'generate' 
                     ? 'e.g., A professional product photo of a vintage leather jacket on a white background'
                     : mode === 'enhance'
                       ? 'e.g., Make the colors more vibrant'
                       : 'e.g., Remove the background and add a studio lighting effect'
                 }
                 onKeyDown={(e) => e.key === 'Enter' && !isProcessing && handleProcess()}
               />
             </div>
 
             {/* Generated Image Result */}
             {generatedImage && (
               <div>
                 <Label className="text-xs text-muted-foreground uppercase mb-2 block">Generated Result</Label>
                 <div className="relative inline-block">
                   <img 
                     src={generatedImage} 
                     alt="Generated" 
                     className="max-w-full max-h-64 object-contain rounded-lg border border-primary"
                   />
                 </div>
               </div>
             )}
 
             {/* Actions */}
             <div className="flex justify-between gap-2 pt-4 border-t border-border">
               <Button variant="outline" onClick={handleClose}>
                 Cancel
               </Button>
               <div className="flex gap-2">
                 <Button
                   onClick={handleProcess}
                   disabled={isProcessing || (mode === 'generate' && !prompt.trim())}
                 >
                   {isProcessing ? (
                     <>
                       <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                       Processing...
                     </>
                   ) : (
                     <>
                       <Sparkles className="h-4 w-4 mr-2" />
                       {mode === 'generate' ? 'Generate' : mode === 'enhance' ? 'Enhance' : 'Apply Edit'}
                     </>
                   )}
                 </Button>
                 {generatedImage && (
                   <Button variant="gold" onClick={handleUseImage}>
                     Use This Image
                   </Button>
                 )}
               </div>
             </div>
           </div>
         </DialogContent>
       </Dialog>
     </>
   );
 }