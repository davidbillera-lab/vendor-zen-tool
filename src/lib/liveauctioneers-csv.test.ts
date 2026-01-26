import { describe, it, expect } from 'vitest';
import {
  normalizeImageFilename,
  generateImageFilename,
  normalizeAndValidateBatch,
  generateLiveAuctioneersCSV,
  type LABatchRow,
} from './liveauctioneers-csv';

describe('normalizeImageFilename', () => {
  it('returns empty string for null/undefined/blank values', () => {
    expect(normalizeImageFilename(null, 1, 0)).toBe('');
    expect(normalizeImageFilename(undefined, 1, 0)).toBe('');
    expect(normalizeImageFilename('', 1, 0)).toBe('');
    expect(normalizeImageFilename('   ', 1, 0)).toBe('');
  });

  it('keeps URLs with image extensions as-is', () => {
    const url = 'https://example.com/image.jpg';
    expect(normalizeImageFilename(url, 1, 0)).toBe(url);
    
    const pngUrl = 'https://cdn.site.com/photo.png';
    expect(normalizeImageFilename(pngUrl, 2, 1)).toBe(pngUrl);
  });

  it('keeps values with image extensions as-is', () => {
    expect(normalizeImageFilename('photo.jpg', 1, 0)).toBe('photo.jpg');
    expect(normalizeImageFilename('image.PNG', 1, 0)).toBe('image.PNG');
  });

  it('converts "{lot}_{n}" pattern to "{lot}_{n:02d}.jpg"', () => {
    expect(normalizeImageFilename('1_1', 1, 0)).toBe('1_01.jpg');
    expect(normalizeImageFilename('12_3', 12, 2)).toBe('12_03.jpg');
    expect(normalizeImageFilename('99_11', 99, 10)).toBe('99_11.jpg');
  });

  it('converts "{lot}-{n}" pattern to "{lot}_{n:02d}.jpg"', () => {
    expect(normalizeImageFilename('1-2', 1, 1)).toBe('1_02.jpg');
    expect(normalizeImageFilename('15-7', 15, 6)).toBe('15_07.jpg');
  });

  it('converts digit-only values to "{digit}_01.jpg"', () => {
    expect(normalizeImageFilename('7', 7, 0)).toBe('7_01.jpg');
    expect(normalizeImageFilename('12', 12, 0)).toBe('12_01.jpg');
    expect(normalizeImageFilename('123', 123, 0)).toBe('123_01.jpg');
  });

  it('appends ".jpg" to other values', () => {
    expect(normalizeImageFilename('myimage', 1, 0)).toBe('myimage.jpg');
    expect(normalizeImageFilename('lot5_photo', 5, 0)).toBe('lot5_photo.jpg');
  });
});

describe('generateImageFilename', () => {
  it('generates correct filenames with 2-digit padding', () => {
    expect(generateImageFilename(1, 0)).toBe('1_01.jpg');
    expect(generateImageFilename(1, 1)).toBe('1_02.jpg');
    expect(generateImageFilename(12, 0)).toBe('12_01.jpg');
    expect(generateImageFilename(12, 9)).toBe('12_10.jpg');
    expect(generateImageFilename('45', 4)).toBe('45_05.jpg');
  });
});

