// src/lib/crosspost/registry.test.ts
import { describe, it, expect } from 'vitest';
import { PLATFORM_ADAPTERS, getPlatform } from './registry';

describe('PLATFORM_ADAPTERS', () => {
  const EXPECTED_IDS = ['ebay', 'liveauctioneers', 'denver', 'mercari', 'poshmark', 'etsy'];

  it('contains all 6 platforms', () => {
    const ids = PLATFORM_ADAPTERS.map(p => p.id);
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id);
    }
    expect(PLATFORM_ADAPTERS).toHaveLength(6);
  });

  it('every adapter has required fields', () => {
    for (const adapter of PLATFORM_ADAPTERS) {
      expect(adapter.id, `${adapter.id} missing id`).toBeTruthy();
      expect(adapter.name, `${adapter.id} missing name`).toBeTruthy();
      expect(adapter.publishType, `${adapter.id} missing publishType`).toBeTruthy();
      expect(adapter.description, `${adapter.id} missing description`).toBeTruthy();
    }
  });

  it('Mercari, Poshmark, and Etsy have formatPrompt defined', () => {
    for (const id of ['mercari', 'poshmark', 'etsy']) {
      const adapter = PLATFORM_ADAPTERS.find(p => p.id === id)!;
      expect(adapter.formatPrompt, `${id} missing formatPrompt`).toBeTruthy();
    }
  });

  it('eBay, LA, Denver have formatPrompt defined for cross-posting', () => {
    for (const id of ['ebay', 'liveauctioneers', 'denver']) {
      const adapter = PLATFORM_ADAPTERS.find(p => p.id === id)!;
      expect(adapter.formatPrompt, `${id} missing formatPrompt`).toBeTruthy();
    }
  });
});

describe('getPlatform', () => {
  it('returns adapter by id', () => {
    const adapter = getPlatform('mercari');
    expect(adapter?.id).toBe('mercari');
  });

  it('returns undefined for unknown platform', () => {
    expect(getPlatform('unknown')).toBeUndefined();
  });
});
