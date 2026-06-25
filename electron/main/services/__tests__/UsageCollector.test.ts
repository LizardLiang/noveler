/**
 * UsageCollector unit tests
 *
 * Tests:
 *   TC-U1: add() accumulates records and size increments
 *   TC-U2: flush() produces ParagraphUsageLog with correct step records
 *   TC-U3: flush() rollup sums tokens correctly
 *   TC-U4: flush() rollup returns null for reasoningTokens when none present
 *   TC-U5: flush() rollup aggregates reasoningTokens when present
 *   TC-U6: drain() returns all records and empties the collector
 *   TC-U7: usageToRec() maps fields correctly
 *   TC-U8: size returns 0 for empty collector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UsageCollector, usageToRec } from '../UsageCollector.js';
import type { PipelineStep } from '../../../shared/types.js';

const step1: PipelineStep = 'story-generation';
const step2: PipelineStep = 'dialogue-edit';

const rec1 = {
  model: 'gpt-4o',
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  reasoningTokens: null,
  latencyMs: 200,
};

const rec2 = {
  model: 'gpt-4o-mini',
  promptTokens: 80,
  completionTokens: 40,
  totalTokens: 120,
  reasoningTokens: 10,
  latencyMs: 150,
};

describe('UsageCollector', () => {
  let collector: UsageCollector;

  beforeEach(() => {
    collector = new UsageCollector();
  });

  it('TC-U8: size returns 0 for empty collector', () => {
    expect(collector.size).toBe(0);
  });

  it('TC-U1: add() accumulates records and size increments', () => {
    collector.add(step1, rec1);
    expect(collector.size).toBe(1);
    collector.add(step2, rec2);
    expect(collector.size).toBe(2);
  });

  it('TC-U2: flush() produces ParagraphUsageLog with correct step records', () => {
    collector.add(step1, rec1);
    collector.add(step2, rec2);
    const log = collector.flush('para-123');

    expect(log.paragraphId).toBe('para-123');
    expect(log.steps).toHaveLength(2);
    expect(log.steps[0].step).toBe(step1);
    expect(log.steps[0].model).toBe('gpt-4o');
    expect(log.steps[0].promptTokens).toBe(100);
    expect(log.steps[1].step).toBe(step2);
    expect(log.steps[1].reasoningTokens).toBe(10);
    expect(log.createdAt).toBeTruthy();
  });

  it('TC-U3: flush() rollup sums tokens correctly', () => {
    collector.add(step1, rec1);
    collector.add(step2, rec2);
    const log = collector.flush('para-abc');

    expect(log.rollup.promptTokens).toBe(180); // 100 + 80
    expect(log.rollup.completionTokens).toBe(90); // 50 + 40
    expect(log.rollup.totalTokens).toBe(270); // 150 + 120
    expect(log.rollup.latencyMs).toBe(350); // 200 + 150
    expect(log.rollup.callCount).toBe(2);
  });

  it('TC-U4: flush() rollup returns null reasoningTokens when none present', () => {
    collector.add(step1, rec1); // no reasoning
    const log = collector.flush('para-nr');
    expect(log.rollup.reasoningTokens).toBeNull();
  });

  it('TC-U5: flush() rollup aggregates reasoningTokens when present', () => {
    collector.add(step1, rec1); // reasoningTokens: null
    collector.add(step2, rec2); // reasoningTokens: 10
    const log = collector.flush('para-r');
    expect(log.rollup.reasoningTokens).toBe(10);
  });

  it('TC-U6: drain() returns all records and empties the collector', () => {
    collector.add(step1, rec1);
    collector.add(step2, rec2);
    const records = collector.drain();

    expect(records).toHaveLength(2);
    expect(records[0].step).toBe(step1);
    expect(records[1].step).toBe(step2);
    expect(collector.size).toBe(0);
  });
});

describe('usageToRec', () => {
  it('TC-U7: maps fields correctly', () => {
    const rec = usageToRec('narration-edit', {
      model: 'claude-sonnet',
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
      reasoningTokens: 25,
      latencyMs: 500,
    });

    expect(rec.step).toBe('narration-edit');
    expect(rec.model).toBe('claude-sonnet');
    expect(rec.promptTokens).toBe(200);
    expect(rec.completionTokens).toBe(100);
    expect(rec.totalTokens).toBe(300);
    expect(rec.reasoningTokens).toBe(25);
    expect(rec.latencyMs).toBe(500);
  });
});
