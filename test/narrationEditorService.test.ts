/**
 * Unit tests for NarrationEditorService — the narration (non-dialogue) refine pass.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  containsNarration,
  getNarrationEditorSettings,
  refineNarration,
  buildSinglePassSystemPrompt,
  buildCritiqueSystemPrompt,
  buildRewriteSystemPrompt,
  extractQuotes,
  stripQuotes,
} from '../electron/main/services/NarrationEditorService.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAiService(returnValue: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: returnValue } }],
  });
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    _create: create,
  } as unknown as ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService> & { _create: typeof create };
}

const SDK_PROVIDER = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o',
  authMethod: 'api_key' as const,
};

type AiSvc = ReturnType<typeof import('../electron/main/services/AIProviderService.js').getAIProviderService>;

// A narration-heavy paragraph (substantial prose outside quotes).
const NARRATION_INPUT = '夜色壓在山脊上，風從谷底捲起，吹得火把忽明忽滅。他握緊了手中的劍，遲遲沒有動作。';

// ── containsNarration ────────────────────────────────────────────────────────

describe('containsNarration', () => {
  it('returns true for substantial prose outside quotes', () => {
    expect(containsNarration(NARRATION_INPUT)).toBe(true);
  });

  it('returns false for a near-pure-dialogue paragraph', () => {
    expect(containsNarration('「你來了。」「嗯。」')).toBe(false);
  });

  it('returns false when narration outside quotes is below the threshold', () => {
    expect(containsNarration('他說「我們明天就出發，沿著河谷一路向北直到城門口集合」。')).toBe(false);
  });

  it('returns false for empty / whitespace', () => {
    expect(containsNarration('')).toBe(false);
    expect(containsNarration('    ')).toBe(false);
  });
});

// ── quote helpers ──────────────────────────────────────────────────────────

describe('extractQuotes / stripQuotes', () => {
  it('extracts CJK and Western quoted spans in order', () => {
    const t = '他說「走吧」，她回答 "no" 然後離開。';
    expect(extractQuotes(t)).toEqual(['「走吧」', '"no"']);
  });

  it('stripQuotes removes all quoted spans', () => {
    expect(stripQuotes('他說「走吧」然後走了。')).toBe('他說然後走了。');
  });
});

// ── prompt builders ──────────────────────────────────────────────────────────

describe('Prompt builders', () => {
  it('single-pass prompt contains the naturalness floor, rubric, ban list, and rewrite rules', () => {
    const p = buildSinglePassSystemPrompt();
    expect(p).toContain('不硬打');                 // telegraphic-fragment example
    expect(p).toContain('節奏變化');               // rubric: rhythm variety
    expect(p).toContain('彷彿');                   // ban list: clichéd imagery
    expect(p).toContain('逐字保留');               // rewrite rule: preserve dialogue
    expect(p).toContain('引號外');                 // narration-only scope
  });

  it('critique prompt diagnoses only (plain text, no JSON, no rewrite rules)', () => {
    const p = buildCritiqueSystemPrompt();
    expect(p).toContain('純文字');
    expect(p).toContain('不要輸出 JSON');
    expect(p).not.toContain('逐字保留');
  });

  it('rewrite prompt includes the critique feedback when provided', () => {
    const p = buildRewriteSystemPrompt('某些診斷意見');
    expect(p).toContain('某些診斷意見');
    expect(p).toContain('逐字保留');
  });
});

// ── getNarrationEditorSettings ───────────────────────────────────────────────

describe('getNarrationEditorSettings', () => {
  it('returns defaults { enabled: true, mode: "two-pass" } when keys absent', () => {
    const mockDb = { prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined) }) };
    const result = getNarrationEditorSettings('p1', () => mockDb as never);
    expect(result).toEqual({ enabled: true, mode: 'two-pass' });
  });

  it('reads persisted disabled + single state', () => {
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        get: vi.fn().mockReturnValue(
          sql.includes('narration_editor_enabled') ? { value: 'false' } : { value: '"single"' },
        ),
      })),
    };
    const result = getNarrationEditorSettings('p1', () => mockDb as never);
    expect(result).toEqual({ enabled: false, mode: 'single' });
  });
});

// ── refineNarration ──────────────────────────────────────────────────────────

describe('refineNarration', () => {
  it('returns null when there is no substantial narration (no LLM call)', async () => {
    const svc = makeAiService('whatever');
    const result = await refineNarration({
      aiService: svc as unknown as AiSvc,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: '「你來了。」「嗯。」',
      mode: 'single',
    });
    expect(result).toBeNull();
    expect(svc._create).not.toHaveBeenCalled();
  });

  it('returns the refined string when quotes are preserved', async () => {
    const refined = '夜色沉沉地壓在嶙峋的山脊上，谷底的風一路捲上來，把火把吹得明一下暗一下。他把劍握得發白，卻遲遲沒有出手。';
    const svc = makeAiService(refined);
    const result = await refineNarration({
      aiService: svc as unknown as AiSvc,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: NARRATION_INPUT,
      mode: 'single',
    });
    expect(result).toBe(refined);
  });

  it('quote-integrity guard: rejects output that altered a quoted span', async () => {
    const input = '他猶豫了很久，最後還是開口，聲音壓得很低。「我們明天走。」';
    // Model wrongly rewrote the dialogue inside the quotes → must be rejected.
    const tampered = '他猶豫了好一陣子，最後才壓低聲音開口。「我們後天再走。」';
    const svc = makeAiService(tampered);
    const result = await refineNarration({
      aiService: svc as unknown as AiSvc,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: input,
      mode: 'single',
    });
    expect(result).toBeNull();
  });

  it('degenerate guard: rejects output far shorter than a substantial input', async () => {
    const longInput = NARRATION_INPUT + NARRATION_INPUT; // well over 80 chars
    const svc = makeAiService('好的，我明白了。'); // far too short
    const result = await refineNarration({
      aiService: svc as unknown as AiSvc,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: longInput,
      mode: 'single',
    });
    expect(result).toBeNull();
  });

  it('two-pass feeds the critique into the rewrite prompt', async () => {
    const rawCritique = '「火把忽明忽滅」屬陳腐套語意象，建議改寫。';
    const rewriteResult = '夜色壓在山脊上，谷風一路捲上來，火把的光在他臉上跳動不定。他攥緊了劍，遲遲沒有動。';
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: rawCritique } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: rewriteResult } }] });
    const svc = {
      getClient: () => ({ chat: { completions: { create } } }),
    } as unknown as AiSvc;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await refineNarration({
      aiService: svc,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: NARRATION_INPUT,
      mode: 'two-pass',
    });
    warnSpy.mockRestore();

    expect(result).toBe(rewriteResult);
    expect(create).toHaveBeenCalledTimes(2);
    const [secondCallOpts] = create.mock.calls[1] as [{ messages: Array<{ role: string; content: string }> }];
    const systemMsg = secondCallOpts.messages.find(m => m.role === 'system');
    expect(systemMsg?.content).toContain(rawCritique);
  });

  it('signal.aborted returns null before any LLM call', async () => {
    const svc = makeAiService('refined');
    const ac = new AbortController();
    ac.abort();
    const result = await refineNarration({
      aiService: svc as unknown as AiSvc,
      providerConfig: SDK_PROVIDER,
      model: 'gpt-4o',
      storyText: NARRATION_INPUT,
      mode: 'single',
      signal: ac.signal,
    });
    expect(result).toBeNull();
    expect(svc._create).not.toHaveBeenCalled();
  });
});
