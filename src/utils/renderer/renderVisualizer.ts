import { Canvas2DContext, RenderLayer, RenderFrame } from './types';

export class VisualizerLayer implements RenderLayer {
  render(ctx: Canvas2DContext, frame: RenderFrame): void {
    const { width, height, styleOptions, coverColors, fft } = frame;

    if (styleOptions.visualizerType === 'none') return;

    const bufferLength = fft.length;

    if (styleOptions.visualizerType === 'bars') {
      const barWidth = (width / bufferLength) * 1.6;
      let x = 0;
      ctx.fillStyle = coverColors 
        ? hexToRgba(coverColors.glow, 0.15) 
        : 'rgba(139, 92, 246, 0.15)';
      
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (fft[i] / 255) * (height * 0.18);
        ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
        x += barWidth;
      }
    } else if (styleOptions.visualizerType === 'circle') {
      const coverSize = styleOptions.aspectRatio === '9:16' 
        ? (frame.resolution === '1080p' ? 240 : 160) 
        : (frame.resolution === '1080p' ? 120 : 80);

      const circleX = styleOptions.aspectRatio === '9:16' ? width / 2 : width * 0.15;
      const circleY = styleOptions.aspectRatio === '9:16' ? height * 0.32 : height - coverSize;
      const baseRadius = (coverSize / 2) * 1.15;

      ctx.strokeStyle = coverColors ? coverColors.glow : 'rgba(168, 85, 247, 0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();

      for (let i = 0; i < bufferLength; i++) {
        const angle = (i / bufferLength) * Math.PI * 2;
        const offset = (fft[i] / 255) * 22;
        const r = baseRadius + offset;
        const x = circleX + Math.cos(angle) * r;
        const y = circleY + Math.sin(angle) * r;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Синглтон-инстанс для обратной совместимости
const visualizerLayerInstance = new VisualizerLayer();
export function renderVisualizer(ctx: Canvas2DContext, frame: RenderFrame): void {
  visualizerLayerInstance.render(ctx, frame);
}
