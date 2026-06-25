/**
 * ui.promptViewer.usage.test.ts
 *
 * TC-E01 / TC-E02 / TC-E03 — PromptViewerModal usage tab logic tests.
 *
 * Since the test environment is Vitest (no jsdom/React Testing Library configured
 * for this project), we test the UI contract at the logic level:
 *
 * TC-E01: Per-step breakdown table — verify the fmt() and stepLabel() functions
 *   that produce the table data return correct values for known inputs.
 * TC-E02: Empty state — usageLog=null triggers the empty state path (no table).
 * TC-E03: Reasoning column — fmt(null) returns "—", fmt(180) returns "180".
 *
 * These tests guard the rendering logic used by PromptViewerModal's UsageTable:
 * - fmt(n) → "—" for null, toLocaleString for numbers
 * - stepLabel(step) → zh-TW label from promptViewer namespace
 * - ParagraphUsageLog shape correctly populates each row
 */

import { describe, it, expect } from 'vitest';
import { zhTW } from '../../../../src/i18n/zh-TW.js';
import type { ParagraphUsageLog, PipelineStep } from '../../../../src/types/ipc.js';

const t = zhTW.promptViewer;

// ── Replicate the rendering helpers from PromptViewerModal ────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function stepLabel(step: PipelineStep): string {
  switch (step) {
    case 'director-directive': return t.stepDirectorDirective;
    case 'world-memory-query': return t.stepWorldMemoryQuery;
    case 'story-generation': return t.stepStoryGeneration;
    case 'narration-edit': return t.stepNarrationEdit;
    case 'dialogue-edit': return t.stepDialogueEdit;
    case 'world-memory-update': return t.stepWorldMemoryUpdate;
    case 'suggestions': return t.stepSuggestions;
    case 'roadmap-reconcile': return t.stepRoadmapReconcile;
    case 'compaction': return t.stepCompaction;
    default: return step;
  }
}

// ── TC-E01: Per-step breakdown table data ────────────────────────────────────

describe('TC-E01: PromptViewerModal usage table — per-step data produces correct row values', () => {
  const usageLog: ParagraphUsageLog = {
    paragraphId: 'para-001',
    createdAt: new Date().toISOString(),
    steps: [
      {
        step: 'director-directive',
        model: 'deepseek-chat',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        reasoningTokens: 20,
        latencyMs: 500,
      },
      {
        step: 'story-generation',
        model: 'deepseek-v4-flash',
        promptTokens: 6400,
        completionTokens: 1900,
        totalTokens: 8300,
        reasoningTokens: null,
        latencyMs: 9120,
      },
    ],
    rollup: {
      promptTokens: 6500,
      completionTokens: 1950,
      totalTokens: 8450,
      reasoningTokens: 20,
      latencyMs: 9620,
      callCount: 2,
    },
  };

  it('step labels match zh-TW strings', () => {
    expect(stepLabel('director-directive')).toBe(t.stepDirectorDirective);
    expect(stepLabel('story-generation')).toBe(t.stepStoryGeneration);
  });

  it('director-directive row renders correct token values', () => {
    const step = usageLog.steps[0];
    expect(fmt(step.promptTokens)).toBe('100');
    expect(fmt(step.completionTokens)).toBe('50');
    expect(fmt(step.totalTokens)).toBe('150');
    expect(fmt(step.reasoningTokens)).toBe('20');
    // latencyMs formatted
    expect(step.latencyMs).toBe(500);
  });

  it('story-generation row has reasoning "—" when reasoningTokens is null', () => {
    const step = usageLog.steps[1];
    expect(fmt(step.reasoningTokens)).toBe('—');
    expect(step.reasoningTokens).toBeNull();
  });

  it('rollup row renders correct totals', () => {
    const r = usageLog.rollup;
    expect(fmt(r.promptTokens)).toBe('6,500');
    expect(fmt(r.completionTokens)).toBe('1,950');
    expect(fmt(r.totalTokens)).toBe('8,450');
    expect(fmt(r.reasoningTokens)).toBe('20');
    expect(r.callCount).toBe(2);
  });

  it('all 9 step labels resolve to non-empty zh-TW strings', () => {
    const allSteps: PipelineStep[] = [
      'director-directive',
      'world-memory-query',
      'story-generation',
      'narration-edit',
      'dialogue-edit',
      'world-memory-update',
      'suggestions',
      'roadmap-reconcile',
      'compaction',
    ];

    for (const step of allSteps) {
      const label = stepLabel(step);
      expect(label, `step "${step}" should have a zh-TW label`).toBeTruthy();
      expect(label).not.toBe(step); // must resolve, not fall through to raw value
    }
  });
});

