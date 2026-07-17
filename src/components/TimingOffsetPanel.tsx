import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FastForward, RotateCcw } from 'lucide-react';
import { useAudioTransport } from '../hooks/useAudioTransport';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { createTimingOffsetPreview } from '../utils/timingOffset';
import type { TimingOffsetPreview } from '../types';

interface TimingOffsetPanelProps {
  className?: string;
}

const QUICK_COMMIT_DELAY_MS = 650;

function displayTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '−' : '';
  const absolute = Math.abs(value);
  const minutes = Math.floor(absolute / 60);
  const seconds = (absolute % 60).toFixed(3).padStart(6, '0');
  return `${sign}${minutes}:${seconds}`;
}

function parseOffsetInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized || normalized === '+' || normalized === '-' || normalized === '.' || normalized === '+.' || normalized === '-.') {
    return null;
  }
  if (!/^[+-]?(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(3)) : null;
}

export const TimingOffsetPanel: React.FC<TimingOffsetPanelProps> = ({ className = '' }) => {
  const {
    lines,
    globalTimingOffset,
    timingComparisonMode,
    timingOffsetResetNotice,
    setGlobalTimingOffsetLive,
    commitGlobalTimingOffset,
    setTimingComparisonMode,
    dismissTimingOffsetResetNotice,
    language,
    theme,
  } = useKaraokeStore();
  const { duration } = useAudioTransport();
  const [inputValue, setInputValue] = useState(globalTimingOffset.toFixed(3));
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);
  const [blockedPreview, setBlockedPreview] = useState<TimingOffsetPreview | null>(null);
  const editingStartRef = useRef<number | null>(null);
  const cancelFieldRef = useRef(false);
  const quickStartRef = useRef<number | null>(null);
  const quickTimerRef = useRef<number | null>(null);

  const preview = useMemo(
    () => createTimingOffsetPreview(lines, globalTimingOffset, duration || null),
    [lines, globalTimingOffset, duration],
  );

  useEffect(() => {
    if (editingStartRef.current === null) setInputValue(globalTimingOffset.toFixed(3));
  }, [globalTimingOffset]);

  useEffect(() => () => {
    if (quickTimerRef.current !== null) window.clearTimeout(quickTimerRef.current);
    if (quickStartRef.current !== null) {
      useKaraokeStore.getState().commitGlobalTimingOffset(quickStartRef.current);
      quickStartRef.current = null;
    }
  }, []);

  const setSafeLiveOffset = (candidate: number): number => {
    const candidatePreview = createTimingOffsetPreview(lines, candidate, duration || null);
    if (candidatePreview.requiresClipping) {
      const safeValue = candidatePreview.maximumSafeNegativeOffset;
      setGlobalTimingOffsetLive(safeValue);
      setInputValue(safeValue.toFixed(3));
      setSafetyMessage(language === 'ru'
        ? `Значение ограничено до ${safeValue.toFixed(3)} с: более ранний сдвиг создаёт отрицательные метки.`
        : `Limited to ${safeValue.toFixed(3)} s: an earlier shift creates negative timestamps.`);
      setBlockedPreview(candidatePreview);
      return safeValue;
    }
    setSafetyMessage(null);
    setBlockedPreview(null);
    setGlobalTimingOffsetLive(candidate);
    return candidate;
  };

  const finishFieldEdit = () => {
    if (cancelFieldRef.current) {
      cancelFieldRef.current = false;
      return;
    }
    const start = editingStartRef.current;
    editingStartRef.current = null;
    const parsed = parseOffsetInput(inputValue);
    if (parsed === null) {
      setInputValue(globalTimingOffset.toFixed(3));
    } else {
      setSafeLiveOffset(parsed);
    }
    if (start !== null) commitGlobalTimingOffset(start);
  };

  const addOffset = (delta: number) => {
    const current = useKaraokeStore.getState().globalTimingOffset;
    if (quickStartRef.current === null) quickStartRef.current = current;
    const applied = setSafeLiveOffset(Number((current + delta).toFixed(3)));
    setInputValue(applied.toFixed(3));
    if (quickTimerRef.current !== null) window.clearTimeout(quickTimerRef.current);
    quickTimerRef.current = window.setTimeout(() => {
      if (quickStartRef.current !== null) commitGlobalTimingOffset(quickStartRef.current);
      quickStartRef.current = null;
      quickTimerRef.current = null;
    }, QUICK_COMMIT_DELAY_MS);
  };

  const resetOffset = () => {
    if (quickTimerRef.current !== null) window.clearTimeout(quickTimerRef.current);
    if (quickStartRef.current !== null) {
      commitGlobalTimingOffset(quickStartRef.current);
      quickStartRef.current = null;
      quickTimerRef.current = null;
    }
    const previous = useKaraokeStore.getState().globalTimingOffset;
    if (previous === 0) return;
    setSafetyMessage(null);
    setGlobalTimingOffsetLive(0);
    setInputValue('0.000');
    commitGlobalTimingOffset(previous);
  };

  return (
    <div className={`rounded-xl border p-4 ${theme === 'dark' ? 'border-zinc-800/70 bg-zinc-900/40' : 'border-zinc-200/70 bg-zinc-50'} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          <FastForward size={14} /> {language === 'ru' ? 'Живой общий offset' : 'Live global offset'}
        </p>
        <div className="flex rounded-lg border border-zinc-700/60 p-0.5 text-[10px] font-bold">
          <button type="button" onClick={() => setTimingComparisonMode('shifted')} className={`rounded-md px-2 py-1 ${timingComparisonMode === 'shifted' ? 'bg-violet-600 text-white' : 'text-zinc-500'}`}>
            {language === 'ru' ? 'Со сдвигом' : 'Shifted'}
          </button>
          <button type="button" onClick={() => setTimingComparisonMode('original')} className={`rounded-md px-2 py-1 ${timingComparisonMode === 'original' ? 'bg-violet-600 text-white' : 'text-zinc-500'}`}>
            {language === 'ru' ? 'Оригинал' : 'Original'}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={inputValue}
          onFocus={() => {
            if (quickTimerRef.current !== null) window.clearTimeout(quickTimerRef.current);
            if (quickStartRef.current !== null) commitGlobalTimingOffset(quickStartRef.current);
            quickStartRef.current = null;
            quickTimerRef.current = null;
            editingStartRef.current = useKaraokeStore.getState().globalTimingOffset;
          }}
          onChange={(event) => {
            const value = event.target.value;
            setInputValue(value);
            const parsed = parseOffsetInput(value);
            if (parsed !== null) setSafeLiveOffset(parsed);
          }}
          onBlur={finishFieldEdit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              const start = editingStartRef.current;
              cancelFieldRef.current = true;
              if (start !== null) {
                setGlobalTimingOffsetLive(start);
                setInputValue(start.toFixed(3));
              }
              editingStartRef.current = null;
              event.currentTarget.blur();
            }
          }}
          className={`w-32 rounded-lg border px-3 py-2 font-mono text-sm font-bold outline-none focus:border-violet-500 ${theme === 'dark' ? 'border-zinc-700 bg-zinc-950 text-zinc-100' : 'border-zinc-300 bg-white text-zinc-900'}`}
          aria-label={language === 'ru' ? 'Общее смещение в секундах' : 'Global offset in seconds'}
        />
        <span className="text-xs text-zinc-500">{language === 'ru' ? 'сек.' : 'sec.'}</span>
        {[-0.5, -0.2, -0.1, 0.1, 0.2, 0.5].map((delta) => (
          <button type="button" key={delta} onClick={() => addOffset(delta)} className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${delta < 0 ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'}`}>
            {delta > 0 ? '+' : ''}{delta}
          </button>
        ))}
        <button type="button" onClick={resetOffset} className="rounded-lg border border-zinc-700/60 p-1.5 text-zinc-400 hover:bg-zinc-800/40" title={language === 'ru' ? 'Сбросить в 0' : 'Reset to 0'}>
          <RotateCcw size={14} />
        </button>
      </div>

      <p className="mt-2 text-[10px] text-zinc-500">
        {language === 'ru' ? 'Изменения сразу видны в плеере; исходные line/word/syllable метки не переписываются.' : 'Changes are live; original line/word/syllable timestamps stay unchanged.'}
      </p>

      {timingOffsetResetNotice && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-700 dark:text-violet-200">
          <span>{language === 'ru' ? 'Импортирован новый текст: offset предыдущего LRC сброшен в 0.' : 'New lyrics imported: the previous LRC offset was reset to 0.'}</span>
          <button type="button" onClick={dismissTimingOffsetResetNotice} className="shrink-0 font-bold underline underline-offset-2">
            {language === 'ru' ? 'Понятно' : 'Dismiss'}
          </button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <TimingValue label={language === 'ru' ? 'Первая без offset' : 'First original'} value={displayTime(preview.firstTimestampBefore)} />
        <TimingValue label={language === 'ru' ? 'Первая эффективная' : 'First effective'} value={displayTime(preview.firstTimestampAfter)} />
        <TimingValue label={language === 'ru' ? 'Последняя без offset' : 'Last original'} value={displayTime(preview.lastTimestampBefore)} />
        <TimingValue label={language === 'ru' ? 'Последняя эффективная' : 'Last effective'} value={displayTime(preview.lastTimestampAfter)} />
      </div>
      <p className="mt-2 text-[10px] text-zinc-500">
        line {preview.affectedLineTimestampCount} · word {preview.affectedWordTimestampCount} · syllable {preview.affectedSyllableTimestampCount} · {language === 'ru' ? 'минимум' : 'minimum'} {displayTime(preview.minimumTimestampAfter)}
      </p>

      {(safetyMessage || preview.negativeTimestampCount > 0) && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
          <p className="font-bold">{safetyMessage || (language === 'ru' ? 'Сдвиг создаёт отрицательные timestamps.' : 'The shift creates negative timestamps.')}</p>
          <p className="mt-1 font-mono text-[11px]">
            {language === 'ru' ? 'Безопасный минимум' : 'Safe minimum'}: {(blockedPreview || preview).maximumSafeNegativeOffset.toFixed(3)} · line {(blockedPreview || preview).negativeLineTimestampCount}, word {(blockedPreview || preview).negativeWordTimestampCount}, syllable {(blockedPreview || preview).negativeSyllableTimestampCount} · min {displayTime((blockedPreview || preview).minimumTimestampAfter)}
          </p>
        </div>
      )}

      {preview.outOfRangeTimestampCount > 0 && (
        <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-200">
          {language === 'ru'
            ? `${preview.outOfRangeTimestampCount} меток окажутся после окончания аудио (${duration.toFixed(3)} с): line ${preview.outOfRangeLineTimestampCount}, word ${preview.outOfRangeWordTimestampCount}, syllable ${preview.outOfRangeSyllableTimestampCount}.`
            : `${preview.outOfRangeTimestampCount} timestamps will be after the audio end (${duration.toFixed(3)} s): line ${preview.outOfRangeLineTimestampCount}, word ${preview.outOfRangeWordTimestampCount}, syllable ${preview.outOfRangeSyllableTimestampCount}.`}
        </div>
      )}
    </div>
  );
};

const TimingValue: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-zinc-800/50 bg-zinc-950/20 px-3 py-2">
    <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
    <p className="mt-0.5 font-mono font-bold text-zinc-700 dark:text-zinc-200">{value}</p>
  </div>
);
