import React, { useState } from 'react';
import { useKaraokeStore, getDefaultProjectTitle } from '../../store/useKaraokeStore';
import { generateLRC } from '../../utils/lrc';
import { generateSRT, generateASS, generateVTT } from '../../utils/subtitleFormats';
import { FileDown, Copy, Check, AlertTriangle, Layers } from 'lucide-react';
import { localization } from '../../utils/localization';

type ExportFormat = 'lrc' | 'srt' | 'ass' | 'vtt';

export const ExportPanel: React.FC = () => {
  const {
    lines,
    audioFileName,
    currentProjectTitle,
    setCurrentProjectTitle,
    theme,
    videoStyle,
    language
  } = useKaraokeStore();
  const [format, setFormat] = useState<ExportFormat>('lrc');
  const dict = localization[language];
  const [copied, setCopied] = useState(false);

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
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all ${
                theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-zinc-50 border-zinc-200 text-zinc-900'
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
            className={`w-full p-4 rounded-xl font-mono text-xs border resize-none focus:outline-none transition-all ${
              theme === 'dark'
                ? 'bg-zinc-900/60 border-zinc-800 text-zinc-300'
                : 'bg-zinc-50 border-zinc-200 text-zinc-800'
            }`}
          />
        </div>
      )}
    </div>
  );
};
