import { LyricLine } from '../../types';
import { Canvas2DContext, RenderFrame } from './types';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function getTrackTitle(audioFileName: string) {
  const cleanName = audioFileName.replace(/\.[^/.]+$/, '').replace(/\s+/g, ' ').trim();
  const parts = cleanName.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return {
      artist: parts[0],
      title: parts.slice(1).join(' - '),
    };
  }

  return {
    artist: '',
    title: cleanName || 'Karaoke Track',
  };
}

export function renderTitleCard(ctx: Canvas2DContext, frame: RenderFrame, timedLines: LyricLine[]) {
  const { time, width, height, audioFileName, styleOptions, resolution } = frame;
  const firstLineTime = timedLines[0]?.time ?? 5;
  const introEnd = Math.min(4.2, Math.max(0, firstLineTime - 0.35));

  if (!audioFileName || time >= introEnd || introEnd <= 0.7) return;

  const fadeIn = smoothstep(time / 0.55);
  const fadeOut = smoothstep((introEnd - time) / 0.7);
  const alpha = Math.min(fadeIn, fadeOut, 1);
  const { artist, title } = getTrackTitle(audioFileName);
  const isVertical = styleOptions.aspectRatio === '9:16';
  const isSquare = styleOptions.aspectRatio === '1:1';
  const isSplitLayout = styleOptions.animationStyle === 'split-screen' && !isVertical && !isSquare;
  const fontFamily = styleOptions.fontFamily;
  const titleSize = resolution === '1080p'
    ? isVertical ? 66 : 62
    : isVertical ? 44 : 40;
  const artistSize = resolution === '1080p' ? 30 : 19;
  const x = isSplitLayout ? width * 0.73 : width / 2;
  const y = height * (isVertical ? 0.28 : isSquare ? 0.3 : isSplitLayout ? 0.25 : 0.27);
  const maxWidth = width * (isVertical ? 0.82 : isSplitLayout ? 0.42 : 0.78);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.58)';
  ctx.shadowBlur = resolution === '1080p' ? 18 : 12;
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${titleSize}px ${fontFamily}`;
  ctx.fillText(title, x, y, maxWidth);

  if (artist) {
    ctx.globalAlpha = alpha * 0.72;
    ctx.shadowBlur = resolution === '1080p' ? 10 : 7;
    ctx.font = `500 ${artistSize}px ${fontFamily}`;
    ctx.fillText(artist, x, y + titleSize * 0.78, maxWidth * 0.92);
  }

  ctx.restore();
}
