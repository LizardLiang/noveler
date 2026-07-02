export function allocateFullStoryCounts(total: number, count: number): number[] {
  if (!Number.isInteger(total) || total <= 0) throw new Error('total must be a positive integer');
  if (!Number.isInteger(count) || count <= 0) throw new Error('count must be a positive integer');
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  return Array.from({ length: count }, () => base + (remainder-- > 0 ? 1 : 0));
}

export function isWithinFullStoryTolerance(actual: number, target: number): boolean {
  return actual >= Math.floor(target * 0.95) && actual <= Math.ceil(target * 1.05);
}
