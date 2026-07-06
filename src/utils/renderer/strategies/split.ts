import { Canvas2DContext, RenderFrame, AnimationStrategy } from '../types';
import { LyricLine } from '../../../types';
import { getPrerenderedText, getCachedTextWidth } from '../textCache';
import { createCanvas } from '../canvasHelper';

// Кэшируем обложку с тенями и скруглениями, чтобы не вызывать тяжелый shadowBlur каждый кадр
let cachedCoverCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let cachedCoverKey = '';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class SplitScreenStrategy implements AnimationStrategy {
  render(
    ctx: Canvas2DContext,
    frame: RenderFrame,
    _fromLine: LyricLine | null,
    _toLine: LyricLine | null,
    transitionProgress: number,
    _centerY: number,
    spacing: number,
    timedLines: LyricLine[],
    activeIdx: number
  ): void {
    const { width, height, styleOptions, resolution } = frame;

    const isVertical = styleOptions.aspectRatio === '9:16';
    const isSquare = styleOptions.aspectRatio === '1:1';

    // 1. ОПРЕДЕЛЕНИЕ ЗОН (LEFT/RIGHT)
    // В вертикальном или квадратном видео обложка сверху, текст снизу.
    // В горизонтальном (16:9) обложка слева, текст справа.
    let leftRect = { x: 0, y: 0, w: width / 2, h: height };
    let rightRect = { x: width / 2, y: 0, w: width / 2, h: height };

    if (isVertical || isSquare) {
      const splitY = isVertical ? height * 0.38 : height * 0.46;
      leftRect = { x: 0, y: 0, w: width, h: splitY };
      rightRect = { x: 0, y: splitY, w: width, h: height - splitY };
    }

    // 2. ОТРИСОВКА ЛЕВОЙ ЧАСТИ (Обложка, Название, Прогресс)
    this.renderLeftPanel(ctx, leftRect, frame);

    // 3. ОТРИСОВКА ПРАВОЙ ЧАСТИ (Многострочные скроллящиеся субтитры)
    this.renderRightPanel(ctx, rightRect, frame, transitionProgress, spacing, timedLines, activeIdx);

    // 4. ОТРИСОВКА ПРОГРЕСС-БАРА ВНИЗУ (для вертикального и квадратного видео)
    if ((isVertical || isSquare) && frame.exportProgress !== undefined) {
      const barWidth = width * 0.8;
      const barHeight = resolution === '1080p' ? 6 : 4;
      const barX = (width - barWidth) / 2;
      const barY = height - (isVertical ? (resolution === '1080p' ? 270 : 180) : (resolution === '1080p' ? 195 : 130));

      // Фон бара
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barWidth, barHeight, barHeight / 2);
      ctx.fill();

      // Заполненная часть
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barWidth * frame.exportProgress, barHeight, barHeight / 2);
      ctx.fill();

      // Временные метки
      let curTimeStr = '0:00';
      let totalTimeStr = '0:00';
      if (frame.time > 100000) {
        const mockDuration = 220; // 3:40
        const mockCurrent = Math.floor(mockDuration * frame.exportProgress);
        curTimeStr = formatTime(mockCurrent);
        totalTimeStr = formatTime(mockDuration);
      } else {
        const currentSec = frame.time;
        const duration = frame.exportProgress > 0 ? currentSec / frame.exportProgress : 0;
        curTimeStr = formatTime(currentSec);
        totalTimeStr = formatTime(duration);
      }

      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = `${resolution === '1080p' ? 20 : 13}px ${styleOptions.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(curTimeStr, barX, barY + (resolution === '1080p' ? 16 : 10));
      ctx.textAlign = 'right';
      ctx.fillText(totalTimeStr, barX + barWidth, barY + (resolution === '1080p' ? 16 : 10));
      ctx.restore();
    }
  }

  private renderLeftPanel(ctx: Canvas2DContext, rect: { x: number; y: number; w: number; h: number }, frame: RenderFrame) {
    const { coverImg, coverColors, audioFileName, exportProgress, resolution, styleOptions, isCoverReady } = frame;
    
    const isVertical = styleOptions.aspectRatio === '9:16';
    const isSquare = styleOptions.aspectRatio === '1:1';
    
    // Рисуем обложку
    let coverSize = Math.min(rect.w * 0.7, rect.h * 0.55);
    if (isVertical) {
      coverSize = Math.min(rect.w * 0.48, rect.h * 0.52);
    } else if (isSquare) {
      coverSize = Math.min(rect.w * 0.52, rect.h * 0.58);
    }

    const coverX = rect.x + (rect.w - coverSize) / 2;
    // Сместим обложку для лучшего визуального баланса (с учетом разрешения)
    const coverY =
      rect.y +
      (rect.h - coverSize) / 2 +
      (isVertical
        ? (resolution === '1080p' ? 25 : 15)
        : isSquare
        ? (resolution === '1080p' ? 12 : 8)
        : -(resolution === '1080p' ? 90 : 60));

    const coverSourceKey = coverImg
      ? `${(coverImg as any).width || 0}x${(coverImg as any).height || 0}`
      : 'no-cover';
    const coverKey = `${audioFileName}_${resolution}_${coverSize}_${coverSourceKey}_${isCoverReady ? 'ready' : 'fallback'}_${frame.quality || 'high'}`;
    
    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';

    if (cachedCoverCanvas && cachedCoverKey === coverKey) {
      // Используем закэшированную обложку с уже примененными тенями
      // Отрисовываем с учетом отступов тени (shadowBlur/OffsetY)
      const shadowPadding = resolution === '1080p' ? 80 : 60;
      ctx.drawImage(cachedCoverCanvas, coverX - shadowPadding, coverY - shadowPadding);
    } else {
      // Рисуем один раз и кэшируем
      const shadowPadding = resolution === '1080p' ? 80 : 60;
      cachedCoverCanvas = createCanvas(coverSize + shadowPadding * 2, coverSize + shadowPadding * 2);
      const cCtx = cachedCoverCanvas.getContext('2d');
      
      if (cCtx) {
        cCtx.imageSmoothingEnabled = true;
        (cCtx as any).imageSmoothingQuality = 'high';
        cCtx.save();
        // Тень обложки
        cCtx.shadowColor = 'rgba(0,0,0,0.4)';
        cCtx.shadowBlur = resolution === '1080p' ? 60 : 40;
        cCtx.shadowOffsetY = resolution === '1080p' ? 20 : 15;

        // Скругление углов
        const radius = resolution === '1080p' ? 24 : 16;
        cCtx.beginPath();
        cCtx.roundRect(shadowPadding, shadowPadding, coverSize, coverSize, radius);
        cCtx.fill();
        cCtx.clip(); // Клипаем контент по скруглению

        // Отрисовка самой картинки обложки
        if (coverImg && isCoverReady) {
          cCtx.drawImage(coverImg, shadowPadding, shadowPadding, coverSize, coverSize);
        } else {
          // Заглушка, если обложки нет
          cCtx.fillStyle = coverColors ? coverColors.primary : '#333333';
          cCtx.fillRect(shadowPadding, shadowPadding, coverSize, coverSize);
        }
        
        cCtx.restore();
        
        // Рисуем обводку
        cCtx.save();
        cCtx.strokeStyle = 'rgba(255,255,255,0.15)';
        cCtx.lineWidth = 2;
        cCtx.beginPath();
        cCtx.roundRect(shadowPadding, shadowPadding, coverSize, coverSize, radius);
        cCtx.stroke();
        cCtx.restore();
        
        cachedCoverKey = coverKey;
      }
      
      if (cachedCoverCanvas) {
        ctx.drawImage(cachedCoverCanvas, coverX - shadowPadding, coverY - shadowPadding);
      }
    }

    // Парсим Название и Артиста из audioFileName
    let artist = 'Unknown Artist';
    let title = 'Karaoke Track';
    
    if (audioFileName) {
      const cleanName = audioFileName.replace(/\.[^/.]+$/, '');
      const parts = cleanName.split(' - ');
      if (parts.length >= 2) {
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      } else {
        title = cleanName.trim();
      }
    }

    // Рисуем Текст под обложкой с учетом режима
    const offsetText = (isVertical || isSquare) ? (resolution === '1080p' ? 40 : 25) : (resolution === '1080p' ? 60 : 40);
    const textY = coverY + coverSize + offsetText;
    const textX = rect.x + rect.w / 2;
    const panelMaxTextW = rect.w * 0.88;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Название трека
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${resolution === '1080p' ? 42 : 28}px ${styleOptions.fontFamily}`;
    ctx.fillText(title, textX, textY, panelMaxTextW);

    // Артист
    const offsetArtist = (isVertical || isSquare) ? (resolution === '1080p' ? 30 : 20) : (resolution === '1080p' ? 45 : 30);
    const artistY = textY + offsetArtist;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `${resolution === '1080p' ? 28 : 18}px ${styleOptions.fontFamily}`;
    ctx.fillText(artist, textX, artistY, panelMaxTextW);

    // Прогресс-бар (только для горизонтального 16:9 режима, для вертикального/квадратного перенесен вниз)
    if (exportProgress !== undefined && !isVertical && !isSquare) {
      const barWidth = coverSize * 0.9;
      const barHeight = resolution === '1080p' ? 6 : 4;
      const barX = textX - barWidth / 2;
      const offsetBar = resolution === '1080p' ? 50 : 35;
      const barY = artistY + offsetBar;

      // Фон бара
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barWidth, barHeight, barHeight / 2);
      ctx.fill();

      // Заполненная часть
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barWidth * exportProgress, barHeight, barHeight / 2);
      ctx.fill();
    }
  }

  private renderRightPanel(
    ctx: Canvas2DContext,
    rect: { x: number; y: number; w: number; h: number },
    frame: RenderFrame,
    transitionProgress: number,
    spacing: number,
    timedLines: LyricLine[],
    activeIdx: number
  ) {
    const { styleOptions, coverColors, time, resolution } = frame;
    
    ctx.save();
    
    // - Клипаем правую область, чтобы текст не вылазил на обложку при анимациях
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const glowColor = coverColors ? coverColors.glow : styleOptions.glowColor;
    const isVertical = styleOptions.aspectRatio === '9:16';
    const isSquare = styleOptions.aspectRatio === '1:1';
    
    const centerX = rect.x + rect.w / 2;
    // Сдвинем центр текста немного выше в вертикальном и квадратном режимах для баланса
    let centerY = rect.y + rect.h / 2;
    if (isVertical) {
      centerY -= resolution === '1080p' ? 270 : 180;
    } else if (isSquare) {
      centerY -= resolution === '1080p' ? 120 : 80;
    }

    // Окно видимых строк: в вертикальном режиме показываем 5 строк (-2, +2) для свободного пространства, в горизонтальном 8 (-3, +4)
    const offsetStart = isVertical ? 2 : 3;
    const offsetEnd = isVertical ? 2 : 4;
    const windowStart = Math.max(0, activeIdx - offsetStart);
    const windowEnd = Math.min(timedLines.length - 1, activeIdx + offsetEnd);

    // Общий скролл всей группы строк
    const scrollOffset = transitionProgress * spacing;

    for (let i = windowStart; i <= windowEnd; i++) {
      const line = timedLines[i];
      if (!line) continue;

      // Относительный индекс (0 = текущая строка)
      const relIdx = i - activeIdx;
      
      // Позиция Y
      const lineY = centerY + (relIdx * spacing) - scrollOffset;

      // Фильтрация невидимых за пределами rect
      if (lineY < rect.y - spacing || lineY > rect.y + rect.h + spacing) continue;

      // Вычисляем прозрачность в зависимости от расстояния до центра
      const distFromCenter = Math.abs(lineY - centerY);
      const maxDist = rect.h / 2;
      let opacity = 1 - Math.pow(distFromCenter / maxDist, 2);
      opacity = Math.max(0, Math.min(1, opacity));

      // Если строка активная (relIdx == 0) — она уходит, (relIdx == 1) — она приходит
      // Мы даем им разные веса
      let lineProgress = 0; // 1 = fully active, 0 = inactive
      
      if (relIdx === 0) {
        lineProgress = 1 - transitionProgress; // От 1 до 0
      } else if (relIdx === 1) {
        lineProgress = transitionProgress; // От 0 до 1
      }

      // Скейл: Активная строка чуть больше
      const baseScale = isVertical ? 0.82 : 0.9; // Сделаем шрифт чуть меньше для списка
      const scale = baseScale + (lineProgress * 0.18); // +18% для активной строки (до 100% в 9:16)

      const activeFont = `bold ${styleOptions.fontSize}px ${styleOptions.fontFamily}`;
      // Текст должен вписываться в панель с отступами
      const maxTextWidth = rect.w * 0.88;
      
      ctx.save();
      ctx.translate(centerX, lineY);
      ctx.scale(scale, scale);

      const prerender = getPrerenderedText(ctx, line, activeFont, styleOptions, glowColor, maxTextWidth);

      // Глобальная прозрачность
      // Базовая для всех - 0.5, для активной до 1.0 (чтобы не было слишком темно)
      const targetAlpha = 0.5 + (lineProgress * 0.5);
      ctx.globalAlpha = opacity * targetAlpha;

      // Если строка хотя бы частично активна, рисуем свечение и анимацию по словам
      if (lineProgress > 0.05) {
        // Свечение только для активной строки
        if (prerender.glowCanvas && styleOptions.glowSize > 0) {
          ctx.save();
          ctx.globalAlpha = opacity * lineProgress * 0.75;
          ctx.drawImage(prerender.glowCanvas, -prerender.width / 2, -prerender.height / 2);
          ctx.restore();
        }

        // Рисуем неактивную (серую) базу
        ctx.drawImage(prerender.inactiveCanvas, -prerender.width / 2, -prerender.height / 2);

        // Расчет прогресса слов для "караоке-закрашивания"
        const hasWordSync = line.words && line.words.some(w => w.time !== null);
        if (hasWordSync) {
          const padding = Math.max(30, styleOptions.glowSize * 2 + styleOptions.strokeWidth * 2);
          let activeWidth = 0;

          line.words.forEach((word, wIdx) => {
            const wordText = word.text + (wIdx < line.words.length - 1 ? ' ' : '');
            const wordWidth = getCachedTextWidth(ctx, wordText, activeFont);

            let fillPercent = 0;
            const wordStartTime = word.time || line.time || 0;
            
            const nextWord = line.words[wIdx + 1];
            const nextLineNode = timedLines[i + 1];
            const nextTimeBoundary = nextWord?.time || nextLineNode?.time || (wordStartTime + 4.5);
            const activeGlowDuration = Math.min(0.45, nextTimeBoundary - wordStartTime);

            if (time >= wordStartTime) {
              const elapsed = time - wordStartTime;
              fillPercent = Math.min(1, elapsed / activeGlowDuration);
            }

            activeWidth += wordWidth * fillPercent;
          });

          if (activeWidth > 0) {
            ctx.save();
            // Активный текст (белый) полностью непрозрачен (с учетом глобального opacity)
            ctx.globalAlpha = opacity * lineProgress;
            
            const revealWidth = Math.ceil(padding + activeWidth);
            ctx.drawImage(
              prerender.activeCanvas,
              0, 0, revealWidth, prerender.height,
              -prerender.width / 2, -prerender.height / 2, revealWidth, prerender.height
            );
            ctx.restore();
          }
        } else {
          // Построчный режим — закрашиваем всю
          ctx.save();
          ctx.globalAlpha = opacity * lineProgress;
          ctx.drawImage(prerender.activeCanvas, -prerender.width / 2, -prerender.height / 2);
          ctx.restore();
        }
      } else {
        // Просто тусклая строка в списке
        ctx.drawImage(prerender.inactiveCanvas, -prerender.width / 2, -prerender.height / 2);
      }

      ctx.restore();
    }

    ctx.restore();
  }
}
