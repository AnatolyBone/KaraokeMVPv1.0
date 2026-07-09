import { Canvas2DContext, RenderFrame } from './types';
import { LyricLine } from '../../types';
import { calculateSubtitlesLayout } from './layout/calculateLayout';
import { getAnimationStrategy } from './strategies';
import { renderTitleCard } from './renderTitleCard';

export function renderLyrics(
  ctx: Canvas2DContext,
  frame: RenderFrame,
  timedLines: LyricLine[]
): void {
  const { height, time, resolution, styleOptions } = frame;

  // Шаг 1: Чистое вычисление геометрической структуры переходов макета (Layout Engine)
  const layout = calculateSubtitlesLayout(timedLines, time, height, resolution, styleOptions);

  // Сохраняем сглаженный прогресс в фрейм для использования внутри стратегий
  const enrichedFrame: RenderFrame = {
    ...frame,
    easedProgress: layout.easedProgress,
  };

  renderTitleCard(ctx, enrichedFrame, timedLines);

  // Шаг 2: Чистый рендеринг через паттерн-стратегию без micro-jitter (Pure Render Contract)
  const strategy = getAnimationStrategy(styleOptions.animationStyle);
  strategy.render(
    ctx,
    enrichedFrame,
    layout.fromLine,
    layout.toLine,
    layout.easedProgress, // Передаем сглаженный прогресс перехода
    layout.centerY,
    layout.spacing,
    timedLines,
    layout.activeIdx
  );
}
