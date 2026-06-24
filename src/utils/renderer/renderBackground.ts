import { RenderLayer, RenderFrame } from './types';

// Кэш для линейных градиентов фона
let cachedBgCanvas: HTMLCanvasElement | null = null;
let cachedBgKey = '';

// Кэш для оффскрин-холста cover-blur
let cachedBlurCanvas: HTMLCanvasElement | null = null;
let cachedBlurCtx: CanvasRenderingContext2D | null = null;

/** Сбрасывает все кэши фона — вызывается при смене пресета/стиля */
export function clearBackgroundCache(): void {
  cachedBgCanvas = null;
  cachedBgKey = '';
  cachedBlurCanvas = null;
  cachedBlurCtx = null;
}

export class BackgroundLayer implements RenderLayer {
  render(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
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
      const pColor = coverColors ? coverColors.primary : '#3c0b63';
      const sColor = coverColors ? coverColors.secondary : '#11031f';
      
      const scale = 0.25;
      const miniWidth = Math.ceil(width * scale);
      const miniHeight = Math.ceil(height * scale);
      
      if (!cachedBlurCanvas) {
        cachedBlurCanvas = document.createElement('canvas');
      }
      if (cachedBlurCanvas.width !== miniWidth || cachedBlurCanvas.height !== miniHeight) {
        cachedBlurCanvas.width = miniWidth;
        cachedBlurCanvas.height = miniHeight;
        cachedBlurCtx = cachedBlurCanvas.getContext('2d');
      }
      
      if (cachedBlurCtx) {
        const rx = miniWidth / 2;
        const ry = miniHeight / 2;
        const rRadius = miniWidth * 0.85 * pulseFactor;
        
        const grad = cachedBlurCtx.createRadialGradient(rx, ry, 12, rx, ry, rRadius);
        grad.addColorStop(0, pColor);
        grad.addColorStop(0.55, sColor);
        grad.addColorStop(1, '#040008');
        cachedBlurCtx.fillStyle = grad;
        cachedBlurCtx.fillRect(0, 0, miniWidth, miniHeight);
        
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        (ctx as any).imageSmoothingQuality = 'medium';
        ctx.drawImage(cachedBlurCanvas, 0, 0, width, height);
        ctx.restore();
      }
      return;
    }

    // Обычные линейные градиенты: кэшируем в отдельную переменную
    // Ключ включает bgType чтобы смена стиля инвалидировала кэш
    const bgKey = `${styleOptions.bgType}_${styleOptions.gradientPreset}_${width}x${height}`;
    if (cachedBgCanvas && cachedBgKey === bgKey) {
      ctx.drawImage(cachedBgCanvas, 0, 0);
      return;
    }

    cachedBgCanvas = document.createElement('canvas');
    cachedBgCanvas.width = width;
    cachedBgCanvas.height = height;
    const bgCtx = cachedBgCanvas.getContext('2d');

    if (bgCtx) {
      let grad = bgCtx.createLinearGradient(0, 0, width, height);
      if (styleOptions.gradientPreset === 'purple-night') {
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
      cachedBgKey = bgKey;
      ctx.drawImage(cachedBgCanvas, 0, 0);
    }
  }
}

// Синглтон
const backgroundLayerInstance = new BackgroundLayer();
export function renderBackground(ctx: CanvasRenderingContext2D, frame: RenderFrame, bgVideoEl?: HTMLVideoElement | null): void {
  if (frame.styleOptions.bgType === 'custom-video' && bgVideoEl && bgVideoEl.readyState >= 2) {
    ctx.drawImage(bgVideoEl, 0, 0, frame.width, frame.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, frame.width, frame.height);
    return;
  }
  backgroundLayerInstance.render(ctx, frame);
}
