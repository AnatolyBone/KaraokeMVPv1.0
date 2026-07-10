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

export interface RecentProject {
  id: string;
  title: string;
  rawText: string;
  lines: LyricLine[];
  audioFileName: string | null;
  coverColors: { primary: string; secondary: string; glow: string } | null;
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
