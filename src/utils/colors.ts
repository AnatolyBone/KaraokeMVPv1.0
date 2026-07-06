interface DominantColors {
  primary: string;
  secondary: string;
  glow: string;
}

/**
 * Analyzes image and extracts dominant color themes for background and text styling
 */
export function extractDominantColors(coverUrl: string): Promise<DominantColors> {
  return new Promise((resolve) => {
    const img = new Image();
    if (coverUrl && !coverUrl.startsWith('blob:') && !coverUrl.startsWith('data:')) {
      img.crossOrigin = 'Anonymous';
    }
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(fallbackColors());
          return;
        }

        ctx.drawImage(img, 0, 0, 64, 64);
        const imgData = ctx.getImageData(0, 0, 64, 64).data;

        let rSum = 0, gSum = 0, bSum = 0, weightSum = 0;
        let accent = { r: 168, g: 85, b: 247, score: -1 };
        for (let i = 0; i < imgData.length; i += 4) {
          const alpha = imgData[i + 3] / 255;
          if (alpha < 0.5) continue;

          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];
          const { s, l } = rgbToHsl(r, g, b);
          if (l < 0.04 || l > 0.96) continue;

          const weight = alpha * (0.35 + s * 1.4) * (1 - Math.abs(l - 0.52) * 0.65);
          rSum += r * weight;
          gSum += g * weight;
          bSum += b * weight;
          weightSum += weight;

          const score = s * 1.6 + (1 - Math.abs(l - 0.55)) * 0.7;
          if (score > accent.score) {
            accent = { r, g, b, score };
          }
        }

        if (weightSum <= 0) {
          resolve(fallbackColors());
          return;
        }

        const avg = {
          r: Math.round(rSum / weightSum),
          g: Math.round(gSum / weightSum),
          b: Math.round(bSum / weightSum),
        };
        const avgHsl = rgbToHsl(avg.r, avg.g, avg.b);
        const accentHsl = rgbToHsl(accent.r, accent.g, accent.b);

        const primary = hslToHex(avgHsl.h, clamp(avgHsl.s * 1.15, 0.32, 0.82), 0.16);
        const secondary = hslToHex(accentHsl.h, clamp(accentHsl.s * 1.12, 0.42, 0.9), 0.26);
        const glow = hslToHex(accentHsl.h, clamp(accentHsl.s * 1.25, 0.58, 1), clamp(accentHsl.l * 1.12, 0.48, 0.72));

        resolve({ primary, secondary, glow });
      } catch {
        resolve(fallbackColors());
      }
    };

    img.onerror = () => {
      resolve(fallbackColors());
    };

    img.src = coverUrl;
  });
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }

  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hueToRgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return rgbToHex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}

function fallbackColors(): DominantColors {
  return {
    primary: '#0c071a',
    secondary: '#1d0f3b',
    glow: '#a855f7',
  };
}
