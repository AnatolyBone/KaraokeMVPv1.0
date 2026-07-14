import React, { useRef, useEffect, useState } from 'react';
import { useKaraokeStore } from '../../store/useKaraokeStore';
import { audioRef } from '../../audioRef';
import { saveAudioToDB, loadAudioFromDB, clearAudioFromDB, saveCoverToDB, loadCoverFromDB, clearCoverFromDB } from '../../utils/db';
import { extractCoverFromAudio } from '../../utils/cover';
import { extractDominantColors } from '../../utils/colors';
import { extractMetadataFromAudio } from '../../utils/metadata';
import { localization } from '../../utils/localization';
import { LyricsSearchModal } from '../../components/LyricsSearchModal';
import { searchAllLyrics, LyricsProviderResult } from '../../services/lyricsProvider';
import { parseLRC } from '../../utils/lrc';
import { Upload, Trash2, Music, RefreshCw, Search, Smartphone, Loader2, Play, Pause, Wand2 } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { formatTime } from '../../utils/time';
import { trackAppEvent } from '../../utils/analytics';

function normalizeAutoSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAutoSearchPart(value: string): string {
  return value
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\b(?:минус|instrumental|karaoke|кавер|cover|remix|rmx|slowed|reverb|sped\s*up|nightcore|bass\s*boosted)\b/giu, ' ')
    .replace(/\((?:[^)]*(?:минус|instrumental|karaoke|remix|slowed|reverb|sped\s*up|nightcore)[^)]*)\)/giu, ' ')
    .replace(/\[(?:[^\]]*(?:минус|instrumental|karaoke|remix|slowed|reverb|sped\s*up|nightcore)[^\]]*)\]/giu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-—–]\s*$/g, '')
    .trim();
}

async function blobUrlToBlob(url: string): Promise<Blob | null> {
  if (!url.startsWith('blob:')) return null;
  try {
    const response = await fetch(url);
    return await response.blob();
  } catch (err) {
    console.warn('Failed to read blob URL:', err);
    return null;
  }
}

function splitAutoSearchParts(value: string): string[] {
  return cleanAutoSearchPart(value)
    .split(/\s*[-—–]\s*/)
    .map(cleanAutoSearchPart)
    .filter(Boolean);
}

function parseAutoSearchMetadata(audioFileName: string, metadata: {
  artist: string | null;
  title: string | null;
} | null): { artist: string | null; title: string } {
  const cleanAudioName = cleanAutoSearchPart(audioFileName);
  let artist = metadata?.artist ? cleanAutoSearchPart(metadata.artist) : '';
  let title = metadata?.title ? cleanAutoSearchPart(metadata.title) : '';

  const titleParts = title ? splitAutoSearchParts(title) : [];
  if (titleParts.length >= 2) {
    artist = artist || titleParts[0];
    title = titleParts[1];
  }

  if ((!artist || !title) && cleanAudioName) {
    const parts = splitAutoSearchParts(cleanAudioName);

    if (parts.length >= 2) {
      artist = artist || parts[0];
      title = title || parts[1];
    } else {
      title = title || cleanAudioName;
    }
  }

  return {
    artist: artist || null,
    title: title || cleanAudioName,
  };
}

function getStemFileLabel(file: any, language: string) {
  const type = String(file?.type || '').toLowerCase();
  if (type.includes('vocal')) return language === 'ru' ? 'Вокал' : 'Vocals';
  if (type.includes('other') || type.includes('instrumental')) return language === 'ru' ? 'Минус' : 'Instrumental';
  return file?.type || (language === 'ru' ? 'Файл' : 'File');
}

function findInstrumentalStemFile(files: any[]) {
  return files.find((file) => {
    const type = String(file?.type || '').toLowerCase();
    return type.includes('other') || type.includes('instrumental');
  }) || null;
}

function getFriendlyInstrumentalName(sourceName: string | null, projectTitle: string | null, language: string) {
  const baseName = (projectTitle || sourceName || 'karaoke')
    .replace(/\.[^/.]+$/, '')
    .replace(/\s*\((?:минус|instrumental)\)\s*$/i, '')
    .trim() || 'karaoke';

  return `${baseName} (${language === 'ru' ? 'минус' : 'instrumental'}).mp3`;
}

