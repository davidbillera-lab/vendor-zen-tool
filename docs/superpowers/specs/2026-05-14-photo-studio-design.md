# Photo Studio — Design Spec

**Date:** 2026-05-14  
**Feature:** In-app image editing (rotate, crop, remove background) for listing photos  
**Status:** Approved — ready for implementation planning

---

## Purpose

Let David prep listing photos without leaving the app. Covers the three most common pre-listing tasks: straighten/rotate, crop to ratio, and strip backgrounds. All processing runs in the browser — no API calls, no edge functions, no cost per image.

---

## Component

`src/components/PhotoStudio.tsx` — a full-screen modal that accepts an array of images and returns edited versions to the caller via a callback.

```ts
interface PhotoStudioProps {
  images: File[]          // images to edit
  initialIndex?: number   // which image to focus first (default: 0)
  onSave: (images: File[]) => void   // called with edited images on Apply
  onCancel: () => void
}
```

---

## Entry Points

**1. "Prep Photos" button** — appears in the CreateListing image upload area once at least one image is attached. Opens PhotoStudio with `initialIndex=0`.

**2. Pencil icon on thumbnails** — appears on hover (top-right corner overlay) on image thumbnails in:
- CreateListing listing editor
- EbayBatchPanel row images

Clicking the pencil opens PhotoStudio with all images for that listing and `initialIndex` set to the thumbnail that was hovered.

Both entry points close PhotoStudio on "Apply" or cancel. On Apply, the returned `File[]` replaces the originals in state — no route change, no re-generation required.

---

## Layout

**Layout B: Top toolbar → Canvas → Bottom filmstrip**

```
┌──────────────────────────────────────────────┐
│  ↺  ↻  │  Free  1:1  4:3  16:9  │  Remove BG  │  Apply ✓  │
├──────────────────────────────────────────────┤
│                                              │
│              [canvas + crop UI]              │
│                                              │
├──────────────────────────────────────────────┤
│  [thumb1*]  [thumb2]  [thumb3]  …   4 images │
└──────────────────────────────────────────────┘
```

Maximizes canvas height. Toolbar is compact and always visible.

---

## Toolbar Behavior

**Rotate:** ↺ (left 90°) and ↻ (right 90°) — applies to the current image in canvas immediately.

**Crop ratios:** Free | 1:1 | 4:3 | 16:9 — selecting a ratio snaps the crop overlay to that ratio. "Free" allows unconstrained drag. Active ratio is highlighted.

**Remove BG:** Runs `@imgly/background-removal` (WASM) on the current image. While processing, the button shows a spinner. On completion, the button changes to "✓ BG Removed" and inline color swatches appear to the right of it:

```
[✓ BG Removed]  Color: [░░ transparent*]  [■ white]  [■ gray]  [+ custom]
```

- Checkered swatch = transparent (default, selected on completion)
- White and light gray are instant presets
- `+` opens the native `<input type="color">` picker
- Selected swatch gets a blue border ring
- The chosen color is composited under the subject in the canvas preview in real time

Remove BG is available for any image, not just the hero.

**Apply:** green button, right-aligned. Bakes all pending edits across every image (each image carries its own rotate/crop/bg state), calls `onSave` with the full updated `File[]`, and closes the modal. Canceling discards all edits.

---

## Canvas

Rendered via `react-image-crop` for the crop overlay UI. Actual pixel operations (rotate, BG removal, color fill) are done with the browser Canvas API.

Edit state is per-image and held in component state — switching filmstrip images preserves uncommitted edits for each. "Apply" commits everything at once.

---

## Filmstrip

Horizontal strip at the bottom. Thumbnails are 36×36px with 2px active border (blue). Click any thumbnail to switch the canvas to that image. Thumbnail shows the current edited state (updates live as edits are made).

---

## Libraries

| Library | Purpose | Load strategy |
|---------|---------|---------------|
| `@imgly/background-removal` | WASM BG removal | Lazy — imported only when "Remove BG" is first clicked |
| `react-image-crop` | Crop overlay UI | Static import (small) |
| Browser Canvas API | Rotate, BG color fill, final export | Native, no install |

Both libraries are already available or installable via npm. No Supabase edge function changes needed.

---

## Data Flow

```
Parent (CreateListing / EbayBatchPanel)
  │
  ├─ passes: File[] images, initialIndex, onSave, onCancel
  │
PhotoStudio (modal)
  │
  ├─ loads images into canvas
  ├─ user edits (rotate, crop, remove BG, color fill)
  ├─ Apply clicked → Canvas.toBlob() → new File[] built
  │
  └─ calls onSave(editedFiles) → parent replaces images in state
```

No Supabase reads or writes. No API calls. Entirely local.

---

## Out of Scope

- Brightness / contrast / saturation sliders
- Filters or presets
- Undo history beyond the current session (Apply is the commit)
- Saving edited images to Supabase Storage (parent handles storage as it does today)
- Batch-apply the same edit to all images at once

---

## Success Criteria

1. User can open PhotoStudio from "Prep Photos" or pencil icon on any thumbnail
2. Rotate, crop, and Remove BG all work on any image in the filmstrip
3. BG removal shows inline color swatches; selected color appears in canvas preview
4. Apply returns updated images; listing continues normally
5. No API calls or edge function deploys required
6. Lazy-loading WASM means zero cost and no delay until Remove BG is first used
