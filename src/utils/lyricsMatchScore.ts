import type { LyricsProviderResult } from '../services/lyricsProvider';
import type {
  LyricsCheckStatus,
  LyricsDiagnostic,
  LyricsDurationAssessment,
  LyricsMatchAssessment,
  LyricsValidationResult,
} from '../types';
import { parseLRC } from './lrc';
import { validateLyricsTimings } from './lyricsValidation';

export const LYRICS_MATCH_THRESHOLDS = {
  AUTO_IMPORT_TEXT_MATCH_MIN: 88,
  AUTO_IMPORT_VERSION_CONFIDENCE_MIN: 80,
  GOOD_TEXT_MATCH_MIN: 88,
  GOOD_VERSION_CONFIDENCE_MIN: 80,
  MISMATCH_TEXT_MATCH_MAX: 49,
  MISMATCH_VERSION_CONFIDENCE_MAX: 44,
  DURATION_CLOSE_SECONDS: 3,
  DURATION_CLOSE_RATIO: 0.01,
  DURATION_INTRO_OUTRO_SECONDS: 15,
  DURATION_INTRO_OUTRO_RATIO: 0.05,
  DURATION_SPEED_CHANGE_SECONDS: 30,
  DURATION_SPEED_CHANGE_RATIO: 0.08,
  LAST_TIMESTAMP_AFTER_WARNING_SECONDS: 2,
  LAST_TIMESTAMP_AFTER_MISMATCH_SECONDS: 10,
  LAST_TIMESTAMP_TRAILING_GAP_SECONDS: 60,
  LAST_TIMESTAMP_TRAILING_GAP_RATIO: 0.25,
  VERSION_MARKER_PENALTY: 15,
  VERSION_MARKER_MAX_PENALTY: 45,
} as const;

export interface LyricsMatchTarget {
  trackName: string;
  artistName?: string | null;
  albumName?: string | null;
  audioFileName?: string | null;
  duration?: number | null;
}

export interface RankedLyricsResult {
  result: LyricsProviderResult;
  assessment: LyricsMatchAssessment;
  validation: LyricsValidationResult;
  status: LyricsCheckStatus;
}

const VERSION_MARKERS = [
  { key: 'radio-edit', label: 'radio edit', pattern: /\bradio\s+edit\b/iu },
  { key: 'sped-up', label: 'sped up', pattern: /\bsped\s*up\b/iu },
  { key: 'remaster', label: 'remaster', pattern: /\bremaster(?:ed)?\b/iu },
  { key: 'instrumental', label: 'instrumental', pattern: /\b(?:instrumental|инструментал|минус)\b/iu },
  { key: 'karaoke', label: 'karaoke', pattern: /\b(?:karaoke|караоке)\b/iu },
  { key: 'acoustic', label: 'acoustic', pattern: /\b(?:acoustic|акустик\p{L}*)\b/iu },
  { key: 'nightcore', label: 'nightcore', pattern: /\bnightcore\b/iu },
  { key: 'slowed', label: 'slowed', pattern: /\bslowed\b/iu },
  { key: 'reverb', label: 'reverb', pattern: /\breverb\b/iu },
  { key: 'remix', label: 'remix', pattern: /\b(?:remix|rmx)\b/iu },
  { key: 'cover', label: 'cover', pattern: /\b(?:cover|кавер)\b/iu },
  { key: 'live', label: 'live', pattern: /\b(?:live|концерт\p{L}*)\b/iu },
  { key: 'clean', label: 'clean', pattern: /\bclean\b/iu },
  { key: 'explicit', label: 'explicit', pattern: /\bexplicit\b/iu },
] as const;

const PROVIDER_PRIORITY: Record<LyricsProviderResult['provider'], number> = {
  supabase: 0,
  custom: 1,
  lrclib: 2,
};

