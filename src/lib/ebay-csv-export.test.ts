import { describe, it, expect } from 'vitest';

/**
 * Regression tests for eBay CSV export header format.
 * Ensures compatibility with eBay File Exchange "Add" bulk upload (Version=1193).
 */

function getEbayCSVHeaders(): string[] {
  return [
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)",
    "CustomLabel",
    "*Category",
    "*Title",
    "Relationship",
    "RelationshipDetails",
    "ScheduleTime",
    "*ConditionID",
    "PicURL",
    "VideoID",
    "*Description",
    "*Format",
    "*Duration",
    "*StartPrice",
    "BuyItNowPrice",
    "BestOfferEnabled",
    "BestOfferAutoAcceptPrice",
    "MinimumBestOfferPrice",
    "*Quantity",
    "ImmediatePayRequired",
    "*Location",
    "ShippingType",
    "ShippingService-1:Option",
    "ShippingService-1:Cost",
    "ShippingService-2:Option",
    "ShippingService-2:Cost",
    "*DispatchTimeMax",
    "*ReturnsAcceptedOption",
    "ReturnsWithinOption",
    "RefundOption",
    "ShippingCostPaidByOption",
  ];
}

/** Mimics the CSV generation from EbayBatchPanel */
function generateTestCSV(rows: Array<{
  lot_number: number;
  title: string;
  description: string;
  price: number;
  category: string | null;
  condition: string;
  shipping_cost?: number | null;
  handling_time?: number | null;
  returns_accepted?: boolean | null;
  return_period?: number | null;
  return_shipping?: "buyer" | "seller" | null;
  shipping_type?: "flat" | "free" | "calculated" | null;
}>, defaultCategoryId = "", location = "Denver, CO"): string {
  const headers = getEbayCSVHeaders();

  const conditionMap: Record<string, string> = {
    "New": "1000", "Used": "3000", "Pre-owned": "3000",
  };

  const infoRows = [
    `Info,Version=1.0.0,Template=fx_category_template_EBAY_US`,
  ];

  const csvRows = rows.map(row => {
    const extractedCategoryId = row.category?.match(/\d{3,}/)?.[0] || "";
    const fallbackCategoryId = defaultCategoryId.trim().match(/^\d{3,}$/) ? defaultCategoryId.trim() : "";
    const categoryId = (extractedCategoryId || fallbackCategoryId).replace(/\.0$/, '').trim();
    const returnsAccepted = row.returns_accepted ?? true;
    const shippingCost = row.shipping_type === "free" ? "0.00" : (row.shipping_cost ?? 9.98).toFixed(2);

    return [
      conditionMap[row.condition] || "3000",
      "",
      "",
      `<p>${row.description}</p>`,
      "FixedPrice",
      "GTC",
      row.price.toString(),
      "",
      "0",
      "",
      "",
      "1",
      "1",
      location,
      "Flat",
      "USPSGroundAdvantage",
      shippingCost,
      "",
      "",
      String(row.handling_time ?? 1),
      returnsAccepted ? "ReturnsAccepted" : "ReturnsNotAccepted",
      returnsAccepted ? `Days_${row.return_period ?? 30}` : "",
      returnsAccepted ? "MoneyBack" : "",
      returnsAccepted ? ((row.return_shipping ?? "seller") === "buyer" ? "Buyer" : "Seller") : "",
    ];
  });

  return [
    ...infoRows,
    headers.join(","),
    ...csvRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
  ].join("\r\n");
}

describe('eBay CSV Export Headers', () => {
  it('should use the current fx_category_template_EBAY_US headers', () => {
    const headers = getEbayCSVHeaders();
    expect(headers).toContain('*Category');
    expect(headers).toContain('ShippingService-1:Option');
    expect(headers).toContain('*ReturnsAcceptedOption');
    expect(headers).not.toContain('Shipping service 1 option');
    expect(headers).not.toContain('Return shipping cost paid by');
  });

  it('should format category values as integer strings without decimals', () => {
    const rawCategory = "128035.0";
    const cleaned = rawCategory.match(/\d{3,}/)?.[0]?.replace(/\.0$/, '').trim() || "";
    expect(cleaned).toBe("128035");
  });

  it('should strip whitespace from category values', () => {
    const rawCategory = " 128035 ";
    const cleaned = rawCategory.match(/\d{3,}/)?.[0]?.replace(/\.0$/, '').trim() || "";
    expect(cleaned).toBe("128035");
  });

  it('should reject empty category values in pre-export validation', () => {
    const rows = [
      { category: "128035", lot_number: 1 },
      { category: "", lot_number: 2 },
      { category: null, lot_number: 3 },
    ];
    const missingCategoryLots = rows
      .filter(row => !(row.category || "").match(/\d{3,}/)?.[0])
      .map(r => r.lot_number);
    expect(missingCategoryLots).toEqual([2, 3]);
  });
});

