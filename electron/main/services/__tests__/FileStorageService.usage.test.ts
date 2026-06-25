/**
 * FileStorageService usage-related integration tests
 *
 * Tests:
 *   TC-I1: readUsageLog returns null when file does not exist
 *   TC-I2: writeUsageLog + readUsageLog round-trips correctly
 *   TC-I3: writeUsageLog overwrites prior data (regenerate semantics)
 *   TC-I4: readUsageEvents returns empty events when file does not exist
 *   TC-I5: appendUsageEvents creates file and accumulates events
 *   TC-I6: appendUsageEvents is additive (read-modify-write)
 *   TC-I7: readUsageEvents returns empty array on corrupt JSON
 *   TC-I8: appendUsageEvents rolling cap — keeps only most recent MAX_USAGE_EVENTS
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileStorageService } from '../FileStorageService.js';
import type { ParagraphUsageLog, StandaloneUsageEvent, PipelineStep } from '../../../shared/types.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'noveler-usage-test-'));
}

function makeUsageLog(paragraphId = 'para-1'): ParagraphUsageLog {
  return {
    paragraphId,
    createdAt: new Date().toISOString(),
    steps: [
      {
        step: 'story-generation',
        model: 'gpt-4o',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        reasoningTokens: null,
        latencyMs: 300,
      },
    ],
    rollup: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      reasoningTokens: null,
      latencyMs: 300,
      callCount: 1,
    },
  };
}

/** Build a StandaloneUsageEvent with the REAL production shape: { createdAt, tipParagraphId, record }. */
function makeEvent(step: PipelineStep = 'suggestions', tipParagraphId: string | null = 'para-tip-1'): StandaloneUsageEvent {
  return {
    createdAt: new Date().toISOString(),
    tipParagraphId,
    record: {
      step,
      model: 'gpt-4o-mini',
      promptTokens: 80,
      completionTokens: 20,
      totalTokens: 100,
      reasoningTokens: null,
      latencyMs: 150,
    },
  };
}

describe('FileStorageService — usage methods', () => {
  const service = new FileStorageService();
  const tmps: string[] = [];

  afterEach(() => {
    for (const dir of tmps) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tmps.length = 0;
  });

  function tmp(): string {
    const d = makeTempDir();
    tmps.push(d);
    return d;
  }

  it('TC-I1: readUsageLog returns null when file does not exist', () => {
    const projectPath = tmp();
    const result = service.readUsageLog(projectPath, 'branch-1', 'para-1');
    expect(result).toBeNull();
  });

  it('TC-I2: writeUsageLog + readUsageLog round-trips correctly', () => {
    const projectPath = tmp();
    const log = makeUsageLog('para-abc');
    service.writeUsageLog(projectPath, 'branch-1', 'para-abc', log);
    const read = service.readUsageLog(projectPath, 'branch-1', 'para-abc');
    expect(read).not.toBeNull();
    expect(read!.paragraphId).toBe('para-abc');
    expect(read!.steps).toHaveLength(1);
    expect(read!.steps[0].step).toBe('story-generation');
    expect(read!.rollup.callCount).toBe(1);
  });

  it('TC-I3: writeUsageLog overwrites prior data (regenerate semantics)', () => {
    const projectPath = tmp();
    const log1 = makeUsageLog('para-x');
    log1.rollup.callCount = 1;
    service.writeUsageLog(projectPath, 'branch-1', 'para-x', log1);

    const log2 = makeUsageLog('para-x');
    log2.rollup.callCount = 3;
    service.writeUsageLog(projectPath, 'branch-1', 'para-x', log2);

    const read = service.readUsageLog(projectPath, 'branch-1', 'para-x');
    expect(read!.rollup.callCount).toBe(3);
  });

  it('TC-I4: readUsageEvents returns empty events when file does not exist', () => {
    const projectPath = tmp();
    const result = service.readUsageEvents(projectPath, 'branch-1');
    expect(result).toEqual({ events: [] });
  });

  it('TC-I5: appendUsageEvents creates file and accumulates events', () => {
    const projectPath = tmp();
    const event = makeEvent('suggestions', 'para-tip-1');
    service.appendUsageEvents(projectPath, 'branch-1', [event]);
    const result = service.readUsageEvents(projectPath, 'branch-1');
    expect(result.events).toHaveLength(1);
    // Assert real StandaloneUsageEvent shape: step is at record.step, not top-level
    expect(result.events[0].record.step).toBe('suggestions');
    expect(result.events[0].tipParagraphId).toBe('para-tip-1');
    expect(result.events[0].record.model).toBe('gpt-4o-mini');
    expect(result.events[0].createdAt).toBeTruthy();
  });

  it('TC-I6: appendUsageEvents is additive (read-modify-write)', () => {
    const projectPath = tmp();
    service.appendUsageEvents(projectPath, 'branch-1', [makeEvent('suggestions')]);
    service.appendUsageEvents(projectPath, 'branch-1', [makeEvent('compaction', null)]);
    const result = service.readUsageEvents(projectPath, 'branch-1');
    expect(result.events).toHaveLength(2);
    expect(result.events[0].record.step).toBe('suggestions');
    expect(result.events[1].record.step).toBe('compaction');
    expect(result.events[1].tipParagraphId).toBeNull();
  });

  it('TC-I7: readUsageEvents returns empty array on corrupt JSON', () => {
    const projectPath = tmp();
    // Manually write corrupt JSON to the expected path
    const summariesDir = path.join(projectPath, 'summaries');
    fs.mkdirSync(summariesDir, { recursive: true });
    fs.writeFileSync(path.join(summariesDir, 'branch-1-usage-events.json'), '{ corrupt', 'utf-8');
    const result = service.readUsageEvents(projectPath, 'branch-1');
    expect(result).toEqual({ events: [] });
  });

  it('TC-I8: appendUsageEvents rolling cap — keeps only the most recent MAX_USAGE_EVENTS entries', () => {
    const projectPath = tmp();
    const cap = FileStorageService.MAX_USAGE_EVENTS;
    // Write cap + 10 events in batches to simulate growth over time
    const batchSize = 50;
    const totalBatches = Math.ceil((cap + 10) / batchSize);
    for (let b = 0; b < totalBatches; b++) {
      const batch: StandaloneUsageEvent[] = [];
      for (let i = 0; i < batchSize; i++) {
        batch.push(makeEvent('suggestions', `para-${b * batchSize + i}`));
      }
      service.appendUsageEvents(projectPath, 'branch-1', batch);
    }
    const result = service.readUsageEvents(projectPath, 'branch-1');
    // Must not exceed the cap
    expect(result.events.length).toBeLessThanOrEqual(cap);
    // The most recent events should be retained (not the oldest)
    const lastEvent = result.events[result.events.length - 1];
    expect(lastEvent.record.step).toBe('suggestions');
  });
});
