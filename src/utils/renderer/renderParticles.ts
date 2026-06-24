import { RenderLayer, RenderFrame } from './types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color?: string;
}

// Кэш оффскрин-холста для частиц
let cachedMiniCanvas: HTMLCanvasElement | null = null;
let cachedMiniCtx: CanvasRenderingContext2D | null = null;

export class ParticlesLayer implements RenderLayer {
  private particles: Particle[] = [];
  private initializedWidth = 0;
  private initializedHeight = 0;
  private initializedOverlay = '';

  private initParticles(width: number, height: number, overlay: string, _coverColors: any, quality?: string) {
    this.particles = [];
    
    // Снижаем плотность частиц для среднего качества
    let fxCount = overlay === 'snow' ? 120 : 35;
    if (quality === 'medium') {
      fxCount = overlay === 'snow' ? 40 : 12;
    }
    
    for (let i = 0; i < fxCount; i++) {
      if (overlay === 'snow') {
        this.particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.3) * 0.7,
          vy: Math.random() * 1.2 + 0.5,
          radius: Math.random() * 2.5 + 1,
          alpha: Math.random() * 0.6 + 0.2,
        });
      } else if (overlay === 'lens-dust') {
        this.particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
          radius: Math.random() * 6 + 2,
          alpha: Math.random() * 0.2 + 0.05,
          color: `rgba(${240 + Math.random() * 15}, ${190 + Math.random() * 20}, 100, `,
        });
      } else {
        // fluid-gradient
        this.particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          radius: Math.random() * (width * 0.3) + width * 0.1,
          alpha: Math.random() * 0.12 + 0.04,
          color: i % 2 === 0 ? '#4f46e5' : '#db2777',
        });
      }
    }
    this.initializedWidth = width;
    this.initializedHeight = height;
    this.initializedOverlay = overlay;
  }

  render(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const { width, height, styleOptions, coverColors, pulseFactor, quality } = frame;

    const actualOverlay = quality === 'low' ? 'none' : styleOptions.fxOverlay;
    if (actualOverlay === 'none' && styleOptions.bgType !== 'particles') return;

    // Инициализируем частицы один раз при первом запуске или изменении размеров/типа
    if (
      this.particles.length === 0 ||
      this.initializedWidth !== width ||
      this.initializedHeight !== height ||
      this.initializedOverlay !== actualOverlay
    ) {
      this.initParticles(width, height, actualOverlay, coverColors, quality);
    }

    const useOffscreen = actualOverlay === 'fluid-gradient' || styleOptions.bgType === 'particles';
    let targetCtx = ctx;
    let drawScale = 1;

    if (useOffscreen) {
      const miniWidth = Math.ceil(width / 4);
      const miniHeight = Math.ceil(height / 4);
      
      if (!cachedMiniCanvas) {
        cachedMiniCanvas = document.createElement('canvas');
      }
      if (cachedMiniCanvas.width !== miniWidth || cachedMiniCanvas.height !== miniHeight) {
        cachedMiniCanvas.width = miniWidth;
        cachedMiniCanvas.height = miniHeight;
        cachedMiniCtx = cachedMiniCanvas.getContext('2d');
      }
      
      if (cachedMiniCtx) {
        targetCtx = cachedMiniCtx;
        drawScale = 0.25;
        // Очищаем кэшированный оффскрин-холст перед новой отрисовкой кадра
        cachedMiniCtx.clearRect(0, 0, miniWidth, miniHeight);
      }
    }

    this.particles.forEach((p) => {
      if (actualOverlay === 'snow') {
        p.y += p.vy;
        p.x += p.vx;
        if (p.y > height) {
          p.y = -10;
          p.x = Math.random() * width;
        }
        targetCtx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        targetCtx.beginPath();
        targetCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        targetCtx.fill();
      } else if (actualOverlay === 'lens-dust') {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
        
        targetCtx.fillStyle = p.color + `${p.alpha})`;
        targetCtx.beginPath();
        targetCtx.arc(p.x, p.y, p.radius * pulseFactor, 0, Math.PI * 2);
        targetCtx.fill();
      } else if (actualOverlay === 'fluid-gradient' || styleOptions.bgType === 'particles') {
        p.x += p.vx * 0.4;
        p.y += p.vy * 0.4;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        const rx = p.x * drawScale;
        const ry = p.y * drawScale;
        const rRadius = p.radius * pulseFactor * drawScale;

        const radGrad = targetCtx.createRadialGradient(rx, ry, 2, rx, ry, Math.max(5, rRadius));
        const colorBase = p.color || (coverColors ? coverColors.glow : '#8b5cf6');
        
        radGrad.addColorStop(0, colorBase.startsWith('#') ? hexToRgba(colorBase, 0.08) : 'rgba(79, 70, 229, 0.08)');
        radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        targetCtx.fillStyle = radGrad;
        targetCtx.beginPath();
        targetCtx.arc(rx, ry, Math.max(5, rRadius), 0, Math.PI * 2);
        targetCtx.fill();
      }
    });

    if (useOffscreen && cachedMiniCanvas) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      (ctx as any).imageSmoothingQuality = 'medium';
      ctx.drawImage(cachedMiniCanvas, 0, 0, width, height);
      ctx.restore();
    }
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Экземпляр для совместимости
const particlesLayerInstance = new ParticlesLayer();
export function renderParticles(ctx: CanvasRenderingContext2D, frame: RenderFrame, _legacyParticles?: any): void {
  particlesLayerInstance.render(ctx, frame);
}
