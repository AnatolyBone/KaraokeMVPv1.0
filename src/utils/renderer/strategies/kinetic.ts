import { Canvas2DContext, RenderFrame, AnimationStrategy } from '../types';
import { LyricLine } from '../../../types';
import { getCachedTextWidth } from '../textCache';

export class KineticTypographyStrategy implements AnimationStrategy {
  render(
    ctx: Canvas2DContext,
    frame: RenderFrame,
    fromLine: LyricLine | null,
    _toLine: LyricLine | null,
    _transitionProgress: number,
    centerY: number,
    spacing: number,
    timedLines: LyricLine[],
    activeIdx: number
  ): void {
    const { width, styleOptions, coverColors, time } = frame;
    const centerX = width / 2;
    const nextLine = activeIdx + 1 < timedLines.length ? timedLines[activeIdx + 1] : null;
    const bandCenterY = centerY + spacing * 0.18;
    const activeY = bandCenterY - spacing * 0.2;
    const hintY = bandCenterY + spacing * 0.28;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    this.renderReadingBand(ctx, frame, bandCenterY, spacing);
    this.renderContextLine(ctx, frame, nextLine, centerX, hintY);

    if (fromLine) {
      // Автомасштабирование шрифта если текст шире 88% кадра
      const maxKineticWidth = width * 0.88;
      let activeFontSize = styleOptions.fontSize;
      let activeFont = `bold ${activeFontSize}px ${styleOptions.fontFamily}`;
      ctx.font = activeFont;
      const rawKineticWidth = ctx.measureText(fromLine.text).width;
      if (rawKineticWidth > maxKineticWidth) {
        activeFontSize = Math.max(12, Math.floor(activeFontSize * (maxKineticWidth / rawKineticWidth) * 0.96));
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
        ctx.shadowColor = coverColors ? coverColors.glow : styleOptions.glowColor;
        ctx.shadowBlur = glowSize;
      }
      ctx.strokeStyle = styleOptions.strokeColor;
      ctx.lineWidth = styleOptions.strokeWidth;

      const hasWordSync = fromLine.words && fromLine.words.some(w => w.time !== null);
      const y = activeY;

      if (hasWordSync) {
        const totalWidth = getCachedTextWidth(ctx, fromLine.text, activeFont);
        let startX = centerX - totalWidth / 2;

        fromLine.words.forEach((word, wIdx) => {
          const wordText = word.text + (wIdx < fromLine.words.length - 1 ? ' ' : '');
          const wordWidth = getCachedTextWidth(ctx, wordText, activeFont);

          let fillPercent = 0;
          const wordStartTime = word.time || fromLine.time || 0;
          const activeGlowDuration = 0.25;

          if (time >= wordStartTime) {
            const elapsed = time - wordStartTime;
            fillPercent = Math.min(1, elapsed / activeGlowDuration);
          }

          // Пружинный отскок при активации слова
          let yOffset = 0;
          if (fillPercent > 0 && fillPercent < 1) {
            const bounce = frame.styleOptions.preset === 'tiktok-neon' ? 5 : 8;
            yOffset = -Math.sin(fillPercent * Math.PI) * bounce;
          }

          ctx.fillStyle = styleOptions.inactiveWordColor;
          ctx.fillText(wordText, startX + wordWidth / 2, y + yOffset);
          if (styleOptions.strokeWidth > 0) {
            ctx.strokeText(wordText, startX + wordWidth / 2, y + yOffset);
          }

          if (fillPercent > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(startX, y - styleOptions.fontSize + yOffset, wordWidth * fillPercent, styleOptions.fontSize * 2);
            ctx.clip();

            ctx.fillStyle = styleOptions.activeWordColor;
            ctx.fillText(wordText, startX + wordWidth / 2, y + yOffset);
            if (styleOptions.strokeWidth > 0) {
              ctx.strokeText(wordText, startX + wordWidth / 2, y + yOffset);
            }
            ctx.restore();
          }

          startX += wordWidth;
        });
      } else {
        ctx.fillStyle = styleOptions.activeWordColor;
        ctx.fillText(fromLine.text, centerX, y);
        if (styleOptions.strokeWidth > 0) {
          ctx.strokeText(fromLine.text, centerX, y);
        }
      }

      ctx.shadowBlur = 0;

      if (fromLine.translation) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
        ctx.font = `italic ${frame.resolution === '1080p' ? '26px' : '16px'} ${styleOptions.fontFamily}`;
        ctx.fillText(fromLine.translation, centerX, y + (frame.resolution === '1080p' ? 50 : 32));
      }
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

  private renderContextLine(ctx: Canvas2DContext, frame: RenderFrame, line: LyricLine | null, centerX: number, y: number) {
    if (!line) return;

    const { width, styleOptions } = frame;

    ctx.save();
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.shadowBlur = 0;
    ctx.font = `${frame.resolution === '1080p' ? '42px' : '28px'} ${styleOptions.fontFamily}`;
    ctx.fillText(line.text, centerX, y, width * 0.88);
    ctx.restore();
  }
}
