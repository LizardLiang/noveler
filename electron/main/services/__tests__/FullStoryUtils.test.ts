import { describe, expect, it } from 'vitest';
import { allocateFullStoryCounts, isWithinFullStoryTolerance } from '../FullStoryUtils.js';

describe('FullStoryUtils', () => {
  it('allocates the exact target across sections', () => {
    const counts = allocateFullStoryCounts(10_003, 5);
    expect(counts).toHaveLength(5);
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(10_003);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('uses inclusive five-percent completion boundaries', () => {
    expect(isWithinFullStoryTolerance(9_500, 10_000)).toBe(true);
    expect(isWithinFullStoryTolerance(10_500, 10_000)).toBe(true);
    expect(isWithinFullStoryTolerance(9_499, 10_000)).toBe(false);
    expect(isWithinFullStoryTolerance(10_501, 10_000)).toBe(false);
  });

  it('rejects invalid allocation inputs', () => {
    expect(() => allocateFullStoryCounts(0, 1)).toThrow();
    expect(() => allocateFullStoryCounts(1_000, 0)).toThrow();
  });
});