function pickBestAutoSearchResult(
  results: LyricsProviderResult[],
  title: string,
  artist?: string | null
): LyricsProviderResult | null {
  if (results.length === 0) return null;

  const targetTitle = normalizeAutoSearchText(title);
  const targetArtist = artist ? normalizeAutoSearchText(artist) : '';

  const ranked = [...results]
    .map((result) => {
      const resultTitle = normalizeAutoSearchText(result.trackName);
      const resultArtist = normalizeAutoSearchText(result.artistName);
      let score = 0;

      if (resultTitle === targetTitle) score += 60;
      else if (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)) score += 35;

      if (targetArtist) {
        if (resultArtist === targetArtist) score += 40;
        else if (resultArtist.includes(targetArtist) || targetArtist.includes(resultArtist)) score += 20;
      }

      if (result.syncedLyrics) score += 10;
      return { result, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.result || null;
}

async function searchAutoLyricsWithFallbacks(
  queries: string[],
  title: string,
  artist?: string | null
): Promise<LyricsProviderResult | null> {
  const uniqueQueries = Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));

  for (const query of uniqueQueries) {
    const results = await searchAllLyrics(query);
    const best = pickBestAutoSearchResult(results, title, artist);
    if (best) return best;
  }

  return null;
}

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
    currentProjectTitle,
    setCurrentProjectTitle,
    setStep,
    rawText,
    setRawText,
    setLines,
    user,
    userProfile
  } = useKaraokeStore();

  const [tgTracks, setTgTracks] = useState<any[]>([]);
  const [loadingTg, setLoadingTg] = useState(false);
  const [downloadingTgId, setDownloadingTgId] = useState<string | null>(null);
  const [showTgImport, setShowTgImport] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [stemJob, setStemJob] = useState<any | null>(null);
  const [stemBusy, setStemBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [lyricsSearchStatus, setLyricsSearchStatus] = useState<'idle' | 'searching' | 'found' | 'not_found'>('idle');

  const dict = localization[language];
  const canUseMvsep = !!user && (
    userProfile?.role === 'admin' ||
    userProfile?.role === 'pro' ||
    (userProfile?.plan === 'plus' && !!userProfile?.plus_until && new Date(userProfile.plus_until).getTime() > Date.now())
  );

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

  const autoSearchedFileRef = useRef<string | null>(null);
  const activeAutoSearchTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (audioFileName) {
      autoSearchedFileRef.current = null;
      activeAutoSearchTokenRef.current = null;
      setLyricsSearchStatus('idle');
    }
  }, [audioFileName]);

  // Автопоиск текста песни при наличии трека (срабатывает как при загрузке, так и при восстановлении из IndexedDB)
  useEffect(() => {
    if (audioUrl && audioFileName && !rawText.trim()) {
      const searchAudioFileName = audioFileName;

      const cleanAudioName = cleanAutoSearchPart(audioFileName);
      const { artist, title } = parseAutoSearchMetadata(audioFileName, trackMetadata);

      if (title || cleanAudioName) {
        const searchTitle = title || cleanAudioName;
        const queryCandidates = [
          artist ? `${artist} - ${searchTitle}` : '',
          artist ? `${artist} ${searchTitle}` : '',
          searchTitle,
          cleanAudioName,
        ];
        const autoSearchKey = `${audioFileName}|${artist || ''}|${searchTitle}`;
        if (autoSearchedFileRef.current === autoSearchKey) {
          return;
        }

        autoSearchedFileRef.current = autoSearchKey;
        const autoSearchToken = `${autoSearchKey}|${performance.now()}`;
        activeAutoSearchTokenRef.current = autoSearchToken;
        setLyricsSearchStatus('searching');
        const searchPromise = searchAutoLyricsWithFallbacks(queryCandidates, searchTitle, artist);

        searchPromise.then((result) => {
          if (
            activeAutoSearchTokenRef.current !== autoSearchToken ||
            useKaraokeStore.getState().audioFileName !== searchAudioFileName
          ) {
            return;
          }
          if (result) {
            if (result.syncedLyrics) {
              const parsed = parseLRC(result.syncedLyrics);
              setLines(parsed);
              setRawText(result.syncedLyrics);
              setStep('timing');
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
          if (
            activeAutoSearchTokenRef.current !== autoSearchToken ||
            useKaraokeStore.getState().audioFileName !== searchAudioFileName
          ) {
            return;
          }
          console.warn('Auto-search lyrics failed:', err);
          setLyricsSearchStatus('not_found');
        });
      } else {
        setLyricsSearchStatus('not_found');
      }
    } else if (!audioUrl) {
      activeAutoSearchTokenRef.current = null;
      setLyricsSearchStatus('idle');
    }
  }, [audioUrl, audioFileName, trackMetadata, rawText, language, setLines, setRawText]);

  const handleFile = async (file: File, meta?: { artist: string | null; title: string | null }) => {
    const isAudioMime = file.type.startsWith('audio/');
    const hasAudioExtension = /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
    if (!isAudioMime && !hasAudioExtension) {
      alert(language === 'ru' ? 'Пожалуйста, выберите корректный аудиофайл (MP3, WAV, OGG, M4A)' : 'Please select a valid audio file (MP3, WAV, OGG, M4A)');
      return;
    }

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    setRawText('');
    setLines([]);
    setCurrentProjectTitle(null);
    const initialMetadata = meta
      ? { artist: meta.artist || null, title: meta.title || null, album: null as string | null }
      : null;
    setTrackMetadata(initialMetadata);
    setLyricsSearchStatus('idle');

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
        const coverBlob = await blobUrlToBlob(cover);
        if (coverBlob) {
          await saveCoverToDB(coverBlob);
        }
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
    setRawText('');
    setLines([]);
    setCurrentProjectTitle(null);
    setIsPlaying(false);
    setPlayerTime(0);
    setPlayerDuration(0);
    setPlayerPlaying(false);
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

  const toggleAudioPlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch((err) => console.warn('Audio play failed:', err));
    } else {
      audio.pause();
    }
  };

  const handlePlayerSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !playerDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * playerDuration;
    setPlayerTime(audio.currentTime);
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
      trackAppEvent({
        eventName: 'telegram_audio_imported',
        userId: user?.id,
        telegramId: userProfile?.telegram_id || track.telegram_id || null,
        appMode: useKaraokeStore.getState().appMode,
        metadata: {
          trackId: track.id,
          fileName: track.file_name,
          artist: track.artist,
          title: track.title,
        },
      });
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

  const getCurrentAudioFile = async (): Promise<File | null> => {
    if (!audioUrl || !audioFileName) return null;
    const cachedFile = await loadAudioFromDB().catch(() => null);
    if (cachedFile) return cachedFile;

    const blob = audioUrl.startsWith('blob:')
      ? await blobUrlToBlob(audioUrl)
      : await fetch(audioUrl).then((response) => response.blob()).catch(() => null);

    if (!blob) return null;
    return new File([blob], audioFileName, { type: blob.type || 'audio/mpeg' });
  };

  const createMvsepJob = async () => {
    if (!canUseMvsep) {
      alert(language === 'ru' ? 'Разделение доступно только Plus/Pro пользователям.' : 'Stem separation is available for Plus/Pro users only.');
      return;
    }

    setStemBusy(true);
    try {
      const file = await getCurrentAudioFile();
      if (!file) throw new Error(language === 'ru' ? 'Не удалось прочитать текущий аудиофайл' : 'Could not read the current audio file');

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error(language === 'ru' ? 'Нужно войти через Telegram' : 'Please sign in first');

      const formData = new FormData();
      formData.append('audiofile', file);
      formData.append('sep_type', '40');
      formData.append('output_format', '0');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mvsep-stems?action=create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'MVSEP job failed');
      setStemJob(result.job);
    } catch (err: any) {
      alert(err.message || (language === 'ru' ? 'Не удалось создать задачу MVSEP' : 'Could not create MVSEP job'));
    } finally {
      setStemBusy(false);
    }
  };

  const refreshMvsepJob = async () => {
    if (!stemJob?.id) return;
    setStemBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error(language === 'ru' ? 'Нужно войти через Telegram' : 'Please sign in first');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mvsep-stems?action=refresh&job_id=${encodeURIComponent(stemJob.id)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'MVSEP refresh failed');
      setStemJob(result.job);
    } catch (err: any) {
      alert(err.message || (language === 'ru' ? 'Не удалось обновить статус MVSEP' : 'Could not refresh MVSEP job'));
    } finally {
      setStemBusy(false);
    }
  };

  const useMvsepInstrumental = async () => {
    const instrumentalFile = findInstrumentalStemFile(stemJob?.result_files || []);
    if (!instrumentalFile?.url) {
      alert(language === 'ru' ? 'Минус пока не готов' : 'Instrumental is not ready yet');
      return;
    }

    setStemBusy(true);
    try {
      const response = await fetch(instrumentalFile.url);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const blob = await response.blob();
      const fileName = getFriendlyInstrumentalName(audioFileName, currentProjectTitle, language);
      const file = new File([blob], fileName, { type: blob.type || 'audio/mpeg' });
      const url = URL.createObjectURL(file);
      const titleBeforeReplace = currentProjectTitle;

      setAudio(url, file.name);
      setTrackMetadata(null);
      await saveAudioToDB(file);
      if (titleBeforeReplace) setCurrentProjectTitle(titleBeforeReplace);
    } catch (err: any) {
      alert(err.message || (language === 'ru' ? 'Не удалось подставить минус' : 'Could not use the instrumental'));
    } finally {
      setStemBusy(false);
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
    <div id="audio-loader-section" className="w-full max-w-2xl mx-auto">
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
                  : 'border-violet-200/70 hover:border-violet-300 bg-white/76 hover:bg-white/88 backdrop-blur-xl shadow-sm shadow-violet-200/40'
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
                className={`flex items-center gap-2 px-5 py-2.5 border font-semibold rounded-xl text-sm transition-all shadow-sm cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800 text-violet-400 hover:text-violet-300'
                    : 'bg-white/72 border-violet-200/70 hover:border-violet-300 hover:bg-white/90 text-violet-700 hover:text-violet-800 backdrop-blur-xl shadow-violet-200/50'
                }`}
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
                      : theme === 'dark'
                        ? 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800 text-sky-400 hover:text-sky-300'
                        : 'bg-white/72 border-sky-200/70 hover:border-sky-300 hover:bg-white/90 text-sky-600 hover:text-sky-700 backdrop-blur-xl shadow-sky-200/40'
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
                  <div className="flex flex-col gap-3">
                    <div className={`rounded-xl border p-3 text-[11px] ${
                      theme === 'dark'
                        ? 'border-violet-500/20 bg-violet-500/10 text-zinc-200'
                        : 'border-violet-200 bg-violet-50/70 text-zinc-700'
                    }`}>
                      <p className="font-black text-violet-500 dark:text-violet-300">
                        {language === 'ru' ? 'Быстрый путь к первому караоке' : 'Fast path to your first karaoke'}
                      </p>
                      <ol className="mt-2 space-y-1 font-semibold leading-relaxed text-zinc-600 dark:text-zinc-300">
                        <li>{language === 'ru' ? '1. Выберите трек ниже.' : '1. Pick a track below.'}</li>
                        <li>{language === 'ru' ? '2. Нажмите «Поиск текста» или дождитесь автопоиска.' : '2. Use lyrics search or wait for auto-search.'}</li>
                        <li>{language === 'ru' ? '3. Проверьте живой плеер и переходите к экспорту.' : '3. Check the live player, then export.'}</li>
                      </ol>
                    </div>

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
                            <p className="text-[9px] text-zinc-500 dark:text-zinc-500 font-mono mt-0.5">
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
              ? 'bg-zinc-900/75 border-white/10 text-zinc-100 shadow-black/20'
              : 'bg-white/82 backdrop-blur-xl border-white/70 text-zinc-900 shadow-violet-200/35'
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
                    className="w-14 h-14 rounded-xl object-cover shadow border border-zinc-200/10 group-hover:brightness-50 transition-all"
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
                className={`p-2 rounded-lg transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer border ${
                  theme === 'dark'
                    ? 'text-violet-300 hover:text-violet-200 hover:bg-zinc-800 border-transparent hover:border-white/10'
                    : 'text-violet-600 hover:text-violet-700 hover:bg-violet-50 border-transparent hover:border-violet-100'
                }`}
                title={dict.lyricsSearchBtn}
              >
                <Search size={16} />
                <span className="hidden sm:inline">{dict.lyricsSearchBtn}</span>
              </button>

              <button
                onClick={removeAudio}
                className="p-2 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
                title={language === 'ru' ? 'Заменить аудио' : 'Replace audio'}
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>

          <div
            className={`mt-2 rounded-2xl p-3 flex items-center gap-3 border ${
              theme === 'dark'
                ? 'bg-zinc-950/80 border-white/10'
                : 'bg-zinc-100/80 border-zinc-200'
            }`}
          >
            <button
              type="button"
              onClick={toggleAudioPlayback}
              className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center shadow-md shadow-violet-500/20 active:scale-95 transition-all shrink-0"
              title={playerPlaying ? (language === 'ru' ? 'Пауза' : 'Pause') : (language === 'ru' ? 'Воспроизвести' : 'Play')}
            >
              {playerPlaying ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
            </button>

            <span className="font-mono text-[11px] font-bold text-violet-500 dark:text-violet-300 tabular-nums shrink-0">
              {formatTime(playerTime).slice(0, 5)}
            </span>

            <div
              onClick={handlePlayerSeek}
              className={`h-2.5 flex-1 rounded-full overflow-hidden cursor-pointer ${
                theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-300/70'
              }`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-75"
                style={{ width: `${playerDuration > 0 ? Math.min(100, (playerTime / playerDuration) * 100) : 0}%` }}
              />
            </div>

            <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
              {formatTime(playerDuration).slice(0, 5)}
            </span>

          </div>

          {canUseMvsep && (
            <div className={`mt-3 rounded-2xl border p-3 ${
              theme === 'dark'
                ? 'border-cyan-500/20 bg-cyan-500/10 text-zinc-200'
                : 'border-cyan-200 bg-cyan-50/70 text-zinc-700'
            }`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-black text-cyan-600 dark:text-cyan-300">
                    <Wand2 size={14} />
                    <span>{language === 'ru' ? 'Минус для караоке через MVSEP' : 'Karaoke instrumental via MVSEP'}</span>
                  </p>
                  <p className="mt-1 text-[10px] font-semibold leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {stemJob
                      ? `${language === 'ru' ? 'Статус' : 'Status'}: ${stemJob.status}${stemJob.mvsep_status ? ` / ${stemJob.mvsep_status}` : ''}`
                      : (language === 'ru'
                        ? 'MP3 320, очередь на сервере. Пока MVSEP free — активна одна задача одновременно.'
                        : 'MP3 320, server-side queue. While MVSEP is free, only one job runs at a time.')}
                  </p>
                  {stemJob?.error_message && (
                    <p className="mt-1 text-[10px] font-semibold text-red-500">{stemJob.error_message}</p>
                  )}
                  {stemJob?.provider_job_url && (
                    <a
                      href={stemJob.provider_job_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex text-[10px] font-bold text-cyan-600 underline-offset-2 hover:underline dark:text-cyan-300"
                    >
                      {language === 'ru' ? 'Открыть задачу MVSEP' : 'Open MVSEP job'}
                    </a>
                  )}
                  {Array.isArray(stemJob?.result_files) && stemJob.result_files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {stemJob.result_files.map((file: any, index: number) => (
                        <a
                          key={`${file?.url || file?.download || index}`}
                          href={file?.url}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-[10px] font-black transition-all ${
                            theme === 'dark'
                              ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/15'
                              : 'border-cyan-200 bg-white/70 text-cyan-700 hover:bg-white'
                          }`}
                        >
                          {getStemFileLabel(file, language)}
                          {file?.size ? ` · ${file.size}` : ''}
                        </a>
                      ))}
                      {findInstrumentalStemFile(stemJob.result_files) && (
                        <button
                          type="button"
                          onClick={useMvsepInstrumental}
                          disabled={stemBusy}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black transition-all disabled:opacity-50 ${
                            theme === 'dark'
                              ? 'bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/20'
                              : 'bg-emerald-500 text-white hover:bg-emerald-600'
                          }`}
                        >
                          {stemBusy && <Loader2 size={11} className="animate-spin" />}
                          {language === 'ru' ? 'Использовать минус' : 'Use instrumental'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  {stemJob?.id && !['completed', 'failed', 'cancelled'].includes(stemJob.status) && (
                    <button
                      type="button"
                      onClick={refreshMvsepJob}
                      disabled={stemBusy}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/25 px-3 py-2 text-xs font-black text-cyan-600 transition-all hover:bg-cyan-500/10 disabled:opacity-50 dark:text-cyan-300"
                    >
                      {stemBusy && <Loader2 size={13} className="animate-spin" />}
                      {language === 'ru' ? 'Обновить' : 'Refresh'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={createMvsepJob}
                    disabled={stemBusy}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 px-3 py-2 text-xs font-black text-white shadow-md shadow-cyan-500/20 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
                  >
                    {stemBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                    {stemJob ? (language === 'ru' ? 'Новая задача' : 'New job') : (language === 'ru' ? 'Сделать минус' : 'Create instrumental')}
                  </button>
                </div>
              </div>
            </div>
          )}

          <audio
            ref={(el) => {
              audioRef.current = el;
            }}
            src={audioUrl}
            preload="auto"
            onLoadedMetadata={(e) => {
              setPlayerDuration(e.currentTarget.duration || 0);
              setPlayerTime(e.currentTarget.currentTime || 0);
            }}
            onTimeUpdate={(e) => {
              setPlayerTime(e.currentTarget.currentTime || 0);
              setPlayerDuration(e.currentTarget.duration || 0);
            }}
            onPlay={() => {
              setIsPlaying(true);
              setPlayerPlaying(true);
            }}
            onPause={() => {
              setIsPlaying(false);
              setPlayerPlaying(false);
            }}
            onEnded={() => {
              setIsPlaying(false);
              setPlayerPlaying(false);
            }}
            className="hidden"
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
