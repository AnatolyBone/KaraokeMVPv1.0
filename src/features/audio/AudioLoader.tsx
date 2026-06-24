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
import { Upload, Trash2, Music, RefreshCw, Search } from 'lucide-react';

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
    setLines
  } = useKaraokeStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

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
              alert(language === 'ru' 
                ? `Найден синхронизированный текст для "${result.artistName} - ${result.trackName}" и импортирован автоматически!` 
                : `Found synced lyrics for "${result.artistName} - ${result.trackName}" and imported them automatically!`
              );
            } else if (result.plainLyrics) {
              const parsed = parseLRC(result.plainLyrics);
              setLines(parsed);
              setRawText(result.plainLyrics);
              alert(language === 'ru'
                ? `Найден текст для "${result.artistName} - ${result.trackName}" и импортирован автоматически. Требуется ручная синхронизация.`
                : `Found plain lyrics for "${result.artistName} - ${result.trackName}" and imported them automatically. Sync required.`
              );
            }
          }
        }).catch((err) => {
          console.warn('Auto-search exact lyrics failed:', err);
        });
      }
    }
  }, [audioUrl, audioFileName, trackMetadata, rawText, language, setLines, setRawText, autoSearchedFile]);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('audio/')) {
      alert(language === 'ru' ? 'Пожалуйста, выберите корректный аудиофайл (MP3, WAV, OGG, M4A)' : 'Please select a valid audio file (MP3, WAV, OGG, M4A)');
      return;
    }

    const url = URL.createObjectURL(file);
    setAudio(url, file.name);

    try {
      await saveAudioToDB(file);

      // Парсим ID3 метаданные
      const metadata = await extractMetadataFromAudio(file);
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

          <div className="flex justify-center">
            <button
              onClick={() => setIsSearchOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800 text-violet-400 hover:text-violet-300 font-semibold rounded-xl text-sm transition-all shadow-sm cursor-pointer"
            >
              <Search size={16} />
              <span>{dict.lyricsSearchBtn}</span>
            </button>
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
