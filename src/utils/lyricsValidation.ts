import type { LyricLine, LyricsDiagnostic, LyricsValidationResult } from '../types';

export const LYRICS_VALIDATION_THRESHOLDS = {
  AUDIO_END_TOLERANCE_SECONDS: 0.05,
  MIN_RELIABLE_TIMED_LINES: 3,
  DUPLICATE_MIN_COUNT: 3,
  DUPLICATE_LINE_RATIO: 0.2,
  SUSPICIOUS_FIRST_LINE_SECONDS: 45,
  SUSPICIOUS_FIRST_LINE_RATIO: 0.2,
  SUSPICIOUS_TRAILING_GAP_SECONDS: 60,
  SUSPICIOUS_TRAILING_GAP_RATIO: 0.25,
  DURATION_WARNING_SECONDS: 15,
  DURATION_WARNING_RATIO: 0.05,
  DURATION_MISMATCH_SECONDS: 30,
  DURATION_MISMATCH_RATIO: 0.1,
} as const;

export interface LyricsValidationOptions {
  audioDuration?: number | null;
  resultDuration?: number | null;
}

function diagnostic(
  code: string,
  severity: LyricsDiagnostic['severity'],
  ru: string,
  en: string,
): LyricsDiagnostic {
  return { code, severity, message: { ru, en } };
}

