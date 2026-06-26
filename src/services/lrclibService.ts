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


class LRCLibProvider implements LyricsProvider {
  name = 'lrclib';

  async search(query: string): Promise<LyricsProviderResult[]> {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'search-lyrics',
          query,
        }),
      });

      if (!response.ok) {
        throw new Error(`Edge Function lyrics search HTTP error: ${response.status}`);
      }

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
      console.error('Lyrics search via Edge Function failed:', err);
      throw err;
    }
  }

  async getExact(params: {
    trackName: string;
    artistName: string;
    albumName?: string;
    duration?: number;
  }): Promise<LyricsProviderResult | null> {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'get-exact-lyrics',
          trackName: params.trackName,
          artistName: params.artistName,
          albumName: params.albumName,
          duration: params.duration ? Math.round(params.duration) : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Edge Function lyrics getExact HTTP error: ${response.status}`);
      }

      const track: LrcLibTrack | null = await response.json();
      if (!track) return null;

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
      console.error('Lyrics getExact via Edge Function failed:', err);
      return null;
    }
  }
}

const lrclibProviderInstance = new LRCLibProvider();

export { lrclibProviderInstance };
