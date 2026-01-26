/**
 * LiveAuctioneers CSV Export Utilities
 * 
 * Generates CSV files matching the exact LiveAuctioneers upload format.
 * Includes validation, normalization, and error reporting.
 */

export interface LABatchRow {
  id: string;
  lot_number: number;
  title: string;
  description?: string | null;
  low_est?: number | null;
  high_est?: number | null;
  start_price?: number | null;
  condition?: string | null;
  consignor?: string | null;
  image_urls?: string[] | null;
}

export interface ValidationIssue {
  row: number;
  lotNum: string | number;
  column: string;
  message: string;
}

export interface NormalizedRow {
  LotNum: string;
  Title: string;
  Description: string;
  LowEst: string;
  HighEst: string;
  StartPrice: string;
  Condition: string;
  Consigner: string;
  images: string[]; // Will be spread into ImageFile.1 through ImageFile.10
}

// Fixed column count for images (do not include ImageFile.11+)
const MAX_IMAGE_COLUMNS = 10;

/**
 * Normalizes an image filename/URL to the expected format.
 * 
 * Rules:
 * - Blank/null -> empty string
 * - URL with image extension -> keep as-is
 * - Already has image extension -> keep as-is
 * - Pattern like \"12_3\" or \"12-3\" -> \"12_03.jpg\"
 * - Only digits like \"12\" -> \"12_01.jpg\"
 * - Otherwise -> append \".jpg\"
 */
export function normalizeImageFilename(value: string | null | undefined, lotNum: number | string, imageIndex: number): string {
  // Blank/null -> empty
  if (!value || value.trim() === '') {
    return '';
  }

  const trimmed = value.trim();

  // Check if it's a URL with an image extension
  if (/^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)$/i.test(trimmed)) {
    return trimmed;
  }

  // Check if already has an image extension
  if (/\.(jpg|jpeg|png|webp|gif)$/i.test(trimmed)) {
    return trimmed;
  }

  // Pattern like \"{lot}_{n}\" or \"{lot}-{n}\" (e.g., 12_3 or 12-3)
  const lotImagePattern = /^(\d+)[_-](\d+)$/;
  const match = trimmed.match(lotImagePattern);
  if (match) {
    const lot = match[1];
    const n = parseInt(match[2], 10);
    return `${lot}_${n.toString().padStart(2, '0')}.jpg`;
  }

  // Only digits (e.g., \"12\") -> \"12_01.jpg\"
  if (/^\d+$/.test(trimmed)) {
    return `${trimmed}_01.jpg`;
  }

  // Otherwise, append \".jpg\"
  return `${trimmed}.jpg`;
}

/**
 * Generates the expected image filename for a lot.
 * Format: {lotNum}_{imageIndex:02d}.jpg (e.g., 12_01.jpg, 12_02.jpg)
 */
export function generateImageFilename(lotNum: number | string, imageIndex: number): string {
  // imageIndex is 0-based, so add 1 for 1-based naming
  const paddedIndex = (imageIndex + 1).toString().padStart(2, '0');
  return `${lotNum}_${paddedIndex}.jpg`;
}

/**
 * Validates and normalizes a batch of LA rows.
 * Returns normalized rows and any validation issues found.
 */
