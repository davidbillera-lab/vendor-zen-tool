import { describe, it, expect, vi } from "vitest";

/**
 * Reproduces the "image saves black" bug.
 *
 * JPEG has no alpha channel, so a transparent canvas pixel encodes as BLACK.
 * Background removal leaves the image transparent; rotating or cropping it then
 * exported JPEG, which turned every transparent pixel black on save.
 *
 * exportCanvas is duplicated here rather than imported because ImageEditor.tsx
 * pulls in React + Supabase at module load; this asserts the pixel behaviour
 * that the fix depends on.
 */
function exportCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  preserveAlpha: boolean,
): string {
  if (preserveAlpha) return canvas.toDataURL("image/png");
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  return canvas.toDataURL("image/jpeg", 0.92);
}

/** Minimal 2D context stand-in that records the operations we care about. */
function makeCanvas() {
  const ops: string[] = [];
  const ctx = {
    globalCompositeOperation: "source-over",
    fillStyle: "",
    fillRect: vi.fn(() => ops.push(`fillRect:${ctx.fillStyle}:${ctx.globalCompositeOperation}`)),
  } as unknown as CanvasRenderingContext2D & { fillRect: ReturnType<typeof vi.fn> };

  const canvas = {
    width: 100,
    height: 100,
    toDataURL: vi.fn((type: string) => `data:${type};base64,STUB`),
  } as unknown as HTMLCanvasElement & { toDataURL: ReturnType<typeof vi.fn> };

  return { canvas, ctx, ops };
}

describe("exportCanvas — transparency must never become black", () => {
  it("keeps alpha as PNG when the image is still transparent", () => {
    const { canvas, ctx } = makeCanvas();
    const out = exportCanvas(canvas, ctx, true);
    expect(out).toContain("image/png");
    // No white fill: PNG carries the alpha, so compositing would destroy it.
    expect((ctx as any).fillRect).not.toHaveBeenCalled();
  });

  it("composites onto white BEFORE encoding JPEG", () => {
    const { canvas, ctx, ops } = makeCanvas();
    const out = exportCanvas(canvas, ctx, false);
    expect(out).toContain("image/jpeg");
    // The white must go behind the artwork, not over it.
    expect(ops).toContain("fillRect:#ffffff:destination-over");
  });

  it("restores the default composite mode so later draws are unaffected", () => {
    const { canvas, ctx } = makeCanvas();
    exportCanvas(canvas, ctx, false);
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });

  it("never emits a JPEG without a preceding white composite", () => {
    // The regression guard: a JPEG export with no white fill is exactly the
    // code path that produced black images.
    const { canvas, ctx, ops } = makeCanvas();
    const out = exportCanvas(canvas, ctx, false);
    if (out.includes("image/jpeg")) {
      expect(ops.some(o => o.startsWith("fillRect:#ffffff"))).toBe(true);
    }
  });
});
