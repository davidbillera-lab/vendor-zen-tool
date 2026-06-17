// src/lib/crosspost/registry.ts
import { Store, Gavel, ShoppingBag, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PublishType = 'ebay-batch' | 'la-batch' | 'denver-batch' | 'queue' | 'etsy-api';

export interface PlatformAdapter {
  id: string;
  name: string;
  icon: LucideIcon;
  color: string;          // Tailwind text color class
  bgColor: string;        // Tailwind bg color class
  publishType: PublishType;
  description: string;
  formatPrompt: string;   // AI prompt for reformatting source listing into this platform's format
}

export const PLATFORM_ADAPTERS: PlatformAdapter[] = [
  {
    id: 'ebay',
    name: 'eBay',
    icon: Store,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    publishType: 'ebay-batch',
    description: 'Added to eBay batch — push from eBay tab',
    formatPrompt: `You are an expert eBay seller. Reformat this item listing for eBay.
STRICT RULES:
- title: EXACTLY 80 characters or fewer (count every character). Cassini keyword-optimized: Brand + Item Type + Key Attributes. No filler words.
- description: 150+ words. Structured: opening hook, specifications, condition report, what is included, shipping note.
- price: USD decimal based on sold comps.
- categoryId: eBay leaf category numeric ID (most specific possible, never a parent).
- category: human-readable name matching categoryId.
- condition: one of: "New", "Open box", "Used", "For parts or not working"
- itemSpecifics: key-value object. Always include Brand, Type, Material, Color. For clothing also include Department (Men/Women/Boys/Girls), Size, Size Type (Regular/Petite/Plus/Tall).
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "price": number, "categoryId": number, "category": string, "condition": string, "itemSpecifics": object }`,
  },
  {
    id: 'liveauctioneers',
    name: 'LiveAuctioneers',
    icon: Gavel,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    publishType: 'la-batch',
    description: 'Added to LA batch — export CSV from LA tab',
    formatPrompt: `You are an expert auction catalog writer for LiveAuctioneers.
STRICT RULES:
- title: max 100 characters. SEO keyword-rich: Maker + Item Type + Material + Era/Style. Count every character.
- description: 6-10+ sentences. Professional auction house style. Include: precise identification, physical details, historical context, expert observations, detailed condition report.
- lowEst: conservative auction estimate in USD (whole number).
- highEst: optimistic estimate, typically 2-4x lowEst (whole number).
- startPrice: always 5.
- condition: detailed condition paragraph.
- category: auction category string.
- consignor: always "JSG".
- locationNickname: always "Highlands Ranch".
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "lowEst": number, "highEst": number, "startPrice": 5, "condition": string, "category": string, "consignor": "JSG", "locationNickname": "Highlands Ranch" }`,
  },
  {
    id: 'denver',
    name: 'Denver Auctions',
    icon: Gavel,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    publishType: 'denver-batch',
    description: 'Queued for DOA agent',
    formatPrompt: `You are an expert auction catalog writer for Denver Online Auctions.
STRICT RULES:
- title: max 100 characters. SEO + GEO optimized for Colorado market. Brand/Maker + Item Type + Material + Era. No filler words.
- description: 5-8+ sentences. Professional catalog style. Include: precise ID, physical details, historical context, expert observations, detailed condition report.
- startingBid: conservative whole number USD ($5-$25 generates most bidding activity).
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "startingBid": number }`,
  },
  {
    id: 'mercari',
    name: 'Mercari',
    icon: ShoppingBag,
    color: 'text-red-400',
    bgColor: 'bg-red-400/10',
    publishType: 'queue',
    description: 'Queued for Mercari agent',
    formatPrompt: `You are an expert Mercari seller. Reformat this item listing for Mercari.
STRICT RULES:
- title: max 40 characters. Descriptive and clear. No punctuation at end. Count every character.
- description: casual and friendly tone, 2-4 sentences. Mention condition, what is included, any flaws.
- price: USD whole number. Mercari takes 10% fee — price slightly above target net.
- category: Mercari category name (e.g., "Men's Tops", "Home Decor", "Electronics & Accessories").
- condition: one of exactly: "New", "Like New", "Good", "Fair", "Poor"
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "price": number, "category": string, "condition": string }`,
  },
  {
    id: 'poshmark',
    name: 'Poshmark',
    icon: Tag,
    color: 'text-pink-500',
    bgColor: 'bg-pink-500/10',
    publishType: 'queue',
    description: 'Queued for Poshmark agent',
    formatPrompt: `You are an expert Poshmark seller. Reformat this item listing for Poshmark.
STRICT RULES:
- title: max 80 characters. Brand name first (if known). Include key item details and condition signal.
- description: style-forward and engaging tone. Include brand, size, material, measurements if available, condition details, any flaws. Mention "bundle discounts available."
- price: USD whole number. Poshmark buyers pay premium — price 10-20% above Mercari equivalents.
- brand: extract from item details, use "No Brand" if unknown.
- size: clothing size (XS/S/M/L/XL/XXL/etc.) or "OS" for one-size non-clothing items.
- category: Poshmark category (e.g., "Women's Tops", "Men's Jackets", "Home & Living", "Electronics").
- condition: one of: "NWT" (New With Tags), "NWOT" (New Without Tags), "Excellent", "Good", "Fair", "Poor"
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "price": number, "brand": string, "size": string, "category": string, "condition": string }`,
  },
  {
    id: 'etsy',
    name: 'Etsy',
    icon: Tag,
    color: 'text-orange-400',
    bgColor: 'bg-orange-400/10',
    publishType: 'etsy-api',
    description: 'Published via Etsy API',
    formatPrompt: `You are an expert Etsy seller specializing in vintage, handmade, and unique items. Reformat this item listing for Etsy.
STRICT RULES:
- title: max 140 characters. SEO keyword-rich. Include material, style, era (e.g., "Vintage 1970s", "Mid Century"), and exact search terms buyers use.
- description: detailed and keyword-rich, minimum 100 words. Cover: what it is, dimensions, materials, era/style, condition report, what is included, care instructions if relevant. Write naturally for both buyers and Etsy search.
- price: USD decimal (e.g., 45.00). Etsy buyers expect premium pricing for unique items.
- tags: EXACTLY 13 tags as a JSON array. Single words or short phrases (max 20 chars each). Focus on searchable terms, materials, styles, eras. No # symbol, no commas within a tag.
- category: Etsy category path (e.g., "Vintage > Clothing > Women's Clothing > Tops & Blouses").
- quantity: 1
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "price": number, "tags": string[], "category": string, "quantity": 1 }`,
  },
];

export function getPlatform(id: string): PlatformAdapter | undefined {
  return PLATFORM_ADAPTERS.find(p => p.id === id);
}
