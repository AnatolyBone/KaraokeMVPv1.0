import React from 'react';
import { AlertTriangle, CheckCircle2, FileWarning, ListMusic } from 'lucide-react';
import type { LyricsProviderResult } from '../services/lyricsProvider';
import type { LyricLine, LyricsMatchAssessment, LyricsValidationResult } from '../types';
import { getLyricsCandidateStatus } from '../utils/lyricsMatchScore';

export interface LyricsImportReviewData {
  track: LyricsProviderResult;
  lines: LyricLine[];
  rawText: string;
  assessment: LyricsMatchAssessment;
  validation: LyricsValidationResult;
  audioDuration: number | null;
}

interface LyricsImportReviewModalProps {
  data: LyricsImportReviewData | null;
  language: 'ru' | 'en';
  onUse: () => void;
  onChooseOther: () => void;
  onManual: () => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export const LyricsImportReviewModal: React.FC<LyricsImportReviewModalProps> = ({
  data,
  language,
  onUse,
  onChooseOther,
  onManual,
}) => {
  if (!data) return null;

  const { track, assessment, validation, audioDuration } = data;
  const overallStatus = getLyricsCandidateStatus(track, assessment, validation);
  const diagnostics = [...assessment.reasons, ...validation.warnings]
    .filter((item, index, list) => list.findIndex((other) => other.code === item.code) === index);
  const statusConfig = overallStatus === 'good'
    ? {
        icon: <CheckCircle2 size={20} />,
        label: language === 'ru' ? 'Вероятное совпадение' : 'Likely match',
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      }
    : overallStatus === 'warning'
      ? {
          icon: <AlertTriangle size={20} />,
          label: language === 'ru' ? 'Требуется проверка' : 'Review required',
          className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        }
      : {
          icon: <FileWarning size={20} />,
          label: language === 'ru' ? 'Вероятно другая версия' : 'Likely different version',
          className: 'border-red-500/30 bg-red-500/10 text-red-300',
        };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl">
        <div className="border-b border-zinc-800 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-violet-400">
                {language === 'ru' ? 'Проверка найденного LRC' : 'Found LRC review'}
              </p>
              <h3 className="mt-1 text-lg font-black">{track.artistName} — {track.trackName}</h3>
              <p className="mt-1 text-xs text-zinc-500">
                {language === 'ru' ? 'Источник' : 'Source'}: {track.provider.toUpperCase()}
              </p>
            </div>
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${statusConfig.className}`}>
              {statusConfig.icon}
              {statusConfig.label}
            </div>
          </div>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric label={language === 'ru' ? 'Аудио' : 'Audio'} value={formatDuration(audioDuration)} />
            <Metric label={language === 'ru' ? 'Версия результата' : 'Result version'} value={formatDuration(track.duration)} />
            <Metric
              label={language === 'ru' ? 'Разница' : 'Difference'}
              value={assessment.durationDifferenceSeconds === null ? '—' : `${assessment.durationDifferenceSeconds.toFixed(1)} ${language === 'ru' ? 'сек.' : 'sec.'}`}
            />
            <Metric label={language === 'ru' ? 'Совпадение текста' : 'Text match'} value={`${assessment.textMatchScore}%`} emphasized />
            <Metric label={language === 'ru' ? 'Соответствие версии' : 'Version confidence'} value={`${assessment.versionConfidence}%`} emphasized />
            <Metric
              label={language === 'ru' ? 'Последняя метка текста' : 'Last text timestamp'}
              value={formatDuration(validation.lastTimestamp)}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric
              label={language === 'ru' ? 'Размечено строк' : 'Timed lines'}
              value={`${validation.timedLineCount} / ${validation.totalLineCount}`}
            />
            <Metric
              label={language === 'ru' ? 'Категория длительности' : 'Duration assessment'}
              value={assessment.durationAssessment}
            />
          </div>

          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-300">
              <ListMusic size={15} />
              {language === 'ru' ? 'Причины и предупреждения' : 'Reasons and warnings'}
            </p>
            <div className="mt-3 space-y-2">
              {diagnostics.length === 0 ? (
                <p className="text-xs text-emerald-400">
                  {language === 'ru' ? 'Существенных предупреждений не найдено.' : 'No material warnings found.'}
                </p>
              ) : diagnostics.map((item) => (
                <div
                  key={item.code}
                  className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                    item.severity === 'error'
                      ? 'border-red-500/20 bg-red-500/10 text-red-200'
                      : item.severity === 'warning'
                        ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                        : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-300'
                  }`}
                >
                  {item.message[language]}
                </div>
              ))}
            </div>
          </div>

          {overallStatus === 'mismatch' && (
            <p className="mt-4 text-xs leading-relaxed text-red-300">
              {language === 'ru'
                ? 'Автоматический импорт запрещён. Использовать этот LRC можно только вручную и с пониманием предупреждений.'
                : 'Automatic import is blocked. You can use this LRC only by explicitly accepting the warnings.'}
            </p>
          )}
        </div>

        <div className="grid gap-2 border-t border-zinc-800 p-4 sm:grid-cols-3">
          <button
            type="button"
            onClick={onUse}
            className={`rounded-xl px-4 py-2.5 text-xs font-black text-white transition-all ${overallStatus === 'mismatch' ? 'bg-red-600 hover:bg-red-500' : 'bg-violet-600 hover:bg-violet-500'}`}
          >
            {language === 'ru' ? 'Использовать этот LRC' : 'Use this LRC'}
          </button>
          <button
            type="button"
            onClick={onChooseOther}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-black text-zinc-200 hover:bg-zinc-800"
          >
            {language === 'ru' ? 'Выбрать другой результат' : 'Choose another result'}
          </button>
          <button
            type="button"
            onClick={onManual}
            className="rounded-xl border border-zinc-700 px-4 py-2.5 text-xs font-black text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            {language === 'ru' ? 'Перейти к ручной разметке' : 'Continue with manual timing'}
          </button>
        </div>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; emphasized?: boolean }> = ({ label, value, emphasized }) => (
  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
    <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</p>
    <p className={`mt-1 font-mono text-sm font-black ${emphasized ? 'text-violet-300' : 'text-zinc-200'}`}>{value}</p>
  </div>
);
