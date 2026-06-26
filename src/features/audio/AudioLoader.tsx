import React, { useRef, useEffect, useState } from 'react';
import { useKaraokeStore } from '../../store/useKaraokeStore';
import { audioRef } from '../../audioRef';
import { saveAudioToDB, loadAudioFromDB, clearAudioFromDB, saveCoverToDB, loadCoverFromDB, clearCoverFromDB } from '../../utils/db';
import { extractCoverFromAudio } from '../../utils/cover';
import { extractDominantColors } from '../../utils/colors';
import { extractMetadataFromAudio } from '../../utils/metadata';
import { localization } from '../../utils/localization';
import { LyricsSearchModal } from '../../components/LyricsSearchModal';
import { getExactAllLyrics } from '../../services/lyricsProvider';
import { parseLRC } from '../../utils/lrc';
import { Upload, Trash2, Music, RefreshCw, Search, Smartphone, Loader2 } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';

export const AudioLoader: React.FC = () => {
  const {
    audioUrl,
    audioFileName,
    setAudio,
    setIsPlaying,
    theme,
    coverUrl,
    coverColors,
    setCover,
    setCoverColors,
    language,
    setTrackMetadata,
    trackMetadata,
    setCurrentProjectTitle,
    rawText,
    setRawText,
    setLines,
    user
  } = useKaraokeStore();

  const [tgTracks, setTgTracks] = useState<any[]>([]);
  const [loadingTg, setLoadingTg] = useState(false);
  const [downloadingTgId, setDownloadingTgId] = useState<string | null>(null);
  const [showTgImport, setShowTgImport] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [lyricsSearchStatus, setLyricsSearchStatus] = useState<'idle' | 'searching' | 'found' | 'not_found'>('idle');

  const dict = localization[language];

  useEffect(() => {
    if (!audioUrl && audioFileName) {
      setIsRestoring(true);
      Promise.all([loadAudioFromDB(), loadCoverFromDB()])
        .then(async ([audioFile, coverFile]) => {
          if (audioFile) {
            const url = URL.createObjectURL(audioFile);
            setAudio(url, audioFile.name);

            let coverBlobUrl: string | null = null;
            if (coverFile) {
              coverBlobUrl = URL.createObjectURL(coverFile);
            } else {
              const cover = await extractCoverFromAudio(audioFile);
              if (cover) coverBlobUrl = cover;
            }

            if (coverBlobUrl) {
              setCover(coverBlobUrl);
              const palette = await extractDominantColors(coverBlobUrl);
              setCoverColors(palette);
            }

            // Восстанавливаем ID3 теги из файла
            const metadata = await extractMetadataFromAudio(audioFile);
            setTrackMetadata(metadata);
          }
        })
        .catch((err) => console.error('Failed to restore audio/cover from DB', err))
        .finally(() => setIsRestoring(false));
    }
  }, [audioUrl, audioFileName, setAudio, setCover, setCoverColors, setTrackMetadata]);

  const [autoSearchedFile, setAutoSearchedFile] = useState<string | null>(null);

  // Автопоиск текста песни при наличии трека (срабатывает как при загрузке, так и при восстановлении из IndexedDB)
  useEffect(() => {
    if (audioUrl && audioFileName && !rawText.trim()) {
      if (autoSearchedFile === audioFileName) return;

      let artist = trackMetadata?.artist || null;
      let title = trackMetadata?.title || null;

      // Попытка распарсить имя файла, если тегов нет
      if ((!artist || !title) && audioFileName) {
        const cleanName = audioFileName.replace(/\.[^/.]+$/, '');
        const parts = cleanName.split(/\s*[-—–]\s*/);
        if (parts.length >= 2) {
          artist = artist || parts[0].trim();
          title = title || parts[1].trim();
        }
      }

      if (title && artist) {
        setAutoSearchedFile(audioFileName);
        setLyricsSearchStatus('searching');
        getExactAllLyrics({
          trackName: title,
          artistName: artist,
          albumName: trackMetadata?.album || undefined,
        }).then((result) => {
          if (result) {
            if (result.syncedLyrics) {
              const parsed = parseLRC(result.syncedLyrics);
              setLines(parsed);
              setRawText(result.syncedLyrics);
              setLyricsSearchStatus('found');
            } else if (result.plainLyrics) {
              const parsed = parseLRC(result.plainLyrics);
              setLines(parsed);
              setRawText(result.plainLyrics);
              setLyricsSearchStatus('found');
            } else {
              setLyricsSearchStatus('not_found');
            }
          } else {
            setLyricsSearchStatus('not_found');
          }
        }).catch((err) => {
          console.warn('Auto-search exact lyrics failed:', err);
          setLyricsSearchStatus('not_found');
        });
      } else {
        setLyricsSearchStatus('not_found');
      }
    } else if (!audioUrl) {
      setLyricsSearchStatus('idle');
    }
  }, [audioUrl, audioFileName, trackMetadata, rawText, language, setLines, setRawText, autoSearchedFile]);

  const handleFile = async (file: File, meta?: { artist: string | null; title: string | null }) => {
    const isAudioMime = file.type.startsWith('audio/');
    const hasAudioExtension = /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
    if (!isAudioMime && !hasAudioExtension) {
      alert(language === 'ru' ? 'Пожалуйста, выберите корректный аудиофайл (MP3, WAV, OGG, M4A)' : 'Please select a valid audio file (MP3, WAV, OGG, M4A)');
      return;
    }

    const url = URL.createObjectURL(file);
    setAudio(url, file.name);

    try {
      await saveAudioToDB(file);

      // Используем переданные метаданные (например, из Telegram), если они есть, иначе парсим ID3
      let metadata = {
        artist: meta?.artist || null,
        title: meta?.title || null,
        album: null as string | null
      };

      if (!metadata.artist || !metadata.title) {
        const parsedMeta = await extractMetadataFromAudio(file);
        metadata = {
          artist: metadata.artist || parsedMeta.artist,
          title: metadata.title || parsedMeta.title,
          album: parsedMeta.album
        };
      }

      setTrackMetadata(metadata);
      if (metadata.title) {
        setCurrentProjectTitle(metadata.artist ? `${metadata.artist} - ${metadata.title}` : metadata.title);
      }

      const cover = await extractCoverFromAudio(file);
      if (cover) {
        setCover(cover);
        const palette = await extractDominantColors(cover);
        setCoverColors(palette);
      } else {
        setCover(null);
        setCoverColors(null);
      }
    } catch (err) {
      console.warn('Could not save audio to IndexedDB:', err);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const removeAudio = async () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudio(null, null);
    setCover(null);
    setCoverColors(null);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.src = '';
    }
    try {
      await clearAudioFromDB();
      await clearCoverFromDB();
    } catch (err: any) {
      console.error('Error clearing DB:', err);
    }
  };

  const fetchTelegramTracks = async () => {
    if (!user) return;
    setLoadingTg(true);
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('telegram_id')
        .eq('id', user.id)
        .single();

      if (profileData?.telegram_id) {
        const { data, error } = await supabase
          .from('telegram_audio_shares')
          .select('*')
          .eq('telegram_id', profileData.telegram_id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        const uniqueTracks: any[] = [];
        const seenFileIds = new Set<string>();
        for (const track of (data || [])) {
          if (track.file_id && !seenFileIds.has(track.file_id)) {
            seenFileIds.add(track.file_id);
            uniqueTracks.push(track);
          }
        }
        setTgTracks(uniqueTracks);
      }
    } catch (err) {
      console.error('Failed to fetch Telegram tracks:', err);
    } finally {
      setLoadingTg(false);
    }
  };

  useEffect(() => {
    if (showTgImport && user) {
      fetchTelegramTracks();
    }
  }, [showTgImport, user]);

  const handleDownloadTgTrack = async (track: any) => {
    setDownloadingTgId(track.id);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-telegram?action=download-audio&file_id=${track.file_id}`
      );

      if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.statusText}`);
      }

      const blob = await response.blob();
      const fileType = blob.type && blob.type.startsWith('audio/')
        ? blob.type
        : (track.file_name.endsWith('.wav') ? 'audio/wav'
           : track.file_name.endsWith('.ogg') ? 'audio/ogg'
           : track.file_name.endsWith('.m4a') ? 'audio/x-m4a'
           : 'audio/mpeg');
      const file = new File([blob], track.file_name, { type: fileType });
      await handleFile(file, { artist: track.artist, title: track.title });
      setShowTgImport(false);
    } catch (err: any) {
      alert(`${dict.audioTgImportError}: ${err.message}`);
    } finally {
      setDownloadingTgId(null);
    }
  };

  const handleDeleteTgTrack = async (e: React.MouseEvent, track: any) => {
    e.stopPropagation();
    if (!confirm(dict.adminDeleteConfirm)) return;
    try {
      const { error } = await supabase
        .from('telegram_audio_shares')
        .delete()
        .eq('file_id', track.file_id)
        .eq('telegram_id', track.telegram_id);
      if (error) throw error;
      setTgTracks((prev) => prev.filter((t) => t.file_id !== track.file_id));
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith('image/')) {
        alert(language === 'ru' ? 'Выберите изображение' : 'Please select an image file');
        return;
      }
      const url = URL.createObjectURL(file);
      setCover(url);

      saveCoverToDB(file).catch((err) => console.warn('Could not save custom cover to DB:', err));

      const palette = await extractDominantColors(url);
      setCoverColors(palette);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {isRestoring && (
        <div className="flex items-center justify-center p-6 text-violet-500 dark:text-violet-400">
          <RefreshCw className="animate-spin mr-2 h-5 w-5" />
          <span>{dict.audioRestoring}</span>
        </div>
      )}

      {!audioUrl && !isRestoring && (
        <div className="flex flex-col gap-4">
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-4 ${isDragging
                ? 'border-violet-500 bg-violet-500/10 scale-[1.01]'
                : theme === 'dark'
                  ? 'border-zinc-700 hover:border-zinc-600 bg-zinc-900/50 hover:bg-zinc-900/80'
                  : 'border-zinc-300 hover:border-zinc-400 bg-white hover:bg-zinc-50'
              }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={onFileChange}
              accept="audio/*"
              className="hidden"
            />

            <div className="p-4 rounded-full bg-violet-500/10 text-violet-500 dark:text-violet-400">
              <Upload size={36} />
            </div>

            <div>
              <p className="text-base font-semibold">
                {dict.audioLoaderPlaceholder}
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                {dict.audioLoaderFormats}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setIsSearchOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800 text-violet-400 hover:text-violet-300 font-semibold rounded-xl text-sm transition-all shadow-sm cursor-pointer"
              >
                <Search size={16} />
                <span>{dict.lyricsSearchBtn}</span>
              </button>

              {user && (
                <button
                  onClick={() => setShowTgImport(!showTgImport)}
                  className={`flex items-center gap-2 px-5 py-2.5 border font-semibold rounded-xl text-sm transition-all shadow-sm cursor-pointer ${
                    showTgImport
                      ? 'bg-sky-500/10 border-sky-500/30 text-sky-400 hover:bg-sky-500/25'
                      : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800 text-sky-400 hover:text-sky-350'
                  }`}
                >
                  <Smartphone size={16} />
                  <span>{dict.audioTgImportBtn}</span>
                </button>
              )}
            </div>

            {showTgImport && user && (
              <div className={`rounded-2xl border p-4 text-left transition-all ${
                theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
              }`}>
                <h4 className="font-bold text-xs uppercase tracking-wider text-sky-500 mb-1">
                  {dict.audioTgImportTitle}
                </h4>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal mb-3">
                  {dict.audioTgImportDesc}
                </p>
                <div className="text-[9px] text-amber-500 dark:text-amber-400/80 leading-normal font-semibold mb-3 border border-amber-500/20 bg-amber-500/5 rounded-lg p-2.5 flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">⚠️</span>
                  <span>
                    {language === 'ru'
                      ? 'Внимание: для импорта из Telegram в РФ может потребоваться активный VPN (из-за блокировок сетевых запросов к серверам Supabase провайдерами).'
                      : 'Note: Telegram import in Russia may require an active VPN (due to connection blockades to Supabase servers by ISPs).'}
                  </span>
                </div>

                {loadingTg ? (
                  <div className="flex items-center justify-center py-6 text-zinc-500">
                    <RefreshCw className="animate-spin mr-2 h-4 w-4" />
                    <span className="text-xs">{dict.audioTgImportLoading}</span>
                  </div>
                ) : tgTracks.length === 0 ? (
                  <p className="text-xs text-zinc-400 py-4 text-center font-semibold">
                    {dict.audioTgImportNoTracks}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                    {tgTracks.map((track) => (
                      <div
                        key={track.id}
                        onClick={() => !downloadingTgId && handleDownloadTgTrack(track)}
                        className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all text-xs font-semibold ${
                          downloadingTgId === track.id
                            ? 'border-sky-550/50 bg-sky-550/5 text-sky-500'
                            : theme === 'dark'
                              ? 'border-zinc-900 bg-zinc-900/40 hover:bg-zinc-900/80 hover:border-zinc-800'
                              : 'border-zinc-100 bg-zinc-50/50 hover:bg-zinc-50 hover:border-zinc-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {downloadingTgId === track.id ? (
                            <Loader2 className="animate-spin text-sky-500 shrink-0" size={14} />
                          ) : (
                            <Music className="text-zinc-500 shrink-0" size={14} />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-bold">
                              {track.artist && track.title ? `${track.artist} - ${track.title}` : track.file_name}
                            </p>
                            <p className="text-[9px] text-zinc-450 dark:text-zinc-500 font-mono mt-0.5">
                              {track.file_size ? `${(track.file_size / (1024 * 1024)).toFixed(1)} MB` : ''}
                              {track.duration ? ` • ${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, '0')}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {downloadingTgId !== track.id && (
                            <button
                              onClick={(e) => handleDeleteTgTrack(e, track)}
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/5 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {audioUrl && (
        <div
          className={`rounded-2xl p-6 shadow-sm border transition-all ${theme === 'dark'
              ? 'bg-zinc-950 border-zinc-800 text-zinc-100'
              : 'bg-white border-zinc-200 text-zinc-900'
            }`}
        >
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">

              <input
                type="file"
                ref={coverInputRef}
                onChange={handleCoverUpload}
                accept="image/*"
                className="hidden"
              />

              <div
                onClick={() => coverInputRef.current?.click()}
                className="cursor-pointer group relative shrink-0"
                title={language === 'ru' ? 'Изменить обложку' : 'Change cover art'}
              >
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt="Cover art"
                    className="w-14 h-14 rounded-xl object-cover shadow border border-zinc-250/10 group-hover:brightness-50 transition-all"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-violet-500/10 text-violet-500 dark:text-violet-400 flex items-center justify-center group-hover:bg-violet-500/20 transition-all">
                    <Music size={24} />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Upload size={16} className="text-white drop-shadow-md" />
                </div>
              </div>

              <div className="min-w-0">
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-extrabold flex items-center gap-1">
                  {dict.audioLoaderTitle}
                  {coverColors && (
                    <span
                      className="w-2 h-2 rounded-full animate-pulse"
                      style={{ backgroundColor: coverColors.glow }}
                    />
                  )}
                </p>
                <h4 className="text-sm font-bold truncate mt-0.5" title={audioFileName || ''}>
                  {audioFileName}
                </h4>
                {lyricsSearchStatus === 'searching' && (
                  <p className="text-[10px] text-violet-500 dark:text-violet-400 font-semibold flex items-center gap-1 mt-1 animate-pulse">
                    <Loader2 size={10} className="animate-spin" />
                    <span>{language === 'ru' ? 'Ищем текст песни в LRCLIB...' : 'Searching lyrics in LRCLIB...'}</span>
                  </p>
                )}
                {lyricsSearchStatus === 'found' && (
                  <p className="text-[10px] text-emerald-500 dark:text-emerald-400 font-semibold flex items-center gap-1 mt-1">
                    <span>{language === 'ru' ? '✅ Текст песни импортирован автоматически!' : '✅ Lyrics imported automatically!'}</span>
                  </p>
                )}
                {lyricsSearchStatus === 'not_found' && (
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold flex items-center gap-1 mt-1">
                    <span>{language === 'ru' ? '⚠️ Текст песни в LRCLIB не найден' : '⚠️ Lyrics not found in LRCLIB'}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setIsSearchOpen(true)}
                className="p-2 rounded-lg text-violet-400 hover:text-violet-300 hover:bg-zinc-900 transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-transparent hover:border-zinc-850"
                title={dict.lyricsSearchBtn}
              >
                <Search size={16} />
                <span className="hidden sm:inline">{dict.lyricsSearchBtn}</span>
              </button>

              <button
                onClick={removeAudio}
                className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                title={language === 'ru' ? 'Заменить аудио' : 'Replace audio'}
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>

          <audio
            ref={(el) => {
              audioRef.current = el;
            }}
            src={audioUrl}
            preload="auto"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            className="w-full focus:outline-none outline-none [&::-webkit-media-controls-panel]:bg-zinc-100 dark:[&::-webkit-media-controls-panel]:bg-zinc-900 [&::-webkit-media-controls-current-time-display]:text-violet-500 mt-2"
            controls
          />
        </div>
      )}

      <LyricsSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
    </div>
  );
};
