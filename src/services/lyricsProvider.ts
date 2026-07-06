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

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreLyricsResult(result: LyricsProviderResult, params: {
  trackName: string;
  artistName: string;
}): number {
  const targetTitle = normalizeForMatch(params.trackName);
  const targetArtist = normalizeForMatch(params.artistName);
  const resultTitle = normalizeForMatch(result.trackName);
  const resultArtist = normalizeForMatch(result.artistName);

  let score = 0;
  if (resultTitle === targetTitle) score += 60;
  else if (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)) score += 35;

  if (resultArtist === targetArtist) score += 40;
  else if (resultArtist.includes(targetArtist) || targetArtist.includes(resultArtist)) score += 20;

  if (result.syncedLyrics) score += 10;
  return score;
}

async function getBroadLyricsFallback(params: {
  trackName: string;
  artistName: string;
}): Promise<LyricsProviderResult | null> {
  const query = `${params.artistName} ${params.trackName}`.trim();
  if (!query) return null;

  try {
    const results = await searchAllLyrics(query);
    if (results.length === 0) return null;

    const ranked = [...results]
      .map((result) => ({ result, score: scoreLyricsResult(result, params) }))
      .sort((a, b) => b.score - a.score);

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

  const exactResult = await new Promise<LyricsProviderResult | null>((resolve) => {
    if (exactProviders.length === 0) {
      resolve(null);
      return;
    }

    let pending = exactProviders.length;
    let settled = false;

    exactProviders.forEach((provider) => {
      try {
        withTimeout(provider.getExact!(params), EXACT_SEARCH_TIMEOUT_MS, provider.name)
          .then((result) => {
            if (settled) return;
            if (result) {
              settled = true;
              resolve(result);
              return;
            }

            pending -= 1;
            if (pending === 0) {
              settled = true;
              resolve(null);
            }
          })
          .catch((err) => {
            console.warn(`Exact match search in provider "${provider.name}" failed:`, err);
            if (settled) return;
            pending -= 1;
            if (pending === 0) {
              settled = true;
              resolve(null);
            }
          });
      } catch (err) {
        console.warn(`Exact match search in provider "${provider.name}" failed:`, err);
        pending -= 1;
        if (!settled && pending === 0) {
          settled = true;
          resolve(null);
        }
      }
    });
  });

  if (exactResult) return exactResult;
  return getBroadLyricsFallback(params);
}
