import { LyricLine, VideoStyleOptions } from '../../types';

export interface RenderFrame {
  time: number;
  width: number;
  height: number;
  pulseFactor: number;
  fft: Uint8Array;
  styleOptions: VideoStyleOptions;
  coverColors: { primary: string; secondary: string; glow: string } | null;
  coverCanvas: HTMLCanvasElement | null;
  coverImg?: HTMLImageElement | null;
  isCoverReady: boolean;
  resolution: '720p' | '1080p';
  easedProgress?: number; // Прогресс перехода с кубическим сглаживанием
  audioFileName?: string;
  exportProgress?: number; // 0 to 1
  quality?: 'low' | 'medium' | 'high' | 'ultra'; // Качество рендеринга
}

export interface RenderLayer {
  render(ctx: CanvasRenderingContext2D, frame: RenderFrame): void;
}

export interface AnimationStrategy {
  render(
    ctx: CanvasRenderingContext2D,
    frame: RenderFrame,
    fromLine: LyricLine | null,
    toLine: LyricLine | null,
    transitionProgress: number,
    centerY: number,
    spacing: number,
    timedLines: LyricLine[],
    activeIdx: number
  ): void;
}
