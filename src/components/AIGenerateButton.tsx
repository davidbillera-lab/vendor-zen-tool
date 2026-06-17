import { useState } from "react";
import { Sparkles, Loader2, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface AIGenerateButtonProps {
  onImageGenerated: (url: string) => void;
  trigger?: React.ReactNode;
}

export function AIGenerateButton({ onImageGenerated, trigger }: AIGenerateButtonProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleGenerate() {
    if (!prompt.trim()) {
      toast({ title: 'Enter a description first', variant: 'destructive' });
      return;
    }
    setProcessing(true);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enhance-image`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ imageUrl: '', prompt: prompt.trim(), mode: 'generate' }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to generate image');
      }

      const data = await response.json();
      setResult(data.imageUrl);
    } catch (error) {
      toast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  }

  function handleUse() {
    if (result) {
      onImageGenerated(result);
      setOpen(false);
      setResult(null);
      setPrompt('');
    }
  }

  function handleClose() {
    setOpen(false);
    setResult(null);
    setPrompt('');
  }

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(true); }}
      >
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1">
            <ImagePlus className="h-4 w-4" />
            AI Generate
          </Button>
        )}
      </span>

      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Generate Image with AI
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the image to create, e.g. 'Professional product photo of a vintage leather jacket on white background'"
              className="min-h-[80px] resize-none text-sm"
              onKeyDown={e => e.key === 'Enter' && e.ctrlKey && !processing && handleGenerate()}
            />

            {result && (
              <img src={result} alt="Generated" className="w-full rounded border border-primary object-contain max-h-48" />
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={processing || !prompt.trim()}
              >
                {processing
                  ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Generating…</>
                  : <><Sparkles className="h-3 w-3 mr-1" />Generate</>}
              </Button>
              {result && (
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleUse}>
                  Use This
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
