import { LyricLine, VideoStyleOptions } from '../../../types';

export interface LayoutMetadata {
  fromLine: LyricLine | null;
  toLine: LyricLine | null;
  transitionProgress: number;
  easedProgress: number;
  activeIdx: number;
  centerY: number;
  spacing: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Вычисляет структуру геометрического макета на основе интерполяционной модели переходов.
 * Строки переключаются плавно, исключая мгновенные скачки (snapping) во время проигрывания.
 */
export function calculateSubtitlesLayout(
  timedLines: LyricLine[],
  time: number,
  height: number,
  resolution: '720p' | '1080p',
  styleOptions: VideoStyleOptions
): LayoutMetadata {
  const centerY = styleOptions.aspectRatio === '9:16' ? height * 0.62 : height / 2;
  const spacing = resolution === '1080p' ? 140 : 90;

  // 1. Бинарный поиск базового кандидата строки (O(log N))
  let low = 0;
  let high = timedLines.length - 1;
  let candidateIdx = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (timedLines[mid].time! <= time) {
      candidateIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  let fromLine: LyricLine | null = null;
  let toLine: LyricLine | null = null;
  let transitionProgress = 0;
  let activeIdx = candidateIdx;

  const transitionWindow = 0.4; // Окно плавного переката субтитров в секундах (было 0.7 — сдвигало слишком рано, 0.15 — дергалось, 0.4 — идеально плавно)

  if (candidateIdx === -1) {
    // Мы в самом начале трека (вступление)
    if (timedLines.length > 0) {
      toLine = timedLines[0];
      const nextTime = toLine.time || 0;
      const startTransition = nextTime - transitionWindow;
      
      if (time >= startTransition) {
        transitionProgress = Math.max(0, Math.min(1, (time - startTransition) / transitionWindow));
      }
    }
  } else {
    // Находим текущую и следующую строки
    fromLine = timedLines[candidateIdx];
    const nextLineNode = candidateIdx + 1 < timedLines.length ? timedLines[candidateIdx + 1] : null;

    if (nextLineNode && nextLineNode.time !== null) {
      const nextTime = nextLineNode.time;
      const startTransition = nextTime - transitionWindow;

      if (time >= startTransition) {
        // Мы вошли в зону плавного переката
        toLine = nextLineNode;
        transitionProgress = Math.max(0, Math.min(1, (time - startTransition) / transitionWindow));
      }
    }
  }

  // Применяем синусоидально-кубическое сглаживание для плавного скролла
  const easedProgress = easeInOutCubic(transitionProgress);

  return {
    fromLine,
    toLine,
    transitionProgress,
    easedProgress,
    activeIdx,
    centerY,
    spacing,
  };
}
