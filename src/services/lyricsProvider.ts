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
import { rankLyricsResults } from '../utils/lyricsMatchScore';

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
const SEARCH_TIMEOUT_MS = 25000;
const EXACT_SEARCH_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);

    promise
      .then((result) => resolve(result))
      .catch((err) => reject(err))
      .finally(() => window.clearTimeout(timeoutId));
  });
}

export function registerLyricsProvider(provider: LyricsProvider) {
  registeredProviders.push(provider);
}

export async function searchAllLyrics(query: string): Promise<LyricsProviderResult[]> {
  const results: LyricsProviderResult[] = [];
  const errors: Error[] = [];
  
  // Выполняем запросы параллельно ко всем провайдерам
  const searchPromises = registeredProviders.map(async (provider) => {
    try {
      const providerResults = await withTimeout(provider.search(query), SEARCH_TIMEOUT_MS, provider.name);
      results.push(...providerResults);
    } catch (err: any) {
      console.warn(`Lyrics provider "${provider.name}" failed:`, err);
      errors.push(err);
    }
  });
  
  await Promise.all(searchPromises);
  
  return results;
}

async function getBroadLyricsFallback(params: {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
}): Promise<LyricsProviderResult | null> {
  const query = `${params.artistName} ${params.trackName}`.trim();
  if (!query) return null;

  try {
    const results = await searchAllLyrics(query);
    if (results.length === 0) return null;

    const ranked = rankLyricsResults(results, {
      trackName: params.trackName,
      artistName: params.artistName,
      albumName: params.albumName,
      duration: params.duration,
    });

    return ranked[0]?.result || null;
  } catch (err) {
    console.warn('Broad lyrics fallback failed:', err);
    return null;
  }
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
  const exactProviders = registeredProviders.filter((provider) => provider.getExact);

  const exactResults = (await Promise.all(exactProviders.map(async (provider) => {
    try {
      return await withTimeout(provider.getExact!(params), EXACT_SEARCH_TIMEOUT_MS, provider.name);
    } catch (err) {
      console.warn(`Exact match search in provider "${provider.name}" failed:`, err);
      return null;
    }
  }))).filter((result): result is LyricsProviderResult => result !== null);

  if (exactResults.length > 0) {
    return rankLyricsResults(exactResults, {
      trackName: params.trackName,
      artistName: params.artistName,
      albumName: params.albumName,
      duration: params.duration,
    })[0]?.result || null;
  }
  return getBroadLyricsFallback(params);
}