function diagnostic(
  code: string,
  severity: LyricsDiagnostic['severity'],
  ru: string,
  en: string,
): LyricsDiagnostic {
  return { code, severity, message: { ru, en } };
}

export function normalizeLyricsMatchText(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeVersionMarkers(value: string): string {
  let next = value;
  for (const marker of VERSION_MARKERS) next = next.replace(marker.pattern, ' ');
  return normalizeLyricsMatchText(next);
}

function markerMap(value: string): Map<string, string> {
  const markers = new Map<string, string>();
  for (const marker of VERSION_MARKERS) {
    if (marker.pattern.test(value)) markers.set(marker.key, marker.label);
  }
  return markers;
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let common = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) common += 1;
  });
  return common / Math.max(leftTokens.size, rightTokens.size);
}

function classifyTextMatch(
  targetValue: string | null | undefined,
  resultValue: string | null | undefined,
): 'exact' | 'partial' | 'weak' | 'none' {
  const target = removeVersionMarkers(targetValue || '');
  const result = removeVersionMarkers(resultValue || '');
  if (!target || !result) return 'none';
  if (target === result) return 'exact';
  if (target.includes(result) || result.includes(target)) return 'partial';
  if (tokenOverlap(target, result) >= 0.5) return 'weak';
  return 'none';
}

function safeDuration(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function extractLastLrcTimestamp(content: string | null): number | null {
  if (!content) return null;
  let lastTimestamp: number | null = null;
  const regex = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const timestamp = Number(match[1]) * 60 + Number(match[2]);
    if (Number.isFinite(timestamp)) lastTimestamp = lastTimestamp === null ? timestamp : Math.max(lastTimestamp, timestamp);
  }
  return lastTimestamp;
}

function classifyDurationDifference(
  difference: number,
  audioDuration: number,
): LyricsDurationAssessment {
  const ratio = difference / audioDuration;
  if (
    difference <= LYRICS_MATCH_THRESHOLDS.DURATION_CLOSE_SECONDS
    || ratio <= LYRICS_MATCH_THRESHOLDS.DURATION_CLOSE_RATIO
  ) return 'close';
  if (
    difference <= LYRICS_MATCH_THRESHOLDS.DURATION_INTRO_OUTRO_SECONDS
    && ratio <= LYRICS_MATCH_THRESHOLDS.DURATION_INTRO_OUTRO_RATIO
  ) return 'possible-intro-outro';
  if (
    difference <= LYRICS_MATCH_THRESHOLDS.DURATION_SPEED_CHANGE_SECONDS
    && ratio <= LYRICS_MATCH_THRESHOLDS.DURATION_SPEED_CHANGE_RATIO
  ) return 'possible-speed-change';
  return 'likely-different-version';
}

function textMatchPoints(match: 'exact' | 'partial' | 'weak' | 'none', kind: 'title' | 'artist'): number {
  if (kind === 'title') return { exact: 60, partial: 42, weak: 22, none: 0 }[match];
  return { exact: 40, partial: 26, weak: 14, none: 0 }[match];
}

