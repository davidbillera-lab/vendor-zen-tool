# Photo Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen photo editing modal (rotate, crop, remove BG) reachable from CreateListing and any DraggableImageGrid thumbnail.

**Architecture:** Single `PhotoStudio.tsx` component that works with `string[]` image URLs internally. CreateListing converts its `File`-based state to/from data URLs at the boundary. DraggableImageGrid passes URLs directly. All processing uses the browser Canvas API — no edge functions.

**Tech Stack:** `react-image-crop` (crop UI overlay), `@imgly/background-removal` (WASM, lazy-loaded), Canvas API (rotate + BG color composite), `@/components/ui/dialog` (modal shell)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/components/PhotoStudio.tsx` | **Create** | Full-screen modal — all editing logic lives here |
| `src/components/DraggableImageGrid.tsx` | **Modify** | Add pencil icon + `onEditPhoto` prop |
| `src/pages/CreateListing.tsx` | **Modify** | Add "Prep Photos" button + open/close PhotoStudio state |

---

## Task 1: Install dependencies

**Files:** `package.json`

- [ ] **Step 1: Install both libraries**

```bash
npm install react-image-crop @imgly/background-removal
```

Expected output: both packages added under `dependencies` in `package.json`.

- [ ] **Step 2: Verify install**

```bash
npm ls react-image-crop @imgly/background-removal
```

Expected: both show a version number, no `UNMET DEPENDENCY` errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-image-crop and @imgly/background-removal"
```

---

## Task 2: Build PhotoStudio component

**Files:**
- Create: `src/components/PhotoStudio.tsx`

- [ ] **Step 1: Create the file with types and skeleton**

