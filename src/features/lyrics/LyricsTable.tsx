import React, { useState } from 'react';
import { useKaraokeStore } from '../../store/useKaraokeStore';
import { formatTime, parseTime } from '../../utils/time';
import { audioRef } from '../../audioRef';
import { localization } from '../../utils/localization';
import { 
  Trash2, Clock, X, Plus, Minus, FastForward, ArrowLeft, 
  GripVertical, Scissors, Merge, HelpCircle, Undo2, RotateCw, ChevronDown, ChevronUp, Globe
} from 'lucide-react';

export const LyricsTable: React.FC = () => {
  const {
    lines,
    updateLineText,
    updateLineTime,
    shiftLineTime,
    deleteLine,
    removeLineTiming,
    shiftAllTimings,
    splitLine,
    mergeLines,
    reorderLines,
    updateWordTime,
    updateLineTranslation,
    setStep,
    theme,
    history,
    historyIndex,
    undo,
    redo,
    language,
  } = useKaraokeStore();

  // Detailed states
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showSplitDialog, setShowSplitDialog] = useState<string | null>(null);

  const dict = localization[language];

  const toggleExpand = (id: string) => {
    setExpandedLines((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleTextChange = (id: string, text: string) => {
    updateLineText(id, text);
  };

  const handleTimeManualChange = (id: string, val: string) => {
    if (val.trim() === '') {
      updateLineTime(id, null);
      return;
    }
    if (val.includes(':')) {
      updateLineTime(id, parseTime(val));
    } else {
      const secs = parseFloat(val);
      if (!isNaN(secs)) {
        updateLineTime(id, secs);
      }
    }
  };

  const handleWordTimeChange = (lineId: string, wordId: string, val: string) => {
    if (val.trim() === '') {
      updateWordTime(lineId, wordId, null);
      return;
    }
    if (val.includes(':')) {
      updateWordTime(lineId, wordId, parseTime(val));
    } else {
      const secs = parseFloat(val);
      if (!isNaN(secs)) {
        updateWordTime(lineId, wordId, secs);
      }
    }
  };

  const jumpToTime = (time: number | null) => {
    if (time !== null && audioRef.current) {
      audioRef.current.currentTime = time;
      audioRef.current.play().catch(() => {});
    }
  };

  const handleDragStart = (idx: number) => {
    setDraggedIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIdx) return;
    reorderLines(draggedIndex, targetIdx);
    setDraggedIndex(targetIdx);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div id="lyrics-table-section" className="w-full flex flex-col gap-6">
      {/* Header, global shift panel and undo/redo history stack */}
      <div
        className={`rounded-2xl p-6 border shadow-sm transition-all ${
          theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'
        }`}
      >
        <div className="flex items-center justify-between mb-5 flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep('timing')}
              className={`p-1.5 rounded-lg border transition-colors ${
                theme === 'dark'
                  ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300'
                  : 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-700'
              }`}
              title={language === 'ru' ? 'Назад к таймингам' : 'Back to timing'}
            >
              <ArrowLeft size={16} />
            </button>
            <h3 className="font-semibold text-lg">{dict.editorTitle}</h3>
          </div>

          {/* Core step undo/redo and stats */}
          <div className="flex items-center gap-2">
            {/* History management */}
            <div className="flex items-center gap-1.5 border border-zinc-200/20 bg-zinc-500/5 p-1 rounded-xl">
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className={`p-2 rounded-lg transition-all ${
                  historyIndex <= 0
                    ? 'opacity-35 cursor-not-allowed'
                    : theme === 'dark'
                    ? 'hover:bg-zinc-800 text-zinc-350'
                    : 'hover:bg-zinc-200 text-zinc-750'
                }`}
                title="Отменить действие"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className={`p-2 rounded-lg transition-all ${
                  historyIndex >= history.length - 1
                    ? 'opacity-35 cursor-not-allowed'
                    : theme === 'dark'
                    ? 'hover:bg-zinc-800 text-zinc-350'
                    : 'hover:bg-zinc-200 text-zinc-750'
                }`}
                title="Повторить действие"
              >
                <RotateCw size={14} />
              </button>
            </div>

            <span className="text-xs px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium">
              {dict.statsTimed} {lines.filter((l) => l.time !== null).length} / {lines.length}
            </span>
          </div>
        </div>

        {/* Shift All Timings Panel */}
        <div
          className={`rounded-xl p-4 border ${
            theme === 'dark'
              ? 'bg-zinc-900/40 border-zinc-800/70'
              : 'bg-zinc-50 border-zinc-200/70'
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3 flex items-center gap-1.5">
            <FastForward size={14} /> {dict.editorShiftAll}
          </p>
          
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => shiftAllTimings(-0.5)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-600 hover:bg-red-500/25 transition-colors"
            >
              -0.5 сек
            </button>
            <button
              onClick={() => shiftAllTimings(-0.2)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-600 hover:bg-red-500/25 transition-colors"
            >
              -0.2 сек
            </button>
            <div className="h-5 w-[1px] bg-zinc-200 dark:bg-zinc-800 mx-1" />
            <button
              onClick={() => shiftAllTimings(0.2)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/25 transition-colors"
            >
              +0.2 сек
            </button>
            <button
              onClick={() => shiftAllTimings(0.5)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/25 transition-colors"
            >
              +0.5 сек
            </button>
          </div>
        </div>
      </div>

      {/* Lines Table container */}
      <div
        className={`rounded-2xl border shadow-sm overflow-hidden transition-all max-h-[450px] overflow-y-auto ${
          theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'
        }`}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr
                className={`border-b text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 ${
                  theme === 'dark' ? 'bg-zinc-900/30 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                }`}
              >
                <th className="py-3 px-4 w-12 text-center">{language === 'ru' ? 'Перенос' : 'Reorder'}</th>
                <th className="py-3 px-4 w-12 text-center">№</th>
                <th className="py-3 px-4">{language === 'ru' ? 'Текст и Перевод' : 'Lyrics & Translation'}</th>
                <th className="py-3 px-4 w-36">Тайминг (мм:сс.хх)</th>
                <th className="py-3 px-4 w-64 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {lines.map((line, idx) => {
                const isExpanded = !!expandedLines[line.id];
                
                return (
                  <React.Fragment key={line.id}>
                    <tr
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`group hover:bg-zinc-500/5 transition-colors cursor-default ${
                        draggedIndex === idx ? 'bg-violet-500/10 opacity-65' : ''
                      } ${
                        line.time === null
                          ? 'bg-yellow-500/[0.02] text-zinc-455 dark:text-zinc-500'
                          : ''
                      }`}
                    >
                      {/* Drag Reorder Handle */}
                      <td className="py-2 px-2 text-center cursor-grab active:cursor-grabbing text-zinc-400 dark:text-zinc-600 hover:text-violet-500">
                        <div className="flex justify-center items-center">
                          <GripVertical size={15} />
                        </div>
                      </td>

                      {/* Line Number */}
                      <td className="py-2 px-1 font-semibold text-center text-xs">{idx + 1}</td>
                      
                      {/* Text & Translation Inputs */}
                      <td className="py-2 px-4 min-w-[250px] space-y-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleExpand(line.id)}
                            className={`p-1 rounded hover:bg-zinc-500/10 text-zinc-400 transition-colors`}
                            title={dict.editorMicrotiming}
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          
                          <input
                            type="text"
                            value={line.text}
                            onChange={(e) => handleTextChange(line.id, e.target.value)}
                            className={`flex-1 px-2 py-1 rounded-lg text-sm border border-transparent focus:border-violet-500 focus:bg-zinc-100 dark:focus:bg-zinc-900 focus:outline-none transition-all ${
                              theme === 'dark'
                                ? 'text-zinc-100 hover:bg-zinc-900/30'
                                : 'text-zinc-900 hover:bg-zinc-50'
                            }`}
                          />
                        </div>

                        {/* Parallel Translation Textbox */}
                        <div className="flex items-center gap-2 pl-7">
                          <Globe size={12} className="text-zinc-400 shrink-0" />
                          <input
                            type="text"
                            value={line.translation || ''}
                            onChange={(e) => updateLineTranslation(line.id, e.target.value)}
                            placeholder={language === 'ru' ? 'Параллельный перевод песни' : 'Parallel song translation'}
                            className={`flex-1 px-2 py-0.5 rounded-md text-xs border border-transparent focus:border-violet-500 focus:bg-zinc-100 dark:focus:bg-zinc-900 focus:outline-none transition-all text-zinc-400 dark:text-zinc-500 italic`}
                          />
                        </div>
                      </td>

                      {/* Timing input & jump */}
                      <td className="py-2 px-4">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            placeholder="--:--.--"
                            value={line.time !== null ? formatTime(line.time) : ''}
                            onChange={(e) => handleTimeManualChange(line.id, e.target.value)}
                            className={`w-24 text-center px-2 py-1 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-violet-500 ${
                              line.time !== null
                                ? theme === 'dark'
                                  ? 'bg-zinc-900 border-zinc-800 text-violet-400 font-bold'
                                  : 'bg-zinc-50 border-zinc-200 text-violet-600 font-bold'
                                : theme === 'dark'
                                ? 'bg-zinc-900/20 border-zinc-800/40 text-zinc-600'
                                : 'bg-zinc-50/20 border-zinc-200/40 text-zinc-400'
                            }`}
                          />
                          {line.time !== null && (
                            <button
                              onClick={() => jumpToTime(line.time)}
                              className="p-1 rounded hover:bg-violet-500/15 text-violet-550 transition-colors"
                              title="Воспроизвести"
                            >
                              <Clock size={13} />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Actions Column */}
                      <td className="py-2 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {line.words.length > 1 && (
                            <button
                              onClick={() => setShowSplitDialog(showSplitDialog === line.id ? null : line.id)}
                              className={`p-1.5 rounded hover:bg-zinc-500/10 text-zinc-450 hover:text-violet-500 transition-colors`}
                              title={dict.editorSplitLabel}
                            >
                              <Scissors size={13} />
                            </button>
                          )}

                          {idx < lines.length - 1 && (
                            <button
                              onClick={() => {
                                if (confirm(language === 'ru' ? 'Объединить эту строку со следующей?' : 'Merge this line with the next one?')) {
                                  mergeLines(line.id);
                                }
                              }}
                              className="p-1.5 rounded hover:bg-zinc-500/10 text-zinc-455 hover:text-violet-500 transition-colors"
                              title={dict.editorMerge}
                            >
                              <Merge size={13} />
                            </button>
                          )}

                          <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800/70 mx-1" />

                          {/* Adjust increments */}
                          {line.time !== null ? (
                            <>
                              <button
                                onClick={() => shiftLineTime(line.id, -0.1)}
                                className={`p-1 rounded border transition-colors ${
                                  theme === 'dark'
                                    ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
                                    : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-650'
                                }`}
                                title="-0.1 сек"
                              >
                                <Minus size={11} />
                              </button>
                              
                              <button
                                onClick={() => shiftLineTime(line.id, 0.1)}
                                className={`p-1 border transition-colors ${
                                  theme === 'dark'
                                    ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
                                    : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-655'
                                }`}
                                title="+0.1 сек"
                              >
                                <Plus size={11} />
                              </button>

                              <button
                                onClick={() => removeLineTiming(line.id)}
                                className="p-1 text-zinc-400 hover:bg-zinc-500/10 transition-colors"
                                title="Сбросить метку"
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                const cur = audioRef.current ? audioRef.current.currentTime : 0;
                                updateLineTime(line.id, cur);
                              }}
                              className="px-2 py-0.5 rounded text-[10px] bg-violet-500/10 text-violet-500 font-semibold transition-colors"
                            >
                              {dict.editorSetTime}
                            </button>
                          )}

                          <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800/70 mx-1" />

                          {/* Delete */}
                          <button
                            onClick={() => {
                              if (confirm(language === 'ru' ? `Удалить строку "${line.text}"?` : `Delete line "${line.text}"?`)) {
                                deleteLine(line.id);
                              }
                            }}
                            className="p-1 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                            title={dict.editorDelete}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Toggle word-by-word timing edit view */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} className="px-6 py-3 bg-zinc-500/[0.01] border-t border-b border-zinc-250 dark:border-zinc-850">
                          <div className="space-y-2">
                            <h5 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
                              <HelpCircle size={11} /> {dict.editorMicrotiming}
                            </h5>
                            <div className="flex flex-wrap gap-3 py-1">
                              {line.words.map((word) => (
                                <div 
                                  key={word.id}
                                  className={`flex items-center gap-1 px-2 py-1.5 rounded-xl border text-xs transition-all ${
                                    theme === 'dark'
                                      ? 'bg-zinc-900/60 border-zinc-800/80'
                                      : 'bg-zinc-50 border-zinc-200/80'
                                  }`}
                                >
                                  <span className="font-bold text-zinc-500 dark:text-zinc-450">{word.text}:</span>
                                  <input
                                    type="text"
                                    placeholder="--:--.--"
                                    value={word.time !== null ? formatTime(word.time) : ''}
                                    onChange={(e) => handleWordTimeChange(line.id, word.id, e.target.value)}
                                    className="w-16 text-center px-1 py-0.5 font-mono text-[10px] bg-transparent border-b border-zinc-350 dark:border-zinc-800 focus:outline-none focus:border-violet-500 text-violet-500 dark:text-violet-400 font-semibold"
                                  />
                                  {word.time !== null && (
                                    <button
                                      onClick={() => jumpToTime(word.time)}
                                      className="p-0.5 rounded hover:bg-zinc-500/10 text-zinc-400 hover:text-violet-500"
                                      title="Перемотать"
                                    >
                                      <Clock size={10} />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Split Line Dialog inside the row */}
                    {showSplitDialog === line.id && (
                      <tr>
                        <td colSpan={5} className="px-6 py-3 bg-zinc-500/[0.02] border-t border-b border-zinc-250 dark:border-zinc-850 text-xs">
                          <div className="flex flex-col gap-2">
                            <div className="font-bold uppercase tracking-wider text-[10px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
                              <Scissors size={12} className="text-violet-500" /> {dict.editorSplit}
                            </div>
                            <div className="flex flex-wrap gap-2 py-1">
                              {line.words.map((w, wordIdx) => {
                                if (wordIdx === 0) return null; // Cannot split at index 0
                                return (
                                  <button
                                    key={w.id}
                                    onClick={() => {
                                      splitLine(line.id, wordIdx);
                                      setShowSplitDialog(null);
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg border border-violet-500/25 bg-violet-500/5 hover:bg-violet-500/15 text-violet-600 dark:text-violet-400 font-bold transition-colors"
                                  >
                                    {language === 'ru' ? 'Начиная с' : 'Starting with'}: "{w.text}"
                                  </button>
                                );
                              })}
                            </div>
                            <button
                              onClick={() => setShowSplitDialog(null)}
                              className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 hover:text-zinc-200 self-start mt-1 underline"
                            >
                              {language === 'ru' ? 'Отмена' : 'Cancel'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              
              {lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    {dict.editorNoLines}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
