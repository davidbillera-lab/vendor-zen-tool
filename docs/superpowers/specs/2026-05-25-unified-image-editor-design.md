# Unified Image Editor — Design Spec
**Date:** 2026-05-25
**Status:** Approved

---

## Problem

The current image editing surface has two separate components that overlap in purpose:

- `PhotoStudio.tsx` — fullscreen Dialog with rotate, crop, and BG removal
- `ImageEnhancer.tsx` — AI enhancement Dialog launched from inside `DraggableImageGrid`'s lightbox Dialog

The black screen bug is caused by `ImageEnhancer` opening a Radix `Dialog` nested inside another Radix `Dialog` (the lightbox in `DraggableImageGrid`). Radix's focus-trap and portal system breaks on nesting, locking the UI until the app is fully reloaded.

---

## Solution Overview

Consolidate into a single unified `ImageEditor` component. One fullscreen Dialog, no nesting anywhere. Simple editing tools live in a persistent toolbar. The AI panel slides in on the right when requested, coexisting with the toolbar tools.

---

## Architecture

### Components deleted
- `ImageEnhancer.tsx` — removed entirely
- Lightbox Dialog in `DraggableImageGrid` — removed (its rotate/remove actions move into the unified editor)

### Components modified
- `PhotoStudio.tsx` → renamed/rewritten as `ImageEditor.tsx`
- `DraggableImageGrid.tsx` — lightbox removed; thumbnail click and pencil icon both open `ImageEditor`
- `supabase/functions/enhance-image/index.ts` — routing updated, Lovable gateway removed

### No new dependencies required
All existing libraries stay: `@imgly/background-removal`, `react-image-crop`, canvas APIs.

---

## UI Structure

### Toolbar (top, always visible)
```
[ ↺ Rotate Left ]  [ ↻ Rotate Right ]  [ ✂ Crop ]  [ Remove BG ]  [ ✨ AI Studio ]        [ ✓ Apply ]
```

Clicking **AI Studio** toggles the right panel open/closed. All other toolbar buttons remain active regardless of panel state. Toolbar tools (rotate, crop, BG removal) always operate on the **current working image**, not the AI result preview. To edit an AI result with simple tools, the user must first hit "Use This" and Apply, then re-open the editor on the new image.

### Main area
- **Left/center:** image canvas (same canvas-based rendering as current PhotoStudio)
- **Right panel (AI Studio, ~280px wide):** hidden by default, slides in when AI Studio is active

### Filmstrip
Bottom filmstrip for multi-image navigation — unchanged from current PhotoStudio.

---

## AI Panel (right side)

```
┌─────────────────────────────┐
│  GPT-Image-2  │  Nano Banana │  ← model toggle
├─────────────────────────────┤
│  [prompt textarea          ] │
│  [Generate ▶              ] │
├─────────────────────────────┤
│  [result image preview     ] │
│  [ Use This ]  [ Refine ▶ ] │
└─────────────────────────────┘
```

**Iteration flow:**
1. User types prompt → hits Generate → spinner → result image shown
2. Two actions on result:
   - **Use This** — queues the result; toolbar Apply button becomes active
   - **Refine** — uses the result as the new input image for the next prompt (iterative)
3. User can keep refining until satisfied, then Use This → Apply

**Model picker:**
- Toggle between `GPT-Image-2` and `Nano Banana 2 Pro`
- Selection persists for the session (no need to re-pick each time)
- Default: GPT-Image-2

---

## Apply Behavior

| Tool | Apply action |
|------|-------------|
| Rotate | Replaces image in grid slot (in-place) |
| Crop | Replaces image in grid slot (in-place) |
| BG removal | Replaces image in grid slot (in-place) |
| AI result (Use This → Apply) | **Adds as new image** next to original in grid |

AI results never overwrite the original — the source image is always preserved.

---

## Background Removal (unchanged)

- Library: `@imgly/background-removal` (client-side, no API call)
- After removal: color swatches appear (transparent, white, light gray, custom picker)
- No change to existing logic

---

## Edge Function Changes (`enhance-image`)

### Request body — new field
```typescript
interface EnhanceRequest {
  imageUrl: string;
  prompt: string;
  mode: 'enhance' | 'generate' | 'edit';
  provider: 'gpt-image-2' | 'nano-banana';  // NEW
}
```

### Routing
- `provider: 'gpt-image-2'` → OpenAI Images API (`gpt-image-1` model, `images.generate` or `images.edit` endpoint depending on mode)
- `provider: 'nano-banana'` → Nano Banana 2 Pro API

### Removed
- Lovable AI gateway call (`https://ai.gateway.lovable.dev/...`) — deleted
- `google/gemini-2.5-flash-image` model reference — deleted

### New env vars required
- `OPENAI_API_KEY` (for GPT-Image-2 route)
- `NANO_BANANA_API_KEY` (for Nano Banana route)

### Upload behavior — unchanged
Results are still uploaded to Supabase storage at `listing-images/{user.id}/enhanced-{timestamp}.png`. Base64 fallback on upload failure remains.

---

## DraggableImageGrid Changes

- Lightbox Dialog removed entirely
- Thumbnail click → opens `ImageEditor` (replaces lightbox)
- Pencil icon → opens `ImageEditor` (same entry point, replaces `PhotoStudio` launch)
- `studioIndex` and `selectedImageIndex` state collapsed into single `editorIndex` state
- `ImageEnhancer` import removed

---

## What Is Not Changing

- ReactCrop with ratio presets (free, 1:1, 4:3, 16:9)
- Canvas rotation logic (`rotateSrc()`, `getCroppedImg()`)
- Multi-image filmstrip navigation
- Supabase storage upload path
- Auth flow in edge function (JWT validation unchanged)
- Error handling: 429/402 responses from AI APIs propagate to UI with user-readable messages

---

## Files Affected

| File | Change |
|------|--------|
| `src/components/PhotoStudio.tsx` | Deleted — replaced by ImageEditor |
| `src/components/ImageEnhancer.tsx` | Deleted — replaced by ImageEditor |
| `src/components/ImageEditor.tsx` | New file — unified editor (toolbar + canvas + AI panel) |
| `src/components/DraggableImageGrid.tsx` | Lightbox Dialog removed, imports updated to ImageEditor |
| `supabase/functions/enhance-image/index.ts` | Provider routing added, Lovable gateway removed |

---

## Out of Scope

- History/undo beyond the current session
- Saving prompts or generation history to the database
- Batch AI enhancement across multiple images at once
- Any change to the DOA or EstateSales upload agents
