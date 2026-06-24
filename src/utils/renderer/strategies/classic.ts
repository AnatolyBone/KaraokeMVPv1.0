import { RenderFrame, AnimationStrategy } from '../types';
import { LyricLine } from '../../../types';
import { getCachedTextWidth } from '../textCache';

export class ClassicKaraokeStrategy implements AnimationStrategy {
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
  ): void {
    const { width, styleOptions, coverColors, time } = frame;
    const centerX = width / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. Render Previous context lines
    if (activeIdx > 0) {
      const prevLine = timedLines[activeIdx - 1];
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = `${frame.resolution === '1080p' ? '34px' : '22px'} ${styleOptions.fontFamily}`;
      ctx.fillText(prevLine.text, centerX, centerY - spacing - transitionProgress * spacing, width * 0.88);
    }

    // 2. Render Next context lines
    if (toLine && activeIdx + 1 < timedLines.length) {
      const nextLine = timedLines[activeIdx + 1];
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = `${frame.resolution === '1080p' ? '34px' : '22px'} ${styleOptions.fontFamily}`;
      ctx.fillText(nextLine.text, centerX, centerY + spacing - transitionProgress * spacing, width * 0.88);
    }

    // 3. Render Active Line (fromLine)
    if (fromLine) {
      // Автомасштабирование шрифта если текст шире 88% кадра
      const maxTextWidth = width * 0.88;
      let activeFontSize = styleOptions.fontSize;
      let activeFont = `bold ${activeFontSize}px ${styleOptions.fontFamily}`;
      ctx.font = activeFont;
      const rawTextWidth = ctx.measureText(fromLine.text).width;
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
        ctx.shadowColor = coverColors ? coverColors.glow : styleOptions.glowColor;
        ctx.shadowBlur = glowSize;
      }
      ctx.strokeStyle = styleOptions.strokeColor;
      ctx.lineWidth = styleOptions.strokeWidth;

      const hasWordSync = fromLine.words && fromLine.words.some(w => w.time !== null);
      const totalWidth = getCachedTextWidth(ctx, fromLine.text, activeFont);
      const startX = centerX - totalWidth / 2;

      const y = centerY - transitionProgress * spacing;

      if (hasWordSync) {
        let wordStartX = startX;
        fromLine.words.forEach((word, wIdx) => {
          const wordText = word.text + (wIdx < fromLine.words.length - 1 ? ' ' : '');
          const wordWidth = getCachedTextWidth(ctx, wordText, activeFont);

          let fillPercent = 0;
          const wordStartTime = word.time || fromLine.time || 0;
          
          const nextWord = fromLine.words[wIdx + 1];
          const nextLineNode = timedLines[activeIdx + 1];
          const wordEndTime = nextWord?.time || nextLineNode?.time || (wordStartTime + 4.5);

          if (time >= wordStartTime) {
            if (time >= wordEndTime) {
              fillPercent = 1;
            } else {
              fillPercent = (time - wordStartTime) / (wordEndTime - wordStartTime);
            }
          }

          ctx.fillStyle = styleOptions.inactiveWordColor;
          ctx.fillText(wordText, wordStartX + wordWidth / 2, y);
          if (styleOptions.strokeWidth > 0) {
            ctx.strokeText(wordText, wordStartX + wordWidth / 2, y);
          }

          if (fillPercent > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(wordStartX, y - styleOptions.fontSize, wordWidth * fillPercent, styleOptions.fontSize * 2);
            ctx.clip();

            ctx.fillStyle = styleOptions.activeWordColor;
            ctx.fillText(wordText, wordStartX + wordWidth / 2, y);
            if (styleOptions.strokeWidth > 0) {
              ctx.strokeText(wordText, wordStartX + wordWidth / 2, y);
            }
            ctx.restore();
          }
          wordStartX += wordWidth;
        });
      } else {
        ctx.fillStyle = styleOptions.inactiveWordColor;
        ctx.fillText(fromLine.text, centerX, y);
        if (styleOptions.strokeWidth > 0) {
          ctx.strokeText(fromLine.text, centerX, y);
        }

        const nextLineNode = timedLines[activeIdx + 1];
        const lineEndTime = nextLineNode ? nextLineNode.time || 0 : (fromLine.time || 0) + 4.5;
        const lineProgress = Math.max(0, Math.min(1, (time - (fromLine.time || 0)) / (lineEndTime - (fromLine.time || 0))));

        if (lineProgress > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(startX, y - styleOptions.fontSize, totalWidth * lineProgress, styleOptions.fontSize * 2);
          ctx.clip();

          ctx.fillStyle = styleOptions.activeWordColor;
          ctx.fillText(fromLine.text, centerX, y);
          if (styleOptions.strokeWidth > 0) {
            ctx.strokeText(fromLine.text, centerX, y);
          }
          ctx.restore();
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
