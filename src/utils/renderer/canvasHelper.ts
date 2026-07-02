export function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document === 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
