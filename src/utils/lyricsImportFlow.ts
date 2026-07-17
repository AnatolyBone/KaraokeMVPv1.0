import type { LyricsProviderResult } from '../services/lyricsProvider';
import type { LyricLine, LyricsMatchAssessment, LyricsValidationResult } from '../types';
import { canAutoImportLyrics, type RankedLyricsResult } from './lyricsMatchScore';
import { parseLRC } from './lrc';

export interface PreparedLyricsImport {
  track: LyricsProviderResult;
  lines: LyricLine[];
  rawText: string;
  assessment: LyricsMatchAssessment;
  validation: LyricsValidationResult;
  audioDuration: number | null;
}

export type LyricsImportDecision =
  | { kind: 'auto-import'; data: PreparedLyricsImport }
  | { kind: 'review'; data: PreparedLyricsImport }
  | { kind: 'plain'; track: LyricsProviderResult; lines: LyricLine[]; rawText: string }
  | { kind: 'empty'; track: LyricsProviderResult };

export function prepareLyricsImport(
  rankedResult: RankedLyricsResult,
  audioDuration: number | null,
): LyricsImportDecision {
  const { result: track, assessment, validation } = rankedResult;
  if (track.syncedLyrics) {
    const data: PreparedLyricsImport = {
      track,
      lines: parseLRC(track.syncedLyrics),
      rawText: track.syncedLyrics,
      assessment,
      validation,
      audioDuration,
    };
    return canAutoImportLyrics(assessment, validation, true)
      ? { kind: 'auto-import', data }
      : { kind: 'review', data };
  }

  if (track.plainLyrics) {
    return { kind: 'plain', track, lines: parseLRC(track.plainLyrics), rawText: track.plainLyrics };
  }

  return { kind: 'empty', track };
}
