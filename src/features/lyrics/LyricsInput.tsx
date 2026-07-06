import React, { useRef } from 'react';
import { useKaraokeStore } from '../../store/useKaraokeStore';
import { parseLRC } from '../../utils/lrc';
import { parseSRT, parseVTT, parseASS } from '../../utils/subtitleFormats';
import { localization } from '../../utils/localization';
import { FileText, Upload, ArrowRight } from 'lucide-react';

export const LyricsInput: React.FC = () => {
  const {
    rawText,
    setRawText,
    prepareLines,
    setLines,
    lines,
    setStep,
    theme,
    language,
  } = useKaraokeStore();

  const lrcInputRef = useRef<HTMLInputElement>(null);

  const dict = localization[language];

  const handleLrcImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const ext = file.name.split('.').pop()?.toLowerCase();
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          let parsed = null;
          
          if (ext === 'srt') {
            parsed = parseSRT(content);
          } else if (ext === 'vtt') {
            parsed = parseVTT(content);
          } else if (ext === 'ass') {
            parsed = parseASS(content);
          } else {
            parsed = parseLRC(content);
          }

          if (parsed && parsed.length > 0) {
            setLines(parsed);
            const reconstructedRaw = parsed.map((l) => l.text).join('\n');
            setRawText(reconstructedRaw);
            setStep('edit');
          } else {
            alert(language === 'ru' ? 'Не удалось распознать строки в импортируемом файле.' : 'Failed to parse subtitles in imported file.');
          }
        }
      };
      reader.readAsText(file);
    }
  };

  const handlePrepare = () => {
    if (!rawText.trim()) {
      alert(language === 'ru' ? 'Пожалуйста, введите или вставьте текст песни' : 'Please enter or paste song lyrics');
      return;
    }
    
    // Проверяем, есть ли уже размеченные строки
    const hasTimings = lines.some((l) => l.time !== null);
    // Проверяем, содержит ли новый текст LRC-теги
    const hasLrcTags = /\[\d+:\d+\.\d+\]|\[[a-zA-Z]+:/m.test(rawText);

    if (hasTimings && !hasLrcTags) {
      const confirmReset = window.confirm(
        language === 'ru' 
          ? 'У вас уже есть размеченные тайминги. При обновлении текста они будут сброшены. Вы уверены, что хотите продолжить?'
          : 'You already have timings. Updating the text will reset them. Are you sure you want to continue?'
      );
      if (!confirmReset) {
        // Если юзер отменил, просто перекидываем его на 2 шаг без пересоздания строк
        setStep('timing');
        return;
      }
    }
    
    prepareLines();
  };

  return (
    <div id="lyrics-input-section" className="flex flex-col gap-6">
      <div
        className={`rounded-2xl p-6 border shadow-sm transition-all ${
          theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-white/82 backdrop-blur-xl border-white/70 shadow-violet-200/35'
        }`}
      >
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <FileText className="text-violet-500 dark:text-violet-400" size={20} />
            <h3 className="font-semibold text-lg">{dict.lyricsInputTitle}</h3>
          </div>
          
          <div>
            <input
              type="file"
              ref={lrcInputRef}
              onChange={handleLrcImport}
              accept=".lrc,.srt,.vtt,.ass"
              className="hidden"
            />
            <button
              onClick={() => lrcInputRef.current?.click()}
              className={`text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                theme === 'dark'
                  ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300'
                  : 'bg-white/70 border-zinc-200/80 hover:bg-white text-zinc-700 shadow-sm'
              }`}
            >
              <Upload size={14} />
              {dict.lyricsImportBtn}
            </button>
          </div>
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-3">
          {dict.lyricsHelpText}
        </p>

        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={dict.lyricsPlaceholder}
          rows={14}
          className={`w-full p-4 rounded-xl font-mono text-sm border resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all ${
            theme === 'dark'
              ? 'bg-zinc-900/60 border-zinc-800 text-zinc-100 placeholder-zinc-600'
              : 'bg-white/58 border-zinc-200/80 text-zinc-900 placeholder-zinc-500 shadow-inner shadow-zinc-200/40'
          }`}
        />

        <div className="mt-4 flex justify-end">
          <button
            onClick={handlePrepare}
            className="px-6 py-3 rounded-xl font-medium bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-600/15 transition-all duration-250 flex items-center gap-2 hover:scale-[1.01] active:scale-95"
          >
            {dict.lyricsPrepareBtn}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>

      <div
        className={`rounded-2xl p-5 border transition-all ${
          theme === 'dark' ? 'bg-zinc-900/30 border-zinc-800/60' : 'bg-white/58 backdrop-blur-xl border-white/65'
        }`}
      >
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
          {dict.lyricsQuickStartTitle}
        </h4>
        <ul className="list-disc pl-4 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          <li>{dict.lyricsQuickStartItem1}</li>
          <li>{dict.lyricsQuickStartItem2}</li>
        </ul>
      </div>
    </div>
  );
};
