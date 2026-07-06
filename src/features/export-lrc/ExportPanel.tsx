import React, { useState, useEffect } from 'react';
import { useKaraokeStore, getDefaultProjectTitle } from '../../store/useKaraokeStore';
import { generateLRC } from '../../utils/lrc';
import { generateSRT, generateASS, generateVTT } from '../../utils/subtitleFormats';
import { FileDown, Copy, Check, AlertTriangle, Layers, Database, Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { localization } from '../../utils/localization';
import { loadAudioFromDB, loadCoverFromDB } from '../../utils/db';
import { AuthSection } from '../../components/AuthSection';
import { supabase } from '../../services/supabaseClient';

type ExportFormat = 'lrc' | 'srt' | 'ass' | 'vtt';

export const ExportPanel: React.FC = () => {
  const {
    lines,
    audioFileName,
    currentProjectTitle,
    setCurrentProjectTitle,
    theme,
    videoStyle,
    language,
    user,
    userProfile,
    publishKaraokeTrack,
    trackMetadata,
    dailyPublishLimitFree,
    dailyPublishLimitPro,
  } = useKaraokeStore();
  const [format, setFormat] = useState<ExportFormat>('lrc');
  const dict = localization[language];
  const [copied, setCopied] = useState(false);

  // State for publishing
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
  
  const [hasLocalAudio, setHasLocalAudio] = useState(false);
  const [hasLocalCover, setHasLocalCover] = useState(false);
  const [uploadAudio, setUploadAudio] = useState(false);
  const [uploadCover, setUploadCover] = useState(false);
  
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [pubErrorMsg, setPubErrorMsg] = useState('');

  // Initializing state with metadata or parsed project title
  useEffect(() => {
    if (trackMetadata) {
      setArtist(trackMetadata.artist || '');
      setTitle(trackMetadata.title || '');
      setAlbum(trackMetadata.album || '');
    } else {
      const projTitle = currentProjectTitle || '';
      if (projTitle.includes(' - ')) {
        const parts = projTitle.split(' - ');
        setArtist(parts[0].trim());
        setTitle(parts[1].trim());
      } else {
        setTitle(projTitle);
      }
    }
  }, [trackMetadata, currentProjectTitle]);

  // Check files in DB
  useEffect(() => {
    const checkDBFiles = async () => {
      try {
        const audioFile = await loadAudioFromDB();
        setHasLocalAudio(!!audioFile);
        setUploadAudio(!!audioFile);

        const coverFile = await loadCoverFromDB();
        setHasLocalCover(!!coverFile);
        setUploadCover(!!coverFile);
      } catch (err) {
        console.error('Failed to load DB files on export panel init:', err);
      }
    };
    checkDBFiles();
  }, []);

  const handlePublish = async () => {
    if (!artist.trim() || !title.trim()) {
      alert(language === 'ru' ? 'Заполните Исполнителя и Название песни!' : 'Please fill in Artist and Song Title!');
      return;
    }
    setPublishing(true);
    setPublishStatus('idle');
    setPubErrorMsg('');

    try {
      if (user) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count, error: countErr } = await supabase
          .from('published_karaoke')
          .select('*', { count: 'exact', head: true })
          .eq('publisher_id', user.id)
          .gte('created_at', oneDayAgo);

        if (countErr) {
          console.error('Failed to check publish limit:', countErr);
        } else {
          const userRole = userProfile?.role || 'free';
          const limit = userRole === 'admin' 
            ? 99999 
            : userRole === 'pro' 
              ? dailyPublishLimitPro 
              : dailyPublishLimitFree;

          if (count !== null && count >= limit) {
            setPublishStatus('error');
            setPubErrorMsg(
              language === 'ru'
                ? `Превышен суточный лимит публикаций (${limit} в сутки) для вашего тарифа (${userRole === 'pro' ? 'PRO' : 'FREE'}).`
                : `Daily publish limit exceeded (${limit} per day) for your tier (${userRole === 'pro' ? 'PRO' : 'FREE'}).`
            );
            setPublishing(false);
            return;
          }
        }
      }

      const audioFile = uploadAudio ? await loadAudioFromDB() : undefined;
      const coverFile = uploadCover ? await loadCoverFromDB() : undefined;

      const res = await publishKaraokeTrack({
        artist: artist.trim(),
        title: title.trim(),
        album: album.trim() || undefined,
        lines,
        videoStyle,
        audioFile: audioFile || undefined,
        coverFile: coverFile ? (coverFile instanceof File ? coverFile : new File([coverFile], 'cover.png', { type: coverFile.type })) : undefined,
      });

      if (res.success) {
        setPublishStatus('success');
      } else {
        setPublishStatus('error');
        setPubErrorMsg(res.error || 'Unknown error');
      }
    } catch (err: any) {
      console.error(err);
      setPublishStatus('error');
      setPubErrorMsg(err.message || 'Unknown error');
    } finally {
      setPublishing(false);
    }
  };

  const timedLinesCount = lines.filter((line) => line.time !== null).length;

  // Generate text dynamically based on active formatting select
  let previewContent = '';
  if (timedLinesCount > 0) {
    if (format === 'srt') {
      previewContent = generateSRT(lines);
    } else if (format === 'ass') {
      previewContent = generateASS(lines, videoStyle.fontFamily, 20);
    } else if (format === 'vtt') {
      previewContent = generateVTT(lines);
    } else {
      const fileNameToUse = (currentProjectTitle || '').trim() || getDefaultProjectTitle(audioFileName, lines, language);
      previewContent = generateLRC(lines, fileNameToUse);
    }
  }

  const handleDownload = () => {
    if (timedLinesCount === 0) {
      alert(language === 'ru' ? 'Нет строк с проставленными таймингами для экспорта!' : 'No timed lines to export!');
      return;
    }
    
    const baseName = (currentProjectTitle || '').trim() || getDefaultProjectTitle(audioFileName, lines, language);
    
    const blob = new Blob([previewContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    if (timedLinesCount === 0) return;
    
    navigator.clipboard.writeText(previewContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className={`h-full rounded-2xl p-6 border shadow-sm transition-all ${
        theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
      }`}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-1.5">
            <Layers size={18} className="text-violet-500" /> Экспорт субтитров и таймингов
          </h3>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
            Скачайте файл разметки караоке в любом удобном для вас формате
          </p>
        </div>

        {/* Format selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className={`p-2 rounded-xl text-xs border font-bold focus:outline-none transition-colors ${
              theme === 'dark'
                ? 'bg-zinc-900 border-zinc-800 text-zinc-300'
                : 'bg-zinc-100 border-zinc-200 text-zinc-700'
            }`}
          >
            <option value="lrc">Караоке (.LRC)</option>
            <option value="srt">SubRip (.SRT)</option>
            <option value="ass">SubStation (.ASS)</option>
            <option value="vtt">WebVTT (.VTT)</option>
          </select>

          {timedLinesCount > 0 && (
            <button
              onClick={handleCopy}
              className={`p-2.5 rounded-xl border transition-colors flex items-center gap-1.5 text-xs font-medium ${
                theme === 'dark'
                  ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                  : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-700'
              }`}
              title="Копировать в буфер обмена"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-green-500" />
                  Скопировано!
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Копировать
                </>
              )}
            </button>
          )}

          <button
            onClick={handleDownload}
            disabled={timedLinesCount === 0}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all ${
              timedLinesCount === 0
                ? 'bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600 cursor-not-allowed shadow-none'
                : 'bg-violet-600 hover:bg-violet-700 text-white shadow-violet-600/15 hover:scale-[1.01] active:scale-95'
            }`}
          >
            <FileDown size={15} />
            Скачать
          </button>
        </div>
      </div>

      {timedLinesCount === 0 ? (
        <div className="flex flex-col items-center justify-center border border-dashed border-yellow-500/35 rounded-xl p-8 text-center bg-yellow-500/[0.02]">
          <AlertTriangle className="text-yellow-500 mb-3" size={32} />
          <h4 className="text-sm font-bold text-yellow-600 dark:text-yellow-400">
            Нет строк с таймингами
          </h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mt-1">
            Вы пока не проставили временные метки ни для одной из строк. Перейдите на шаг{' '}
            <strong>«Тайминги»</strong>, чтобы разметить текст под музыку.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Filename Input */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {dict.exportFilenameLabel || 'Название файла при экспорте'}
            </label>
            <input
              type="text"
              value={currentProjectTitle || getDefaultProjectTitle(audioFileName, lines, language)}
              onChange={(e) => setCurrentProjectTitle(e.target.value)}
              placeholder={dict.exportFilenamePlaceholder || 'Введите название файла...'}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all duration-300 ${
                theme === 'dark' ? 'bg-zinc-950/50 backdrop-blur-md border-white/5 text-zinc-100 hover:border-white/10 focus:border-violet-500/40' : 'bg-zinc-50 border-zinc-200 text-zinc-900'
              }`}
            />
          </div>

          <div className="flex justify-between text-xs font-semibold text-zinc-400 dark:text-zinc-500">
            <span>ПРЕДПРОСМОТР ФАЙЛА ({format.toUpperCase()})</span>
            <span>
              {timedLinesCount} {language === 'ru' ? 'из' : 'of'} {lines.length} {language === 'ru' ? 'строк размечено' : 'lines timed'}
            </span>
          </div>
          
          <textarea
            readOnly
            value={previewContent}
            rows={8}
            className={`w-full p-4 rounded-xl font-mono text-xs border resize-none focus:outline-none transition-all duration-300 ${
              theme === 'dark'
                ? 'bg-zinc-950/30 backdrop-blur-md border-white/5 text-zinc-300'
                : 'bg-zinc-50 border-zinc-200 text-zinc-800'
            }`}
          />

          {/* Cloud Publishing Card */}
          <div className={`mt-6 rounded-2xl border p-5 transition-all duration-300 ${
            theme === 'dark'
              ? 'bg-zinc-900/40 backdrop-blur-xl border-white/5 text-zinc-100 hover:border-violet-500/20 shadow-xl shadow-black/10'
              : 'bg-zinc-50 border-zinc-200 text-zinc-900'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <Database className="text-violet-500" size={18} />
              <h4 className="font-extrabold text-sm uppercase tracking-wider">
                {language === 'ru' ? 'Публикация в базу караоке' : 'Publish to Karaoke DB'}
              </h4>
            </div>

            <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mb-4 leading-relaxed">
              {language === 'ru'
                ? 'Опубликуйте эту песню в общий каталог, чтобы вы и другие пользователи могли мгновенно запустить её в режиме «Караоке».'
                : 'Publish this track to the shared catalog so you and other users can instantly sing it in Karaoke mode.'}
            </p>

            {!user ? (
              <div className="flex flex-col gap-3">
                <div className="p-3 border border-yellow-500/20 bg-yellow-500/[0.02] text-yellow-600 dark:text-yellow-400 rounded-xl text-[11px] leading-relaxed">
                  ⚠️ {language === 'ru'
                    ? 'Для публикации песен требуется авторизация через Telegram. Пожалуйста, войдите в аккаунт ниже:'
                    : 'Log in with Telegram is required to publish songs. Please authenticate below:'}
                </div>
                <AuthSection />
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Inputs grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                      {language === 'ru' ? 'Исполнитель' : 'Artist'}
                    </label>
                    <input
                      type="text"
                      value={artist}
                      onChange={(e) => setArtist(e.target.value)}
                      placeholder={language === 'ru' ? 'Исполнитель...' : 'Artist name...'}
                      className={`w-full px-3 py-2 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all duration-300 ${
                        theme === 'dark' ? 'bg-zinc-950/50 backdrop-blur-md border-white/5 text-zinc-100 hover:border-white/10 focus:border-violet-500/40' : 'bg-white border-zinc-200 text-zinc-900'
                      }`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                      {language === 'ru' ? 'Название трека' : 'Track Title'}
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={language === 'ru' ? 'Название...' : 'Track title...'}
                      className={`w-full px-3 py-2 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all duration-300 ${
                        theme === 'dark' ? 'bg-zinc-950/50 backdrop-blur-md border-white/5 text-zinc-100 hover:border-white/10 focus:border-violet-500/40' : 'bg-white border-zinc-200 text-zinc-900'
                      }`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                      {language === 'ru' ? 'Альбом (опционально)' : 'Album (optional)'}
                    </label>
                    <input
                      type="text"
                      value={album}
                      onChange={(e) => setAlbum(e.target.value)}
                      placeholder={language === 'ru' ? 'Альбом...' : 'Album...'}
                      className={`w-full px-3 py-2 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all duration-300 ${
                        theme === 'dark' ? 'bg-zinc-950/50 backdrop-blur-md border-white/5 text-zinc-100 hover:border-white/10 focus:border-violet-500/40' : 'bg-white border-zinc-200 text-zinc-900'
                      }`}
                    />
                  </div>
                </div>

                {/* Toggles */}
                <div className="flex flex-col gap-2.5 bg-zinc-100/50 dark:bg-zinc-950/20 p-3 rounded-xl border border-zinc-200/40 dark:border-white/5">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs">
                    <input
                      type="checkbox"
                      checked={uploadAudio}
                      disabled={!hasLocalAudio}
                      onChange={(e) => setUploadAudio(e.target.checked)}
                      className="rounded text-violet-650 focus:ring-violet-500 h-4 w-4 border-zinc-300 dark:border-zinc-800"
                    />
                    <div className="flex flex-col">
                      <span className={!hasLocalAudio ? 'text-zinc-500 dark:text-zinc-700 line-through' : 'font-semibold text-zinc-800 dark:text-zinc-200'}>
                        {language === 'ru' ? 'Загрузить аудиофайл на сервер' : 'Upload audio file to server'}
                      </span>
                      <span className="text-[9px] text-zinc-400 dark:text-zinc-500">
                        {hasLocalAudio
                          ? (language === 'ru' ? 'Позволит запускать трек онлайн без локальных файлов' : 'Allows playing the song online without local files')
                          : (language === 'ru' ? 'Локальный аудиофайл не найден в кэше' : 'Local audio file not found in cache')}
                      </span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs border-t border-zinc-200/30 dark:border-zinc-800/40 pt-2">
                    <input
                      type="checkbox"
                      checked={uploadCover}
                      disabled={!hasLocalCover}
                      onChange={(e) => setUploadCover(e.target.checked)}
                      className="rounded text-violet-650 focus:ring-violet-500 h-4 w-4 border-zinc-300 dark:border-zinc-800"
                    />
                    <div className="flex flex-col">
                      <span className={!hasLocalCover ? 'text-zinc-500 dark:text-zinc-700 line-through' : 'font-semibold text-zinc-800 dark:text-zinc-200'}>
                        {language === 'ru' ? 'Загрузить обложку на сервер' : 'Upload cover art to server'}
                      </span>
                      <span className="text-[9px] text-zinc-400 dark:text-zinc-500">
                        {hasLocalCover
                          ? (language === 'ru' ? 'Добавит изображение обложки в карточку каталога' : 'Adds cover image to the catalog card')
                          : (language === 'ru' ? 'Изображение обложки отсутствует' : 'Cover image not found')}
                      </span>
                    </div>
                  </label>
                </div>

                {/* Publish Button and Status */}
                <div className="flex items-center gap-4 flex-wrap">
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    className={`px-4.5 py-2.5 rounded-xl font-extrabold text-xs flex items-center gap-2 shadow-md transition-all duration-300 cursor-pointer ${
                      publishing
                        ? 'bg-zinc-200 text-zinc-455 dark:bg-zinc-800 dark:text-zinc-700 cursor-wait'
                        : 'bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 hover:opacity-95 text-white shadow-lg shadow-violet-500/10 hover:scale-[1.015] active:scale-95 border border-violet-500/20'
                    }`}
                  >
                    {publishing ? (
                      <>
                        <Loader2 className="animate-spin" size={14} />
                        {language === 'ru' ? 'Публикация...' : 'Publishing...'}
                      </>
                    ) : (
                      <>
                        <Upload size={14} />
                        {language === 'ru' ? 'Опубликовать в общую базу' : 'Publish to Catalog'}
                      </>
                    )}
                  </button>

                  {publishStatus === 'success' && (
                    <span className="text-xs font-semibold text-emerald-500 flex items-center gap-1">
                      <CheckCircle size={14} />
                      {language === 'ru' ? 'Успешно опубликовано!' : 'Published successfully!'}
                    </span>
                  )}

                  {publishStatus === 'error' && (
                    <span className="text-xs font-semibold text-red-500 flex items-center gap-1">
                      <AlertCircle size={14} />
                      {language === 'ru' ? `Ошибка: ${pubErrorMsg}` : `Error: ${pubErrorMsg}`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
