import { LyricLine, VideoStyleOptions } from '../../types';
import { clearBackgroundCache } from './renderBackground';
import { createCanvas } from './canvasHelper';
import { Canvas2DContext } from './types';

interface PrerenderedText {
  inactiveCanvas: HTMLCanvasElement | OffscreenCanvas;
  activeCanvas: HTMLCanvasElement | OffscreenCanvas;
  glowCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  width: number;
  height: number;
  /** Эффективный размер шрифта (может быть уменьшен если текст не вписался в maxWidth) */
  effectiveFontSize: number;
}

const widthCache = new Map<string, number>();
const prerenderCache = new Map<string, PrerenderedText>();

export function getCachedTextWidth(ctx: Canvas2DContext, text: string, font: string): number {
  const key = `${font}_${text}`;
  if (widthCache.has(key)) {
    return widthCache.get(key)!;
  }
  const originalFont = ctx.font;
  ctx.font = font;
  const width = ctx.measureText(text).width;
  ctx.font = originalFont;
  widthCache.set(key, width);
  return width;
}

/**
 * Вычисляет уменьшенный шрифт, если текст шире maxWidth.
 * Возвращает масштабированный font-string и effectiveFontSize.
 */
function fitFontToWidth(
  ctx: Canvas2DContext,
  text: string,
  font: string,
  fontSize: number,
  fontFamily: string,
  maxWidth: number
): { fittedFont: string; fittedFontSize: number } {
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;

  if (textWidth <= maxWidth) {
    return { fittedFont: font, fittedFontSize: fontSize };
  }

  // Линейное масштабирование шрифта вниз + небольшой запас 4%
  const scale = (maxWidth / textWidth) * 0.96;
  const fittedFontSize = Math.max(Math.floor(fontSize * scale), 12);
  // Сохраняем bold если оно было в оригинальном font
  const isBold = font.startsWith('bold');
  const fittedFont = `${isBold ? 'bold ' : ''}${fittedFontSize}px ${fontFamily}`;
  return { fittedFont, fittedFontSize };
}

/**
 * Пре-рендерит строчку караоке на оффскрин-холсты для Inactive, Active и Glow слоев (Text Prerender Cache).
 * @param maxWidth Максимальная ширина текста в пикселях (ширина канваса). Текст автоматически масштабируется.
 */
export function getPrerenderedText(
  ctx: Canvas2DContext,
  line: LyricLine,
  font: string,
  styleOptions: VideoStyleOptions,
  glowColorOverride: string | null,
  maxWidth?: number,
  quality?: 'low' | 'medium' | 'high' | 'ultra'
): PrerenderedText {
  const maxW = maxWidth ?? 99999;
  
  // Динамически масштабируем размер свечения на основе настройки качества
  let glowSize = styleOptions.glowSize;
  if (quality === 'low') {
    glowSize = 0;
  } else if (quality === 'medium') {
    glowSize = Math.min(4, styleOptions.glowSize);
  }

  const cacheKey = `${line.id}_${font}_${styleOptions.fontSize}_${styleOptions.strokeWidth}_${glowSize}_${styleOptions.activeWordColor}_${styleOptions.inactiveWordColor}_mw${maxW}`;
  
  if (prerenderCache.has(cacheKey)) {
    return prerenderCache.get(cacheKey)!;
  }

  const originalFont = ctx.font;

  // Авто-подгонка шрифта под maxWidth
  const { fittedFont, fittedFontSize } = fitFontToWidth(
    ctx,
    line.text,
    font,
    styleOptions.fontSize,
    styleOptions.fontFamily,
    maxW
  );

  ctx.font = fittedFont;

  // Вычисляем габариты оффскрин холста с запасом под тень и свечение
  const textWidth = ctx.measureText(line.text).width;
  const padding = Math.max(30, glowSize * 2 + styleOptions.strokeWidth * 2);
  const canvasWidth = Math.ceil(textWidth + padding * 2);
  const canvasHeight = Math.ceil(fittedFontSize * 2 + padding * 2);

  // --- 1. INACTIVE TEXT LAYER ---
  const inactiveCanvas = createCanvas(canvasWidth, canvasHeight);
  const inactiveCtx = inactiveCanvas.getContext('2d')!;
  inactiveCtx.font = fittedFont;
  inactiveCtx.textAlign = 'center';
  inactiveCtx.textBaseline = 'middle';
  inactiveCtx.fillStyle = styleOptions.inactiveWordColor;
  inactiveCtx.fillText(line.text, canvasWidth / 2, canvasHeight / 2);
  if (styleOptions.strokeWidth > 0) {
    inactiveCtx.strokeStyle = styleOptions.strokeColor;
    inactiveCtx.lineWidth = styleOptions.strokeWidth;
    inactiveCtx.strokeText(line.text, canvasWidth / 2, canvasHeight / 2);
  }

  // --- 2. ACTIVE TEXT LAYER ---
  const activeCanvas = createCanvas(canvasWidth, canvasHeight);
  const activeCtx = activeCanvas.getContext('2d')!;
  activeCtx.font = fittedFont;
  activeCtx.textAlign = 'center';
  activeCtx.textBaseline = 'middle';
  activeCtx.fillStyle = styleOptions.activeWordColor;
  activeCtx.fillText(line.text, canvasWidth / 2, canvasHeight / 2);
  if (styleOptions.strokeWidth > 0) {
    activeCtx.strokeStyle = styleOptions.strokeColor;
    activeCtx.lineWidth = styleOptions.strokeWidth;
    activeCtx.strokeText(line.text, canvasWidth / 2, canvasHeight / 2);
  }

  // --- 3. GLOW / SHADOW LAYER (Запекаем тяжелый Gaussian Blur один раз перед стартом!) ---
  let glowCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  if (glowSize > 0) {
    glowCanvas = createCanvas(canvasWidth, canvasHeight);
    const glowCtx = glowCanvas.getContext('2d')!;
    glowCtx.font = fittedFont;
    glowCtx.textAlign = 'center';
    glowCtx.textBaseline = 'middle';
    
    // Настраиваем тяжелый shadowBlur один раз во избежание флуктуаций CPU
    glowCtx.shadowColor = glowColorOverride || styleOptions.glowColor;
    glowCtx.shadowBlur = glowSize;
    
    // Рисуем невидимый текст, чтобы отбросить тень
    glowCtx.fillStyle = styleOptions.activeWordColor;
    glowCtx.fillText(line.text, canvasWidth / 2, canvasHeight / 2);
    
    if (styleOptions.strokeWidth > 0) {
      glowCtx.strokeStyle = styleOptions.strokeColor;
      glowCtx.lineWidth = styleOptions.strokeWidth;
      glowCtx.strokeText(line.text, canvasWidth / 2, canvasHeight / 2);
    }
  }

  ctx.font = originalFont;

  const result: PrerenderedText = {
    inactiveCanvas,
    activeCanvas,
    glowCanvas,
    width: canvasWidth,
    height: canvasHeight,
    effectiveFontSize: fittedFontSize,
  };

  prerenderCache.set(cacheKey, result);
  return result;
}

export function clearTextWidthCache(): void {
  widthCache.clear();
  prerenderCache.clear();
  clearBackgroundCache();
}
