import { supabase } from "@/integrations/supabase/client";

export type Platform = 'ebay' | 'facebook' | 'liveauctioneers' | 'denver';

export interface GeneratedListing {
  title: string;
  description: string;
  price?: number;
  category?: string;
  condition?: string;
  itemSpecifics?: Record<string, string>;
  estimateLow?: number;
  estimateHigh?: number;
}

export async function generateListing(
  platform: Platform,
  imageUrls: string[],
  additionalContext?: string
): Promise<GeneratedListing> {
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

export async function uploadImage(file: File): Promise<string> {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
  const filePath = `listings/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('listing-images')
    .upload(filePath, file);

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
}) {
  const { data, error } = await supabase
    .from('listings')
    .insert(listing)
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

  return [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
}

// Generate LiveAuctioneers CSV
export function generateLiveAuctioneersCSV(listings: any[]): string {
  const headers = [
    'Lot Number',
    'Title',
    'Description',
    'Category',
    'Low Estimate',
    'High Estimate',
    'Image URL'
  ];

  const rows = listings.map((l, index) => [
    l.lot_number || index + 1,
    l.title || '',
    l.description || '',
    l.category || '',
    l.csv_row_data?.estimateLow || '',
    l.csv_row_data?.estimateHigh || '',
    (l.image_urls || [])[0] || ''
  ]);

  return [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
}