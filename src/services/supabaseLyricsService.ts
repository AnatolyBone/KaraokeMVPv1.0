import { LyricsProvider, LyricsProviderResult } from './lyricsProvider';
import { supabase } from './supabaseClient';
import { generateLRC } from '../utils/lrc';
import { LyricLine } from '../types';

export function getStoragePublicUrl(bucketName: string, path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  
  const { data } = supabase.storage.from(bucketName).getPublicUrl(path);
  return data?.publicUrl || null;
}

class SupabaseLyricsProvider implements LyricsProvider {
  name = 'supabase';

  async search(query: string): Promise<LyricsProviderResult[]> {
    try {
      const { data, error } = await supabase
        .from('published_karaoke')
        .select(`
          id,
          lines,
          video_style,
          audio_storage_path,
          cover_storage_path,
          likes_count,
          songs!inner (
            id,
            artist,
            title,
            album,
            duration_seconds,
            bpm
          )
        `)
        .or(`artist.ilike.%${query}%,title.ilike.%${query}%`, { foreignTable: 'songs' });

      if (error) {
        console.error('Supabase lyrics search query failed:', error);
        return [];
      }

      return (data || []).map((item: any) => {
        const lines = item.lines as LyricLine[];
        const syncedLyrics = generateLRC(lines, item.songs.title);
        const plainLyrics = lines.map(l => l.text).join('\n');

        return {
          id: item.id,
          trackName: item.songs.title,
          artistName: item.songs.artist,
          albumName: item.songs.album,
          duration: item.songs.duration_seconds,
          plainLyrics,
          syncedLyrics,
          provider: 'supabase',
          lines,
          videoStyle: item.video_style,
          audioStoragePath: getStoragePublicUrl('published_audio', item.audio_storage_path),
          coverStoragePath: getStoragePublicUrl('published_covers', item.cover_storage_path),
        };
      });
    } catch (err) {
      console.error('Supabase lyrics search exception:', err);
      return [];
    }
  }

  async getExact(params: {
    trackName: string;
    artistName: string;
    albumName?: string;
    duration?: number;
  }): Promise<LyricsProviderResult | null> {
    try {
      const { data, error } = await supabase
        .from('published_karaoke')
        .select(`
          id,
          lines,
          video_style,
          audio_storage_path,
          cover_storage_path,
          likes_count,
          songs!inner (
            id,
            artist,
            title,
            album,
            duration_seconds,
            bpm
          )
        `)
        .ilike('songs.artist', params.artistName)
        .ilike('songs.title', params.trackName)
        .limit(1);

      if (error) {
        console.error('Supabase exact lyrics query failed:', error);
        return null;
      }

      if (!data || data.length === 0) return null;

      const item = data[0];
      const lines = item.lines as LyricLine[];
      const syncedLyrics = generateLRC(lines, item.songs.title);
      const plainLyrics = lines.map(l => l.text).join('\n');

      return {
        id: item.id,
        trackName: item.songs.title,
        artistName: item.songs.artist,
        albumName: item.songs.album,
        duration: item.songs.duration_seconds,
        plainLyrics,
        syncedLyrics,
        provider: 'supabase',
        lines,
        videoStyle: item.video_style,
        audioStoragePath: getStoragePublicUrl('published_audio', item.audio_storage_path),
        coverStoragePath: getStoragePublicUrl('published_covers', item.cover_storage_path),
      };
    } catch (err) {
      console.error('Supabase exact lyrics exception:', err);
      return null;
    }
  }
}

export const supabaseLyricsProviderInstance = new SupabaseLyricsProvider();
