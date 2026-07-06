import { Canvas2DContext, RenderFrame, AnimationStrategy } from '../types';
import { LyricLine } from '../../../types';
import { getCachedTextWidth } from '../textCache';

export class KineticTypographyStrategy implements AnimationStrategy {
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
  ): void {
    const { width, styleOptions, coverColors, time } = frame;
    const centerX = width / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (activeIdx > 0) {
      const prevLine = timedLines[activeIdx - 1];
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = `${frame.resolution === '1080p' ? '34px' : '22px'} ${styleOptions.fontFamily}`;
      ctx.fillText(prevLine.text, centerX, centerY - spacing - transitionProgress * spacing, width * 0.88);
    }

    if (toLine && activeIdx + 1 < timedLines.length) {
      const nextLine = timedLines[activeIdx + 1];
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = `${frame.resolution === '1080p' ? '34px' : '22px'} ${styleOptions.fontFamily}`;
      ctx.fillText(nextLine.text, centerX, centerY + spacing - transitionProgress * spacing, width * 0.88);
    }

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
      const y = centerY - transitionProgress * spacing;

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
            yOffset = -Math.sin(fillPercent * Math.PI) * 12;
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
}