export function normalizeAndValidateBatch(rows: LABatchRow[]): {
  normalizedRows: NormalizedRow[];
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const normalizedRows: NormalizedRow[] = [];
  const seenLotNums = new Set<string>();

  rows.forEach((row, index) => {
    const rowNum = index + 1; // 1-based row number for error reporting
    const lotNum = row.lot_number?.toString() ?? '';

    // Validate LotNum
    if (!lotNum || lotNum.trim() === '') {
      issues.push({
        row: rowNum,
        lotNum: lotNum || '(empty)',
        column: 'LotNum',
        message: 'LotNum is required and cannot be empty',
      });
    } else if (seenLotNums.has(lotNum)) {
      issues.push({
        row: rowNum,
        lotNum,
        column: 'LotNum',
        message: `Duplicate LotNum: ${lotNum} already exists`,
      });
    } else {
      seenLotNums.add(lotNum);
    }

    // Normalize and validate Title
    let title = (row.title || '').trim();
    if (title.length > 100) {
      title = title.substring(0, 100);
    }

    // Normalize Description and Condition (replace null/NaN with empty string)
    const description = normalizeString(row.description);
    const condition = normalizeString(row.condition);
    const consigner = normalizeString(row.consignor) || 'JSG';

    // Validate and normalize estimates
    const lowEst = normalizeInteger(row.low_est);
    const highEst = normalizeInteger(row.high_est);
    const startPrice = normalizeInteger(row.start_price) || '5';

    // Validate: LowEst < HighEst
    if (lowEst && highEst) {
      const lowVal = parseInt(lowEst, 10);
      const highVal = parseInt(highEst, 10);
      if (lowVal >= highVal) {
        issues.push({
          row: rowNum,
          lotNum,
          column: 'LowEst/HighEst',
          message: `LowEst (${lowVal}) must be < HighEst (${highVal})`,
        });
      }
    }

    // Validate: StartPrice <= LowEst
    if (startPrice && lowEst) {
      const startVal = parseInt(startPrice, 10);
      const lowVal = parseInt(lowEst, 10);
      if (startVal > lowVal) {
        issues.push({
          row: rowNum,
          lotNum,
          column: 'StartPrice',
          message: `StartPrice (${startVal}) must be <= LowEst (${lowVal})`,
        });
      }
    }

    // Normalize image filenames (generate expected filenames from URLs)
    const imageUrls = row.image_urls || [];
    const images: string[] = [];
    
    for (let i = 0; i < MAX_IMAGE_COLUMNS; i++) {
      if (i < imageUrls.length && imageUrls[i]) {
        // Generate the expected filename for this image
        images.push(generateImageFilename(lotNum, i));
      } else {
        images.push('');
      }
    }

    normalizedRows.push({
      LotNum: lotNum,
      Title: title,
      Description: description,
      LowEst: lowEst,
      HighEst: highEst,
      StartPrice: startPrice,
      Condition: condition,
      Consigner: consigner,
      images,
    });
  });

  return { normalizedRows, issues };
}

/**
 * Normalizes a string value, replacing null/undefined/NaN with empty string.
 */
function normalizeString(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value).trim();
  if (str === 'NaN' || str === 'null' || str === 'undefined') {
    return '';
  }
  return str;
}

/**
 * Normalizes a numeric value to an integer string.
 * Returns empty string for null/undefined/NaN.
 */
function normalizeInteger(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) {
    return '';
  }
  return Math.round(num).toString();
}

/**
 * Generates the CSV content for LiveAuctioneers upload.
 * 
 * Column order (exact):
 * LotNum, Title, Description, LowEst, HighEst, StartPrice, Condition, Consigner,
 * ImageFile.1, ImageFile.2, ImageFile.3, ImageFile.4, ImageFile.5,
 * ImageFile.6, ImageFile.7, ImageFile.8, ImageFile.9, ImageFile.10
 */
export function generateLiveAuctioneersCSV(normalizedRows: NormalizedRow[]): string {
  // Fixed headers - exact order required
  const headers = [
    'LotNum',
    'Title',
    'Description',
    'LowEst',
    'HighEst',
    'StartPrice',
    'Condition',
    'Consigner',
    'ImageFile.1',
    'ImageFile.2',
    'ImageFile.3',
    'ImageFile.4',
    'ImageFile.5',
    'ImageFile.6',
    'ImageFile.7',
    'ImageFile.8',
    'ImageFile.9',
    'ImageFile.10',
  ];

  const csvRows: string[][] = [headers];

  for (const row of normalizedRows) {
    const csvRow = [
      row.LotNum,
      row.Title,
      row.Description,
      row.LowEst,
      row.HighEst,
      row.StartPrice,
      row.Condition,
      row.Consigner,
      ...row.images.slice(0, MAX_IMAGE_COLUMNS),
    ];
    csvRows.push(csvRow);
  }

  // Convert to CSV string with proper escaping
  const csvContent = csvRows
    .map(row => row.map(cell => escapeCSVCell(cell)).join(','))
    .join('\r\n'); // CRLF for compatibility

  return csvContent;
}

/**
 * Escapes a cell value for CSV format.
 * Wraps in quotes and escapes internal quotes.
 */
function escapeCSVCell(value: string): string {
  // Replace any NaN-like values with empty string
  if (value === 'NaN' || value === 'null' || value === 'undefined') {
    value = '';
  }
  // Always wrap in quotes and escape internal quotes
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Creates a downloadable CSV file with UTF-8 BOM.
 */
export function downloadCSV(csvContent: string, filename: string = 'liveauctioneers_upload.csv'): void {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Formats validation issues for display.
 */
export function formatValidationErrors(issues: ValidationIssue[]): string {
  return issues
    .map(issue => `Row ${issue.row} (LotNum ${issue.lotNum}): ${issue.column} - ${issue.message}`)
    .join('\n');
}