export function assessLyricsMatch(
  result: LyricsProviderResult,
  target: LyricsMatchTarget,
): LyricsMatchAssessment {
  const reasons: LyricsDiagnostic[] = [];
  const titleMatch = classifyTextMatch(target.trackName, result.trackName);
  const hasTargetArtist = Boolean(normalizeLyricsMatchText(target.artistName));
  const artistMatch = hasTargetArtist
    ? classifyTextMatch(target.artistName, result.artistName)
    : 'unknown';

  const titlePoints = textMatchPoints(titleMatch, 'title');
  const artistPoints = artistMatch === 'unknown' ? 0 : textMatchPoints(artistMatch, 'artist');
  const textMatchScore = Math.round(hasTargetArtist
    ? titlePoints + artistPoints
    : (titlePoints / 60) * 100);

  reasons.push(diagnostic(
    `title-${titleMatch}`,
    titleMatch === 'none' ? 'error' : titleMatch === 'exact' ? 'info' : 'warning',
    titleMatch === 'exact' ? 'Название совпадает точно' : titleMatch === 'partial' ? 'Название совпадает частично' : titleMatch === 'weak' ? 'Название похоже только по части слов' : 'Название не совпадает',
    titleMatch === 'exact' ? 'Title matches exactly' : titleMatch === 'partial' ? 'Title matches partially' : titleMatch === 'weak' ? 'Title has only weak token overlap' : 'Title does not match',
  ));
  reasons.push(artistMatch === 'unknown'
    ? diagnostic('artist-unknown', 'warning', 'Исполнитель исходного трека неизвестен; text match рассчитан только по названию', 'Source artist is unknown; text match is based on title only')
    : diagnostic(
        `artist-${artistMatch}`,
        artistMatch === 'none' ? 'error' : artistMatch === 'exact' ? 'info' : 'warning',
        artistMatch === 'exact' ? 'Исполнитель совпадает точно' : artistMatch === 'partial' ? 'Исполнитель совпадает частично' : artistMatch === 'weak' ? 'Исполнитель совпадает слабо' : 'Исполнитель не совпадает',
        artistMatch === 'exact' ? 'Artist matches exactly' : artistMatch === 'partial' ? 'Artist matches partially' : artistMatch === 'weak' ? 'Artist match is weak' : 'Artist does not match',
      ));

  const targetDuration = safeDuration(target.duration);
  const resultDuration = safeDuration(result.duration);
  const durationDifferenceSeconds = targetDuration !== null && resultDuration !== null
    ? Math.abs(targetDuration - resultDuration)
    : null;
  const durationAssessment = durationDifferenceSeconds !== null && targetDuration !== null
    ? classifyDurationDifference(durationDifferenceSeconds, targetDuration)
    : 'unknown';

  let versionConfidence = 100;
  if (durationAssessment === 'unknown') {
    versionConfidence -= 10;
    reasons.push(diagnostic('duration-unknown', 'warning', 'Длительность версии результата неизвестна', 'Result-version duration is unknown'));
  } else if (durationAssessment === 'close') {
    reasons.push(diagnostic('duration-close', 'info', `Небольшое допустимое отличие длительности: ${durationDifferenceSeconds!.toFixed(1)} сек.`, `Small acceptable duration difference: ${durationDifferenceSeconds!.toFixed(1)} sec.`));
  } else if (durationAssessment === 'possible-intro-outro') {
    versionConfidence -= 10;
    reasons.push(diagnostic('duration-intro-outro', 'warning', `Отличие ${durationDifferenceSeconds!.toFixed(1)} сек. может объясняться тишиной или другим intro/outro`, `${durationDifferenceSeconds!.toFixed(1)} sec. difference may be silence or a different intro/outro`));
  } else if (durationAssessment === 'possible-speed-change') {
    versionConfidence -= 25;
    reasons.push(diagnostic('duration-speed-change', 'warning', `Отличие ${durationDifferenceSeconds!.toFixed(1)} сек. может указывать на изменение скорости`, `${durationDifferenceSeconds!.toFixed(1)} sec. difference may indicate a speed change`));
  } else {
    versionConfidence -= 50;
    reasons.push(diagnostic('duration-different-version', 'error', `Отличие ${durationDifferenceSeconds!.toFixed(1)} сек. похоже на другую структуру или версию`, `${durationDifferenceSeconds!.toFixed(1)} sec. difference suggests a different structure or version`));
  }

  const sourceVersionText = [target.trackName, target.artistName, target.albumName, target.audioFileName].filter(Boolean).join(' ');
  const resultVersionText = [result.trackName, result.artistName, result.albumName].filter(Boolean).join(' ');
  const sourceMarkers = markerMap(sourceVersionText);
  const resultMarkers = markerMap(resultVersionText);
  const mismatchedVersionMarkers: string[] = [];

  sourceMarkers.forEach((label, key) => {
    if (!resultMarkers.has(key)) mismatchedVersionMarkers.push(label);
  });
  resultMarkers.forEach((label, key) => {
    if (!sourceMarkers.has(key)) mismatchedVersionMarkers.push(label);
  });
  const uniqueMismatchedMarkers = Array.from(new Set(mismatchedVersionMarkers));
  if (uniqueMismatchedMarkers.length) {
    versionConfidence -= Math.min(
      LYRICS_MATCH_THRESHOLDS.VERSION_MARKER_MAX_PENALTY,
      uniqueMismatchedMarkers.length * LYRICS_MATCH_THRESHOLDS.VERSION_MARKER_PENALTY,
    );
    reasons.push(diagnostic(
      'version-markers-differ',
      'error',
      `Не совпадают признаки версии: ${uniqueMismatchedMarkers.join(', ')}`,
      `Version markers differ: ${uniqueMismatchedMarkers.join(', ')}`,
    ));
  }

  const lastTimestampSeconds = extractLastLrcTimestamp(result.syncedLyrics);
  if (targetDuration !== null && lastTimestampSeconds !== null) {
    const afterAudio = lastTimestampSeconds - targetDuration;
    const trailingGap = targetDuration - lastTimestampSeconds;
    if (afterAudio > LYRICS_MATCH_THRESHOLDS.LAST_TIMESTAMP_AFTER_MISMATCH_SECONDS) {
      versionConfidence -= 25;
      reasons.push(diagnostic('last-timestamp-after-audio-severe', 'error', 'Последняя временная метка текста находится более чем на 10 секунд после конца аудио', 'Last text timestamp is more than 10 seconds after the audio ends'));
    } else if (afterAudio > LYRICS_MATCH_THRESHOLDS.LAST_TIMESTAMP_AFTER_WARNING_SECONDS) {
      versionConfidence -= 12;
      reasons.push(diagnostic('last-timestamp-after-audio', 'warning', 'Последняя временная метка текста находится после конца аудио', 'Last text timestamp is after the audio ends'));
    } else if (trailingGap > Math.max(
      LYRICS_MATCH_THRESHOLDS.LAST_TIMESTAMP_TRAILING_GAP_SECONDS,
      targetDuration * LYRICS_MATCH_THRESHOLDS.LAST_TIMESTAMP_TRAILING_GAP_RATIO,
    )) {
      versionConfidence -= 8;
      reasons.push(diagnostic('large-trailing-gap', 'warning', 'Последняя временная метка текста находится подозрительно далеко от конца аудио', 'Last text timestamp is suspiciously far from the end of the audio'));
    } else {
      reasons.push(diagnostic('last-timestamp-plausible', 'info', 'Последняя временная метка текста укладывается в длительность аудио', 'Last text timestamp fits the audio duration'));
    }
  }

  versionConfidence = Math.max(0, Math.min(100, Math.round(versionConfidence)));
  const hasAssessmentWarning = reasons.some((reason) => reason.severity !== 'info');
  const status: LyricsCheckStatus =
    textMatchScore <= LYRICS_MATCH_THRESHOLDS.MISMATCH_TEXT_MATCH_MAX
    || versionConfidence <= LYRICS_MATCH_THRESHOLDS.MISMATCH_VERSION_CONFIDENCE_MAX
      ? 'mismatch'
      : textMatchScore >= LYRICS_MATCH_THRESHOLDS.GOOD_TEXT_MATCH_MIN
        && versionConfidence >= LYRICS_MATCH_THRESHOLDS.GOOD_VERSION_CONFIDENCE_MIN
        && !hasAssessmentWarning
        ? 'good'
        : 'warning';

  return {
    textMatchScore: Math.max(0, Math.min(100, textMatchScore)),
    versionConfidence,
    status,
    reasons,
    durationDifferenceSeconds,
    lastTimestampSeconds,
    durationAssessment,
    sourceVersionMarkers: Array.from(sourceMarkers.values()),
    resultVersionMarkers: Array.from(resultMarkers.values()),
    mismatchedVersionMarkers: uniqueMismatchedMarkers,
    titleMatch,
    artistMatch,
  };
}

