// src/lib/crosspost/api.test.ts
import { describe, it, expect } from 'vitest';
import { buildEbayBatchRow, buildLaBatchRow, buildDenverBatchRow } from './api';

describe('buildEbayBatchRow', () => {
  it('maps formatted_data fields to ebay_batch_rows schema', () => {
    const data = {
      title: 'Test Item',
      description: 'A description',
      price: 45,
      category: "Men's Casual Shirts",
      condition: 'Used',
      itemSpecifics: { Brand: 'Nike', Color: 'Blue' },
    };
    const result = buildEbayBatchRow(data, ['https://img.jpg'], 'batch-id-123', 1);
    expect(result.title).toBe('Test Item');
    expect(result.price).toBe(45);
    expect(result.category).toBe("Men's Casual Shirts");
    expect(result.item_specifics).toEqual({ Brand: 'Nike', Color: 'Blue' });
    expect(result.batch_id).toBe('batch-id-123');
    expect(result.lot_number).toBe(1);
    expect(result.image_urls).toEqual(['https://img.jpg']);
    expect(result.status).toBe('pending');
  });
});

describe('buildLaBatchRow', () => {
  it('maps formatted_data fields to la_batch_rows schema', () => {
    const data = {
      title: 'Vintage Vase',
      description: 'Fine piece',
      lowEst: 50,
      highEst: 150,
      startPrice: 5,
      condition: 'Very good',
      consignor: 'JSG',
      category: 'Ceramics',
    };
    const result = buildLaBatchRow(data, ['https://img.jpg'], 'batch-123', 5);
    expect(result.low_est).toBe(50);
    expect(result.high_est).toBe(150);
    expect(result.start_price).toBe(5);
    expect(result.consignor).toBe('JSG');
    expect(result.lot_number).toBe(5);
  });
});

describe('buildDenverBatchRow', () => {
  it('maps formatted_data fields to denver_batch_rows schema', () => {
    const data = { title: 'Antique Clock', description: 'Beautiful piece', startingBid: 15 };
    const result = buildDenverBatchRow(data, ['https://img.jpg'], 'batch-123', 3);
    expect(result.title).toBe('Antique Clock');
    expect(result.starting_bid).toBe(15);
    expect(result.lot_number).toBe(3);
  });
});
