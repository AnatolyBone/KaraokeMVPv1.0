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
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(fallbackColors());
          return;
        }

        ctx.drawImage(img, 0, 0, 16, 16);
        const imgData = ctx.getImageData(0, 0, 16, 16).data;

        // Average colors
        let rSum = 0, gSum = 0, bSum = 0;
        for (let i = 0; i < imgData.length; i += 4) {
          rSum += imgData[i];
          gSum += imgData[i + 1];
          bSum += imgData[i + 2];
        }

        const count = imgData.length / 4;
        const rAvg = Math.round(rSum / count);
        const gAvg = Math.round(gSum / count);
        const bAvg = Math.round(bSum / count);

        // Generate extremely elegant, deep muted colors to prevent visual flashiness
        const primary = rgbToHex(Math.max(10, Math.round(rAvg * 0.18)), Math.max(5, Math.round(gAvg * 0.18)), Math.max(15, Math.round(bAvg * 0.18)));
        const secondary = rgbToHex(Math.max(20, Math.round(rAvg * 0.3)), Math.max(10, Math.round(gAvg * 0.3)), Math.max(30, Math.round(bAvg * 0.3)));
        const glow = rgbToHex(Math.min(255, Math.round(rAvg * 1.2)), Math.min(255, Math.round(gAvg * 1.2)), Math.min(255, Math.round(bAvg * 1.2)));

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

function fallbackColors(): DominantColors {
  return {
    primary: '#0c071a',
    secondary: '#1d0f3b',
    glow: '#a855f7',
  };
}