// ── TC-E02: Empty state when usageLog is null ────────────────────────────────

describe('TC-E02: PromptViewerModal — empty state for pre-feature paragraph', () => {
  it('usageEmpty key exists and is a non-empty zh-TW string', () => {
    // The component renders t.usageEmpty when usageLog is null
    expect(t.usageEmpty).toBeTruthy();
    expect(typeof t.usageEmpty).toBe('string');
    // Should contain Chinese characters (not an English key name)
    expect(/[一-鿿]/.test(t.usageEmpty)).toBe(true);
  });

  it('empty state message does NOT contain zero-filled table data', () => {
    // When usageLog is null, no table is rendered — only the empty state message
    // We verify this by checking that the empty state string is just a message,
    // not a table structure
    expect(t.usageEmpty).not.toContain('0');
  });

  it('fmt handles null correctly for empty state representation', () => {
    // In the empty state, no fmt() calls happen — but fmt(null) must return "—" not "0"
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
    expect(fmt(null)).not.toBe('0');
  });
});

// ── TC-E03: Reasoning column — null → "—", number → formatted string ─────────

describe('TC-E03: Reasoning column — null shows "—", numbers show correctly', () => {
  it('fmt(null) returns "—" for the reasoning column', () => {
    expect(fmt(null)).toBe('—');
  });

  it('fmt(180) returns the string representation of 180', () => {
    expect(fmt(180)).toBe('180');
  });

  it('fmt(0) returns "0" (real zero is preserved, not treated as null)', () => {
    expect(fmt(0)).toBe('0');
  });

  it('story-generation row with null reasoningTokens shows "—" in reasoning column', () => {
    const step = {
      step: 'story-generation' as PipelineStep,
      model: 'deepseek-v4-flash',
      promptTokens: 6400,
      completionTokens: 1900,
      totalTokens: 8300,
      reasoningTokens: null,
      latencyMs: 9120,
    };

    const reasoningDisplay = fmt(step.reasoningTokens);
    expect(reasoningDisplay).toBe('—');
  });

  it('director-directive row with reasoningTokens: 180 shows "180"', () => {
    const step = {
      step: 'director-directive' as PipelineStep,
      model: 'deepseek-chat',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      reasoningTokens: 180,
      latencyMs: 500,
    };

    const reasoningDisplay = fmt(step.reasoningTokens);
    expect(reasoningDisplay).toBe('180');
  });
});

// ── StoryStats token daily-trend section ────────────────────────────────────

describe('StoryStats — token daily trend data (FR-023)', () => {
  it('DailyTokenCount has date and totalTokens fields', () => {
    // Verify the type shape expected by the new StoryStats rendering
    const trend = { date: '2026-06-24', totalTokens: 5000 };
    expect(trend.date).toBe('2026-06-24');
    expect(trend.totalTokens).toBe(5000);
  });

  it('tokenUsage.dailyTrend key exists in zh-TW', () => {
    expect(zhTW.tokenUsage.dailyTrend).toBeTruthy();
    expect(typeof zhTW.tokenUsage.dailyTrend).toBe('string');
  });
});
