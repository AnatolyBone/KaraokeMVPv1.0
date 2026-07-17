export type AppStep = 'input' | 'timing' | 'edit';

export type SyllableTiming = {
  id: string;
  text: string;
  time: number | null;
};

export type WordTiming = {
  id: string;
  text: string;
  time: number | null; // time in seconds
  syllables?: SyllableTiming[]; // Syllable breakdowns for Tap-to-Syllable mode
};

export type LyricLine = {
  id: string;
  text: string;
  time: number | null; // time in seconds
  words: WordTiming[];
  translation?: string; // Parallel translation line for bilingual karaoke
};

export type LyricsCheckStatus = 'good' | 'warning' | 'mismatch';

export type LyricsDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface LyricsDiagnostic {
  code: string;
  severity: LyricsDiagnosticSeverity;
  message: {
    ru: string;
    en: string;
  };
}

export type LyricsDurationAssessment =
  | 'unknown'
  | 'close'
  | 'possible-intro-outro'
  | 'possible-speed-change'
  | 'likely-different-version';

export interface LyricsMatchAssessment {
  textMatchScore: number;
  versionConfidence: number;
  status: LyricsCheckStatus;
  reasons: LyricsDiagnostic[];
  durationDifferenceSeconds: number | null;
  lastTimestampSeconds: number | null;
  durationAssessment: LyricsDurationAssessment;
  sourceVersionMarkers: string[];
  resultVersionMarkers: string[];
  mismatchedVersionMarkers: string[];
  titleMatch: 'exact' | 'partial' | 'weak' | 'none';
  artistMatch: 'exact' | 'partial' | 'weak' | 'none' | 'unknown';
}

export interface LyricsValidationResult {
  valid: boolean;
  status: LyricsCheckStatus;
  warnings: LyricsDiagnostic[];
  totalLineCount: number;
  timedLineCount: number;
  untimedLineCount: number;
  totalTimestampCount: number;
  negativeTimestampCount: number;
  outOfRangeTimestampCount: number;
  nonMonotonicTimestampCount: number;
  duplicateTimestampCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  durationDifferenceSeconds: number | null;
}

export interface TimingOffsetPreview {
  offsetSeconds: number;
  affectedTimestampCount: number;
  affectedLineTimestampCount: number;
  affectedWordTimestampCount: number;
  affectedSyllableTimestampCount: number;
  negativeTimestampCount: number;
  negativeLineTimestampCount: number;
  negativeWordTimestampCount: number;
  negativeSyllableTimestampCount: number;
  outOfRangeTimestampCount: number;
  outOfRangeLineTimestampCount: number;
  outOfRangeWordTimestampCount: number;
  outOfRangeSyllableTimestampCount: number;
  firstTimestampBefore: number | null;
  lastTimestampBefore: number | null;
  firstTimestampAfter: number | null;
  lastTimestampAfter: number | null;
  minimumTimestampAfter: number | null;
  maximumSafeNegativeOffset: number;
  requiresClipping: boolean;
}

export interface TimingOffsetApplyOptions {
  clipNegative?: boolean;
}

export interface RecentProject {
  id: string;
  title: string;
  rawText: string;
  lines: LyricLine[];
  audioFileName: string | null;
  coverColors: { primary: string; secondary: string; glow: string } | null;
  videoStyle?: VideoStyleOptions;
  audioIdentity?: AudioIdentityState;
  createdAt?: string;
  updatedAt?: string;
  cloudSyncStatus?: ProjectCloudSyncStatus;
  legacyProjectIds?: string[];
  globalTimingOffset?: number;
}

export type TimingComparisonMode = 'shifted' | 'original';

export type ProjectCloudSyncStatus = 'local' | 'pending' | 'synced' | 'error';

export type StemJobStatus =
  | 'queued'
  | 'submitting'
  | 'waiting'
  | 'processing'
  | 'distributing'
  | 'merging'
  | 'persisting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StemKind = 'vocal' | 'instrumental';

export interface AudioIdentityState {
  sourceAudioFingerprint: string | null;
  activeAudioFingerprint: string | null;
  activeAudioKind: 'original' | 'instrumental';
}

export interface StemAsset {
  storagePath: string;
  signedUrl?: string;
  expiresAt?: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
}

export interface StemJobState {
  id: string;
  status: StemJobStatus;
  mvsepStatus: string | null;
  providerJobUrl: string | null;
  projectId: string | null;
  songId: string | null;
  sourceFileName: string | null;
  sourceSizeBytes: number | null;
  sourceDurationSeconds: number | null;
  sourceFingerprint: string | null;
  sourceMimeType: string | null;
  vocal: StemAsset | null;
  instrumental: StemAsset | null;
  errorMessage: string | null;
  outputsPersistError: string | null;
  persistenceFailureCode: string | null;
  requiresNewSeparation: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  outputsSavedAt: string | null;
}


export type VideoBgType = 'gradient' | 'cover-blur' | 'particles' | 'minimal-dark' | 'custom-video' | 'split-dark';
export type AspectRatioType = '16:9' | '9:16' | '1:1';
export type SubtitleAnimationStyle = 'apple-music' | 'classic-karaoke' | 'kinetic' | 'split-screen';
export type VisualizerType = 'bars' | 'circle' | 'none';
export type FxOverlayType = 'snow' | 'lens-dust' | 'fluid-gradient' | 'none';
export type VideoPresetType = 'apple-music' | 'spotify' | 'tiktok-neon' | 'classic-karaoke' | 'minimal-cinema';

export interface VideoStyleOptions {
  preset: VideoPresetType;
  bgType: VideoBgType;
  gradientPreset: string; // CSS/Canvas linear gradient configuration
  fontFamily: string;
  fontSize: number;
  strokeColor: string;
  strokeWidth: number;
  glowColor: string;
  glowSize: number;
  activeWordColor: string;
  inactiveWordColor: string;
  
  // Cinema Engine 2.0 Новые Свойства
  aspectRatio: AspectRatioType;
  animationStyle: SubtitleAnimationStyle;
  visualizerType: VisualizerType;
  fxOverlay: FxOverlayType;
  customVideoUrl: string | null; // Для пользовательских видео-фонов
}

export interface RenderStats {
  fps: number;
  totalTime: number;
  bgTime: number;
  particlesTime: number;
  lyricsTime: number;
  visualizerTime: number;
}

export interface UserProfile {
  id: string;
  username: string | null;
  avatar_url: string | null;
  telegram_id: number;
  role: 'free' | 'pro' | 'admin';
  plan?: 'free' | 'plus' | string | null;
  plus_until?: string | null;
  created_at: string;
  updated_at: string;
}
