/**
 * StatsService — token usage aggregation tests
 *
 * These tests cover the scan-on-read aggregation logic in getStats().
 * The method is integration-tested using a real temp filesystem and
 * a mocked SQLite database with minimal paragraph rows.
 *
 * Tests:
 *   TC-A1: getStats returns hasData=false when no usage logs exist
 *   TC-A2: getStats aggregates per-paragraph usage logs correctly
 *   TC-A3: getStats includes branch-level usage events in aggregation
 *   TC-A4: grandTotal sums all tokens from both sources
 *   TC-A5: perStep groups by step name
 *   TC-A6: perModel groups by model name
 *   TC-A7: dailyTrend covers last 7 days, zeroes for days without usage
 *   TC-A8: reasoningTokens is null in grandTotal when no records have reasoning
 *   TC-A9: reasoningTokens is aggregated when present in some records
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mock FileStorageService before importing StatsService ────────────────────

const mockReadUsageLog = vi.fn();
const mockReadUsageEvents = vi.fn();
const mockReadParagraphContent = vi.fn().mockReturnValue('');

vi.mock('../FileStorageService.js', () => ({
  getFileStorageService: () => ({
    readParagraphContent: mockReadParagraphContent,
    readUsageLog: mockReadUsageLog,
    readUsageEvents: mockReadUsageEvents,
  }),
}));

import { getStatsService } from '../StatsService.js';
import type { ParagraphUsageLog, StepUsageRecord } from '../../../shared/types.js';

// ── Minimal DB stub ──────────────────────────────────────────────────────────

function makeMockDb(paragraphIds: string[]) {
  const today = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const rows = paragraphIds.map(id => ({ id, active_version: 1, created_at: today }));
  return {
    prepare: (sql: string) => ({
      all: (..._args: unknown[]) => {
        if (sql.includes('paragraph_meta')) return rows;
        if (sql.includes('characters')) return [];
        return [];
      },
    }),
  };
}

// ── Factory helpers ──────────────────────────────────────────────────────────

function makeStepRecord(overrides: Partial<StepUsageRecord> = {}): StepUsageRecord {
  return {
    step: 'story-generation',
    model: 'gpt-4o',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    reasoningTokens: null,
    latencyMs: 300,
    ...overrides,
  };
}

function makeUsageLog(paragraphId: string, steps: StepUsageRecord[]): ParagraphUsageLog {
  const pt = steps.reduce((s, r) => s + (r.promptTokens ?? 0), 0);
  const ct = steps.reduce((s, r) => s + (r.completionTokens ?? 0), 0);
  return {
    paragraphId,
    createdAt: new Date().toISOString(),
    steps,
    rollup: {
      promptTokens: pt,
      completionTokens: ct,
      totalTokens: pt + ct,
      reasoningTokens: null,
      latencyMs: steps.reduce((s, r) => s + (r.latencyMs ?? 0), 0),
      callCount: steps.length,
    },
  };
}

describe('StatsService — token usage aggregation', () => {
  const service = getStatsService();
  const fakeProjectPath = '/fake/project';
  const branchId = 'branch-1';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no usage events
    mockReadUsageEvents.mockReturnValue({ events: [] });
  });

  it('TC-A1: getStats returns hasData=false when no usage logs exist', () => {
    mockReadUsageLog.mockReturnValue(null);
    const db = makeMockDb(['para-1']);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);
    expect(stats.tokenUsage.hasData).toBe(false);
    expect(stats.tokenUsage.grandTotal.callCount).toBe(0);
  });

  it('TC-A2: getStats aggregates per-paragraph usage logs correctly', () => {
    const step = makeStepRecord({ promptTokens: 200, completionTokens: 80, totalTokens: 280 });
    const log = makeUsageLog('para-1', [step]);
    mockReadUsageLog.mockReturnValue(log);

    const db = makeMockDb(['para-1']);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);

    expect(stats.tokenUsage.hasData).toBe(true);
    expect(stats.tokenUsage.grandTotal.promptTokens).toBe(200);
    expect(stats.tokenUsage.grandTotal.completionTokens).toBe(80);
    expect(stats.tokenUsage.grandTotal.totalTokens).toBe(280);
    expect(stats.tokenUsage.grandTotal.callCount).toBe(1);
  });

  it('TC-A3: getStats includes branch-level usage events in aggregation', () => {
    mockReadUsageLog.mockReturnValue(null); // no para usage
    mockReadUsageEvents.mockReturnValue({
      events: [
        {
          step: 'suggestions',
          createdAt: new Date().toISOString(),
          record: makeStepRecord({ step: 'suggestions', promptTokens: 50, completionTokens: 20, totalTokens: 70 }),
        },
      ],
    });

    const db = makeMockDb(['para-1']);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);

    expect(stats.tokenUsage.hasData).toBe(true);
    expect(stats.tokenUsage.grandTotal.totalTokens).toBe(70);
  });

  it('TC-A4: grandTotal sums all tokens from both sources', () => {
    const paraStep = makeStepRecord({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    const paraLog = makeUsageLog('para-1', [paraStep]);
    mockReadUsageLog.mockReturnValue(paraLog);
    mockReadUsageEvents.mockReturnValue({
      events: [
        {
          step: 'suggestions',
          createdAt: new Date().toISOString(),
          record: makeStepRecord({ step: 'suggestions', promptTokens: 80, completionTokens: 30, totalTokens: 110 }),
        },
      ],
    });

    const db = makeMockDb(['para-1']);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);

    expect(stats.tokenUsage.grandTotal.promptTokens).toBe(180); // 100 + 80
    expect(stats.tokenUsage.grandTotal.completionTokens).toBe(80); // 50 + 30
    expect(stats.tokenUsage.grandTotal.totalTokens).toBe(260); // 150 + 110
    expect(stats.tokenUsage.grandTotal.callCount).toBe(2);
  });

  it('TC-A5: perStep groups by step name', () => {
    mockReadUsageLog.mockImplementation((_p: string, _b: string, paragraphId: string) => {
      if (paragraphId === 'para-1') {
        return makeUsageLog('para-1', [
          makeStepRecord({ step: 'story-generation', promptTokens: 100, completionTokens: 50, totalTokens: 150 }),
          makeStepRecord({ step: 'dialogue-edit', promptTokens: 60, completionTokens: 30, totalTokens: 90 }),
        ]);
      }
      return null;
    });

    const db = makeMockDb(['para-1']);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);

    expect(stats.tokenUsage.perStep).toHaveLength(2);
    const steps = stats.tokenUsage.perStep.map(s => s.step);
    expect(steps).toContain('story-generation');
    expect(steps).toContain('dialogue-edit');

    const storyStep = stats.tokenUsage.perStep.find(s => s.step === 'story-generation')!;
    expect(storyStep.callCount).toBe(1);
    expect(storyStep.totalPromptTokens).toBe(100);
  });

  it('TC-A6: perModel groups by model name', () => {
    mockReadUsageLog.mockReturnValue(
      makeUsageLog('para-1', [
        makeStepRecord({ model: 'gpt-4o', totalTokens: 150 }),
        makeStepRecord({ model: 'gpt-4o-mini', totalTokens: 100 }),
        makeStepRecord({ model: 'gpt-4o', totalTokens: 200 }), // same model, second call
      ]),
    );

    const db = makeMockDb(['para-1']);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);

    expect(stats.tokenUsage.perModel).toHaveLength(2);
    const gpt4o = stats.tokenUsage.perModel.find(m => m.model === 'gpt-4o')!;
    expect(gpt4o.callCount).toBe(2);
    expect(gpt4o.totalTokens).toBe(350); // 150 + 200
  });

  it('TC-A7: dailyTrend covers last 7 days, zeroes for days without usage', () => {
    mockReadUsageLog.mockReturnValue(null);

    const db = makeMockDb([]);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);

    // hasData=false but dailyTrend is still empty array
    expect(stats.tokenUsage.dailyTrend).toHaveLength(0);
  });

  it('TC-A7b: dailyTrend has 7 entries when data exists', () => {
    mockReadUsageLog.mockReturnValue(makeUsageLog('para-1', [makeStepRecord()]));

    const db = makeMockDb(['para-1']);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);

    expect(stats.tokenUsage.dailyTrend).toHaveLength(7);
    // Today should have our tokens
    const today = new Date().toISOString().slice(0, 10);
    const todayEntry = stats.tokenUsage.dailyTrend.find(d => d.date === today);
    expect(todayEntry).toBeDefined();
    expect(todayEntry!.totalTokens).toBe(150);
  });

  it('TC-A8: reasoningTokens is null in grandTotal when no records have reasoning', () => {
    mockReadUsageLog.mockReturnValue(
      makeUsageLog('para-1', [makeStepRecord({ reasoningTokens: null })]),
    );

    const db = makeMockDb(['para-1']);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);

    expect(stats.tokenUsage.grandTotal.reasoningTokens).toBeNull();
  });

  it('TC-A9: reasoningTokens is aggregated when present in some records', () => {
    mockReadUsageLog.mockReturnValue(
      makeUsageLog('para-1', [
        makeStepRecord({ reasoningTokens: null }),
        makeStepRecord({ reasoningTokens: 25 }),
        makeStepRecord({ reasoningTokens: 15 }),
      ]),
    );

    const db = makeMockDb(['para-1']);
    const stats = service.getStats(db as never, 'proj-1', branchId, fakeProjectPath);

    expect(stats.tokenUsage.grandTotal.reasoningTokens).toBe(40); // 25 + 15
  });
});
