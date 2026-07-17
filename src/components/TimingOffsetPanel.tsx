import React, { useMemo, useState } from 'react';
import { FastForward, Pause, Play, RotateCcw } from 'lucide-react';
import { audioRef } from '../audioRef';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { createTimingOffsetPreview } from '../utils/timingOffset';

interface TimingOffsetPanelProps {
  className?: string;
}

function displayTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '−' : '';
  const absolute = Math.abs(value);
  const minutes = Math.floor(absolute / 60);
  const seconds = (absolute % 60).toFixed(3).padStart(6, '0');
  return `${sign}${minutes}:${seconds}`;
}

export const TimingOffsetPanel: React.FC<TimingOffsetPanelProps> = ({ className = '' }) => {
  const { lines, shiftAllTimings, language, theme } = useKaraokeStore();
  const [inputValue, setInputValue] = useState('0.000');
  const parsedOffset = Number.parseFloat(inputValue.replace(',', '.'));
  const offset = Number.isFinite(parsedOffset) ? parsedOffset : 0;
  const preview = useMemo(() => createTimingOffsetPreview(lines, offset), [lines, offset]);
  const secLabel = language === 'ru' ? 'сек.' : 'sec.';

  const setOffset = (value: number) => setInputValue(Number(value.toFixed(3)).toFixed(3));
  const addOffset = (delta: number) => setOffset(offset + delta);
  const cancel = () => setOffset(0);

  const listenAt = (timestamp: number | null) => {
    const audio = audioRef.current;
    if (!audio || timestamp === null) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || timestamp, timestamp - 2));
    audio.play().catch((error) => console.warn('Offset preview playback failed:', error));
  };

  const apply = (clipNegative = false) => {
    if (!preview.affectedTimestampCount || preview.offsetSeconds === 0) return;
    if (preview.requiresClipping && !clipNegative) return;
    shiftAllTimings(preview.offsetSeconds, { clipNegative });
    setOffset(0);
  };

  return (
    <div className={`rounded-xl border p-4 ${theme === 'dark' ? 'border-zinc-800/70 bg-zinc-900/40' : 'border-zinc-200/70 bg-zinc-50'} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          <FastForward size={14} /> {language === 'ru' ? 'Точный общий offset' : 'Precise global offset'}
        </p>
        <span className="text-[10px] text-zinc-500">
          {language === 'ru' ? 'Предпросмотр не изменяет тайминги' : 'Preview does not change timings'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="number"
          step="0.001"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          className={`w-32 rounded-lg border px-3 py-2 font-mono text-sm font-bold outline-none focus:border-violet-500 ${theme === 'dark' ? 'border-zinc-700 bg-zinc-950 text-zinc-100' : 'border-zinc-300 bg-white text-zinc-900'}`}
          aria-label={language === 'ru' ? 'Общее смещение в секундах' : 'Global offset in seconds'}
        />
        <span className="text-xs text-zinc-500">{secLabel}</span>
        {[-0.5, -0.2, -0.1, 0.1, 0.2, 0.5].map((delta) => (
          <button
            type="button"
            key={delta}
            onClick={() => addOffset(delta)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors ${delta < 0 ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'}`}
          >
            {delta > 0 ? '+' : ''}{delta}
          </button>
        ))}
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg border border-zinc-700/60 p-1.5 text-zinc-400 hover:bg-zinc-800/40"
          title={language === 'ru' ? 'Сбросить' : 'Reset'}
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <TimingValue label={language === 'ru' ? 'Первая до' : 'First before'} value={displayTime(preview.firstTimestampBefore)} />
        <TimingValue label={language === 'ru' ? 'Первая после' : 'First after'} value={displayTime(preview.firstTimestampAfter)} />
        <TimingValue label={language === 'ru' ? 'Последняя до' : 'Last before'} value={displayTime(preview.lastTimestampBefore)} />
        <TimingValue label={language === 'ru' ? 'Последняя после' : 'Last after'} value={displayTime(preview.lastTimestampAfter)} />
      </div>
      <p className="mt-2 text-[10px] text-zinc-500">
        {language === 'ru' ? 'Будут сдвинуты' : 'Affected timestamps'}: line {preview.affectedLineTimestampCount}, word {preview.affectedWordTimestampCount}, syllable {preview.affectedSyllableTimestampCount}.
      </p>

      {preview.requiresClipping && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
          <p className="font-bold">
            {language === 'ru'
              ? `После сдвига ${preview.negativeTimestampCount} временных меток окажутся раньше начала трека.`
              : `${preview.negativeTimestampCount} timestamps will be before the beginning of the track.`}
          </p>
          <p className="mt-1 opacity-80">
            {language === 'ru'
              ? 'По умолчанию сдвиг заблокирован, чтобы не разрушить интервалы ранних строк.'
              : 'The shift is blocked by default to preserve early timing intervals.'}
          </p>
          <p className="mt-1 font-mono text-[11px]">
            {language === 'ru' ? 'Минимальная метка после сдвига' : 'Minimum timestamp after shift'}: {displayTime(preview.minimumTimestampAfter)} · line {preview.negativeLineTimestampCount}, word {preview.negativeWordTimestampCount}, syllable {preview.negativeSyllableTimestampCount}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={cancel} className="rounded-lg border border-amber-500/30 px-3 py-1.5 font-bold hover:bg-amber-500/10">
              {language === 'ru' ? 'Отменить сдвиг' : 'Cancel shift'}
            </button>
            <button type="button" onClick={() => setOffset(preview.maximumSafeNegativeOffset)} className="rounded-lg border border-amber-500/30 px-3 py-1.5 font-bold hover:bg-amber-500/10">
              {language === 'ru' ? `Ограничить до ${preview.maximumSafeNegativeOffset.toFixed(3)}` : `Limit to ${preview.maximumSafeNegativeOffset.toFixed(3)}`}
            </button>
            <button type="button" onClick={() => apply(true)} className="rounded-lg bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-500">
              {language === 'ru' ? 'Применить с обрезкой' : 'Apply with clipping'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => listenAt(preview.firstTimestampBefore)}
          disabled={preview.firstTimestampBefore === null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/60 px-3 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-800/30 disabled:opacity-40"
        >
          <Play size={13} /> {language === 'ru' ? 'Прослушать до' : 'Listen before'}
        </button>
        <button
          type="button"
          onClick={() => listenAt(preview.firstTimestampAfter)}
          disabled={preview.firstTimestampAfter === null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/60 px-3 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-800/30 disabled:opacity-40"
        >
          <Play size={13} /> {language === 'ru' ? 'Прослушать после' : 'Listen after'}
        </button>
        <button type="button" onClick={() => audioRef.current?.pause()} className="rounded-lg border border-zinc-700/60 p-2 text-zinc-500 hover:bg-zinc-800/30" title={language === 'ru' ? 'Пауза' : 'Pause'}>
          <Pause size={13} />
        </button>
        <button type="button" onClick={cancel} className="rounded-lg border border-zinc-700/60 px-3 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-800/30">
          {language === 'ru' ? 'Отмена' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={() => apply(false)}
          disabled={!preview.affectedTimestampCount || preview.offsetSeconds === 0 || preview.requiresClipping}
          className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-black text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {language === 'ru' ? 'Применить' : 'Apply'}
        </button>
      </div>
    </div>
  );
};

const TimingValue: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-zinc-800/50 bg-zinc-950/20 px-3 py-2">
    <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
    <p className="mt-0.5 font-mono font-bold text-zinc-700 dark:text-zinc-200">{value}</p>
  </div>
);
