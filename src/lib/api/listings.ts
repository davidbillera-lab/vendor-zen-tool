import { supabase } from "@/integrations/supabase/client";

// Helper to get current user ID
async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('User must be authenticated');
  }
  return user.id;
}

export type Platform = 'ebay' | 'facebook' | 'liveauctioneers' | 'denver';

export interface GeneratedListing {
  title: string;
  description: string;
  price?: number;
  category?: string;
  condition?: string;
  itemSpecifics?: Record<string, string>;
  // LiveAuctioneers specific
  lowEst?: number;
  highEst?: number;
  startPrice?: number;
  height?: number;
  width?: number;
  depth?: number;
  dimensionUnit?: 'in' | 'ft' | 'cm';
  weight?: number;
  weightUnit?: 'oz' | 'lb' | 'g' | 'kg';
  origin?: string;
  stylePeriod?: string;
  creator?: string;
  materials?: string;
  consigner?: string;
  locationNickname?: string;
  // Denver specific
  startingBid?: number;
}

export async function generateListing(
  platform: Platform,
  imageUrls: string[],
  additionalContext?: string
): Promise<GeneratedListing> {
  // Ensure user is authenticated before calling
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('User must be authenticated to generate listings');
  }

  const { data, error } = await supabase.functions.invoke('generate-listing', {
    body: { platform, imageUrls, additionalContext }
  });

  if (error) {
    throw new Error(error.message);
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return data.listing;
}

// Compress image before upload for faster processing
async function compressImage(file: File, maxWidth = 1200, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    img.onload = () => {
      // Calculate new dimensions
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        'image/jpeg',
        quality
      );
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

export async function uploadImage(file: File): Promise<string> {
  // Compress image for faster upload (only if it's an image)
  let uploadFile: File | Blob = file;
  if (file.type.startsWith('image/')) {
    try {
      uploadFile = await compressImage(file);
    } catch (e) {
      console.warn('Image compression failed, using original:', e);
    }
  }

  const fileExt = 'jpg'; // Always use jpg after compression
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
  const filePath = `listings/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('listing-images')
    .upload(filePath, uploadFile, {
      contentType: 'image/jpeg',
    });

  if (uploadError) {
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }

  const { data } = supabase.storage
    .from('listing-images')
    .getPublicUrl(filePath);

  return data.publicUrl;
}

export async function saveListing(listing: {
  platform: Platform;
  status: 'draft' | 'pending' | 'posted' | 'exported';
  title?: string;
  description?: string;
  price?: number;
  category?: string;
  condition?: string;
  item_specifics?: Record<string, string>;
  promotion_rate?: number;
  promotion_type?: 'flat' | 'fluctuating';
  image_urls?: string[];
  lot_number?: number;
  csv_row_data?: Record<string, any>;
  facebook_groups?: string[];
  project_id?: string;
}) {
  const userId = await getCurrentUserId();
  
  const { data, error } = await supabase
    .from('listings')
    .insert({ ...listing, user_id: userId })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save listing: ${error.message}`);
  }

  return data;
}

export async function getListings(platform?: Platform, status?: string) {
  let query = supabase.from('listings').select('*').order('created_at', { ascending: false });
  
  if (platform) {
    query = query.eq('platform', platform);
  }
  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch listings: ${error.message}`);
  }

  return data;
}

export async function updateListing(id: string, updates: Partial<{
  status: 'draft' | 'pending' | 'posted' | 'exported';
  title: string;
  description: string;
  price: number;
  category: string;
  condition: string;
  item_specifics: Record<string, string>;
  promotion_rate: number;
  promotion_type: 'flat' | 'fluctuating';
  lot_number: number;
}>) {
  const { data, error } = await supabase
    .from('listings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update listing: ${error.message}`);
  }

  return data;
}

export async function deleteListing(id: string) {
  const { error } = await supabase
    .from('listings')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete listing: ${error.message}`);
  }
}

// Generate eBay bulk CSV
export function generateEbayCSV(listings: any[]): string {
  const headers = [
    'Action(SiteID=US|Country=US|Currency=USD|Version=1193)',
    'Title',
    'Description',
    'StartPrice',
    'CategoryID',
    'ConditionID',
    'Format',
    'Duration',
    'PicURL'
  ];

  const rows = listings.map(l => [
    'Add',
    l.title || '',
    l.description || '',
    l.price || '',
    l.category || '',
    '', // ConditionID mapping would go here
    'FixedPrice',
    'GTC',
    (l.image_urls || []).join('|')
  ]);

  return [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\r\n');
}

// Generate LiveAuctioneers CSV - EXACT FORMAT REQUIRED with dynamic image columns
export function generateLiveAuctioneersCSV(listings: any[]): string {
  // Find maximum number of images across all listings
  const maxImages = Math.max(...listings.map(l => (l.image_urls || []).length), 4);
  
  // Build dynamic ImageFile columns
  const imageColumns = Array.from({ length: maxImages }, (_, i) => `ImageFile.${i + 1}`);
  
  // Official LiveAuctioneers column headers
  const headers = [
    'LotNum',
    'Title',
    'Description',
    'LowEst',
    'HighEst',
    'StartPrice',
    'Condition',
    'Consigner',
    ...imageColumns,
    'Buy Now Price',
    'Exclude From Buy Now',
    'Reserve Price',
    'Height',
    'Width',
    'Depth',
    'Dimension Unit',
    'Weight',
    'Weight Unit',
    'Domestic Flat Shipping Price',
    'Quantity',
    'Category',
    'Origin',
    'Style & Period',
    'Creator',
    'Materials & Techniques',
    'Lot Reference Number',
    'Location Nickname'
  ];

  const rows = listings.map(l => {
    const data = l.csv_row_data || {};
    const images = l.image_urls || [];
    const lotNum = l.lotNumber || l.lot_number || '';
    
    // Generate image filename entries for all columns
    const imageEntries = Array.from({ length: maxImages }, (_, i) => 
      images[i] ? `${lotNum}_${i + 1}` : ''
    );
    
    return [
      lotNum,
      (l.title || '').substring(0, 100), // Max 100 chars
      l.description || '',
      data.lowEst || '',
      data.highEst || '',
      data.startPrice || '',
      data.condition || '',
      data.consigner || 'JSG',
      ...imageEntries,
      '', // Buy Now Price
      '', // Exclude From Buy Now
      '', // Reserve Price
      data.height || '',
      data.width || '',
      data.depth || '',
      data.dimensionUnit || '',
      data.weight || '',
      data.weightUnit || '',
      '', // Domestic Flat Shipping Price
      '1', // Quantity
      data.category || '',
      data.origin || '',
      data.stylePeriod || '',
      data.creator || '',
      data.materials || '',
      '', // Lot Reference Number
      data.locationNickname || 'Highlands Ranch'
    ];
  });

  return [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\r\n');
}