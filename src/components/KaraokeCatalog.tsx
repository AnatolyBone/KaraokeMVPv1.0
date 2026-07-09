import React, { useEffect, useState } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { supabase } from '../services/supabaseClient';
import { getStoragePublicUrl } from '../services/supabaseLyricsService';
import { extractDominantColors } from '../utils/colors';
import { Music, Play, Search, Heart, Loader2, Disc, Library, Share2 } from 'lucide-react';
import { lrclibProviderInstance } from '../services/lrclibService';
import { parseLRC } from '../utils/lrc';


interface KaraokeCatalogProps {
  onTrackLoaded?: () => void;
  onRequestPublish?: () => void;
}

export const KaraokeCatalog: React.FC<KaraokeCatalogProps> = ({ onTrackLoaded, onRequestPublish }) => {
  const {
    theme,
    language,
    lines,
    setAudio,
    setLines,
    setCover,
    setCoverColors,
    setRawText,
    updateVideoStyle,
    setCurrentProjectTitle,
    cacheLrcLibTrack,
  } = useKaraokeStore();

  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);

  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const timedLinesCount = lines.filter((line) => line.time !== null).length;
  const canPublishCurrentProject = timedLinesCount > 0;

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      // 1. Поиск в опубликованных караоке по БД
      const { data: pubs } = await supabase
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
        `);

      const matchedPubs = (pubs || []).filter((p: any) => {
        const artist = p.songs?.artist || '';
        const title = p.songs?.title || '';
        return artist.toLowerCase().includes(query.toLowerCase()) || title.toLowerCase().includes(query.toLowerCase());
      });

      // 2. Поиск в telegram_audio_shares
      const { data: shares } = await supabase
        .from('telegram_audio_shares')
        .select('*')
        .or(`artist.ilike.%${query}%,title.ilike.%${query}%,file_name.ilike.%${query}%`)
        .limit(30);

      // Объединяем результаты
      const merged: any[] = [...matchedPubs.map((p: any) => ({ ...p, type: 'published' }))];

      for (const share of (shares || [])) {
        const alreadyExists = merged.some(p => 
          p.songs?.artist?.toLowerCase() === share.artist?.toLowerCase() &&
          p.songs?.title?.toLowerCase() === share.title?.toLowerCase()
        );
        if (!alreadyExists) {
          merged.push({
            id: share.id,
            type: 'telegram_share',
            audio_storage_path: null,
            cover_storage_path: null,
            likes_count: 0,
            telegram_file_id: share.file_id,
            songs: {
              artist: share.artist || 'Unknown Artist',
              title: share.title || share.file_name || 'Unknown Track',
              album: null,
              duration_seconds: share.duration,
              bpm: null
            }
          });
        }
      }

      setSearchResults(merged);
    } catch (err) {
      console.error('Failed to search database:', err);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const delayDebounce = setTimeout(() => {
      handleSearch(searchQuery);
    }, 450);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

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
      setRawText('');
      setLines([]);
      setCover(null);
      setCoverColors(null);

      let audioUrl = getStoragePublicUrl('published_audio', track.audio_storage_path);
      const coverUrl = getStoragePublicUrl('published_covers', track.cover_storage_path);
      let linesToUse = track.lines || [];

      if (track.type === 'telegram_share') {
        audioUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-telegram?action=download-audio&file_id=${track.telegram_file_id}`;
        
        // Проверяем наличие текста в нашей локальной опубликованной базе караоке по совпадению названия и исполнителя
        const { data: matchedPub } = await supabase
          .from('published_karaoke')
          .select(`
            lines,
            video_style,
            songs (
              artist,
              title
            )
          `)
          .eq('songs.artist', track.songs.artist)
          .eq('songs.title', track.songs.title)
          .limit(1)
          .maybeSingle();

        if (matchedPub?.lines) {
          linesToUse = matchedPub.lines;
          if (matchedPub.video_style) {
            updateVideoStyle(matchedPub.video_style);
          }
        } else {
          // Запрашиваем LRCLIB для получения текста
          try {
            const lrclibTrack = await lrclibProviderInstance.getExact({
              artistName: track.songs.artist,
              trackName: track.songs.title,
              duration: track.songs.duration_seconds || undefined
            });

            if (lrclibTrack?.syncedLyrics) {
              const parsed = parseLRC(lrclibTrack.syncedLyrics);
              linesToUse = parsed || [];
              
              // Кэшируем трек в базу
              await cacheLrcLibTrack(lrclibTrack);
            } else if (lrclibTrack?.plainLyrics) {
              const parsed = lrclibTrack.plainLyrics
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .map(lineText => ({
                  id: Math.random().toString(36).substring(2, 9),
                  text: lineText,
                  time: null,
                  words: []
                }));
              linesToUse = parsed || [];
            }
          } catch (lrclibErr) {
            console.error('Failed to get exact lyrics from LRCLIB:', lrclibErr);
          }
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
          setRawText(linesToUse.map((line: any) => line.text).join('\n'));
          setLines(linesToUse);
          updateVideoStyle(track.video_style || {});
          setCurrentProjectTitle(`${track.songs.artist} - ${track.songs.title}`);
          if (coverUrl) {
            setCover(coverUrl);
            const colors = await extractDominantColors(coverUrl);
            setCoverColors(colors);
          }
          // Переключаем пользователя в режим редактора на шаг синхронизации/просмотра
          useKaraokeStore.setState({ step: 'timing' });
          onTrackLoaded?.();
        }
        return;
      }

      if (linesToUse.length === 0) {
        const confirmCreate = window.confirm(
          language === 'ru'
            ? 'Для этого трека не найден текст песни. Хотите открыть его в редакторе и добавить текст вручную?'
            : 'Lyrics not found for this track. Would you like to open it in the editor and add lyrics manually?'
        );

        if (confirmCreate) {
          setAudio(audioUrl, `${track.songs.artist} - ${track.songs.title}.mp3`);
          setCurrentProjectTitle(`${track.songs.artist} - ${track.songs.title}`);
          setRawText('');
          setLines([]);
          useKaraokeStore.setState({ step: 'input' });
          onTrackLoaded?.();
        }
        return;
      }

      // Загружаем облачный караоке-трек
      setAudio(audioUrl, `${track.songs.artist} - ${track.songs.title}.mp3`);
      setRawText(linesToUse.map((line: any) => line.text).join('\n'));
      setLines(linesToUse);
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

      onTrackLoaded?.();
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

  const handleOpenPublicPage = (e: React.MouseEvent, trackId: string) => {
    e.stopPropagation();
    window.history.pushState({}, '', `/karaoke/${trackId}`);
    window.dispatchEvent(new Event('karaoke-route-change'));
  };

  const formatDuration = (sec: number | null) => {
    if (sec === null || sec === undefined) return '--:--';
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };


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
              ? 'Пойте готовые караоке-треки из сообщества или Telegram'
              : 'Sing ready-made karaoke tracks from the community or Telegram'}
          </p>
        </div>

        {/* Search input */}
        <div className="relative w-full md:max-w-xs">
          {searching ? (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-500 animate-spin" size={15} />
          ) : (
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={15} />
          )}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={language === 'ru' ? 'Поиск песни или артиста...' : 'Search song or artist...'}
            className={`w-full backdrop-blur-md border focus:border-violet-500/40 rounded-xl pl-9 pr-4 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500/35 transition-all duration-300 ${
              theme === 'dark'
                ? 'bg-zinc-950/50 border-white/5 text-zinc-200 placeholder-zinc-500 hover:border-white/10'
                : 'bg-white/78 border-zinc-200/80 text-zinc-900 placeholder-zinc-500 hover:border-violet-300/60'
            }`}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500 gap-3">
          <Loader2 className="animate-spin text-violet-500" size={32} />
          <span className="text-xs font-semibold">{language === 'ru' ? 'Загрузка каталога...' : 'Loading catalog...'}</span>
        </div>
      ) : (searchQuery.trim() ? searchResults : tracks).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/10 text-zinc-500 gap-2">
          <Disc size={36} className="stroke-[1.25] text-zinc-700" />
          <span className="text-xs font-medium">
            {searchQuery
              ? (language === 'ru' ? 'Песни не найдены' : 'No songs found')
              : (language === 'ru' ? 'Каталог пока пуст. Опубликуйте первый трек!' : 'The catalog is empty. Publish the first track!')}
          </span>
          {!searchQuery.trim() && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <p className="max-w-md text-[11px] leading-relaxed text-zinc-500">
                {language === 'ru'
                  ? 'Сохранённые проекты остаются в ваших черновиках. Чтобы трек появился здесь, его нужно опубликовать в общий каталог.'
                  : 'Saved projects stay in your drafts. To show a track here, publish it to the shared catalog.'}
              </p>
              <button
                type="button"
                disabled={!canPublishCurrentProject || !onRequestPublish}
                onClick={onRequestPublish}
                className={`rounded-xl px-4 py-2.5 text-xs font-extrabold transition-all ${
                  canPublishCurrentProject && onRequestPublish
                    ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/15 hover:bg-violet-700 hover:scale-[1.02]'
                    : 'bg-zinc-200 text-zinc-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-600'
                }`}
              >
                {language === 'ru' ? 'Опубликовать текущий проект' : 'Publish current project'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {(searchQuery.trim() ? searchResults : tracks).map((track) => {
            const isTelegramShare = track.type === 'telegram_share';
            const hasAudio = !!track.audio_storage_path || isTelegramShare;
            const coverUrl = getStoragePublicUrl('published_covers', track.cover_storage_path);

            return (
              <div
                key={track.id}
                onClick={() => handleSelectTrack(track)}
                className={`group relative rounded-2xl p-4 border transition-all duration-300 flex flex-col justify-between cursor-pointer hover:-translate-y-1 hover:scale-[1.015] shadow-sm hover:shadow-violet-500/10 ${
                  theme === 'dark'
                    ? 'bg-zinc-900/40 backdrop-blur-xl border-white/5 hover:border-violet-500/30'
                    : 'bg-white border-zinc-200 hover:bg-zinc-50/50'
                }`}
              >
                <div className="flex gap-3">
                  {/* Cover image or fallback */}
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-zinc-900 border border-zinc-800/30 flex items-center justify-center">
                    {coverUrl ? (
                      <img src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
                    ) : (
                      <Music className="text-zinc-700" size={24} />
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
                      {isTelegramShare ? (
                        <span className="shrink-0 text-[8px] font-extrabold px-1 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 uppercase tracking-wider">
                          TG AUDIO
                        </span>
                      ) : hasAudio ? (
                        <span className="shrink-0 text-[8px] font-extrabold px-1 rounded bg-emerald-500/10 text-emerald-450 border border-emerald-500/20 uppercase tracking-wider">
                          KARAOKE
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500 truncate mt-0.5">
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

                  {!isTelegramShare && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => handleOpenPublicPage(e, track.id)}
                        className="flex items-center gap-1 hover:text-violet-500 transition-colors"
                        title={language === 'ru' ? 'Открыть публичную страницу' : 'Open public page'}
                      >
                        <Share2 size={11} />
                        <span>{language === 'ru' ? 'Ссылка' : 'Share'}</span>
                      </button>
                      <button
                        onClick={(e) => handleLike(e, track.id, track.likes_count || 0)}
                        className="flex items-center gap-1 hover:text-pink-500 transition-colors"
                      >
                        <Heart size={11} className="fill-current text-pink-500/20 group-hover:scale-110 transition-transform" />
                        <span className="font-mono">{track.likes_count || 0}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
