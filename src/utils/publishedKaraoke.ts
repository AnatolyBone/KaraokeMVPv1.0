import { supabase } from '../services/supabaseClient';
import { getStoragePublicUrl } from '../services/supabaseLyricsService';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { getAnonymousId } from './analytics';
import { extractDominantColors } from './colors';

export interface PublishedKaraokeTrack {
  id: string;
  lines: any[];
  video_style: any;
  audio_storage_path: string | null;
  cover_storage_path: string | null;
  likes_count: number | null;
  plays_count: number | null;
  created_at?: string;
  songs: {
    id: string;
    artist: string;
    title: string;
    album: string | null;
    duration_seconds: number | null;
    bpm: number | null;
  };
  profiles?: {
    username: string | null;
    avatar_url: string | null;
    telegram_id?: number | null;
  } | null;
}

export const getPublishedKaraokeCoverUrl = (track: Pick<PublishedKaraokeTrack, 'cover_storage_path'>) =>
  getStoragePublicUrl('published_covers', track.cover_storage_path);

export const getPublishedKaraokeAudioUrl = (track: Pick<PublishedKaraokeTrack, 'audio_storage_path'>) =>
  getStoragePublicUrl('published_audio', track.audio_storage_path);

export async function fetchPublishedKaraokeById(id: string): Promise<PublishedKaraokeTrack | null> {
  const { data, error } = await supabase
    .from('published_karaoke')
    .select(`
      id,
      lines,
      video_style,
      audio_storage_path,
      cover_storage_path,
      likes_count,
      plays_count,
      created_at,
      songs!inner (
        id,
        artist,
        title,
        album,
        duration_seconds,
        bpm
      ),
      profiles (
        username,
        avatar_url,
        telegram_id
      )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch published karaoke:', error);
    return null;
  }

  return data as PublishedKaraokeTrack | null;
}

export async function trackPublishedKaraokeOpen(track: PublishedKaraokeTrack) {
  try {
    const store = useKaraokeStore.getState();
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'track-public-open',
        karaokeId: track.id,
        userId: store.user?.id || null,
        telegramId: store.userProfile?.telegram_id || null,
        anonymousId: getAnonymousId(),
        route: `${window.location.pathname}${window.location.search}`,
      }),
    });

    if (!response.ok) {
      console.warn('Failed to track public karaoke open:', await response.text());
    }
  } catch (err) {
    console.warn('Failed to track public karaoke open:', err);
  }
}

export async function loadPublishedKaraokeIntoPlayer(track: PublishedKaraokeTrack) {
  const store = useKaraokeStore.getState();
  const audioUrl = getPublishedKaraokeAudioUrl(track);
  const coverUrl = getPublishedKaraokeCoverUrl(track);
  const linesToUse = track.lines || [];
  const title = `${track.songs.artist} - ${track.songs.title}`;

  store.setAudio(audioUrl, `${title}.mp3`);
  store.setRawText(linesToUse.map((line: any) => line.text).join('\n'));
  store.setLines(linesToUse);
  store.updateVideoStyle(track.video_style || {});
  store.setCurrentProjectTitle(title);
  store.setAppMode('karaoke');

  if (coverUrl) {
    store.setCover(coverUrl);
    try {
      const colors = await extractDominantColors(coverUrl);
      store.setCoverColors(colors);
    } catch (err) {
      console.warn('Failed to extract public karaoke cover colors:', err);
      store.setCoverColors(null);
    }
  } else {
    store.setCover(null);
    store.setCoverColors(null);
  }
}
