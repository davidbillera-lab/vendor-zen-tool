import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EbayListingDrawer, type DrawerEbayRow } from "@/components/ebay/EbayListingDrawer";
import { fetchCategoryAspects, extractCategoryId, mergeAspectsWithSpecifics } from "@/components/ebay/ebayCategoryAspects";

vi.mock("@/components/ebay/ebayCategoryAspects", () => ({
  fetchCategoryAspects: vi.fn(),
  extractCategoryId: vi.fn(),
  mergeAspectsWithSpecifics: vi.fn(),
}));
vi.mock("@/components/ImageEditor", () => ({ ImageEditor: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const baseRow: DrawerEbayRow = {
  id: "row-1",
  lot_number: 42,
  title: "Vintage Coffee Maker",
  description: "Works perfectly",
  price: 25.0,
  category: "12345 - Small Kitchen Appliances",
  condition: "Used",
  item_specifics: {},
  image_urls: [],
  status: "staged",
  custom_sku: null,
  upc: null,
  brand: null,
  mpn: null,
  ebay_item_id: null,
};

const brandAspect = { name: "Brand", required: true, mode: "FREE_TEXT" as const, allowedValues: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EbayListingDrawer", () => {
  it("disables Publish and shows missing-field count when required specifics are empty", async () => {
    vi.mocked(extractCategoryId).mockReturnValue("12345");
    vi.mocked(fetchCategoryAspects).mockResolvedValue({
      categoryId: "12345",
      aspects: [brandAspect],
      fromCache: false,
      fetchedAt: new Date().toISOString(),
    });
    vi.mocked(mergeAspectsWithSpecifics).mockReturnValue([
      { aspect: brandAspect, currentValue: "" },
    ]);

    render(<EbayListingDrawer row={baseRow} open={true} onOpenChange={() => {}} onPublish={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText(/1 required field missing/).length).toBeGreaterThan(0);
    });

    const publishBtn = screen.getByRole("button", { name: /Publish to eBay/i });
    expect(publishBtn).toBeDisabled();
  });

  it("enables Publish and shows ready banner when all required fields are filled", async () => {
    vi.mocked(extractCategoryId).mockReturnValue("12345");
    vi.mocked(fetchCategoryAspects).mockResolvedValue({
      categoryId: "12345",
      aspects: [brandAspect],
      fromCache: false,
      fetchedAt: new Date().toISOString(),
    });
    vi.mocked(mergeAspectsWithSpecifics).mockReturnValue([
      { aspect: brandAspect, currentValue: "Apple" },
    ]);

    render(
      <EbayListingDrawer
        row={{ ...baseRow, item_specifics: { Brand: "Apple" } }}
        open={true}
        onOpenChange={() => {}}
        onPublish={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/All required specifics filled/)).toBeInTheDocument();
    });

    const publishBtn = screen.getByRole("button", { name: /Publish to eBay/i });
    expect(publishBtn).not.toBeDisabled();
  });

  it("renders read-only banner and live listing link for a published row", async () => {
    vi.mocked(extractCategoryId).mockReturnValue("12345");
    vi.mocked(fetchCategoryAspects).mockResolvedValue({
      categoryId: "12345",
      aspects: [],
      fromCache: false,
      fetchedAt: new Date().toISOString(),
    });
    vi.mocked(mergeAspectsWithSpecifics).mockReturnValue([]);

    const liveRow: DrawerEbayRow = {
      ...baseRow,
      status: "published",
      ebay_item_id: "987654321",
    };

    render(<EbayListingDrawer row={liveRow} open={true} onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Live on eBay/)).toBeInTheDocument();
    });

    const link = screen.getByRole("link", { name: /View live listing/i });
    expect(link).toHaveAttribute("href", "https://www.ebay.com/itm/987654321");
  });

  it("falls back to free-text fields from item_specifics when no category is set", async () => {
    vi.mocked(extractCategoryId).mockReturnValue("");

    render(
      <EbayListingDrawer
        row={{ ...baseRow, category: null, item_specifics: { Color: "Blue", Material: "Plastic" } }}
        open={true}
        onOpenChange={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("Blue")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Plastic")).toBeInTheDocument();
    });

    expect(vi.mocked(fetchCategoryAspects)).not.toHaveBeenCalled();
  });
});
