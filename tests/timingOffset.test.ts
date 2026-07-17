import assert from 'node:assert/strict';
import test from 'node:test';
import type { LyricLine } from '../src/types.ts';
import {
  createEffectiveTimingLines,
  createTimingOffsetPreview,
  getEffectiveTimestamp,
  getOriginalTimestamp,
} from '../src/utils/timingOffset.ts';

const lines: LyricLine[] = [{
  id: 'line-1',
  text: 'hello',
  time: 1,
  words: [{
    id: 'word-1',
    text: 'hello',
    time: 1.1,
    syllables: [{ id: 'syllable-1', text: 'hel', time: 1.2 }],
  }],
}];

test('creates effective line, word and syllable timings without mutating originals', () => {
  const effective = createEffectiveTimingLines(lines, 0.123, 'shifted');

  assert.equal(effective[0].time, 1.123);
  assert.equal(effective[0].words[0].time, 1.223);
  assert.equal(effective[0].words[0].syllables?.[0].time, 1.323);
  assert.equal(lines[0].time, 1);
  assert.equal(lines[0].words[0].time, 1.1);
  assert.equal(lines[0].words[0].syllables?.[0].time, 1.2);
});

test('original comparison mode ignores the saved offset', () => {
  assert.equal(getEffectiveTimestamp(12.4, 0.34, 'shifted'), 12.74);
  assert.equal(getEffectiveTimestamp(12.4, 0.34, 'original'), 12.4);
  assert.equal(getOriginalTimestamp(12.74, 0.34), 12.4);
});

test('preview reports unsafe negative and after-audio timestamps separately', () => {
  const negative = createTimingOffsetPreview(lines, -1.15, 2);
  assert.equal(negative.requiresClipping, true);
  assert.equal(negative.negativeTimestampCount, 2);
  assert.equal(negative.maximumSafeNegativeOffset, -1);

  const late = createTimingOffsetPreview(lines, 1, 2);
  assert.equal(late.requiresClipping, false);
  assert.equal(late.outOfRangeTimestampCount, 2);
});
