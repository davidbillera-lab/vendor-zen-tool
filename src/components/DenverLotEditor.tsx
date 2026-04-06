import { useState, useRef } from "react";
import { X, Check, Loader2, Sparkles, Send, Trash2, ImagePlus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { DraggableImageGrid } from "./DraggableImageGrid";
import { ImageEnhancer } from "./ImageEnhancer";
import { cn } from "@/lib/utils";

interface DenverLotEditorProps {
  lot: {
    id: string;
    lot_number: number;
    title: string;
    description: string;
    starting_bid: number;
    image_urls: string[];
  };
  onClose: () => void;
  onUpdate: (updatedLot: any) => void;
  onDelete: (lotId: string) => void;
  masterPrompt?: string | null;
}

export function DenverLotEditor({ lot, onClose, onUpdate, onDelete, masterPrompt }: DenverLotEditorProps) {
  const [formData, setFormData] = useState({
    title: lot.title || '',
    description: lot.description || '',
    starting_bid: lot.starting_bid ?? 5,
  });
  const [imageUrls, setImageUrls] = useState<string[]>(lot.image_urls || []);
  const [saving, setSaving] = useState(false);
  const [correctionPrompt, setCorrectionPrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; confidence: string; notes: string } | null>(null);
  const correctionInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('denver_batch_rows')
        .update({
          title: formData.title.substring(0, 100),
          description: formData.description,
          starting_bid: formData.starting_bid,
          image_urls: imageUrls,
        })
        .eq('id', lot.id)
        .select()
        .single();

      if (error) throw error;

      toast({ title: "Lot Updated", description: `Lot #${lot.lot_number} saved` });
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
        .from('denver_batch_rows')
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
            startingBid: formData.starting_bid,
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
        title: (refined.title || prev.title).substring(0, 100),
        description: refined.description || prev.description,
        starting_bid: refined.startingBid ?? prev.starting_bid,
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

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke('refine-listing', {
        body: {
          currentListing: {
            title: formData.title,
            description: formData.description,
            startingBid: formData.starting_bid,
          },
          correctionPrompt: '',
          imageUrls: imageUrls,
          platform: 'denver',
          mode: 'verify',
          masterPrompt: masterPrompt || undefined
        }
      });

      if (error) throw new Error(error.message);

      const refined = data.listing;
      setVerifyResult({ verified: data.verified, confidence: data.confidence, notes: data.notes });

      const parseNum = (v: any, fallback: number) => {
        if (v == null) return fallback;
        const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.]/g, '')) : Number(v);
        return isNaN(n) ? fallback : n;
      };

      setFormData(prev => ({
        ...prev,
        title: (refined.title || prev.title).substring(0, 100),
        description: refined.description || prev.description,
        starting_bid: parseNum(refined.startingBid, prev.starting_bid),
      }));

      toast({
        title: data.verified ? "✅ Verification Confirmed" : "🔄 Corrections Applied",
        description: data.notes || (data.verified ? "AI confirmed the listing is correct" : "Listing updated with corrections"),
      });
    } catch (error) {
      toast({ title: "Verification Failed", description: error instanceof Error ? error.message : "Could not verify", variant: "destructive" });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-lg">Edit Denver Lot #{lot.lot_number}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Images */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-muted-foreground uppercase">
                Images (drag to reorder)
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
              <p className="text-sm text-muted-foreground">No images.</p>
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
              className="w-full min-h-[80px] px-3 py-2 bg-background border border-input rounded-md text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">{formData.description.length} chars</p>
          </div>

          {/* Starting Bid */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase">Starting Bid ($)</Label>
            <Input
              type="number"
              value={formData.starting_bid}
              onChange={(e) => handleChange('starting_bid', parseFloat(e.target.value) || 5)}
            />
          </div>
        </div>

        {/* AI Chat Bar */}
        <div className="p-4 border-t border-border bg-secondary/30 space-y-3">
          {verifyResult && (
            <div className={cn("text-xs p-2 rounded-md", verifyResult.verified ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400")}>
              <strong>{verifyResult.verified ? '✅ Verified' : '🔄 Corrected'}</strong> ({verifyResult.confidence}) — {verifyResult.notes}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Ask AI to make changes</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleVerify}
              disabled={isVerifying || isRefining || imageUrls.length === 0}
              className="gap-1.5 text-xs"
            >
              {isVerifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
              {isVerifying ? 'Verifying...' : 'Verify with AI'}
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              ref={correctionInputRef}
              placeholder="e.g., 'Make title more SEO friendly' or 'Lower starting bid'"
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
              {isRefining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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
