import React, { useEffect, useState } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { supabase } from '../services/supabaseClient';
import { getStoragePublicUrl } from '../services/supabaseLyricsService';
import { extractDominantColors } from '../utils/colors';
import { Music, Play, Search, Heart, Loader2, Disc, Library } from 'lucide-react';


export const KaraokeCatalog: React.FC = () => {
  const {
    theme,
    language,
    setAudio,
    setLines,
    setCover,
    setCoverColors,
    updateVideoStyle,
    setCurrentProjectTitle,
  } = useKaraokeStore();

  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);

  const fetchCatalog = async () => {
    setLoading(true);
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
          songs (
            id,
            artist,
            title,
            album,
            duration_seconds,
            bpm
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTracks(data || []);
    } catch (err) {
      console.error('Failed to load karaoke catalog:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const handleSelectTrack = async (track: any) => {
    if (loadingTrackId) return;
    setLoadingTrackId(track.id);

    try {
      let audioUrl = getStoragePublicUrl('published_audio', track.audio_storage_path);
      const coverUrl = getStoragePublicUrl('published_covers', track.cover_storage_path);

      if (!audioUrl) {
        // Поиск совпадения в telegram_audio_shares по артисту и названию
        const { data: share } = await supabase
          .from('telegram_audio_shares')
          .select('file_id')
          .ilike('artist', track.songs.artist)
          .ilike('title', track.songs.title)
          .limit(1)
          .maybeSingle();

        if (share?.file_id) {
          audioUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-telegram?action=download-audio&file_id=${share.file_id}`;
        }
      }

      if (!audioUrl) {
        // Если аудио нет ни в облаке, ни в телеграме, просим пользователя загрузить локальное аудио
        const confirmLocal = window.confirm(
          language === 'ru'
            ? 'Этот трек содержит только разметку текста. Хотите привязать свой локальный аудиофайл для воспроизведения?'
            : 'This track only has lyrics timing. Would you like to select your own local audio file to play?'
        );

        if (confirmLocal) {
          setLines(track.lines || []);
          updateVideoStyle(track.video_style || {});
          setCurrentProjectTitle(`${track.songs.artist} - ${track.songs.title}`);
          if (coverUrl) {
            setCover(coverUrl);
            const colors = await extractDominantColors(coverUrl);
            setCoverColors(colors);
          }
          // Переключаем пользователя в режим редактора на шаг синхронизации/просмотра
          useKaraokeStore.setState({ step: 'timing' });
        }
        return;
      }

      // Загружаем облачный караоке-трек
      setAudio(audioUrl, `${track.songs.artist} - ${track.songs.title}.mp3`);
      setLines(track.lines || []);
      updateVideoStyle(track.video_style || {});
      setCurrentProjectTitle(`${track.songs.artist} - ${track.songs.title}`);

      if (coverUrl) {
        setCover(coverUrl);
        const colors = await extractDominantColors(coverUrl);
        setCoverColors(colors);
      } else {
        setCover(null);
        setCoverColors(null);
      }
    } catch (err) {
      console.error('Failed to load track from catalog:', err);
      alert(language === 'ru' ? 'Ошибка загрузки трека' : 'Error loading track');
    } finally {
      setLoadingTrackId(null);
    }
  };

  const handleLike = async (e: React.MouseEvent, trackId: string, currentLikes: number) => {
    e.stopPropagation();
    try {
      const { error } = await supabase
        .from('published_karaoke')
        .update({ likes_count: currentLikes + 1 })
        .eq('id', trackId);

      if (error) throw error;

      // Обновляем локальное состояние
      setTracks((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, likes_count: currentLikes + 1 } : t))
      );
    } catch (err) {
      console.error('Failed to like track:', err);
    }
  };

  const formatDuration = (sec: number | null) => {
    if (sec === null || sec === undefined) return '--:--';
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const filteredTracks = tracks.filter((t) => {
    const artist = t.songs?.artist || '';
    const title = t.songs?.title || '';
    const search = searchQuery.toLowerCase();
    return artist.toLowerCase().includes(search) || title.toLowerCase().includes(search);
  });

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-3 duration-300">
      {/* Header and Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold flex items-center gap-2">
            <Library className="text-violet-500" size={22} />
            {language === 'ru' ? 'Каталог караоке' : 'Karaoke Catalog'}
          </h2>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
            {language === 'ru'
              ? 'Пойте готовые караоке-треки, опубликованные сообществом'
              : 'Sing ready-made karaoke songs published by the community'}
          </p>
        </div>

        {/* Search input */}
        <div className="relative w-full md:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={15} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={language === 'ru' ? 'Поиск песни или артиста...' : 'Search song or artist...'}
            className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/35 transition-all placeholder-zinc-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500 gap-3">
          <Loader2 className="animate-spin text-violet-500" size={32} />
          <span className="text-xs font-semibold">{language === 'ru' ? 'Загрузка каталога...' : 'Loading catalog...'}</span>
        </div>
      ) : filteredTracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/10 text-zinc-500 gap-2">
          <Disc size={36} className="stroke-[1.25] text-zinc-650" />
          <span className="text-xs font-medium">
            {searchQuery
              ? (language === 'ru' ? 'Песни не найдены' : 'No songs found')
              : (language === 'ru' ? 'Каталог пока пуст. Опубликуйте первый трек!' : 'The catalog is empty. Publish the first track!')}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {filteredTracks.map((track) => {
            const hasAudio = !!track.audio_storage_path;
            const coverUrl = getStoragePublicUrl('published_covers', track.cover_storage_path);

            return (
              <div
                key={track.id}
                onClick={() => handleSelectTrack(track)}
                className={`group relative rounded-2xl p-4 border transition-all duration-300 flex flex-col justify-between cursor-pointer hover:-translate-y-1 shadow-sm hover:shadow-violet-500/5 ${
                  theme === 'dark'
                    ? 'bg-zinc-950/65 border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-950'
                    : 'bg-white border-zinc-250 hover:border-zinc-350 hover:bg-zinc-50/50'
                }`}
              >
                <div className="flex gap-3">
                  {/* Cover image or fallback */}
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-zinc-900 border border-zinc-800/30 flex items-center justify-center">
                    {coverUrl ? (
                      <img src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
                    ) : (
                      <Music className="text-zinc-600" size={24} />
                    )}

                    {/* Play button overlay */}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      {loadingTrackId === track.id ? (
                        <Loader2 className="animate-spin text-white" size={16} />
                      ) : (
                        <Play className="text-white fill-white" size={16} />
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-bold text-sm text-zinc-100 truncate group-hover:text-violet-400 transition-colors">
                        {track.songs.title}
                      </h4>
                      {hasAudio && (
                        <span className="shrink-0 text-[8px] font-extrabold px-1 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 uppercase tracking-wider">
                          AUDIO
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-450 dark:text-zinc-500 truncate mt-0.5">
                      {track.songs.artist}
                    </p>
                    {track.songs.album && (
                      <p className="text-[10px] text-zinc-500 italic truncate mt-0.5">
                        {track.songs.album}
                      </p>
                    )}
                  </div>
                </div>

                {/* Footer specs of card */}
                <div className="flex items-center justify-between border-t border-zinc-900/40 dark:border-zinc-900 mt-4 pt-3.5 text-[10px] text-zinc-500">
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums">{formatDuration(track.songs.duration_seconds)}</span>
                    {track.songs.bpm && (
                      <>
                        <span>•</span>
                        <span className="font-mono">{track.songs.bpm} BPM</span>
                      </>
                    )}
                  </div>

                  <button
                    onClick={(e) => handleLike(e, track.id, track.likes_count || 0)}
                    className="flex items-center gap-1 hover:text-pink-500 transition-colors"
                  >
                    <Heart size={11} className="fill-current text-pink-500/20 group-hover:scale-110 transition-transform" />
                    <span className="font-mono">{track.likes_count || 0}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
