import { useState, useRef } from 'react';
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import {
  RotateCcw, RotateCw, Loader2, X, Check,
  Sparkles, ChevronRight, ChevronLeft, Wand2, ImagePlus, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface ImageEditorProps {
  images: string[];
  initialIndex?: number;
  onSave: (updatedImages: string[]) => void;
  onCancel: () => void;
}

type AiMode = 'enhance' | 'generate' | 'edit';
type AiProvider = 'gpt-image-2' | 'gemini';

interface ImageEdit {
  rotation: number;
  crop: PixelCrop | null;
  bgRemoved: boolean;
  bgColor: string | null;
  src: string;
}

export function ImageEditor({ images, initialIndex = 0, onSave, onCancel }: ImageEditorProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [edits, setEdits] = useState<ImageEdit[]>(() =>
    images.map(src => ({ rotation: 0, crop: null, bgRemoved: false, bgColor: null, src }))
  );
  const [crop, setCrop] = useState<Crop>();
  const [activeCropRatio, setActiveCropRatio] = useState<string>('free');
  const [removingBg, setRemovingBg] = useState(false);
  const [applying, setApplying] = useState(false);

  // AI Studio panel state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>('enhance');
  const [aiProvider, setAiProvider] = useState<AiProvider>('gpt-image-2');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const currentEdit = edits[currentIndex];

  function updateEdit(index: number, patch: Partial<ImageEdit>) {
    setEdits(prev => prev.map((e, i) => i === index ? { ...e, ...patch } : e));
  }

  const cropRatios: Record<string, number | undefined> = {
    free: undefined,
    '1:1': 1,
    '4:3': 4 / 3,
    '16:9': 16 / 9,
  };

  async function handleRotate(dir: 'left' | 'right') {
    const degrees = dir === 'right' ? 90 : -90;
    const rotated = await rotateSrc(currentEdit.src, degrees);
    updateEdit(currentIndex, { src: rotated, rotation: (currentEdit.rotation + degrees + 360) % 360 });
  }

  function handleCropRatio(key: string) {
    setActiveCropRatio(key);
    const aspect = cropRatios[key];
    if (aspect !== undefined) {
      setCrop({ unit: '%', x: 10, y: 10, width: 80, height: 80 / aspect });
    } else {
      setCrop(undefined);
    }
  }

  async function applyCrop() {
    if (!crop || !imgRef.current) return;
    const cropped = await getCroppedImg(imgRef.current, crop as PixelCrop);
    updateEdit(currentIndex, { src: cropped, crop: crop as PixelCrop });
    setCrop(undefined);
    setActiveCropRatio('free');
  }

  async function handleRemoveBg() {
    setRemovingBg(true);
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const blob = await removeBackground(currentEdit.src);
      const url = URL.createObjectURL(blob);
      updateEdit(currentIndex, { bgRemoved: true, bgColor: null, src: url });
    } catch (e) {
      console.error('BG removal failed:', e);
      toast({ title: 'Background removal failed', variant: 'destructive' });
    } finally {
      setRemovingBg(false);
    }
  }

  async function handleBgColor(color: string | null) {
    if (!currentEdit.bgRemoved) return;
    const filled = await fillBackground(currentEdit.src, color);
    updateEdit(currentIndex, { bgColor: color, src: filled });
  }

  async function handleApply() {
    setApplying(true);
    onSave(edits.map(e => e.src));
    setApplying(false);
    setIsOpen(false);
  }

  // ── AI Studio ──────────────────────────────────────────────────────────────

  async function blobUrlToDataUrl(url: string): Promise<string> {
    if (!url.startsWith('blob:')) return url;
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  async function handleAiGenerate() {
    if (aiMode === 'generate' && !aiPrompt.trim()) {
      toast({ title: 'Enter a description first', variant: 'destructive' });
      return;
    }

    setAiProcessing(true);
    setAiResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const imageUrl = aiMode !== 'generate'
        ? await blobUrlToDataUrl(currentEdit.src)
        : '';

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enhance-image`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            imageUrl,
            prompt: aiPrompt.trim(),
            mode: aiMode,
            provider: aiProvider,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to process image');
      }

      const data = await response.json();
      setAiResult(data.imageUrl);
    } catch (error) {
      console.error('AI processing error:', error);
      toast({
        title: 'AI processing failed',
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setAiProcessing(false);
    }
  }

  function handleUseAiResult() {
    if (!aiResult) return;
    // AI results add as a NEW image, never overwriting the original
    const newEdit: ImageEdit = { rotation: 0, crop: null, bgRemoved: false, bgColor: null, src: aiResult };
    setEdits(prev => [...prev, newEdit]);
    setCurrentIndex(edits.length); // jump to the new image
    setAiResult(null);
    setAiPrompt('');
    toast({ title: 'AI image added to your set' });
  }

  function switchImage(i: number) {
    setCurrentIndex(i);
    setCrop(undefined);
    setActiveCropRatio('free');
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-screen-lg w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border-b border-border flex-shrink-0 flex-wrap">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleRotate('left')}>
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleRotate('right')}>
            <RotateCw className="h-4 w-4" />
          </Button>

          <div className="w-px h-5 bg-border mx-1" />

          {Object.keys(cropRatios).map(key => (
            <Button
              key={key}
              size="sm"
              variant={activeCropRatio === key ? 'default' : 'ghost'}
              className="h-7 px-2 text-xs"
              onClick={() => handleCropRatio(key)}
            >
              {key}
            </Button>
          ))}
          {crop && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={applyCrop}>
              Crop
            </Button>
          )}

          <div className="w-px h-5 bg-border mx-1" />

          {!currentEdit.bgRemoved ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleRemoveBg} disabled={removingBg}>
              {removingBg
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Removing…</>
                : 'Remove BG'}
            </Button>
          ) : (
            <>
              <span className="text-xs text-blue-400 font-medium">✓ BG Removed</span>
              <span className="text-xs text-muted-foreground ml-1">Color:</span>
              <button
                onClick={() => handleBgColor(null)}
                className={cn('w-5 h-5 rounded border-2 flex-shrink-0', currentEdit.bgColor === null ? 'border-primary' : 'border-border')}
                style={{ background: 'repeating-conic-gradient(#888 0% 25%, #555 0% 50%) 0 0 / 8px 8px' }}
                title="Transparent"
              />
              <button
                onClick={() => handleBgColor('#ffffff')}
                className={cn('w-5 h-5 rounded border-2 flex-shrink-0 bg-white', currentEdit.bgColor === '#ffffff' ? 'border-primary' : 'border-border')}
                title="White"
              />
              <button
                onClick={() => handleBgColor('#e5e7eb')}
                className={cn('w-5 h-5 rounded border-2 flex-shrink-0', currentEdit.bgColor === '#e5e7eb' ? 'border-primary' : 'border-border')}
                style={{ background: '#e5e7eb' }}
                title="Light gray"
              />
              <label
                className="w-5 h-5 rounded border border-border cursor-pointer flex items-center justify-center text-xs text-muted-foreground hover:border-primary"
                title="Custom color"
              >
                +
                <input type="color" className="sr-only" onChange={e => handleBgColor(e.target.value)} />
              </label>
            </>
          )}

          <div className="w-px h-5 bg-border mx-1" />

          <Button
            size="sm"
            variant={aiOpen ? 'default' : 'ghost'}
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setAiOpen(v => !v)}
          >
            <Sparkles className="h-3 w-3" />
            AI Studio
            {aiOpen ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
          </Button>

          <div className="flex-1" />

          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-green-600 hover:bg-green-700 text-white gap-1"
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Apply
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body: canvas + optional AI panel */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Canvas */}
          <div className="flex-1 bg-[#111] flex items-center justify-center overflow-hidden min-h-0">
            <ReactCrop crop={crop} onChange={c => setCrop(c)} aspect={cropRatios[activeCropRatio]}>
              <img
                ref={imgRef}
                src={currentEdit.src}
                alt="editing"
                className="max-h-full max-w-full object-contain"
                crossOrigin="anonymous"
              />
            </ReactCrop>
          </div>

          {/* AI Studio panel */}
          {aiOpen && (
            <div className="w-72 flex-shrink-0 bg-[#1a1a1a] border-l border-border flex flex-col overflow-y-auto">
              <div className="p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI Studio</p>

                {/* Provider toggle */}
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={aiProvider === 'gpt-image-2' ? 'default' : 'ghost'}
                    className="h-6 px-2 text-xs flex-1"
                    onClick={() => setAiProvider('gpt-image-2')}
                  >
                    GPT-Image-2
                  </Button>
                  <Button
                    size="sm"
                    variant={aiProvider === 'gemini' ? 'default' : 'ghost'}
                    className="h-6 px-2 text-xs flex-1"
                    onClick={() => setAiProvider('gemini')}
                  >
                    Gemini
                  </Button>
                </div>

                {/* Mode selector */}
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={aiMode === 'enhance' ? 'default' : 'ghost'}
                    className="h-6 px-2 text-xs flex-1"
                    onClick={() => setAiMode('enhance')}
                    title="Auto-enhance this image"
                  >
                    <Wand2 className="h-3 w-3 mr-1" />
                    Enhance
                  </Button>
                  <Button
                    size="sm"
                    variant={aiMode === 'edit' ? 'default' : 'ghost'}
                    className="h-6 px-2 text-xs flex-1"
                    onClick={() => setAiMode('edit')}
                    title="Edit with a prompt"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant={aiMode === 'generate' ? 'default' : 'ghost'}
                    className="h-6 px-2 text-xs flex-1"
                    onClick={() => setAiMode('generate')}
                    title="Generate a new image"
                  >
                    <ImagePlus className="h-3 w-3 mr-1" />
                    New
                  </Button>
                </div>

                {/* Prompt */}
                <Textarea
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder={
                    aiMode === 'generate'
                      ? 'Describe the image to create…'
                      : aiMode === 'enhance'
                        ? 'Optional: enhancement notes…'
                        : 'Describe the changes you want…'
                  }
                  className="text-xs min-h-[72px] resize-none bg-[#111] border-border"
                />

                <Button
                  size="sm"
                  className="w-full h-7 text-xs gap-1"
                  onClick={handleAiGenerate}
                  disabled={aiProcessing || (aiMode === 'generate' && !aiPrompt.trim())}
                >
                  {aiProcessing
                    ? <><Loader2 className="h-3 w-3 animate-spin" />Processing…</>
                    : <><Sparkles className="h-3 w-3" />Generate</>}
                </Button>

                {/* AI result preview */}
                {aiResult && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Result preview:</p>
                    <img
                      src={aiResult}
                      alt="AI result"
                      className="w-full rounded border border-primary object-contain"
                    />
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="h-6 px-2 text-xs flex-1 bg-green-600 hover:bg-green-700 text-white"
                        onClick={handleUseAiResult}
                      >
                        Use This
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs flex-1"
                        onClick={() => { setAiResult(null); handleAiGenerate(); }}
                        disabled={aiProcessing}
                      >
                        Refine
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Filmstrip */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border-t border-border flex-shrink-0 overflow-x-auto">
          {edits.map((edit, i) => (
            <button
              key={i}
              onClick={() => switchImage(i)}
              className={cn(
                'w-10 h-10 flex-shrink-0 rounded overflow-hidden border-2 transition-all',
                i === currentIndex ? 'border-primary' : 'border-transparent hover:border-border'
              )}
            >
              <img src={edit.src} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
          <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
            {edits.length} photo{edits.length !== 1 ? 's' : ''}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

async function rotateSrc(src: string, degrees: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const abs = Math.abs(degrees);
      if (abs === 90 || abs === 270) {
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
    img.onerror = () => reject(new Error('Failed to load image for rotation'));
    img.src = src;
  });
}

async function getCroppedImg(img: HTMLImageElement, crop: PixelCrop): Promise<string> {
  const canvas = document.createElement('canvas');
  const scaleX = img.naturalWidth / img.width;
  const scaleY = img.naturalHeight / img.height;
  canvas.width = crop.width * scaleX;
  canvas.height = crop.height * scaleY;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    img,
    crop.x * scaleX, crop.y * scaleY,
    crop.width * scaleX, crop.height * scaleY,
    0, 0,
    canvas.width, canvas.height
  );
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function fillBackground(src: string, color: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      resolve(color ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image for BG fill'));
    img.src = src;
  });
}
