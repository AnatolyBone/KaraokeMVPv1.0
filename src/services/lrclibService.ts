import { LyricsProvider, LyricsProviderResult } from './lyricsProvider';

interface LrcLibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

class LRCLibProvider implements LyricsProvider {
  name = 'lrclib';

  async search(query: string): Promise<LyricsProviderResult[]> {
    const isDev = !!(import.meta as any).env?.DEV;
    const baseUrl = isDev ? '/api/lrclib/api' : 'https://lrclib.net/api';
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
    
    let response: Response;
    try {
      // Сначала пробуем основной URL (прямой или через Vite proxy)
      response = await fetchWithTimeout(url, 45000);
      if (!response.ok) {
        throw new Error(`Direct/Proxy LRCLIB HTTP error: ${response.status}`);
      }
    } catch (err) {
      console.warn('Primary search request failed, attempting backup CORS proxy...', err);
      try {
        const targetUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        response = await fetchWithTimeout(proxyUrl, 45000);
        if (!response.ok) {
          throw new Error(`Backup Proxy LRCLIB HTTP error: ${response.status}`);
        }
      } catch (proxyErr) {
        console.error('All search options failed:', proxyErr);
        throw proxyErr;
      }
    }

    try {
      const tracks: LrcLibTrack[] = await response.json();
      return tracks.map((track) => ({
        id: track.id,
        trackName: track.trackName,
        artistName: track.artistName,
        albumName: track.albumName,
        duration: track.duration,
        plainLyrics: track.plainLyrics,
        syncedLyrics: track.syncedLyrics,
        provider: 'lrclib',
      }));
    } catch (err) {
      console.error('Failed to parse search JSON response:', err);
      throw err;
    }
  }

  async getExact(params: {
    trackName: string;
    artistName: string;
    albumName?: string;
    duration?: number;
  }): Promise<LyricsProviderResult | null> {
    const isDev = !!(import.meta as any).env?.DEV;
    const baseUrl = isDev ? `${window.location.origin}/api/lrclib/api` : 'https://lrclib.net/api';
    
    const url = new URL(`${baseUrl}/get`);
    url.searchParams.append('track_name', params.trackName);
    url.searchParams.append('artist_name', params.artistName);
    if (params.albumName) {
      url.searchParams.append('album_name', params.albumName);
    }
    if (params.duration) {
      url.searchParams.append('duration', Math.round(params.duration).toString());
    }

    const urlString = url.toString();
    let response: Response;
    try {
      response = await fetchWithTimeout(urlString, 30000);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Direct/Proxy LRCLIB exact match HTTP error: ${response.status}`);
      }
    } catch (err) {
      console.warn('Primary exact match request failed, attempting backup CORS proxy...', err);
      try {
        const targetUrl = new URL('https://lrclib.net/api/get');
        targetUrl.searchParams.append('track_name', params.trackName);
        targetUrl.searchParams.append('artist_name', params.artistName);
        if (params.albumName) {
          targetUrl.searchParams.append('album_name', params.albumName);
        }
        if (params.duration) {
          targetUrl.searchParams.append('duration', Math.round(params.duration).toString());
        }
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl.toString())}`;
        response = await fetchWithTimeout(proxyUrl, 30000);
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw new Error(`Backup Proxy LRCLIB exact match HTTP error: ${response.status}`);
        }
      } catch (proxyErr) {
        console.error('All exact match options failed:', proxyErr);
        return null;
      }
    }

    try {
      const track: LrcLibTrack = await response.json();
      return {
        id: track.id,
        trackName: track.trackName,
        artistName: track.artistName,
        albumName: track.albumName,
        duration: track.duration,
        plainLyrics: track.plainLyrics,
        syncedLyrics: track.syncedLyrics,
        provider: 'lrclib',
      };
    } catch (err) {
      console.error('Failed to parse exact match JSON response:', err);
      return null;
    }
  }
}

const lrclibProviderInstance = new LRCLibProvider();

export { lrclibProviderInstance };
