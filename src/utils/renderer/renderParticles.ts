import { Canvas2D, Canvas2DContext, RenderLayer, RenderFrame } from './types';
import { createCanvas } from './canvasHelper';

interface Particle {
  x: number;
  y: number;
  baseX?: number;
  baseY?: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color?: string;
  phase?: number;
  orbit?: number;
  speed?: number;
  stretch?: number;
}

// Кэш оффскрин-холста для частиц
let cachedMiniCanvas: Canvas2D | null = null;
let cachedMiniCtx: Canvas2DContext | null = null;

export class ParticlesLayer implements RenderLayer {
  private particles: Particle[] = [];
  private initializedWidth = 0;
  private initializedHeight = 0;
  private initializedOverlay = '';
  private initializedQuality = '';

  private initParticles(width: number, height: number, overlay: string, coverColors: RenderFrame['coverColors'], quality?: string) {
    this.particles = [];
    
    // Снижаем плотность частиц для среднего качества
    let fxCount = 0;
    if (overlay === 'snow') {
      fxCount = quality === 'ultra' ? 180 : quality === 'medium' ? 45 : 120;
    } else if (overlay === 'lens-dust') {
      fxCount = quality === 'ultra' ? 55 : quality === 'medium' ? 14 : 35;
    } else {
      fxCount = quality === 'ultra' ? 76 : quality === 'medium' ? 18 : 46;
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
        const palette = [
          coverColors?.primary || '#4f46e5',
          coverColors?.glow || '#db2777',
          coverColors?.secondary || '#06b6d4',
          '#f43f5e',
        ];
        const alphaMin = quality === 'ultra' ? 0.14 : quality === 'medium' ? 0.055 : 0.09;
        const alphaRange = quality === 'ultra' ? 0.18 : quality === 'medium' ? 0.07 : 0.12;
        const radiusMin = quality === 'ultra' ? width * 0.14 : width * 0.10;
        const radiusRange = quality === 'ultra' ? width * 0.42 : width * 0.32;
        this.particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * (quality === 'ultra' ? 0.7 : 0.45),
          vy: (Math.random() - 0.5) * (quality === 'ultra' ? 0.7 : 0.45),
          radius: Math.random() * radiusRange + radiusMin,
          alpha: Math.random() * alphaRange + alphaMin,
          color: palette[i % palette.length],
          phase: Math.random() * Math.PI * 2,
          orbit: Math.random() * (width * 0.12) + width * 0.035,
          speed: Math.random() * 0.26 + 0.08,
          stretch: Math.random() * 0.8 + 0.75,
        });
        const created = this.particles[this.particles.length - 1];
        created.baseX = created.x;
        created.baseY = created.y;
      }
    }
    this.initializedWidth = width;
    this.initializedHeight = height;
    this.initializedOverlay = overlay;
    this.initializedQuality = quality || 'high';
  }

  render(ctx: Canvas2DContext, frame: RenderFrame): void {
    const { width, height, styleOptions, coverColors, pulseFactor, quality } = frame;

    const actualOverlay = quality === 'low' ? 'none' : styleOptions.fxOverlay;
    if (actualOverlay === 'none' && styleOptions.bgType !== 'particles') return;

    // Инициализируем частицы один раз при первом запуске или изменении размеров/типа
    if (
      this.particles.length === 0 ||
      this.initializedWidth !== width ||
      this.initializedHeight !== height ||
      this.initializedOverlay !== actualOverlay ||
      this.initializedQuality !== (quality || 'high')
    ) {
      this.initParticles(width, height, actualOverlay, coverColors, quality);
    }

    const useOffscreen = actualOverlay === 'fluid-gradient' || styleOptions.bgType === 'particles';
    let targetCtx: Canvas2DContext = ctx;
    let drawScale = 1;
    const offscreenScale = actualOverlay === 'fluid-gradient'
      ? (quality === 'ultra' ? 0.5 : quality === 'medium' ? 0.25 : 0.38)
      : 0.25;

    if (useOffscreen) {
      const miniWidth = Math.ceil(width * offscreenScale);
      const miniHeight = Math.ceil(height * offscreenScale);
      
      if (!cachedMiniCanvas) {
        cachedMiniCanvas = createCanvas(miniWidth, miniHeight);
        cachedMiniCtx = cachedMiniCanvas.getContext('2d') as Canvas2DContext;
      }
      const miniCanvas = cachedMiniCanvas;
      if (miniCanvas.width !== miniWidth || miniCanvas.height !== miniHeight) {
        miniCanvas.width = miniWidth;
        miniCanvas.height = miniHeight;
        cachedMiniCtx = miniCanvas.getContext('2d') as Canvas2DContext;
      }
      
      if (cachedMiniCtx) {
        targetCtx = cachedMiniCtx;
        drawScale = offscreenScale;
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
        const t = frame.time;
        if (actualOverlay === 'fluid-gradient' && quality === 'ultra') {
          const phase = p.phase || 0;
          const orbit = p.orbit || width * 0.07;
          const speed = p.speed || 0.14;
          const driftX = Math.cos(t * speed + phase) * orbit + Math.sin(t * speed * 0.63 + phase * 1.7) * orbit * 0.55;
          const driftY = Math.sin(t * speed * 0.82 + phase) * orbit * 0.72 + Math.cos(t * speed * 0.47 + phase * 1.3) * orbit * 0.35;
          p.x = (p.baseX || p.x) + driftX;
          p.y = (p.baseY || p.y) + driftY;
        } else {
          p.x += p.vx * 0.4;
          p.y += p.vy * 0.4;
        }

        const margin = p.radius * 0.35;
        if (p.x < -margin) p.x = width + margin;
        if (p.x > width + margin) p.x = -margin;
        if (p.y < -margin) p.y = height + margin;
        if (p.y > height + margin) p.y = -margin;

        const rx = p.x * drawScale;
        const ry = p.y * drawScale;
        const breath = actualOverlay === 'fluid-gradient'
          ? 1 + Math.sin(t * ((p.speed || 0.12) * 1.9) + (p.phase || 0)) * (quality === 'ultra' ? 0.18 : 0.08)
          : 1;
        const rRadius = p.radius * pulseFactor * breath * drawScale;

        const radGrad = targetCtx.createRadialGradient(rx, ry, 2, rx, ry, Math.max(5, rRadius));
        const colorBase = p.color || (coverColors ? coverColors.glow : '#8b5cf6');
        const coreAlpha = actualOverlay === 'fluid-gradient'
          ? (quality === 'ultra' ? Math.min(0.36, p.alpha) : Math.min(0.24, p.alpha))
          : 0.08;
        
        radGrad.addColorStop(0, colorBase.startsWith('#') ? hexToRgba(colorBase, coreAlpha) : `rgba(79, 70, 229, ${coreAlpha})`);
        radGrad.addColorStop(0.38, colorBase.startsWith('#') ? hexToRgba(colorBase, coreAlpha * 0.38) : `rgba(79, 70, 229, ${coreAlpha * 0.38})`);
        radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        targetCtx.save();
        if (actualOverlay === 'fluid-gradient') {
          targetCtx.globalCompositeOperation = 'screen';
        }
        targetCtx.fillStyle = radGrad;
        targetCtx.beginPath();
        if (actualOverlay === 'fluid-gradient') {
          const rotation = t * ((p.speed || 0.12) * 0.35) + (p.phase || 0);
          const stretch = p.stretch || 1;
          targetCtx.ellipse(
            rx,
            ry,
            Math.max(5, rRadius * stretch),
            Math.max(5, rRadius / Math.max(0.65, stretch)),
            rotation,
            0,
            Math.PI * 2
          );
        } else {
          targetCtx.arc(rx, ry, Math.max(5, rRadius), 0, Math.PI * 2);
        }
        targetCtx.fill();
        targetCtx.restore();
      }
    });

    if (useOffscreen && cachedMiniCanvas) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      (ctx as any).imageSmoothingQuality = quality === 'ultra' ? 'high' : 'medium';
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
export function renderParticles(ctx: Canvas2DContext, frame: RenderFrame, _legacyParticles?: any): void {
  particlesLayerInstance.render(ctx, frame);
}
