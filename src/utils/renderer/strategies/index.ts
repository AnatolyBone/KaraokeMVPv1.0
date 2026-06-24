import { AnimationStrategy } from '../types';
import { AppleMusicStrategy } from './apple';
import { ClassicKaraokeStrategy } from './classic';
import { KineticTypographyStrategy } from './kinetic';
import { SplitScreenStrategy } from './split';

const appleStrategy = new AppleMusicStrategy();
const classicStrategy = new ClassicKaraokeStrategy();
const kineticStrategy = new KineticTypographyStrategy();
const splitStrategy = new SplitScreenStrategy();

export function getAnimationStrategy(style: 'apple-music' | 'classic-karaoke' | 'kinetic' | 'split-screen'): AnimationStrategy {
  if (style === 'split-screen') return splitStrategy;
  if (style === 'classic-karaoke') return classicStrategy;
  if (style === 'kinetic') return kineticStrategy;
  return appleStrategy;
}
