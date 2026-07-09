import { Canvas2D, Canvas2DContext, RenderLayer, RenderFrame } from './types';
import { createCanvas } from './canvasHelper';

// Кэш для линейных градиентов фона
let cachedBgCanvas: Canvas2D | null = null;
let cachedBgKey = '';

// Кэш для оффскрин-холста cover-blur
let cachedBlurCanvas: Canvas2D | null = null;
let cachedBlurCtx: Canvas2DContext | null = null;

/** Сбрасывает все кэши фона — вызывается при смене пресета/стиля */
export function clearBackgroundCache(): void {
  cachedBgCanvas = null;
  cachedBgKey = '';
  cachedBlurCanvas = null;
  cachedBlurCtx = null;
}

export class BackgroundLayer implements RenderLayer {
  render(ctx: Canvas2DContext, frame: RenderFrame): void {
    const { width, height, styleOptions, coverColors, pulseFactor, quality } = frame;

    if (quality === 'low') {
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    if (styleOptions.bgType === 'minimal-dark') {
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    if (styleOptions.bgType === 'split-dark') {
      const pColor = coverColors ? coverColors.primary : '#111111';
      const sColor = coverColors ? coverColors.secondary : '#050505';
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, pColor);
      grad.addColorStop(1, sColor);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // cover-blur: рисуем пульсирующий радиальный градиент из палитры обложки (через уменьшенный оффскрин-холст для 16-кратного ускорения)
    if (styleOptions.bgType === 'cover-blur') {
      const isSpotify = styleOptions.preset === 'spotify';
      const pColor = isSpotify ? '#0f3d2e' : coverColors ? coverColors.primary : '#3c0b63';
      const sColor = isSpotify ? '#06130f' : coverColors ? coverColors.secondary : '#11031f';
      const glowColor = isSpotify ? '#1ed760' : coverColors ? coverColors.glow : '#a855f7';
      
      const scale = 0.25;
      const miniWidth = Math.ceil(width * scale);
      const miniHeight = Math.ceil(height * scale);
      
      if (!cachedBlurCanvas) {
        cachedBlurCanvas = createCanvas(miniWidth, miniHeight);
        cachedBlurCtx = cachedBlurCanvas.getContext('2d') as Canvas2DContext;
      }
      const blurCanvas = cachedBlurCanvas;
      if (blurCanvas.width !== miniWidth || blurCanvas.height !== miniHeight) {
        blurCanvas.width = miniWidth;
        blurCanvas.height = miniHeight;
        cachedBlurCtx = blurCanvas.getContext('2d') as Canvas2DContext;
      }
      
      if (cachedBlurCtx) {
        const rx = miniWidth / 2;
        const ry = miniHeight / 2;
        const rRadius = miniWidth * 0.85 * pulseFactor;
        
        const baseGrad = cachedBlurCtx.createLinearGradient(0, 0, miniWidth, miniHeight);
        baseGrad.addColorStop(0, pColor);
        baseGrad.addColorStop(0.58, sColor);
        baseGrad.addColorStop(1, '#030108');
        cachedBlurCtx.fillStyle = baseGrad;
        cachedBlurCtx.fillRect(0, 0, miniWidth, miniHeight);

        const grad = cachedBlurCtx.createRadialGradient(rx, ry, 12, rx, ry, rRadius);
        grad.addColorStop(0, hexToRgba(glowColor, 0.48));
        grad.addColorStop(0.45, hexToRgba(sColor, 0.42));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        cachedBlurCtx.fillStyle = grad;
        cachedBlurCtx.fillRect(0, 0, miniWidth, miniHeight);

        const sideGlow = cachedBlurCtx.createRadialGradient(miniWidth * 0.18, miniHeight * 0.82, 0, miniWidth * 0.18, miniHeight * 0.82, miniWidth * 0.72);
        sideGlow.addColorStop(0, hexToRgba(pColor, 0.55));
        sideGlow.addColorStop(1, 'rgba(0,0,0,0)');
        cachedBlurCtx.fillStyle = sideGlow;
        cachedBlurCtx.fillRect(0, 0, miniWidth, miniHeight);
        
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        (ctx as any).imageSmoothingQuality = 'medium';
        ctx.drawImage(blurCanvas, 0, 0, width, height);
        if (isSpotify) {
          const vignette = ctx.createRadialGradient(
            width * 0.5, height * 0.46,
            Math.min(width, height) * 0.12,
            width * 0.5, height * 0.46,
            Math.max(width, height) * 0.78
          );
          vignette.addColorStop(0, 'rgba(0,0,0,0)');
          vignette.addColorStop(1, 'rgba(0,0,0,0.44)');
          ctx.fillStyle = vignette;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.restore();
      }
      return;
    }

    // Обычные линейные градиенты: кэшируем в отдельную переменную
    // Ключ включает bgType чтобы смена стиля инвалидировала кэш
    const colorKey = coverColors ? `${coverColors.primary}_${coverColors.secondary}_${coverColors.glow}` : 'fallback';
    const bgKey = `${styleOptions.bgType}_${styleOptions.gradientPreset}_${styleOptions.preset}_${colorKey}_${width}x${height}`;
    if (cachedBgCanvas && cachedBgKey === bgKey) {
      ctx.drawImage(cachedBgCanvas, 0, 0);
      return;
    }

    cachedBgCanvas = createCanvas(width, height);
    const bgCanvas = cachedBgCanvas;
    const bgCtx = bgCanvas.getContext('2d');

    if (bgCtx) {
      let grad = bgCtx.createLinearGradient(0, 0, width, height);
      if (styleOptions.preset === 'tiktok-neon') {
        grad.addColorStop(0, '#05040d');
        grad.addColorStop(0.48, '#17051f');
        grad.addColorStop(1, '#02040a');
      } else if (coverColors) {
        grad.addColorStop(0, coverColors.primary);
        grad.addColorStop(0.48, coverColors.secondary);
        grad.addColorStop(1, '#030108');
      } else if (styleOptions.gradientPreset === 'purple-night') {
        grad.addColorStop(0, '#090514');
        grad.addColorStop(0.5, '#140c24');
        grad.addColorStop(1, '#05020a');
      } else if (styleOptions.gradientPreset === 'ocean') {
        grad.addColorStop(0, '#011f26');
        grad.addColorStop(0.5, '#000c12');
        grad.addColorStop(1, '#000305');
      } else {
        grad.addColorStop(0, '#24020c');
        grad.addColorStop(0.5, '#0d0003');
        grad.addColorStop(1, '#030001');
      }
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, width, height);
      if (styleOptions.preset === 'tiktok-neon') {
        const cyanGlow = bgCtx.createRadialGradient(
          width * 0.18, height * 0.24,
          0,
          width * 0.18, height * 0.24,
          Math.max(width, height) * 0.55
        );
        cyanGlow.addColorStop(0, 'rgba(0,234,255,0.2)');
        cyanGlow.addColorStop(1, 'rgba(0,0,0,0)');
        bgCtx.fillStyle = cyanGlow;
        bgCtx.fillRect(0, 0, width, height);

        const magentaGlow = bgCtx.createRadialGradient(
          width * 0.82, height * 0.72,
          0,
          width * 0.82, height * 0.72,
          Math.max(width, height) * 0.58
        );
        magentaGlow.addColorStop(0, 'rgba(255,47,179,0.18)');
        magentaGlow.addColorStop(1, 'rgba(0,0,0,0)');
        bgCtx.fillStyle = magentaGlow;
        bgCtx.fillRect(0, 0, width, height);
      }
      cachedBgKey = bgKey;
      ctx.drawImage(bgCanvas, 0, 0);
    }
  }
}

// Синглтон
const backgroundLayerInstance = new BackgroundLayer();
export function renderBackground(ctx: Canvas2DContext, frame: RenderFrame, bgVideoEl?: HTMLVideoElement | null): void {
  if (frame.styleOptions.bgType === 'custom-video' && bgVideoEl && bgVideoEl.readyState >= 2) {
    ctx.drawImage(bgVideoEl, 0, 0, frame.width, frame.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, frame.width, frame.height);
  } else {
    backgroundLayerInstance.render(ctx, frame);
  }

  // Цветовой overlay от обложки — применяется поверх ЛЮБОГО типа фона (кроме cover-blur, у которого свой механизм)
  // Добавляет мягкий тёплый/холодный оттенок в зависимости от палитры обложки
  if (frame.coverColors && frame.styleOptions.bgType !== 'cover-blur') {
    const { width, height, coverColors, pulseFactor } = frame;
    const pulse = pulseFactor ?? 1;

    // Верхний радиальный блик (primary color)
    const topGrad = ctx.createRadialGradient(
      width * 0.5, 0,
      0,
      width * 0.5, 0,
      Math.min(width, height) * 0.7 * pulse
    );
    topGrad.addColorStop(0, hexToRgba(coverColors.primary, 0.28));
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, width, height);

    // Нижний радиальный блик (secondary / glow color)
    const btmGrad = ctx.createRadialGradient(
      width * 0.5, height,
      0,
      width * 0.5, height,
      Math.min(width, height) * 0.55 * pulse
    );
    btmGrad.addColorStop(0, hexToRgba(coverColors.glow, 0.14));
    btmGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = btmGrad;
    ctx.fillRect(0, 0, width, height);
  }
}

/** Конвертирует hex-цвет #rrggbb в rgba() строку с заданной прозрачностью */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}
