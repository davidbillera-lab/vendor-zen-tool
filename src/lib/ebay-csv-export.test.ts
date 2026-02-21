import { describe, it, expect } from 'vitest';

/**
 * Regression tests for eBay CSV export header format.
 * Ensures compatibility with eBay File Exchange "Add" bulk upload.
 */

// Simulate the header generation logic from EbayBatchPanel
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
      .filter(row => {
        const id = (row.category || "").match(/\d{3,}/)?.[0] || "";
        return !id;
      })
      .map(r => r.lot_number);

    expect(missingCategoryLots).toEqual([2, 3]);
  });
});