function isFiniteTimestamp(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function collectAllTimestamps(lines: LyricLine[]): number[] {
  const values: number[] = [];
  lines.forEach((line) => {
    if (isFiniteTimestamp(line.time)) values.push(line.time);
    line.words?.forEach((word) => {
      if (isFiniteTimestamp(word.time)) values.push(word.time);
      word.syllables?.forEach((syllable) => {
        if (isFiniteTimestamp(syllable.time)) values.push(syllable.time);
      });
    });
  });
  return values;
}

export function validateLyricsTimings(
  lines: LyricLine[],
  options: LyricsValidationOptions = {},
): LyricsValidationResult {
  const warnings: LyricsDiagnostic[] = [];
  const lineTimestamps = lines
    .map((line) => line.time)
    .filter(isFiniteTimestamp);
  const allTimestamps = collectAllTimestamps(lines);
  const audioDuration = isFiniteTimestamp(options.audioDuration) && options.audioDuration > 0
    ? options.audioDuration
    : null;
  const resultDuration = isFiniteTimestamp(options.resultDuration) && options.resultDuration > 0
    ? options.resultDuration
    : null;

  const negativeTimestampCount = allTimestamps.filter((time) => time < 0).length;
  const outOfRangeTimestampCount = audioDuration === null
    ? 0
    : allTimestamps.filter((time) => time > audioDuration + LYRICS_VALIDATION_THRESHOLDS.AUDIO_END_TOLERANCE_SECONDS).length;

  let nonMonotonicTimestampCount = 0;
  for (let index = 1; index < lineTimestamps.length; index += 1) {
    if (lineTimestamps[index] < lineTimestamps[index - 1]) nonMonotonicTimestampCount += 1;
  }

  const timestampFrequency = new Map<string, number>();
  lineTimestamps.forEach((time) => {
    const key = time.toFixed(3);
    timestampFrequency.set(key, (timestampFrequency.get(key) || 0) + 1);
  });
  const duplicateTimestampCount = Array.from(timestampFrequency.values())
    .reduce((total, count) => total + Math.max(0, count - 1), 0);

  const firstTimestamp = lineTimestamps.length ? Math.min(...lineTimestamps) : null;
  const lastTimestamp = lineTimestamps.length ? Math.max(...lineTimestamps) : null;
  const durationDifferenceSeconds = audioDuration !== null && resultDuration !== null
    ? Math.abs(audioDuration - resultDuration)
    : null;

  if (!lineTimestamps.length) {
    warnings.push(diagnostic('no-timestamps', 'error', 'В тексте нет построчных временных меток', 'Lyrics contain no line timestamps'));
  } else if (lineTimestamps.length < LYRICS_VALIDATION_THRESHOLDS.MIN_RELIABLE_TIMED_LINES) {
    warnings.push(diagnostic('too-few-timed-lines', 'warning', `Размечено только ${lineTimestamps.length} строк(и)`, `Only ${lineTimestamps.length} line(s) have timestamps`));
  }

  if (negativeTimestampCount > 0) {
    warnings.push(diagnostic('negative-timestamps', 'error', `${negativeTimestampCount} временных меток находятся раньше начала трека`, `${negativeTimestampCount} timestamps are before the beginning of the track`));
  }
  if (outOfRangeTimestampCount > 0) {
    warnings.push(diagnostic('timestamps-after-audio', 'error', `${outOfRangeTimestampCount} временных меток находятся после конца аудио`, `${outOfRangeTimestampCount} timestamps are after the end of the audio`));
  }
  if (nonMonotonicTimestampCount > 0) {
    warnings.push(diagnostic('timestamps-out-of-order', 'error', `Нарушен возрастающий порядок меток: ${nonMonotonicTimestampCount} переход(а)`, `Timestamp order is broken at ${nonMonotonicTimestampCount} transition(s)`));
  }

  const duplicateThreshold = Math.max(
    LYRICS_VALIDATION_THRESHOLDS.DUPLICATE_MIN_COUNT,
    Math.ceil(lineTimestamps.length * LYRICS_VALIDATION_THRESHOLDS.DUPLICATE_LINE_RATIO),
  );
  if (duplicateTimestampCount >= duplicateThreshold) {
    warnings.push(diagnostic('many-duplicate-timestamps', 'warning', `${duplicateTimestampCount} строк повторяют время другой строки`, `${duplicateTimestampCount} lines repeat another line timestamp`));
  }

  if (audioDuration !== null && firstTimestamp !== null) {
    const suspiciousStart = Math.max(
      LYRICS_VALIDATION_THRESHOLDS.SUSPICIOUS_FIRST_LINE_SECONDS,
      audioDuration * LYRICS_VALIDATION_THRESHOLDS.SUSPICIOUS_FIRST_LINE_RATIO,
    );
    if (firstTimestamp > suspiciousStart) {
      warnings.push(diagnostic('first-line-too-late', 'warning', `Первая строка начинается только на ${firstTimestamp.toFixed(1)} сек.`, `First line starts only at ${firstTimestamp.toFixed(1)} sec.`));
    }
  }

  if (audioDuration !== null && lastTimestamp !== null) {
    const trailingGap = audioDuration - lastTimestamp;
    const suspiciousTrailingGap = Math.max(
      LYRICS_VALIDATION_THRESHOLDS.SUSPICIOUS_TRAILING_GAP_SECONDS,
      audioDuration * LYRICS_VALIDATION_THRESHOLDS.SUSPICIOUS_TRAILING_GAP_RATIO,
    );
    if (trailingGap > suspiciousTrailingGap) {
      warnings.push(diagnostic('last-line-too-early', 'warning', `После последней строки остаётся ${trailingGap.toFixed(1)} сек. аудио`, `${trailingGap.toFixed(1)} sec. of audio remain after the last line`));
    }
  }

  if (durationDifferenceSeconds !== null && audioDuration !== null) {
    const ratio = durationDifferenceSeconds / audioDuration;
    if (
      durationDifferenceSeconds > LYRICS_VALIDATION_THRESHOLDS.DURATION_MISMATCH_SECONDS
      || ratio > LYRICS_VALIDATION_THRESHOLDS.DURATION_MISMATCH_RATIO
    ) {
      warnings.push(diagnostic('duration-mismatch-severe', 'error', `Значительное расхождение длительности аудио и версии результата: ${durationDifferenceSeconds.toFixed(1)} сек.`, `Large difference between audio and result-version duration: ${durationDifferenceSeconds.toFixed(1)} sec.`));
    } else if (
      durationDifferenceSeconds > LYRICS_VALIDATION_THRESHOLDS.DURATION_WARNING_SECONDS
      || ratio > LYRICS_VALIDATION_THRESHOLDS.DURATION_WARNING_RATIO
    ) {
      warnings.push(diagnostic('duration-mismatch', 'warning', `Расхождение длительности аудио и версии результата: ${durationDifferenceSeconds.toFixed(1)} сек.`, `Difference between audio and result-version duration: ${durationDifferenceSeconds.toFixed(1)} sec.`));
    }
  }

  const valid = !warnings.some((warning) => warning.severity === 'error');
  const status = !valid
    ? 'mismatch'
    : warnings.some((warning) => warning.severity === 'warning')
      ? 'warning'
      : 'good';

  return {
    valid,
    status,
    warnings,
    totalLineCount: lines.length,
    timedLineCount: lineTimestamps.length,
    untimedLineCount: Math.max(0, lines.length - lineTimestamps.length),
    totalTimestampCount: allTimestamps.length,
    negativeTimestampCount,
    outOfRangeTimestampCount,
    nonMonotonicTimestampCount,
    duplicateTimestampCount,
    firstTimestamp,
    lastTimestamp,
    durationDifferenceSeconds,
  };
}