```tsx
import { useState, useRef, useCallback } from 'react';
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { RotateCcw, RotateCw, Loader2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface PhotoStudioProps {
  images: string[];          // src URLs (data URLs or remote URLs)
  initialIndex?: number;     // which image to show first (default 0)
  onSave: (images: string[]) => void;
  onCancel: () => void;
}

// Per-image edit state
interface ImageEdit {
  rotation: number;          // cumulative degrees (0, 90, 180, 270)
  crop: PixelCrop | null;    // null = no crop applied
  bgRemoved: boolean;
  bgColor: string | null;    // null = transparent, '#ffffff' = white, etc.
  src: string;               // current working data URL (starts as original)
}

export function PhotoStudio({ images, initialIndex = 0, onSave, onCancel }: PhotoStudioProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [edits, setEdits] = useState<ImageEdit[]>(() =>
    images.map(src => ({ rotation: 0, crop: null, bgRemoved: false, bgColor: null, src }))
  );
  const [crop, setCrop] = useState<Crop>();
  const [activeCropRatio, setActiveCropRatio] = useState<string>('free');
  const [removingBg, setRemovingBg] = useState(false);
  const [applying, setApplying] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const currentEdit = edits[currentIndex];

  // -- helpers --

  function updateEdit(index: number, patch: Partial<ImageEdit>) {
    setEdits(prev => prev.map((e, i) => i === index ? { ...e, ...patch } : e));
  }

  const cropRatios: Record<string, number | undefined> = {
    free: undefined,
    '1:1': 1,
    '4:3': 4 / 3,
    '16:9': 16 / 9,
  };

  // -- rotate --

  async function handleRotate(dir: 'left' | 'right') {
    const degrees = dir === 'right' ? 90 : -90;
    const src = currentEdit.src;
    const rotated = await rotateSrc(src, degrees);
    updateEdit(currentIndex, { src: rotated, rotation: (currentEdit.rotation + degrees + 360) % 360 });
  }

  // -- crop ratio change --

  function handleCropRatio(key: string) {
    setActiveCropRatio(key);
    const aspect = cropRatios[key];
    if (aspect !== undefined) {
      setCrop(prev => prev ? { ...prev, aspect } as unknown as Crop : { unit: '%', x: 10, y: 10, width: 80, height: 80 / aspect });
    } else {
      setCrop(prev => prev ? { ...prev } : undefined);
    }
  }

  // -- apply crop --

  async function applyCrop() {
    if (!crop || !imgRef.current) return;
    const cropped = await getCroppedImg(imgRef.current, crop as unknown as PixelCrop);
    updateEdit(currentIndex, { src: cropped, crop: crop as unknown as PixelCrop });
    setCrop(undefined);
    setActiveCropRatio('free');
  }

  // -- remove BG --

  async function handleRemoveBg() {
    setRemovingBg(true);
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const blob = await removeBackground(currentEdit.src);
      const url = URL.createObjectURL(blob);
      updateEdit(currentIndex, { bgRemoved: true, bgColor: null, src: url });
    } catch (e) {
      console.error('BG removal failed:', e);
    } finally {
      setRemovingBg(false);
    }
  }

  // -- BG color fill --

  async function handleBgColor(color: string | null) {
    if (!currentEdit.bgRemoved) return;
    updateEdit(currentIndex, { bgColor: color });
    // Composite color fill in canvas
    const filled = await fillBackground(currentEdit.src, color);
    // Store composite but keep bgRemoved=true so swatch stays visible
    updateEdit(currentIndex, { bgColor: color, src: filled });
  }

  // -- apply & save --

  async function handleApply() {
    setApplying(true);
    const result = edits.map(e => e.src);
    onSave(result);
    setApplying(false);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-screen-lg w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border-b border-border flex-shrink-0 flex-wrap">
          {/* Rotate */}
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleRotate('left')}><RotateCcw className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleRotate('right')}><RotateCw className="h-4 w-4" /></Button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Crop ratios */}
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
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={applyCrop}>Crop</Button>
          )}

          <div className="w-px h-5 bg-border mx-1" />

          {/* Remove BG */}
          {!currentEdit.bgRemoved ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleRemoveBg} disabled={removingBg}>
              {removingBg ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Removing…</> : 'Remove BG'}
            </Button>
          ) : (
            <>
              <span className="text-xs text-blue-400 font-medium">✓ BG Removed</span>
              <span className="text-xs text-muted-foreground ml-1">Color:</span>
              {/* Transparent */}
              <button
                onClick={() => handleBgColor(null)}
                className={cn('w-5 h-5 rounded border-2 flex-shrink-0', currentEdit.bgColor === null ? 'border-primary' : 'border-border')}
                style={{ background: 'repeating-conic-gradient(#888 0% 25%, #555 0% 50%) 0 0 / 8px 8px' }}
                title="Transparent"
              />
              {/* White */}
              <button
                onClick={() => handleBgColor('#ffffff')}
                className={cn('w-5 h-5 rounded border-2 flex-shrink-0 bg-white', currentEdit.bgColor === '#ffffff' ? 'border-primary' : 'border-border')}
                title="White"
              />
              {/* Light gray */}
              <button
                onClick={() => handleBgColor('#e5e7eb')}
                className={cn('w-5 h-5 rounded border-2 flex-shrink-0', currentEdit.bgColor === '#e5e7eb' ? 'border-primary' : 'border-border')}
                style={{ background: '#e5e7eb' }}
                title="Light gray"
              />
              {/* Custom */}
              <label className="w-5 h-5 rounded border border-border cursor-pointer flex items-center justify-center text-xs text-muted-foreground hover:border-primary" title="Custom color">
                +
                <input type="color" className="sr-only" onChange={e => handleBgColor(e.target.value)} />
              </label>
            </>
          )}

          <div className="flex-1" />

          {/* Apply */}
          <Button size="sm" className="h-7 px-3 text-xs bg-green-600 hover:bg-green-700 text-white gap-1" onClick={handleApply} disabled={applying}>
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Apply
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onCancel}><X className="h-4 w-4" /></Button>
        </div>

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

        {/* Filmstrip */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border-t border-border flex-shrink-0 overflow-x-auto">
          {edits.map((edit, i) => (
            <button
              key={i}
              onClick={() => { setCurrentIndex(i); setCrop(undefined); setActiveCropRatio('free'); }}
              className={cn(
                'w-10 h-10 flex-shrink-0 rounded overflow-hidden border-2 transition-all',
                i === currentIndex ? 'border-primary' : 'border-transparent hover:border-border'
              )}
            >
              <img src={edit.src} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
          <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{images.length} photo{images.length !== 1 ? 's' : ''}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Canvas helpers ──────────────────────────────────────────────────────────────

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
      // Keep PNG if transparent (no color), JPEG otherwise
      resolve(color ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image for BG fill'));
    img.src = src;
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build 2>&1 | head -40
```