describe('normalizeAndValidateBatch', () => {
  it('validates required LotNum field', () => {
    const rows: LABatchRow[] = [
      { id: '1', lot_number: 0, title: 'Test' }, // 0 is falsy but valid
      { id: '2', lot_number: undefined as any, title: 'Test' },
    ];
    
    const { issues } = normalizeAndValidateBatch(rows);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.column === 'LotNum')).toBe(true);
  });

  it('detects duplicate LotNum values', () => {
    const rows: LABatchRow[] = [
      { id: '1', lot_number: 5, title: 'First' },
      { id: '2', lot_number: 5, title: 'Duplicate' },
    ];
    
    const { issues } = normalizeAndValidateBatch(rows);
    expect(issues.some(i => i.message.includes('Duplicate'))).toBe(true);
  });

  it('truncates titles longer than 100 characters', () => {
    const longTitle = 'A'.repeat(150);
    const rows: LABatchRow[] = [
      { id: '1', lot_number: 1, title: longTitle },
    ];
    
    const { normalizedRows } = normalizeAndValidateBatch(rows);
    expect(normalizedRows[0].Title.length).toBe(100);
  });

  it('trims whitespace from titles', () => {
    const rows: LABatchRow[] = [
      { id: '1', lot_number: 1, title: '  Trimmed Title  ' },
    ];
    
    const { normalizedRows } = normalizeAndValidateBatch(rows);
    expect(normalizedRows[0].Title).toBe('Trimmed Title');
  });

  it('replaces null/NaN with empty strings in text fields', () => {
    const rows: LABatchRow[] = [
      { id: '1', lot_number: 1, title: 'Test', description: null, condition: undefined },
    ];
    
    const { normalizedRows } = normalizeAndValidateBatch(rows);
    expect(normalizedRows[0].Description).toBe('');
    expect(normalizedRows[0].Condition).toBe('');
  });

  it('validates LowEst < HighEst', () => {
    const rows: LABatchRow[] = [
      { id: '1', lot_number: 1, title: 'Test', low_est: 200, high_est: 100 },
    ];
    
    const { issues } = normalizeAndValidateBatch(rows);
    expect(issues.some(i => i.column === 'LowEst/HighEst')).toBe(true);
  });

  it('validates StartPrice <= LowEst', () => {
    const rows: LABatchRow[] = [
      { id: '1', lot_number: 1, title: 'Test', low_est: 50, high_est: 100, start_price: 75 },
    ];
    
    const { issues } = normalizeAndValidateBatch(rows);
    expect(issues.some(i => i.column === 'StartPrice')).toBe(true);
  });

  it('generates image filenames for available images', () => {
    const rows: LABatchRow[] = [
      { 
        id: '1', 
        lot_number: 5, 
        title: 'Test',
        image_urls: ['http://img1.jpg', 'http://img2.jpg', 'http://img3.jpg'],
      },
    ];
    
    const { normalizedRows } = normalizeAndValidateBatch(rows);
    expect(normalizedRows[0].images[0]).toBe('5_01.jpg');
    expect(normalizedRows[0].images[1]).toBe('5_02.jpg');
    expect(normalizedRows[0].images[2]).toBe('5_03.jpg');
    expect(normalizedRows[0].images[3]).toBe(''); // No 4th image
  });

  it('limits images to 10 columns', () => {
    const rows: LABatchRow[] = [
      { 
        id: '1', 
        lot_number: 1, 
        title: 'Test',
        image_urls: Array(15).fill('http://img.jpg'),
      },
    ];
    
    const { normalizedRows } = normalizeAndValidateBatch(rows);
    expect(normalizedRows[0].images.length).toBe(10);
  });
});

describe('generateLiveAuctioneersCSV', () => {
  it('generates CSV with correct header order', () => {
    const normalizedRows = [
      {
        LotNum: '1',
        Title: 'Test Item',
        Description: 'A test',
        LowEst: '50',
        HighEst: '100',
        StartPrice: '5',
        Condition: 'Good',
        Consigner: 'JSG',
        images: ['1_01.jpg', '1_02.jpg', '', '', '', '', '', '', '', ''],
      },
    ];
    
    const csv = generateLiveAuctioneersCSV(normalizedRows);
    const lines = csv.split('\r\n');
    
    // Check header
    expect(lines[0]).toContain('LotNum');
    expect(lines[0]).toContain('Title');
    expect(lines[0]).toContain('ImageFile.1');
    expect(lines[0]).toContain('ImageFile.10');
    expect(lines[0]).not.toContain('ImageFile.11');
    
    // Check data row
    expect(lines[1]).toContain('"1"');
    expect(lines[1]).toContain('"Test Item"');
  });

  it('properly escapes quotes in cell values', () => {
    const normalizedRows = [
      {
        LotNum: '1',
        Title: 'Item with "quotes"',
        Description: 'Test',
        LowEst: '50',
        HighEst: '100',
        StartPrice: '5',
        Condition: '',
        Consigner: 'JSG',
        images: Array(10).fill(''),
      },
    ];
    
    const csv = generateLiveAuctioneersCSV(normalizedRows);
    expect(csv).toContain('""quotes""');
  });

  it('replaces NaN-like values with empty strings', () => {
    const normalizedRows = [
      {
        LotNum: '1',
        Title: 'Test',
        Description: 'NaN',
        LowEst: '',
        HighEst: '',
        StartPrice: '5',
        Condition: 'null',
        Consigner: 'JSG',
        images: Array(10).fill(''),
      },
    ];
    
    const csv = generateLiveAuctioneersCSV(normalizedRows);
    // NaN and null should be converted to empty quoted strings
    expect(csv).not.toContain('"NaN"');
    expect(csv).not.toContain('"null"');
  });

  it('uses CRLF line endings', () => {
    const normalizedRows = [
      {
        LotNum: '1',
        Title: 'Test',
        Description: '',
        LowEst: '',
        HighEst: '',
        StartPrice: '5',
        Condition: '',
        Consigner: 'JSG',
        images: Array(10).fill(''),
      },
    ];
    
    const csv = generateLiveAuctioneersCSV(normalizedRows);
    expect(csv).toContain('\r\n');
  });
});
