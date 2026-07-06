import { LyricLine, VideoStyleOptions } from '../../types';

export type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Canvas2D = HTMLCanvasElement | OffscreenCanvas;

export interface RenderFrame {
  time: number;
  width: number;
  height: number;
  pulseFactor: number;
  fft: Uint8Array;
  styleOptions: VideoStyleOptions;
  coverColors: { primary: string; secondary: string; glow: string } | null;
  coverCanvas: Canvas2D | null;
  coverImg?: CanvasImageSource | null;
  isCoverReady: boolean;
  resolution: '720p' | '1080p';
  easedProgress?: number; // Прогресс перехода с кубическим сглаживанием
  audioFileName?: string;
  exportProgress?: number; // 0 to 1
  quality?: 'low' | 'medium' | 'high' | 'ultra'; // Качество рендеринга
}

export interface RenderLayer {
  render(ctx: Canvas2DContext, frame: RenderFrame): void;
}

export interface AnimationStrategy {
  render(
    ctx: Canvas2DContext,
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
