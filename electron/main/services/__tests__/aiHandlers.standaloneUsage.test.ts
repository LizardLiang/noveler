/**
 * aiHandlers.standaloneUsage.test.ts
 *
 * Integration tests for standalone IPC handler usage capture.
 * Tests the key invariants:
 *   - Standalone handlers (AI_SUGGESTIONS, AI_COMPACT, DIRECTOR_REPLAN) each
 *     create their own UsageCollector, drain to appendUsageEvents, and never
 *     call writeUsageLog for a paragraph.
 *   - The correct step tags are used per handler.
 *   - Best-effort swallow: appendUsageEvents throws → handler still succeeds.
 *
 * TC-I05: AI_SUGGESTIONS — appendUsageEvents called with suggestions step,
 *         writeUsageLog NOT called.
 * TC-I06: AI_SUGGESTIONS retry — 2 suggestion records from 2 proposeDirections calls.
 * TC-I07: AI_COMPACT — compaction step, tipParagraphId = null.
 * TC-I08: DIRECTOR_REPLAN — roadmap-reconcile and/or director-directive steps.
 * TC-I15: appendUsageEvents throws → standalone handler error swallowed.
 *
 * Strategy: We exercise the persistUsageEvents helper (extracted from
 * aiHandlers.ts logic) and UsageCollector directly, then assert FileStorageService
 * state. This avoids the need to mock Electron IPC.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UsageCollector } from '../UsageCollector.js';
import { FileStorageService } from '../FileStorageService.js';
import type { PipelineStep, StepUsageRecord, StandaloneUsageEvent } from '../../../shared/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'noveler-standalone-test-'));
}

function makeRec(overrides: Partial<StepUsageRecord> = {}): Omit<StepUsageRecord, 'step'> {
  return {
    model: 'test-model',
    promptTokens: 80,
    completionTokens: 20,
    totalTokens: 100,
    reasoningTokens: null,
    latencyMs: 150,
    ...overrides,
  };
}

/**
 * Replicates the persistUsageEvents fire-and-forget from aiHandlers.ts.
 * Each standalone handler creates a collector, drains it, and appends to
 * the branch-level usage-events.json.
 */
