import { Canvas2DContext, RenderFrame, AnimationStrategy } from '../types';
import { LyricLine } from '../../../types';
import { getCachedTextWidth } from '../textCache';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export class ClassicKaraokeStrategy implements AnimationStrategy {
  render(
    ctx: Canvas2DContext,
    frame: RenderFrame,
    fromLine: LyricLine | null,
    toLine: LyricLine | null,
    _transitionProgress: number,
    centerY: number,
    spacing: number,
    timedLines: LyricLine[],
    activeIdx: number
  ): void {
    const { width } = frame;
    const centerX = width / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const nextLine = activeIdx + 1 < timedLines.length ? timedLines[activeIdx + 1] : null;
    const bandCenterY = centerY + spacing * 0.18;
    const activeY = bandCenterY - spacing * 0.2;
    const hintY = bandCenterY + spacing * 0.28;

    this.renderReadingBand(ctx, frame, bandCenterY, spacing);

    this.renderContextLine(ctx, frame, nextLine, centerX, hintY, 0.58);

    if (fromLine) {
      this.renderActiveLine(ctx, frame, fromLine, centerX, activeY, timedLines, activeIdx, 1, true);
    } else if (toLine) {
      this.renderActiveLine(ctx, frame, toLine, centerX, activeY, timedLines, activeIdx, 1, true);
    }
  }

  private renderReadingBand(ctx: Canvas2DContext, frame: RenderFrame, centerY: number, spacing: number) {
    const { width } = frame;
    const bandHeight = spacing * 1.48;
    const y = centerY - bandHeight / 2;
    const gradient = ctx.createLinearGradient(0, y, 0, y + bandHeight);

    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.22, 'rgba(0, 0, 0, 0.2)');
    gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.42)');
    gradient.addColorStop(0.78, 'rgba(0, 0, 0, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, width, bandHeight);

    const centerGlow = ctx.createRadialGradient(width / 2, centerY, 0, width / 2, centerY, width * 0.46);
    centerGlow.addColorStop(0, 'rgba(0, 0, 0, 0.24)');
    centerGlow.addColorStop(0.54, 'rgba(0, 0, 0, 0.12)');
    centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, y, width, bandHeight);

    ctx.restore();
  }

  private renderContextLine(
    ctx: Canvas2DContext,
    frame: RenderFrame,
    line: LyricLine | null,
    centerX: number,
    y: number,
    alpha: number
  ) {
    if (!line || alpha <= 0) return;

    const { width, styleOptions } = frame;

    ctx.save();
    ctx.globalAlpha = clamp01(alpha);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.shadowBlur = 0;
    ctx.font = `${frame.resolution === '1080p' ? '42px' : '28px'} ${styleOptions.fontFamily}`;
    ctx.fillText(line.text, centerX, y, width * 0.88);
    ctx.restore();
  }

  private renderActiveLine(
    ctx: Canvas2DContext,
    frame: RenderFrame,
    line: LyricLine,
    centerX: number,
    y: number,
    timedLines: LyricLine[],
    lineIndex: number,
    alpha: number,
    renderTranslation: boolean
  ) {
    if (alpha <= 0) return;

    const { width, styleOptions, coverColors, time } = frame;
    const activeTextColor = styleOptions.preset === 'spotify' ? '#f8fff8' : styleOptions.activeWordColor;
    const inactiveTextColor = styleOptions.preset === 'spotify' ? 'rgba(255,255,255,0.64)' : styleOptions.inactiveWordColor;
    const maxTextWidth = width * 0.88;
    let activeFontSize = styleOptions.fontSize;
    let activeFont = `bold ${activeFontSize}px ${styleOptions.fontFamily}`;

    ctx.save();
    ctx.globalAlpha = clamp01(alpha);
    ctx.font = activeFont;

    const rawTextWidth = ctx.measureText(line.text).width;
    if (rawTextWidth > maxTextWidth) {
      activeFontSize = Math.max(12, Math.floor(activeFontSize * (maxTextWidth / rawTextWidth) * 0.96));
      activeFont = `bold ${activeFontSize}px ${styleOptions.fontFamily}`;
    }
    ctx.font = activeFont;

    let glowSize = styleOptions.glowSize;
    if (frame.quality === 'low') {
      glowSize = 0;
    } else if (frame.quality === 'medium') {
      glowSize = Math.min(4, styleOptions.glowSize);
    }

    if (glowSize > 0) {
      ctx.shadowColor = styleOptions.preset === 'spotify' ? '#1ed760' : coverColors ? coverColors.glow : styleOptions.glowColor;
      ctx.shadowBlur = glowSize;
    }

    ctx.strokeStyle = styleOptions.strokeColor;
    ctx.lineWidth = styleOptions.strokeWidth;

    const hasWordSync = line.words && line.words.some(word => word.time !== null);
    const totalWidth = getCachedTextWidth(ctx, line.text, activeFont);
    const startX = centerX - totalWidth / 2;

    if (hasWordSync) {
      let wordStartX = startX;

      line.words.forEach((word, wordIndex) => {
        const wordText = word.text + (wordIndex < line.words.length - 1 ? ' ' : '');
        const wordWidth = getCachedTextWidth(ctx, wordText, activeFont);
        const wordStartTime = word.time || line.time || 0;
        const nextWord = line.words[wordIndex + 1];
        const nextLine = timedLines[lineIndex + 1];
        const wordEndTime = nextWord?.time || nextLine?.time || (wordStartTime + 4.5);
        const duration = Math.max(0.08, wordEndTime - wordStartTime);
        const fillPercent = time >= wordEndTime ? 1 : time >= wordStartTime ? clamp01((time - wordStartTime) / duration) : 0;

        ctx.fillStyle = inactiveTextColor;
        ctx.fillText(wordText, wordStartX + wordWidth / 2, y);
        if (styleOptions.strokeWidth > 0) {
          ctx.strokeText(wordText, wordStartX + wordWidth / 2, y);
        }

        if (fillPercent > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(wordStartX, y - activeFontSize, wordWidth * fillPercent, activeFontSize * 2);
          ctx.clip();
          ctx.fillStyle = activeTextColor;
          ctx.fillText(wordText, wordStartX + wordWidth / 2, y);
          if (styleOptions.strokeWidth > 0) {
            ctx.strokeText(wordText, wordStartX + wordWidth / 2, y);
          }
          ctx.restore();
        }

        wordStartX += wordWidth;
      });
    } else {
      ctx.fillStyle = inactiveTextColor;
      ctx.fillText(line.text, centerX, y);
      if (styleOptions.strokeWidth > 0) {
        ctx.strokeText(line.text, centerX, y);
      }

      const nextLine = timedLines[lineIndex + 1];
      const lineStartTime = line.time || 0;
      const lineEndTime = nextLine ? nextLine.time || 0 : lineStartTime + 4.5;
      const duration = Math.max(0.08, lineEndTime - lineStartTime);
      const lineProgress = clamp01((time - lineStartTime) / duration);

      if (lineProgress > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(startX, y - activeFontSize, totalWidth * lineProgress, activeFontSize * 2);
        ctx.clip();
        ctx.fillStyle = activeTextColor;
        ctx.fillText(line.text, centerX, y);
        if (styleOptions.strokeWidth > 0) {
          ctx.strokeText(line.text, centerX, y);
        }
        ctx.restore();
      }
    }

    ctx.shadowBlur = 0;

    if (line.translation && renderTranslation) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
      ctx.font = `italic ${frame.resolution === '1080p' ? '26px' : '16px'} ${styleOptions.fontFamily}`;
      ctx.fillText(line.translation, centerX, y + (frame.resolution === '1080p' ? 50 : 32));
    }

    ctx.restore();
  }
}
