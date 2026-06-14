/**
 * Unit tests for DialogueEditorService
 * Covers TC-U-001 through TC-U-060 from the test plan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  containsDialogue,
  selectRoster,
  getDialogueEditorSettings,
  refineDialogue,
  buildSinglePassSystemPrompt,
  buildCritiqueSystemPrompt,
  buildRewriteSystemPrompt,
  RUBRIC,
  BAN_LIST,
  REWRITE_RULES,
} from '../electron/main/services/DialogueEditorService.js';
import type { CharacterForRoster } from '../electron/main/services/DialogueEditorService.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeChar(overrides: Partial<CharacterForRoster> = {}): CharacterForRoster {
  return {
    id: 'char-1',
    name: 'Alice',
    aliases: [],
    voiceStyle: 'Speaks formally, uses long sentences.',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAiService(returnValue: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: returnValue } }],
  });
  return {
    getClient: () => ({
      chat: { completions: { create } },
    }),
    _create: create,
  } as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService> & { _create: typeof create };
}

const SDK_PROVIDER = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o',
  authMethod: 'api_key' as const,
};

// ── TC-U-001: Western straight double quotes ───────────────────────────────

describe('containsDialogue', () => {
  it('TC-U-001: detects Western straight double quotes', () => {
    expect(containsDialogue('She said "hello" and left.')).toBe(true);
    expect(containsDialogue('No quotes here.')).toBe(false);
  });

  // TC-U-002
  it('TC-U-002: detects Western curly double quotes (open/close)', () => {
    expect(containsDialogue('“Hello,” she said.')).toBe(true);
  });

  // TC-U-003
  it('TC-U-003: detects CJK 「」 quotes', () => {
    expect(containsDialogue('彼女は「こんにちは」と言った。')).toBe(true);
    expect(containsDialogue('彼女は『こんにちは』と言った。')).toBe(true);
  });

  // TC-U-004
  it('TC-U-004: detects CJK 『』 (book-title / inner quote) style', () => {
    expect(containsDialogue('She noted 『異世界』 as a genre.')).toBe(true);
  });

  // TC-U-005: MIXED CJK and Western in one paragraph
  it('TC-U-005: detects MIXED CJK and Western quotes in one paragraph (independent branches)', () => {
    expect(containsDialogue('He said "hello" then 「bye」 left.')).toBe(true);
    expect(containsDialogue('“Good morning,” she said, then 「また明日」 and departed.')).toBe(true);
  });

  // TC-U-006: lone apostrophe contraction (false-positive guard)
  it('TC-U-006: lone apostrophe contraction does NOT trigger (false-positive guard)', () => {
    expect(containsDialogue("She didn't know what he'd said.")).toBe(false);
  });

  // TC-U-007: KNOWN SKIP — open one style, close another
  it('TC-U-007: KNOWN SKIP — single span opening straight " and closing curly " returns false', () => {
    // straight " open, curly " close
    expect(containsDialogue('He said "hello” and left.')).toBe(false);
  });

  // TC-U-008: empty string
  it('TC-U-008: empty string returns false', () => {
    expect(containsDialogue('')).toBe(false);
    expect(containsDialogue('   ')).toBe(false);
  });

  // TC-U-009: pure narration
  it('TC-U-009: pure narration paragraph returns false', () => {
    expect(containsDialogue('The sun set slowly over the mountains. Shadows lengthened across the valley floor.')).toBe(false);
  });

  // TC-U-030: Western curly single quotes
  it('TC-U-030: detects Western curly single quotes ‘…’', () => {
    expect(containsDialogue('‘Hello,’ he whispered.')).toBe(true);
  });

  // TC-U-031: multi-line paragraph with multiple dialogue spans
  it('TC-U-031: multi-line paragraph with multiple dialogue spans', () => {
    expect(containsDialogue('"First line."\nSome narration.\n"Second line."')).toBe(true);
  });

  // TC-U-032: very long pure-narration paragraph
  it('TC-U-032: very long pure-narration paragraph returns false quickly', () => {
    const longNarration = 'The protagonist walked through the forest. '.repeat(50);
    const start = performance.now();
    const result = containsDialogue(longNarration);
    const elapsed = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(10);
  });
});

// ── TC-U-010 through TC-U-014: selectRoster ───────────────────────────────

describe('selectRoster', () => {
  // TC-U-010: all ≤ 8 returned as-is
  it('TC-U-010: returns all characters when count ≤ 8', () => {
    const chars = Array.from({ length: 8 }, (_, i) =>
      makeChar({ id: `char-${i}`, name: `Char${i}`, voiceStyle: `Voice ${i}` }),
    );
    const result = selectRoster(chars, 'Any text.');
    expect(result).toHaveLength(8);
  });

  // TC-U-011: cap at top-8 when > 8
  it('TC-U-011: caps at 8 when > 8, present chars first then recency', () => {
    const storyText = 'Alice Bob Carol Dave were there.';
    const now = Date.now();
    const chars: CharacterForRoster[] = [
      makeChar({ id: 'A', name: 'Alice', updatedAt: new Date(now - 1000).toISOString() }),
      makeChar({ id: 'B', name: 'Bob', updatedAt: new Date(now - 2000).toISOString() }),
      makeChar({ id: 'C', name: 'Carol', updatedAt: new Date(now - 3000).toISOString() }),
      makeChar({ id: 'D', name: 'Dave', updatedAt: new Date(now - 4000).toISOString() }),
      // Not present — E is most recent absent
      makeChar({ id: 'E', name: 'Eve', updatedAt: new Date(now - 100).toISOString() }),
      makeChar({ id: 'F', name: 'Frank', updatedAt: new Date(now - 200).toISOString() }),
      makeChar({ id: 'G', name: 'Grace', updatedAt: new Date(now - 300).toISOString() }),
      makeChar({ id: 'H', name: 'Hank', updatedAt: new Date(now - 400).toISOString() }),
      makeChar({ id: 'I', name: 'Iris', updatedAt: new Date(now - 500).toISOString() }),
      makeChar({ id: 'J', name: 'Jack', updatedAt: new Date(now - 600).toISOString() }),
      makeChar({ id: 'K', name: 'Kate', updatedAt: new Date(now - 700).toISOString() }),
      makeChar({ id: 'L', name: 'Leo', updatedAt: new Date(now - 800).toISOString() }),
    ];
    const result = selectRoster(chars, storyText);
    expect(result).toHaveLength(8);
    // Present chars A, B, C, D must be in the result
    const names = result.map(c => c.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
    expect(names).toContain('Carol');
    expect(names).toContain('Dave');
    // Top 4 absent by recency: E, F, G, H
    expect(names).toContain('Eve');
    expect(names).toContain('Frank');
    expect(names).toContain('Grace');
    expect(names).toContain('Hank');
  });

  // TC-U-012: all voiceStyle blank → roster section omitted
  it('TC-U-012: all voiceStyle blank → roster section omitted from prompt', () => {
    const chars = [
      makeChar({ id: 'a', name: 'Alice', voiceStyle: '' }),
      makeChar({ id: 'b', name: 'Bob', voiceStyle: '' }),
      makeChar({ id: 'c', name: 'Carol', voiceStyle: '' }),
    ];
    const roster = selectRoster(chars, 'text');
    const prompt = buildSinglePassSystemPrompt(roster);
    expect(prompt).not.toContain('角色聲音設定（依對話');
  });

  // TC-U-013: mixed voiceStyle — blank char listed by name only
  it('TC-U-013: character with empty voiceStyle listed by name only', () => {
    const chars = [
      makeChar({ id: 'a', name: 'Alice', voiceStyle: 'Formal speech.' }),
      makeChar({ id: 'b', name: 'Bob', voiceStyle: '' }),
      makeChar({ id: 'c', name: 'Carol', voiceStyle: 'Casual and warm.' }),
    ];
    const roster = selectRoster(chars, 'text');
    const prompt = buildSinglePassSystemPrompt(roster);
    expect(prompt).toContain('Alice');
    expect(prompt).toContain('Bob');
    expect(prompt).toContain('無聲音設定，僅依通用標準');
    expect(prompt).toContain('Carol');
  });

  // TC-U-014: empty character list → no roster section
  it('TC-U-014: empty character list produces no roster section', () => {
    const roster = selectRoster([], 'He said "hello."');
    const prompt = buildSinglePassSystemPrompt(roster);
    expect(prompt).not.toContain('角色聲音設定（依對話');
    // Still has rubric and ban list
    expect(prompt).toContain('聲音辨識度');
    expect(prompt).toContain('禁止清單');
  });
});

// ── TC-U-020: Single-pass prompt content ──────────────────────────────────

describe('Prompt builders', () => {
  it('TC-U-020: single-pass system prompt contains rubric, ban list, and rewrite rules', async () => {
    const chars = [makeChar()];
    const roster = selectRoster(chars, 'text');
    const prompt = buildSinglePassSystemPrompt(roster);

    // Rubric dimensions
    expect(prompt).toContain('聲音辨識度');
    expect(prompt).toContain('潛台詞深度');
    expect(prompt).toContain('避免直白');
    expect(prompt).toContain('權力動態');

    // Ban list items
    expect(prompt).toContain('破折號濫用');
    expect(prompt).toContain('他點點頭');
    expect(prompt).toContain('治療式語言');
    expect(prompt).toContain('資訊傾倒');
    expect(prompt).toContain('對話中途反覆呼喚');
    expect(prompt).toContain('角色直接陳述自己的動機');

    // Rewrite rules
    expect(prompt).toContain('逐字保留');
    // Both CJK and Western quote styles mentioned
    expect(prompt).toContain('「」');
    expect(prompt).toContain('"');
  });

  it('TC-U-021: two-pass critique prompt contains rubric and ban list; rewrite prompt has rewrite rules', () => {
    const chars = [makeChar()];
    const roster = selectRoster(chars, 'text');

    const critiquePrompt = buildCritiqueSystemPrompt(roster);
    // Rubric
    expect(critiquePrompt).toContain('聲音辨識度');
    // Ban list
    expect(critiquePrompt).toContain('破折號濫用');
    // Plain-text diagnosis, explicitly NOT JSON
    expect(critiquePrompt).toContain('純文字');
    expect(critiquePrompt).toContain('不要輸出 JSON');
    // No rewrite rules
    expect(critiquePrompt).not.toContain('逐字保留');

    const rewritePrompt = buildRewriteSystemPrompt(roster, 'some critique');
    // Has rewrite rules
    expect(rewritePrompt).toContain('逐字保留');
    // Includes the critique feedback when provided
    expect(rewritePrompt).toContain('some critique');
  });

  it('TC-U-022: refineDialogue returns the mocked refined string (golden-ish)', async () => {
    const storyText = 'She crossed the room. "I feel betrayed," she said. He nodded slowly.';
    const refined = 'She crossed the room. "You\'ve made your choice," she said. He nodded slowly.';
    const svc = makeAiService(refined);

    const result = await refineDialogue({
      aiService: svc as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService>,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText,
      characters: [],
      mode: 'single',
    });

    expect(result).toBe(refined);
    // The user message sent was the original storyText
    const [{ messages }] = svc._create.mock.calls[0] as [{ messages: Array<{ role: string; content: string }> }];
    const userMsg = messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg?.content).toBe(storyText);
  });
});

// ── TC-U-040 through TC-U-042: getDialogueEditorSettings ──────────────────

describe('getDialogueEditorSettings', () => {
  it('TC-U-040: returns defaults { enabled: true, mode: "single" } when keys absent', () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined) }),
    };
    const result = getDialogueEditorSettings('project-123', () => mockDb as unknown as ReturnType<typeof import('../electron/ipc/projectHandlers.js').getOpenProject>);
    expect(result).toEqual({ enabled: true, mode: 'single' });
  });

  it('TC-U-041: reads persisted disabled state', () => {
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        get: vi.fn().mockReturnValue(
          sql.includes('dialogue_editor_enabled')
            ? { value: 'false' }
            : { value: '"two-pass"' },
        ),
      })),
    };
    const result = getDialogueEditorSettings('project-123', () => mockDb as unknown as ReturnType<typeof import('../electron/ipc/projectHandlers.js').getOpenProject>);
    expect(result).toEqual({ enabled: false, mode: 'two-pass' });
  });

  it('TC-U-042: reads two-pass mode', () => {
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        get: vi.fn().mockReturnValue(
          sql.includes('dialogue_editor_enabled')
            ? { value: 'true' }
            : { value: '"two-pass"' },
        ),
      })),
    };
    const result = getDialogueEditorSettings('project-123', () => mockDb as unknown as ReturnType<typeof import('../electron/ipc/projectHandlers.js').getOpenProject>);
    expect(result).toEqual({ enabled: true, mode: 'two-pass' });
  });
});

// ── TC-U-050 through TC-U-060: refineDialogue ─────────────────────────────

describe('refineDialogue', () => {
  it('TC-U-050: returns null when storyText has no dialogue (no LLM call)', async () => {
    const svc = makeAiService('Some refined text.');
    const result = await refineDialogue({
      aiService: svc as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService>,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: 'Pure narration only. No quotes.',
      characters: [],
      mode: 'single',
    });
    expect(result).toBeNull();
    expect(svc._create).not.toHaveBeenCalled();
  });

  it('TC-U-051: returns null on empty LLM response', async () => {
    const svc = makeAiService('');
    const result = await refineDialogue({
      aiService: svc as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService>,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: '"Hello."',
      characters: [],
      mode: 'single',
    });
    expect(result).toBeNull();
  });

  it('TC-U-052: returns null on whitespace-only LLM response', async () => {
    const svc = makeAiService('   \n  ');
    const result = await refineDialogue({
      aiService: svc as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService>,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: '"Hello."',
      characters: [],
      mode: 'single',
    });
    expect(result).toBeNull();
  });

  it('TC-U-053: returns null when getClient() returns null (SDK path)', async () => {
    const nullClientSvc = {
      getClient: () => null,
    } as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService>;

    const result = await refineDialogue({
      aiService: nullClientSvc,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: '"Hello."',
      characters: [],
      mode: 'single',
    });
    expect(result).toBeNull();
  });

  it('TC-U-054: two-pass plain-text critique is fed into the rewrite prompt', async () => {
    const rawCritique = 'The dialogue is too on-the-nose. Fix line 2.';
    const rewriteResult = 'Refined paragraph text here.';
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: rawCritique } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: rewriteResult } }] });
    const svc = {
      getClient: () => ({ chat: { completions: { create } } }),
      _create: create,
    } as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService> & { _create: typeof create };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await refineDialogue({
      aiService: svc as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService>,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: '"Hello."',
      characters: [],
      mode: 'two-pass',
    });
    warnSpy.mockRestore();

    expect(result).toBe(rewriteResult);
    expect(create).toHaveBeenCalledTimes(2);
    // Second call's system prompt should include the raw critique text
    const [secondCallOpts] = create.mock.calls[1] as [{ messages: Array<{ role: string; content: string }> }];
    const systemMsg = secondCallOpts.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg?.content).toContain(rawCritique);
  });

  it('TC-U-055: two-pass with an EMPTY critique still produces the rewrite (graceful, the gpt-5.5 rawLen=0 case)', async () => {
    // Reproduces the real bug: the critique call returns an empty string.
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '' } }] })          // empty critique
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Refined line.' } }] }); // rewrite still runs
    const svc = {
      getClient: () => ({ chat: { completions: { create } } }),
    } as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService>;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await refineDialogue({
      aiService: svc,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: '"Hello."',
      characters: [],
      mode: 'two-pass',
    });

    const warnedEmpty = warnSpy.mock.calls.some(c => String(c[0]).includes('critique returned empty'));
    warnSpy.mockRestore();

    expect(result).toBe('Refined line.');     // rewrite output used despite empty critique
    expect(create).toHaveBeenCalledTimes(2);   // both calls made
    expect(warnedEmpty).toBe(true);            // empty critique logged clearly (not a "parse failed" error)
  });

  it('TC-U-060: signal.aborted returns null before LLM call (explicit cancel)', async () => {
    const svc = makeAiService('Refined.');
    const ac = new AbortController();
    ac.abort();
    const result = await refineDialogue({
      aiService: svc as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService>,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: '"Hello."',
      characters: [],
      mode: 'single',
      signal: ac.signal,
    });
    expect(result).toBeNull();
    expect(svc._create).not.toHaveBeenCalled();
  });

});
