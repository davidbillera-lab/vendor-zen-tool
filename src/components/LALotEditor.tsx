import { useState, useRef } from "react";
import { X, Check, Loader2, Sparkles, Send, Trash2, ImagePlus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DraggableImageGrid } from "./DraggableImageGrid";
import { ImageEnhancer } from "./ImageEnhancer";

interface LALotEditorProps {
  lot: {
    id: string;
    lot_number: number;
    title: string;
    description: string;
    low_est: number;
    high_est: number;
    start_price: number;
    condition: string;
    category: string;
    consignor: string;
    height: string;
    width: string;
    depth: string;
    dimension_unit: string;
    weight: string;
    weight_unit: string;
    image_urls: string[];
  };
  onClose: () => void;
  onUpdate: (updatedLot: any) => void;
  onDelete: (lotId: string) => void;
  masterPrompt?: string | null;
}

export function LALotEditor({ lot, onClose, onUpdate, onDelete, masterPrompt }: LALotEditorProps) {
  const [formData, setFormData] = useState({
    title: lot.title || '',
    description: lot.description || '',
    low_est: lot.low_est || 0,
    high_est: lot.high_est || 0,
    start_price: lot.start_price || 5,
    condition: lot.condition || '',
    category: lot.category || '',
    consignor: lot.consignor || 'JSG',
    height: lot.height || '',
    width: lot.width || '',
    depth: lot.depth || '',
    dimension_unit: lot.dimension_unit || 'in',
    weight: lot.weight || '',
    weight_unit: lot.weight_unit || 'lbs',
  });
  const [imageUrls, setImageUrls] = useState<string[]>(lot.image_urls || []);
  const [saving, setSaving] = useState(false);
  const [correctionPrompt, setCorrectionPrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const correctionInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('la_batch_rows')
        .update({
          title: formData.title.substring(0, 100),
          description: formData.description,
          low_est: formData.low_est,
          high_est: formData.high_est,
          start_price: formData.start_price,
          condition: formData.condition,
          category: formData.category,
          consignor: formData.consignor,
          height: formData.height,
          width: formData.width,
          depth: formData.depth,
          dimension_unit: formData.dimension_unit,
          weight: formData.weight,
          weight_unit: formData.weight_unit,
          image_urls: imageUrls,
        })
        .eq('id', lot.id)
        .select()
        .single();

      if (error) throw error;

      toast({ title: "Lot Updated", description: `Lot #${lot.lot_number} saved successfully` });
      onUpdate(data);
      onClose();
    } catch (error) {
      console.error('Error updating lot:', error);
      toast({ title: "Update Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete Lot #${lot.lot_number}? This cannot be undone.`)) return;
    
    try {
      const { error } = await supabase
        .from('la_batch_rows')
        .delete()
        .eq('id', lot.id);

      if (error) throw error;

      toast({ title: "Lot Deleted" });
      onDelete(lot.id);
      onClose();
    } catch (error) {
      console.error('Error deleting lot:', error);
      toast({ title: "Delete Failed", variant: "destructive" });
    }
  };

  const refineListing = async () => {
    if (!correctionPrompt.trim()) return;
    
    setIsRefining(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-listing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          currentListing: {
            title: formData.title,
            description: formData.description,
            lowEst: formData.low_est,
            highEst: formData.high_est,
            startPrice: formData.start_price,
            condition: formData.condition,
            category: formData.category,
          },
          correctionPrompt: correctionPrompt.trim(),
          imageUrls: lot.image_urls || [],
          masterPrompt: masterPrompt || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to refine listing');
      }

      const data = await response.json();
      const refined = data.listing;
      
      setFormData(prev => ({
        ...prev,
        title: refined.title || prev.title,
        description: refined.description || prev.description,
        low_est: refined.lowEst ?? prev.low_est,
        high_est: refined.highEst ?? prev.high_est,
        start_price: refined.startPrice ?? prev.start_price,
        condition: refined.condition || prev.condition,
        category: refined.category || prev.category,
      }));
      
      setCorrectionPrompt("");
      toast({ title: "Listing Updated", description: "AI has refined your listing" });
    } catch (error) {
      console.error("Refinement error:", error);
      toast({
        title: "Refinement Failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsRefining(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-lg">Edit Lot #{lot.lot_number}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Images - Draggable */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-muted-foreground uppercase">
                Images (drag to reorder, hover for AI enhance)
              </Label>
              <ImageEnhancer
                onImageGenerated={(url) => setImageUrls(prev => [...prev, url])}
                trigger={
                  <Button variant="outline" size="sm" className="gap-1 h-7">
                    <ImagePlus className="h-3 w-3" />
                    AI Generate
                  </Button>
                }
              />
            </div>
            {imageUrls.length > 0 ? (
              <DraggableImageGrid
                images={imageUrls}
                onReorder={setImageUrls}
                onRemove={(index) => {
                  setImageUrls(prev => prev.filter((_, i) => i !== index));
                }}
                showEnhance={true}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No images. Use AI Generate to create one.</p>
            )}
          </div>

          {/* Title */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase">Title (max 100 chars)</Label>
            <Input
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground mt-1">{formData.title.length}/100</p>
          </div>

          {/* Description */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase">Description</Label>
            <textarea
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              className="w-full min-h-[100px] px-3 py-2 bg-background border border-input rounded-md text-sm"
            />
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground uppercase">Low Est ($)</Label>
              <Input
                type="number"
                value={formData.low_est}
                onChange={(e) => handleChange('low_est', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground uppercase">High Est ($)</Label>
              <Input
                type="number"
                value={formData.high_est}
                onChange={(e) => handleChange('high_est', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground uppercase">Start Price ($)</Label>
              <Input
                type="number"
                value={formData.start_price}
                onChange={(e) => handleChange('start_price', parseFloat(e.target.value) || 5)}
              />
            </div>
          </div>

          {/* Condition */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase">Condition</Label>
            <textarea
              value={formData.condition}
              onChange={(e) => handleChange('condition', e.target.value)}
              className="w-full min-h-[60px] px-3 py-2 bg-background border border-input rounded-md text-sm"
            />
          </div>

          {/* Category */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase">Category</Label>
            <Input
              value={formData.category}
              onChange={(e) => handleChange('category', e.target.value)}
            />
          </div>

          {/* Dimensions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground uppercase">Height</Label>
              <Input
                value={formData.height}
                onChange={(e) => handleChange('height', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground uppercase">Width</Label>
              <Input
                value={formData.width}
                onChange={(e) => handleChange('width', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground uppercase">Depth</Label>
              <Input
                value={formData.depth}
                onChange={(e) => handleChange('depth', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground uppercase">Unit</Label>
              <Input
                value={formData.dimension_unit}
                onChange={(e) => handleChange('dimension_unit', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* AI Chat Bar */}
        <div className="p-4 border-t border-border bg-secondary/30">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Ask AI to make changes</span>
          </div>
          <div className="flex gap-2">
            <Input
              ref={correctionInputRef}
              placeholder="e.g., 'Lower the estimates' or 'Make title shorter'"
              value={correctionPrompt}
              onChange={(e) => setCorrectionPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isRefining && refineListing()}
              disabled={isRefining}
            />
            <Button
              onClick={refineListing}
              disabled={!correctionPrompt.trim() || isRefining}
              size="icon"
            >
              {isRefining ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 md:p-4 border-t border-border flex flex-col sm:flex-row sm:justify-between gap-2">
          <Button variant="destructive" size="sm" onClick={handleDelete} className="w-full sm:w-auto">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Lot
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="flex-1 sm:flex-none">Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1 sm:flex-none">
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
