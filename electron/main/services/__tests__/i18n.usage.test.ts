/**
 * i18n.usage.test.ts
 *
 * TC-U29: zh-TW i18n — all token usage UI strings present and non-empty.
 *
 * Asserts that the ACTUAL implemented key names exist in src/i18n/zh-TW.ts
 * and that none are empty strings. The implementation uses two namespaces:
 *   - promptViewer.*  — per-step breakdown in the Prompt Viewer modal
 *   - tokenUsage.*   — StoryStats dashboard section
 *
 * Note: Hera's PRD-alignment check found the test-plan assumed key names
 * (colStep, colModel, etc.) differ from the implementation (usageStep, usagePrompt, etc.).
 * This test asserts the ACTUAL key names that exist in the codebase.
 */

import { describe, it, expect } from 'vitest';

// Import zh-TW directly (TypeScript source)
// Vitest handles .ts imports from src/ via its vite config
// We use a relative path from the test file location
import { zhTW } from '../../../../src/i18n/zh-TW.js';

describe('TC-U29: zh-TW i18n — all 9 step labels present in promptViewer namespace', () => {
  it('has all 9 PipelineStep labels as non-empty strings', () => {
    const pv = zhTW.promptViewer;
    const stepKeys = [
      'stepDirectorDirective',
      'stepWorldMemoryQuery',
      'stepStoryGeneration',
      'stepNarrationEdit',
      'stepDialogueEdit',
      'stepWorldMemoryUpdate',
      'stepSuggestions',
      'stepRoadmapReconcile',
      'stepCompaction',
    ] as const;

    for (const key of stepKeys) {
      expect(pv, `promptViewer.${key} must exist`).toHaveProperty(key);
      expect(pv[key], `promptViewer.${key} must be non-empty`).toBeTruthy();
      expect(typeof pv[key]).toBe('string');
    }
  });

  it('has all usage tab column/section keys as non-empty strings', () => {
    const pv = zhTW.promptViewer;
    const columnKeys = [
      'usageTab',
      'usageEmpty',
      'usageStep',
      'usagePrompt',
      'usageCompletion',
      'usageReasoning',
      'usageTotal',
      'usageLatency',
      'usageRollup',
      'usageCallCount',
    ] as const;

    for (const key of columnKeys) {
      expect(pv, `promptViewer.${key} must exist`).toHaveProperty(key);
      expect(pv[key], `promptViewer.${key} must be non-empty`).toBeTruthy();
      expect(typeof pv[key]).toBe('string');
    }
  });
});

describe('TC-U29: zh-TW i18n — tokenUsage dashboard keys present', () => {
  it('has all dashboard section keys as non-empty strings', () => {
    const tu = zhTW.tokenUsage;
    const dashboardKeys = [
      'title',
      'grandTotal',
      'totalTokens',
      'promptTokens',
      'completionTokens',
      'reasoningTokens',
      'callCount',
      'perStep',
      'perModel',
      'dailyTrend',
      'noData',
      'model',
      'avgTokens',
      'totalLatency',
      'avgLatency',
    ] as const;

    for (const key of dashboardKeys) {
      expect(tu, `tokenUsage.${key} must exist`).toHaveProperty(key);
      expect(tu[key], `tokenUsage.${key} must be non-empty`).toBeTruthy();
      expect(typeof tu[key]).toBe('string');
    }
  });

  it('tokenUsage.title contains "Token" (is zh-TW, not English)', () => {
    // The title should be the zh-TW label, not a raw English placeholder
    expect(zhTW.tokenUsage.title).toMatch(/Token/);
    // Should not be just an English key name
    expect(zhTW.tokenUsage.title).not.toBe('title');
  });

  it('all step labels contain Chinese characters (not English fallbacks)', () => {
    const pv = zhTW.promptViewer;
    const steps = [
      pv.stepDirectorDirective,
      pv.stepWorldMemoryQuery,
      pv.stepStoryGeneration,
      pv.stepNarrationEdit,
      pv.stepDialogueEdit,
      pv.stepWorldMemoryUpdate,
      pv.stepSuggestions,
      pv.stepRoadmapReconcile,
      pv.stepCompaction,
    ];

    for (const label of steps) {
      // Each label must contain at least one Chinese character
      expect(/[一-鿿]/.test(label), `"${label}" must contain Chinese characters`).toBe(true);
    }
  });
});

describe('TC-U29: zh-TW i18n — no empty strings in new token usage keys', () => {
  it('all tokenUsage strings are non-empty', () => {
    const tu = zhTW.tokenUsage;
    for (const [key, value] of Object.entries(tu)) {
      expect(value, `tokenUsage.${key} should not be empty`).toBeTruthy();
    }
  });

  it('all promptViewer usage strings are non-empty', () => {
    const pv = zhTW.promptViewer;
    const usageKeys = Object.keys(pv).filter(k => k.startsWith('usage') || k.startsWith('step'));
    expect(usageKeys.length).toBeGreaterThan(0);
    for (const key of usageKeys) {
      const value = (pv as Record<string, string>)[key];
      expect(value, `promptViewer.${key} should not be empty`).toBeTruthy();
    }
  });
});
