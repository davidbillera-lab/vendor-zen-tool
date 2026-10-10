import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { persistLocalImageUrls } from "../listings";

describe("persistLocalImageUrls", () => {
  it("uploads browser-only photo-editor URLs and passes real URLs through", async () => {
    const upload = vi.fn().mockResolvedValue("https://store.example/edited.jpg");
    const stored = "https://store.example/original.jpg";
    const edited = "data:image/png;base64,iVBORw0KGgo=";

    const result = await persistLocalImageUrls([stored, edited], upload);

    expect(result).toEqual([stored, "https://store.example/edited.jpg"]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBeInstanceOf(File);
  });
});
