/**
 * ContextManager.assemblePrompt — directorDirective channel tests
 *
 * The "regenerate with an extra prompt" feature rides the directorDirective slot:
 * the per-rewrite author instruction (額外指示 → req.directorNote) is wrapped into a
 * directive and passed to assemblePrompt as `directorDirective`. These tests pin the
 * contract that feature depends on:
 *   TC-1: directorDirective → a system message carrying the directive text exists
 *   TC-2: it sits after story history and immediately before the user-input turn (recency)
 *   TC-3: empty/omitted directorDirective → no directive message is injected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pin the context window so budget math never truncates our tiny fixtures.
vi.mock('../AIProviderService.js', () => ({
  getContextWindowSize: () => 128_000,
}));

import { ContextManager } from '../ContextManager.js';
import type { AssembleOptions } from '../ContextManager.js';

const baseOptions = (): AssembleOptions => ({
  model: 'test-model',
  systemPrompt: '',
  customInstructions: '',
  worldRules: '',
  writingStyleHints: '',
  worldDirectory: '',
  worldMemorySummary: '',
  storyHistory: [
    { paragraphId: 'p1', type: 'ai', content: '前一段故事內容。' },
  ],
  userInput: '繼續這一段。',
});

describe('ContextManager.assemblePrompt — directorDirective', () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager();
  });

  it('TC-1: injects a system message carrying the directive text', () => {
    const note = '加強緊張感，改成第一人稱';
    const { messages } = cm.assemblePrompt({ ...baseOptions(), directorDirective: note });

    const directiveMsg = messages.find(
      m => m.role === 'system' && typeof m.content === 'string' && m.content.includes(note),
    );
    expect(directiveMsg).toBeDefined();
    expect(directiveMsg!.content).toContain('導演指示');
  });

  it('TC-2: directive sits after story history and immediately before the user turn', () => {
    const note = '縮短對話';
    const { messages } = cm.assemblePrompt({ ...baseOptions(), directorDirective: note });

    const directiveIdx = messages.findIndex(
      m => typeof m.content === 'string' && m.content.includes(note),
    );
    const historyIdx = messages.findIndex(
      m => typeof m.content === 'string' && m.content.includes('前一段故事內容。'),
    );
    const userIdx = messages.findIndex(m => m.role === 'user');

    expect(directiveIdx).toBeGreaterThan(historyIdx); // after history
    expect(directiveIdx).toBe(userIdx - 1);            // freshest before the user turn
  });

  it('TC-3: omitted/empty directorDirective injects no directive message', () => {
    const withEmpty = cm.assemblePrompt({ ...baseOptions(), directorDirective: '' });
    const without = cm.assemblePrompt({ ...baseOptions() });

    for (const { messages } of [withEmpty, without]) {
      const hasDirective = messages.some(
        m => typeof m.content === 'string' && m.content.includes('導演指示'),
      );
      expect(hasDirective).toBe(false);
    }
  });
});
