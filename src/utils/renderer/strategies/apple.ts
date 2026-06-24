import { RenderFrame, AnimationStrategy } from '../types';
import { LyricLine } from '../../../types';
import { getPrerenderedText, getCachedTextWidth } from '../textCache';

export class AppleMusicStrategy implements AnimationStrategy {
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
    
    // 1. Базовое чистое выравнивание
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const glowColor = coverColors ? coverColors.glow : styleOptions.glowColor;

    // 2. ОТРИСОВКА УПЛЫВАЮЩЕЙ СТРОКИ fromLine
    if (fromLine) {
      ctx.save();
      
      const lineY = centerY - transitionProgress * spacing;
      const opacity = 1 - transitionProgress;
      
      // Аппаратный скейл (scale от 1.0 до 0.8)
      const activeFont = `bold ${styleOptions.fontSize}px ${styleOptions.fontFamily}`;
      const scale = 1 - transitionProgress * 0.15;
      ctx.translate(centerX, lineY);
      ctx.scale(scale, scale);

      // --- ОПТИМИЗАЦИЯ 1: РЕНДЕРИНГ ТЯЖЕЛЫХ ТЕКСТОВЫХ СЛОЕВ ЧЕРЕЗ DRAWIMAGE ---
      const maxTextWidth = width * 0.88; // 88% ширины кадра — текст не выходит за края
      const prerender = getPrerenderedText(ctx, fromLine, activeFont, styleOptions, glowColor, maxTextWidth);

      // Рендеринг Glow-слоя с аппаратной регулировкой прозрачности (без вызовов shadowBlur!)
      if (prerender.glowCanvas && styleOptions.glowSize > 0) {
        ctx.save();
        ctx.globalAlpha = opacity * (1 - transitionProgress) * 0.75;
        ctx.drawImage(prerender.glowCanvas, -prerender.width / 2, -prerender.height / 2);
        ctx.restore();
      }

      // Рисуем базовый неактивный текст
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(prerender.inactiveCanvas, -prerender.width / 2, -prerender.height / 2);
      ctx.restore();

      // Выборочно раскрываем (Reveal swipe) активный текст поверх неактивного
      const hasWordSync = fromLine.words && fromLine.words.some(w => w.time !== null);

      if (hasWordSync) {
        // Вычисляем ширину раскрытия закрашенных слов (Reveal Width)
        const padding = Math.max(30, styleOptions.glowSize * 2 + styleOptions.strokeWidth * 2);
        
        let activeWidth = 0;

        fromLine.words.forEach((word, wIdx) => {
          const wordText = word.text + (wIdx < fromLine.words.length - 1 ? ' ' : '');
          const wordWidth = getCachedTextWidth(ctx, wordText, activeFont);

          let fillPercent = 0;
          const wordStartTime = word.time || fromLine.time || 0;
          
          const nextWord = fromLine.words[wIdx + 1];
          const nextLineNode = timedLines[activeIdx + 1];
          const nextTimeBoundary = nextWord?.time || nextLineNode?.time || (wordStartTime + 4.5);
          const activeGlowDuration = Math.min(0.45, nextTimeBoundary - wordStartTime);

          if (time >= wordStartTime) {
            const elapsed = time - wordStartTime;
            fillPercent = Math.min(1, elapsed / activeGlowDuration);
          }

          activeWidth += wordWidth * fillPercent;
        });

        // --- ОПТИМИЗАЦИЯ 2: REVEAL MASK ВМЕСТО ЕЖЕКАДРОВОГО CLIP() ---
        // Рисуем только раскрытую часть закрашенного оффскрин-холста (drawImage source rect)
        if (activeWidth > 0) {
          ctx.save();
          ctx.globalAlpha = opacity;
          
          const revealWidth = Math.ceil(padding + activeWidth);
          ctx.drawImage(
            prerender.activeCanvas,
            0, 0, revealWidth, prerender.height, // Source rect
            -prerender.width / 2, -prerender.height / 2, revealWidth, prerender.height // Destination rect
          );
          ctx.restore();
        }
      } else {
        // Для обычного построчного режима закрашиваем всю строчку целиком
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.drawImage(prerender.activeCanvas, -prerender.width / 2, -prerender.height / 2);
        ctx.restore();
      }

      ctx.restore();

      // Перевод под строкой
      if (fromLine.translation) {
        ctx.save();
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.68 * opacity).toFixed(3)})`;
        ctx.font = `italic ${frame.resolution === '1080p' ? '26' : '16'}px ${styleOptions.fontFamily}`;
        ctx.fillText(fromLine.translation, centerX, lineY + (frame.resolution === '1080p' ? 50 : 32));
        ctx.restore();
      }
    }

    // 3. ОТРИСОВКА ВЫПЛЫВАЮЩЕЙ СНИЗУ СТРОКИ toLine
    if (toLine) {
      ctx.save();
      
      const lineY = centerY + spacing - transitionProgress * spacing;
      const opacity = transitionProgress;

      // Аппаратный скейл (scale от 0.85 до 1.0)
      const baseFont = `bold ${styleOptions.fontSize}px ${styleOptions.fontFamily}`;
      const scale = 0.85 + transitionProgress * 0.15;
      ctx.translate(centerX, lineY);
      ctx.scale(scale, scale);

      const maxTextWidth = width * 0.88;
      const prerender = getPrerenderedText(ctx, toLine, baseFont, styleOptions, glowColor, maxTextWidth);

      // Рисуем Glow
      if (prerender.glowCanvas && styleOptions.glowSize > 0) {
        ctx.save();
        ctx.globalAlpha = opacity * transitionProgress * 0.75;
        ctx.drawImage(prerender.glowCanvas, -prerender.width / 2, -prerender.height / 2);
        ctx.restore();
      }

      // Рисуем Inactive
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(prerender.inactiveCanvas, -prerender.width / 2, -prerender.height / 2);
      ctx.restore();

      const hasWordSync = toLine.words && toLine.words.some(w => w.time !== null);

      if (hasWordSync) {
        const padding = Math.max(30, styleOptions.glowSize * 2 + styleOptions.strokeWidth * 2);
        let activeWidth = 0;

        toLine.words.forEach((word, wIdx) => {
          const wordText = word.text + (wIdx < toLine.words.length - 1 ? ' ' : '');
          const wordWidth = getCachedTextWidth(ctx, wordText, baseFont);

          let fillPercent = 0;
          const wordStartTime = word.time || toLine.time || 0;
          
          const nextWord = toLine.words[wIdx + 1];
          const nextLineNode = timedLines[activeIdx + 2];
          const nextTimeBoundary = nextWord?.time || nextLineNode?.time || (wordStartTime + 4.5);
          const activeGlowDuration = Math.min(0.45, nextTimeBoundary - wordStartTime);

          if (time >= wordStartTime) {
            const elapsed = time - wordStartTime;
            fillPercent = Math.min(1, elapsed / activeGlowDuration);
          }

          activeWidth += wordWidth * fillPercent;
        });

        // Reveal Swipe
        if (activeWidth > 0) {
          ctx.save();
          ctx.globalAlpha = opacity;
          
          const revealWidth = Math.ceil(padding + activeWidth);
          ctx.drawImage(
            prerender.activeCanvas,
            0, 0, revealWidth, prerender.height,
            -prerender.width / 2, -prerender.height / 2, revealWidth, prerender.height
          );
          ctx.restore();
        }
      } else {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.drawImage(prerender.activeCanvas, -prerender.width / 2, -prerender.height / 2);
        ctx.restore();
      }

      ctx.restore();

      // Перевод под строкой
      if (toLine.translation) {
        ctx.save();
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.68 * opacity).toFixed(3)})`;
        ctx.font = `italic ${frame.resolution === '1080p' ? '26' : '16'}px ${styleOptions.fontFamily}`;
        ctx.fillText(toLine.translation, centerX, lineY + (frame.resolution === '1080p' ? 50 : 32));
        ctx.restore();
      }
    }
  }
}
