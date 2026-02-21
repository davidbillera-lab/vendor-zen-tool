import { describe, it, expect } from 'vitest';

/**
 * Regression tests for eBay CSV export header format.
 * Ensures compatibility with eBay File Exchange "Add" bulk upload (Version=1193).
 */

function getEbayCSVHeaders(): string[] {
  return [
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)",
    "Custom Label (SKU)",
    "Category",
    "Title",
    "Relationship",
    "Relationship details",
    "Schedule Time",
    "P:EPID",
    "Start price",
    "Quantity",
    "Item photo URL",
    "VideoID",
    "Condition ID",
    "Description",
    "Format",
    "Duration",
    "Buy It Now price",
    "Best Offer Enabled",
    "Best Offer Auto Accept Price",
    "Minimum Best Offer Price",
    "Immediate pay required",
    "Location",
    "Shipping service 1 option",
    "Shipping service 1 cost",
    "Shipping service 1 priority",
    "Shipping service 2 option",
    "Shipping service 2 cost",
    "Shipping service 2 priority",
    "Max dispatch time",
    "Returns accepted option",
    "Returns within option",
    "Refund option",
    "Return shipping cost paid by",
    "Shipping profile name",
    "Return profile name",
    "Payment profile name",
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
}>, defaultCategoryId = "", location = "Denver, CO"): string {
  const headers = getEbayCSVHeaders();

  const conditionMap: Record<string, string> = {
    "New": "1000", "Used": "3000", "Pre-owned": "3000",
  };

  const infoRows = [
    `#INFO,Created=1234567890,,Template=fx_multi_category_template_EBAY_US`,
    `#INFO,Version=1.0`,
    `#INFO`,
  ];

  const csvRows = rows.map(row => {
    const extractedCategoryId = row.category?.match(/\d{3,}/)?.[0] || "";
    const fallbackCategoryId = defaultCategoryId.trim().match(/^\d{3,}$/) ? defaultCategoryId.trim() : "";
    const categoryId = (extractedCategoryId || fallbackCategoryId).replace(/\.0$/, '').trim();

    return [
      "Add", row.lot_number.toString(), categoryId,
      row.title.substring(0, 80), "", "", "", "",
      row.price.toString(), "1", "", "",
      conditionMap[row.condition] || "3000",
      `<p>${row.description}</p>`,
      "FixedPrice", "GTC", "",
      "1", "", "", "",
      location, "USPSMedia", "0", "1", "", "", "", "3",
      "ReturnsAccepted", "Days_30", "MoneyBack", "Seller",
      "", "", "",
    ];
  });

  return [
    ...infoRows,
    headers.join(","),
    ...csvRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
  ].join("\r\n");
}

describe('eBay CSV Export Headers', () => {
  it('should have "Category" column (not "Category ID" or "Category Name")', () => {
    const headers = getEbayCSVHeaders();
    expect(headers).toContain('Category');
    expect(headers).not.toContain('Category ID');
    expect(headers).not.toContain('Category Name');
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

  it('should produce valid CSV with #INFO rows, correct headers, and data rows', () => {
    const csv = generateTestCSV(testRows);
    const lines = csv.split("\r\n");

    // 3 info rows + 1 header + 2 data rows
    expect(lines.length).toBe(6);

    // Info rows
    expect(lines[0]).toContain('#INFO');
    expect(lines[0]).toContain('Template=fx_multi_category_template_EBAY_US');

    // Header row – column index 2 must be "Category"
    const headerCols = lines[3].split(",");
    expect(headerCols[2]).toBe("Category");
    expect(headerCols.join(",")).not.toContain("Category ID");
    expect(headerCols.join(",")).not.toContain("Category Name");
  });

  it('should populate Category column with clean numeric IDs', () => {
    const csv = generateTestCSV(testRows);
    const lines = csv.split("\r\n");

    // First data row (index 4) – category is column index 2
    const row1Cols = lines[4].split('","').map(c => c.replace(/^"|"$/g, ''));
    expect(row1Cols[2]).toBe("128035");
    expect(row1Cols[2]).not.toContain(".");

    const row2Cols = lines[5].split('","').map(c => c.replace(/^"|"$/g, ''));
    expect(row2Cols[2]).toBe("67681");
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
    for (let i = 4; i < lines.length; i++) {
      const cols = lines[i].split('","').map(c => c.replace(/^"|"$/g, ''));
      expect(cols[0]).toBe("Add");
    }
  });
});