Fix any TypeScript errors before proceeding. Common ones:
- `PixelCrop` import issue: check `react-image-crop` exports — it may be `import type { Crop, PixelCrop } from 'react-image-crop'`
- `aspect` property: in react-image-crop v11, `aspect` is a prop on `<ReactCrop>` not on the `Crop` object

- [ ] **Step 3: Commit**

```bash
git add src/components/PhotoStudio.tsx
git commit -m "feat: add PhotoStudio component (rotate, crop, remove BG)"
```

---

## Task 3: Wire PhotoStudio into DraggableImageGrid

**Files:**
- Modify: `src/components/DraggableImageGrid.tsx`

The goal: show a pencil icon on thumbnail hover (alongside the existing X/remove button) that opens PhotoStudio for that image.

- [ ] **Step 1: Add `onEditPhoto` prop and pencil icon**

Add `Pencil` to the lucide-react import and add the `onEditPhoto` prop and PhotoStudio state to `DraggableImageGrid`:

```tsx
// Add Pencil to existing lucide-react import
import { GripVertical, X, RotateCw, Loader2, ZoomIn, Pencil } from "lucide-react";

// Add PhotoStudio import
import { PhotoStudio } from "./PhotoStudio";

// Extend props interface — add optional prop
interface DraggableImageGridProps {
  images: string[];
  onReorder: (images: string[]) => void;
  onRemove?: (index: number) => void;
  onEnhance?: (index: number, newUrl: string) => void;
  showEnhance?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onEditPhoto?: (index: number, newUrls: string[]) => void;  // add this
}

// Inside the component function, add state:
const [studioIndex, setStudioIndex] = useState<number | null>(null);
```

- [ ] **Step 2: Add pencil button next to the existing X button**

Find the "Quick action buttons" block (around line 182 in `DraggableImageGrid.tsx`) and add the pencil button:

```tsx
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
```

- [ ] **Step 3: Render PhotoStudio when triggered**

Add just before the closing `</>` of the component return:

```tsx
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
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add src/components/DraggableImageGrid.tsx
git commit -m "feat: add pencil entry point to DraggableImageGrid for PhotoStudio"
```

---

## Task 4: Wire PhotoStudio into CreateListing

**Files:**
- Modify: `src/pages/CreateListing.tsx`

Two changes: (1) "Prep Photos" button appears below the image count once photos are loaded, (2) each thumbnail in the grid gets a pencil icon on hover.

- [ ] **Step 1: Add PhotoStudio import and open state**

At the top of CreateListing.tsx, add:

```tsx
import { PhotoStudio } from '@/components/PhotoStudio';
```

Inside the `CreateListing` component function, add state (near the other useState calls around line 98):

```tsx
const [photoStudioOpen, setPhotoStudioOpen] = useState(false);
const [photoStudioIndex, setPhotoStudioIndex] = useState(0);
```

- [ ] **Step 2: Add a helper to handle PhotoStudio save**

Add this function inside the component (after `clearAll`, around line 502):

