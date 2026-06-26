export interface LyricsProviderResult {
  id: string | number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  provider: 'lrclib' | 'custom' | 'supabase';
  lines?: import('../types').LyricLine[];
  videoStyle?: any;
  audioStoragePath?: string | null;
  coverStoragePath?: string | null;
}

import { lrclibProviderInstance } from './lrclibService';
import { supabaseLyricsProviderInstance } from './supabaseLyricsService';

export interface LyricsProvider {
  name: string;
  search(query: string): Promise<LyricsProviderResult[]>;
  getExact?(params: {
    trackName: string;
    artistName: string;
    albumName?: string;
    duration?: number;
  }): Promise<LyricsProviderResult | null>;
}

const registeredProviders: LyricsProvider[] = [supabaseLyricsProviderInstance, lrclibProviderInstance];

export function registerLyricsProvider(provider: LyricsProvider) {
  registeredProviders.push(provider);
}

export async function searchAllLyrics(query: string): Promise<LyricsProviderResult[]> {
  const results: LyricsProviderResult[] = [];
  const errors: Error[] = [];
  
  // Выполняем запросы параллельно ко всем провайдерам
  const searchPromises = registeredProviders.map(async (provider) => {
    try {
      const providerResults = await provider.search(query);
      results.push(...providerResults);
    } catch (err: any) {
      console.warn(`Lyrics provider "${provider.name}" failed:`, err);
      errors.push(err);
    }
  });
  
  await Promise.all(searchPromises);
  
  if (results.length === 0 && errors.length > 0) {
    throw errors[0];
  }
  
  return results;
}

/**
 * Ищет точное совпадение по метаданным (например, для автопоиска при загрузке)
 */
export async function getExactAllLyrics(params: {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
}): Promise<LyricsProviderResult | null> {
  for (const provider of registeredProviders) {
    if (provider.getExact) {
      try {
        const result = await provider.getExact(params);
        if (result) return result;
      } catch (err) {
        console.warn(`Exact match search in provider "${provider.name}" failed:`, err);
      }
    }
  }
  return null;
}