function persistUsageEvents(
  storage: FileStorageService,
  projectPath: string,
  branchId: string,
  collector: UsageCollector,
  step: PipelineStep,
  tipParagraphId: string | null,
  onError?: (e: Error) => void,
): void {
  if (collector.size === 0) return;
  try {
    const recs = collector.drain();
    const now = new Date().toISOString();
    const events: StandaloneUsageEvent[] = recs.map(rec => ({
      createdAt: now,
      tipParagraphId,
      record: { ...rec, step },
    }));
    void (async () => {
      try {
        storage.appendUsageEvents(projectPath, branchId, events);
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  } catch (e) {
    // best-effort
  }
}

// ── TC-I05: AI_SUGGESTIONS — appendUsageEvents, NOT writeUsageLog ────────────

describe('standaloneUsage — TC-I05: AI_SUGGESTIONS collector scope', () => {
  let tmpDir: string;
  let storage: FileStorageService;
  const branchId = 'main';
  const tipId = 'para-tip-001';

  beforeEach(() => {
    tmpDir = makeTempDir();
    storage = new FileStorageService();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('appendUsageEvents called with suggestions step and tipParagraphId', async () => {
    const suggestCollector = new UsageCollector();
    suggestCollector.add('suggestions', makeRec({ model: 'director-model' }));

    const writeSpy = vi.spyOn(storage, 'writeUsageLog');
    persistUsageEvents(storage, tmpDir, branchId, suggestCollector, 'suggestions', tipId);
    await new Promise(r => setTimeout(r, 50));

    // writeUsageLog must NOT be called (standalone handler must not touch paragraph usage.json)
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();

    // appendUsageEvents was called — verify the stored events
    const events = storage.readUsageEvents(tmpDir, branchId);
    expect(events.events).toHaveLength(1);
    expect(events.events[0].record.step).toBe('suggestions');
    expect(events.events[0].tipParagraphId).toBe(tipId);
  });

  it('event record has all expected fields', async () => {
    const suggestCollector = new UsageCollector();
    suggestCollector.add('suggestions', {
      model: 'deepseek-chat',
      promptTokens: 500,
      completionTokens: 100,
      totalTokens: 600,
      reasoningTokens: null,
      latencyMs: 800,
    });

    persistUsageEvents(storage, tmpDir, branchId, suggestCollector, 'suggestions', tipId);
    await new Promise(r => setTimeout(r, 50));

    const { events } = storage.readUsageEvents(tmpDir, branchId);
    expect(events[0].record.model).toBe('deepseek-chat');
    expect(events[0].record.promptTokens).toBe(500);
    expect(events[0].record.step).toBe('suggestions');
    expect(events[0].tipParagraphId).toBe(tipId);
  });
});

// ── TC-I06: AI_SUGGESTIONS retry — 2 suggestion records ─────────────────────

describe('standaloneUsage — TC-I06: AI_SUGGESTIONS retry → 2 suggestion records', () => {
  it('two proposeDirections calls produce two suggestion records in appendUsageEvents', async () => {
    const tmpDir = makeTempDir();
    const storage = new FileStorageService();

    // Simulate a retry: two calls to proposeDirections, each adding a record
    const suggestCollector = new UsageCollector();
    // First attempt
    suggestCollector.add('suggestions', makeRec({ model: 'director-model', latencyMs: 900 }));
    // Retry attempt
    suggestCollector.add('suggestions', makeRec({ model: 'director-model', latencyMs: 850 }));

    expect(suggestCollector.size).toBe(2);
    persistUsageEvents(storage, tmpDir, 'main', suggestCollector, 'suggestions', 'para-tip');
    await new Promise(r => setTimeout(r, 50));

    const { events } = storage.readUsageEvents(tmpDir, 'main');
    expect(events).toHaveLength(2);
    expect(events[0].record.step).toBe('suggestions');
    expect(events[1].record.step).toBe('suggestions');

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// ── TC-I07: AI_COMPACT — compaction step, tipParagraphId = null ───────────────

describe('standaloneUsage — TC-I07: AI_COMPACT compaction step with null tipParagraphId', () => {
  it('compaction event has step=compaction and tipParagraphId=null', async () => {
    const tmpDir = makeTempDir();
    const storage = new FileStorageService();

    const compactCollector = new UsageCollector();
    compactCollector.add('compaction', makeRec({ model: 'compact-model', latencyMs: 1200 }));

    // Compaction has no owning paragraph — tipParagraphId is null
    persistUsageEvents(storage, tmpDir, 'main', compactCollector, 'compaction', null);
    await new Promise(r => setTimeout(r, 50));

    const { events } = storage.readUsageEvents(tmpDir, 'main');
    expect(events).toHaveLength(1);
    expect(events[0].record.step).toBe('compaction');
    expect(events[0].tipParagraphId).toBeNull();

    // writeUsageLog not called (no paragraph)
    const wuLog = storage.readUsageLog(tmpDir, 'main', 'any-para');
    expect(wuLog).toBeNull();

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// ── TC-I08: DIRECTOR_REPLAN — roadmap-reconcile + director-directive steps ───

describe('standaloneUsage — TC-I08: DIRECTOR_REPLAN produces roadmap-reconcile and director-directive events', () => {
  it('replan collector contains roadmap-reconcile and director-directive events', async () => {
    const tmpDir = makeTempDir();
    const storage = new FileStorageService();
    const tipId = 'para-last';

    // DIRECTOR_REPLAN calls planAndDirect which fires onUsage for both
    // roadmap-reconcile (reconcileRoadmap) and director-directive (buildDirective)
    const replanCollector = new UsageCollector();
    // roadmap-reconcile step (from reconcileRoadmap)
    replanCollector.add('roadmap-reconcile', makeRec({ model: 'dir-model', latencyMs: 600 }));
    // director-directive step (from buildDirective)
    replanCollector.add('director-directive', makeRec({ model: 'dir-model', latencyMs: 400 }));

    // DIRECTOR_REPLAN drains with the record's own step tag (not a fixed outer step)
    // The actual aiHandlers code uses: recs.map(rec => ({ ..., record: rec }))
    // so the step comes from each record's step field.
    const recs = replanCollector.drain();
    const now = new Date().toISOString();
    const events: StandaloneUsageEvent[] = recs.map(rec => ({
      createdAt: now,
      tipParagraphId: tipId,
      record: rec,
    }));

    storage.appendUsageEvents(tmpDir, 'main', events);

    const written = storage.readUsageEvents(tmpDir, 'main');
    expect(written.events).toHaveLength(2);

    const stepNames = written.events.map(e => e.record.step);
    expect(stepNames).toContain('roadmap-reconcile');
    expect(stepNames).toContain('director-directive');

    // writeUsageLog not called
    const wuLog = storage.readUsageLog(tmpDir, 'main', 'any-para');
    expect(wuLog).toBeNull();

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// ── TC-I15: appendUsageEvents throws → handler still succeeds ──────────────

describe('standaloneUsage — TC-I15: appendUsageEvents throws swallowed', () => {
  it('appendUsageEvents failure does not propagate to caller', async () => {
    const storage = new FileStorageService();
    const appendError = new Error('ENOENT: disk full');
    const errors: Error[] = [];

    vi.spyOn(storage, 'appendUsageEvents').mockImplementation(() => { throw appendError; });

    const suggestCollector = new UsageCollector();
    suggestCollector.add('suggestions', makeRec());

    // Should not throw
    expect(() => {
      persistUsageEvents(storage, '/fake', 'main', suggestCollector, 'suggestions', 'tip-para',
        (e) => errors.push(e));
    }).not.toThrow();

    await new Promise(r => setTimeout(r, 50));

    // Error was swallowed — handler continues successfully
    // The error callback was invoked (observable), but no exception escaped
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('disk full');

    vi.restoreAllMocks();
  });
});

// ── Empty collector — persistUsageEvents skips append ────────────────────────

describe('standaloneUsage — empty collector: persistUsageEvents skips append', () => {
  it('does not call appendUsageEvents when collector is empty', async () => {
    const storage = new FileStorageService();
    const appendSpy = vi.spyOn(storage, 'appendUsageEvents');

    const emptyCollector = new UsageCollector();
    persistUsageEvents(storage, '/fake', 'main', emptyCollector, 'suggestions', null);
    await new Promise(r => setTimeout(r, 50));

    expect(appendSpy).not.toHaveBeenCalled();
    appendSpy.mockRestore();
  });
});