```tsx
// Convert data URL back to a File object for form submission
function dataURLtoFile(dataUrl: string, filename: string): File {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)![1];
  const binary = atob(data);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new File([array], filename, { type: mime });
}

function handlePhotoStudioSave(updatedUrls: string[]) {
  setImages(prev => {
    // Revoke old object URLs to avoid memory leaks
    prev.forEach(img => { if (img.preview.startsWith('blob:')) URL.revokeObjectURL(img.preview); });
    return updatedUrls.map((url, i) => {
      const original = prev[i];
      const filename = original?.file?.name ?? `photo-${i + 1}.jpg`;
      const newFile = dataURLtoFile(url, filename);
      return { file: newFile, preview: url, url: original?.url };
    });
  });
  setPhotoStudioOpen(false);
}
```

- [ ] **Step 3: Add "Prep Photos" button and pencil icons to the thumbnail grid**

Find the `<div className="flex items-center justify-between">` block around line 1193 and add the button:

```tsx
<div className="flex items-center justify-between">
  <span className="text-sm text-muted-foreground">{images.length} photo(s)</span>
  <div className="flex items-center gap-2">
    <Button
      variant="outline"
      size="sm"
      onClick={() => { setPhotoStudioIndex(0); setPhotoStudioOpen(true); }}
    >
      Prep Photos
    </Button>
    <Button variant="ghost" size="sm" onClick={clearAll}>
      Clear All
    </Button>
  </div>
</div>
```

Then in the thumbnail map (line 1200), add a pencil button overlay to each thumbnail:

```tsx
{images.map((img, index) => (
  <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
    <img src={img.preview} alt="" className="w-full h-full object-cover" />
    {/* Pencil edit button */}
    <button
      onClick={() => { setPhotoStudioIndex(index); setPhotoStudioOpen(true); }}
      className="absolute top-1 left-1 p-1 bg-primary/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
      title="Edit in Photo Studio"
    >
      <Pencil className="h-3 w-3 text-white" />
    </button>
    <button
      onClick={() => removeImage(index)}
      className="absolute top-1 right-1 p-1 bg-background/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <X className="h-3 w-3" />
    </button>
    {img.url && (
      <Check className="absolute bottom-1 left-1 h-4 w-4 text-green-500" />
    )}
  </div>
))}
```

Add `Pencil` to the existing lucide-react import in CreateListing.tsx.

- [ ] **Step 4: Render PhotoStudio modal**

Add just before the closing `</div>` of the component return (or near the bottom of the JSX):

```tsx
{photoStudioOpen && (
  <PhotoStudio
    images={images.map(img => img.preview)}
    initialIndex={photoStudioIndex}
    onSave={handlePhotoStudioSave}
    onCancel={() => setPhotoStudioOpen(false)}
  />
)}
```

- [ ] **Step 5: Verify build**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/CreateListing.tsx
git commit -m "feat: wire PhotoStudio into CreateListing (Prep Photos button + pencil icons)"
```

---

## Task 5: Manual smoke test

- [ ] Run dev server: `npm run dev`
- [ ] Open CreateListing, upload 2–3 photos
- [ ] Click "Prep Photos" → PhotoStudio opens, all photos in filmstrip
- [ ] Rotate an image left and right → image updates in canvas
- [ ] Select 1:1 crop ratio → crop overlay snaps to square → click Crop → image updates
- [ ] Click "Remove BG" → spinner appears → subject shown on transparent checkerboard
- [ ] Click white swatch → white background fills in canvas
- [ ] Click a different photo in the filmstrip → switches to that photo
- [ ] Click Apply → modal closes → thumbnail previews show the edited versions
- [ ] Hover over any thumbnail → pencil icon appears → click it → PhotoStudio opens at that photo
- [ ] Click cancel → no changes to images

- [ ] **Final commit** (if any fixes needed from smoke test)

```bash
git add -p
git commit -m "fix: photo studio smoke test fixes"
```

---

## Deployment note

No edge functions changed. No `supabase functions deploy` needed. This is purely frontend.