export function getLyricsCandidateStatus(
  result: LyricsProviderResult,
  assessment: LyricsMatchAssessment,
  validation: LyricsValidationResult,
): LyricsCheckStatus {
  if (assessment.status === 'mismatch') return 'mismatch';
  if (!result.syncedLyrics) return 'warning';
  if (validation.status === 'mismatch') return 'mismatch';
  if (assessment.status === 'good' && validation.status === 'good') return 'good';
  return 'warning';
}

function validationForResult(result: LyricsProviderResult, target: LyricsMatchTarget): LyricsValidationResult {
  const lines = result.lines?.length
    ? result.lines
    : parseLRC(result.syncedLyrics || result.plainLyrics || '');
  return validateLyricsTimings(lines, {
    audioDuration: target.duration,
    resultDuration: result.duration,
  });
}

export function rankLyricsResults(
  results: LyricsProviderResult[],
  target: LyricsMatchTarget,
): RankedLyricsResult[] {
  return results
    .map((result) => {
      const assessment = assessLyricsMatch(result, target);
      const validation = validationForResult(result, target);
      return {
        result,
        assessment,
        validation,
        status: getLyricsCandidateStatus(result, assessment, validation),
      };
    })
    .sort((left, right) => {
      const statusRank: Record<LyricsCheckStatus, number> = { good: 0, warning: 1, mismatch: 2 };
      const statusDifference = statusRank[left.status] - statusRank[right.status];
      if (statusDifference) return statusDifference;
      if (right.assessment.versionConfidence !== left.assessment.versionConfidence) {
        return right.assessment.versionConfidence - left.assessment.versionConfidence;
      }
      if (right.assessment.textMatchScore !== left.assessment.textMatchScore) {
        return right.assessment.textMatchScore - left.assessment.textMatchScore;
      }
      const syncedDifference = Number(Boolean(right.result.syncedLyrics)) - Number(Boolean(left.result.syncedLyrics));
      if (syncedDifference) return syncedDifference;
      const leftDuration = left.assessment.durationDifferenceSeconds ?? Number.POSITIVE_INFINITY;
      const rightDuration = right.assessment.durationDifferenceSeconds ?? Number.POSITIVE_INFINITY;
      if (leftDuration !== rightDuration) return leftDuration - rightDuration;
      const providerDifference = PROVIDER_PRIORITY[left.result.provider] - PROVIDER_PRIORITY[right.result.provider];
      if (providerDifference) return providerDifference;
      const leftKey = `${left.result.provider}|${String(left.result.id)}|${normalizeLyricsMatchText(left.result.artistName)}|${normalizeLyricsMatchText(left.result.trackName)}`;
      const rightKey = `${right.result.provider}|${String(right.result.id)}|${normalizeLyricsMatchText(right.result.artistName)}|${normalizeLyricsMatchText(right.result.trackName)}`;
      return leftKey.localeCompare(rightKey);
    });
}

export function canAutoImportLyrics(
  assessment: LyricsMatchAssessment,
  validation: LyricsValidationResult,
  hasSyncedLyrics = true,
): boolean {
  return hasSyncedLyrics
    && assessment.status === 'good'
    && assessment.textMatchScore >= LYRICS_MATCH_THRESHOLDS.AUTO_IMPORT_TEXT_MATCH_MIN
    && assessment.versionConfidence >= LYRICS_MATCH_THRESHOLDS.AUTO_IMPORT_VERSION_CONFIDENCE_MIN
    && validation.valid
    && validation.status === 'good';
}
