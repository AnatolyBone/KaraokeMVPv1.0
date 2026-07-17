import type { LyricLine, TimingComparisonMode, TimingOffsetApplyOptions, TimingOffsetPreview } from '../types';

function isFiniteTimestamp(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundTimestamp(value: number): number {
  return Number(value.toFixed(3));
}

type TimingEntry = { kind: 'line' | 'word' | 'syllable'; value: number };

function collectTimingEntries(lines: LyricLine[]): TimingEntry[] {
  const entries: TimingEntry[] = [];
  lines.forEach((line) => {
    if (isFiniteTimestamp(line.time)) entries.push({ kind: 'line', value: line.time });
    line.words?.forEach((word) => {
      if (isFiniteTimestamp(word.time)) entries.push({ kind: 'word', value: word.time });
      word.syllables?.forEach((syllable) => {
        if (isFiniteTimestamp(syllable.time)) entries.push({ kind: 'syllable', value: syllable.time });
      });
    });
  });
  return entries;
}

export function collectTimingValues(lines: LyricLine[]): number[] {
  return collectTimingEntries(lines).map((entry) => entry.value);
}

export function createTimingOffsetPreview(
  lines: LyricLine[],
  offsetSeconds: number,
  audioDuration: number | null = null,
): TimingOffsetPreview {
  const safeOffset = Number.isFinite(offsetSeconds) ? roundTimestamp(offsetSeconds) : 0;
  const entries = collectTimingEntries(lines);
  const timestamps = entries.map((entry) => entry.value);
  const shifted = timestamps.map((time) => time + safeOffset);
  const negativeEntries = entries.filter((entry) => entry.value + safeOffset < 0);
  const hasAudioDuration = typeof audioDuration === 'number' && Number.isFinite(audioDuration) && audioDuration > 0;
  const outOfRangeEntries = hasAudioDuration
    ? entries.filter((entry) => entry.value + safeOffset > audioDuration)
    : [];
  const minimumTimestamp = timestamps.length ? Math.min(...timestamps) : 0;

  return {
    offsetSeconds: safeOffset,
    affectedTimestampCount: timestamps.length,
    affectedLineTimestampCount: entries.filter((entry) => entry.kind === 'line').length,
    affectedWordTimestampCount: entries.filter((entry) => entry.kind === 'word').length,
    affectedSyllableTimestampCount: entries.filter((entry) => entry.kind === 'syllable').length,
    negativeTimestampCount: negativeEntries.length,
    negativeLineTimestampCount: negativeEntries.filter((entry) => entry.kind === 'line').length,
    negativeWordTimestampCount: negativeEntries.filter((entry) => entry.kind === 'word').length,
    negativeSyllableTimestampCount: negativeEntries.filter((entry) => entry.kind === 'syllable').length,
    outOfRangeTimestampCount: outOfRangeEntries.length,
    outOfRangeLineTimestampCount: outOfRangeEntries.filter((entry) => entry.kind === 'line').length,
    outOfRangeWordTimestampCount: outOfRangeEntries.filter((entry) => entry.kind === 'word').length,
    outOfRangeSyllableTimestampCount: outOfRangeEntries.filter((entry) => entry.kind === 'syllable').length,
    firstTimestampBefore: timestamps.length ? Math.min(...timestamps) : null,
    lastTimestampBefore: timestamps.length ? Math.max(...timestamps) : null,
    firstTimestampAfter: shifted.length ? Math.min(...shifted) : null,
    lastTimestampAfter: shifted.length ? Math.max(...shifted) : null,
    minimumTimestampAfter: shifted.length ? Math.min(...shifted) : null,
    maximumSafeNegativeOffset: roundTimestamp(-minimumTimestamp),
    requiresClipping: negativeEntries.length > 0,
  };
}

export function getEffectiveTimestamp(
  time: number | null | undefined,
  globalTimingOffset: number,
  comparisonMode: TimingComparisonMode = 'shifted',
): number | null {
  if (!isFiniteTimestamp(time)) return null;
  if (comparisonMode === 'original') return time;
  return roundTimestamp(time + (Number.isFinite(globalTimingOffset) ? globalTimingOffset : 0));
}

export function getOriginalTimestamp(
  effectiveTime: number,
  globalTimingOffset: number,
): number {
  return roundTimestamp(effectiveTime - (Number.isFinite(globalTimingOffset) ? globalTimingOffset : 0));
}

export function createEffectiveTimingLines(
  lines: LyricLine[],
  globalTimingOffset: number,
  comparisonMode: TimingComparisonMode = 'shifted',
): LyricLine[] {
  return lines.map((line) => ({
    ...line,
    time: getEffectiveTimestamp(line.time, globalTimingOffset, comparisonMode),
    words: line.words.map((word) => ({
      ...word,
      time: getEffectiveTimestamp(word.time, globalTimingOffset, comparisonMode),
      syllables: word.syllables?.map((syllable) => ({
        ...syllable,
        time: getEffectiveTimestamp(syllable.time, globalTimingOffset, comparisonMode),
      })),
    })),
  }));
}

function shiftValue(value: number | null, offset: number, clipNegative: boolean): number | null {
  if (!isFiniteTimestamp(value)) return value;
  const shifted = value + offset;
  return roundTimestamp(clipNegative ? Math.max(0, shifted) : shifted);
}

export function applyTimingOffset(
  lines: LyricLine[],
  offsetSeconds: number,
  options: TimingOffsetApplyOptions = {},
): LyricLine[] {
  const preview = createTimingOffsetPreview(lines, offsetSeconds);
  if (preview.requiresClipping && !options.clipNegative) {
    throw new Error('TIMING_OFFSET_REQUIRES_CLIPPING_CONFIRMATION');
  }

  return lines.map((line) => ({
    ...line,
    time: shiftValue(line.time, preview.offsetSeconds, Boolean(options.clipNegative)),
    words: line.words.map((word) => ({
      ...word,
      time: shiftValue(word.time, preview.offsetSeconds, Boolean(options.clipNegative)),
      syllables: word.syllables?.map((syllable) => ({
        ...syllable,
        time: shiftValue(syllable.time, preview.offsetSeconds, Boolean(options.clipNegative)),
      })),
    })),
  }));
}

export function removeAllTimings(lines: LyricLine[]): LyricLine[] {
  return lines.map((line) => ({
    ...line,
    time: null,
    words: line.words.map((word) => ({
      ...word,
      time: null,
      syllables: word.syllables?.map((syllable) => ({ ...syllable, time: null })),
    })),
  }));
}