describe('eBay CSV Full Output', () => {
  const testRows = [
    { lot_number: 1, title: "Vintage Bronze Sculpture", description: "A fine bronze piece", price: 49.99, category: "128035", condition: "Used" },
    { lot_number: 2, title: "Antique Silver Ring", description: "Sterling silver ring", price: 29.99, category: "67681", condition: "Pre-owned" },
  ];

  it('should produce valid CSV with the current info row, correct headers, and data rows', () => {
    const csv = generateTestCSV(testRows);
    const lines = csv.split("\r\n");

    // 1 info row + 1 header + 2 data rows
    expect(lines.length).toBe(4);

    expect(lines[0]).toBe('Info,Version=1.0.0,Template=fx_category_template_EBAY_US');

    // Header row – column index 2 must be "Category"
    const headerCols = lines[1].split(",");
    expect(headerCols[2]).toBe("*Category");
    expect(headerCols[22]).toBe("ShippingService-1:Option");
    expect(headerCols[27]).toBe("*ReturnsAcceptedOption");
  });

  it('should populate Category column with clean numeric IDs', () => {
    const csv = generateTestCSV(testRows);
    const lines = csv.split("\r\n");

    const row1Cols = lines[2].split('","').map(c => c.replace(/^"|"$/g, ''));
    expect(row1Cols[2]).toBe("128035");
    expect(row1Cols[2]).not.toContain(".");

    const row2Cols = lines[3].split('","').map(c => c.replace(/^"|"$/g, ''));
    expect(row2Cols[2]).toBe("67681");
  });

  it('should default shipping and return values to JSG standards', () => {
    const csv = generateTestCSV([
      { lot_number: 1, title: "Vintage Bronze Sculpture", description: "A fine bronze piece", price: 49.99, category: "128035", condition: "Used" },
    ]);
    const lines = csv.split("\r\n");
    const rowCols = lines[2].split('","').map(c => c.replace(/^"|"$/g, ''));

    expect(rowCols[21]).toBe("Flat");
    expect(rowCols[22]).toBe("USPSGroundAdvantage");
    expect(rowCols[23]).toBe("9.98");
    expect(rowCols[26]).toBe("1");
    expect(rowCols[27]).toBe("ReturnsAccepted");
    expect(rowCols[28]).toBe("Days_30");
    expect(rowCols[29]).toBe("MoneyBack");
    expect(rowCols[30]).toBe("Seller");
  });

  it('should blank return-specific fields when returns are not accepted', () => {
    const csv = generateTestCSV([
      { lot_number: 1, title: "Vintage Bronze Sculpture", description: "A fine bronze piece", price: 49.99, category: "128035", condition: "Used", returns_accepted: false },
    ]);
    const lines = csv.split("\r\n");
    const rowCols = lines[2].split('","').map(c => c.replace(/^"|"$/g, ''));

    expect(rowCols[27]).toBe("ReturnsNotAccepted");
    expect(rowCols[28]).toBe("");
    expect(rowCols[29]).toBe("");
    expect(rowCols[30]).toBe("");
  });

  it('should use CRLF line endings', () => {
    const csv = generateTestCSV(testRows);
    expect(csv).toContain("\r\n");
    // Should not have bare LF without CR
    const withoutCRLF = csv.replace(/\r\n/g, '');
    expect(withoutCRLF).not.toContain("\n");
  });

  it('should NOT include UTF-8 BOM', () => {
    const csv = generateTestCSV(testRows);
    expect(csv.charCodeAt(0)).not.toBe(0xFEFF);
  });

  it('should set Action to "Add" for every row', () => {
    const csv = generateTestCSV(testRows);
    const lines = csv.split("\r\n");
    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split('","').map(c => c.replace(/^"|"$/g, ''));
      expect(cols[0]).toBe("Add");
    }
  });
});
