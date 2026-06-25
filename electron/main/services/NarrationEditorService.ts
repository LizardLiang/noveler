/**
 * NarrationEditorService.ts
 *
 * The inverse of DialogueEditorService: refines the NARRATION (text OUTSIDE
 * quotes) while leaving every line of dialogue inside quotes verbatim. The two
 * passes compose — the narration pass keeps quotes intact, the dialogue pass
 * keeps narration intact.
 *
 * Targets the AI-tells the dialogue pass never touches because they live in
 * narration:
 *   - generic / clichéd imagery (彷彿…, 一絲…, 空氣彷彿凝固了…)
 *   - repetitive sentence rhythm (uniform length/structure, mechanical parallelism)
 *   - telegraphic cryptic fragments (不硬打 / 不硬衝) that no human would write
 *
 * Hard rule: never compress for brevity. Natural prose is often longer; output
 * may exceed the input length and must never drop plot information.
 *
 * Best-effort / never-throws (mirrors refineDialogue). Staleness (FR-D013) is
 * the CALLER's responsibility via the generation-token write guard.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { getAIProviderService } from './AIProviderService.js';
import { callLLM } from './DialogueEditorService.js';
import type { ProviderConfig } from './DialogueEditorService.js';
import type { StepUsageRecord } from '../../shared/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface NarrationEditorSettings {
  enabled: boolean;
  mode: 'single' | 'two-pass';
}

export interface RefineNarrationParams {
  aiService: ReturnType<typeof getAIProviderService>;
  providerConfig: ProviderConfig;
  model: string;
  storyText: string;
  mode: 'single' | 'two-pass';
  signal?: AbortSignal;
  /** Optional usage callback — called after each LLM call with the record (step is tagged by the caller). */
  onUsage?: (rec: Omit<StepUsageRecord, 'step'>) => void;
}

// ── Quote detection / extraction ──────────────────────────────────────────────

/**
 * Global match for every supported quote style (mirrors DIALOGUE_RE but global,
 * so all spans can be stripped/collected). Backslash-u escapes keep the parser
 * from treating curly quotes as string delimiters.
 *   「 / 」 『 / 』 — CJK corner brackets
 *   “ / ”  ‘ / ’    — Western curly quotes
 *   "              — Western straight double quote
 */
const QUOTE_RE_GLOBAL = new RegExp(
  "「[^」]*」" +
  "|『[^』]*』" +
  "|“[^”]*”" +
  "|‘[^’]*’" +
  '|"[^"]*"',
  'g',
);

/** Ordered list of quoted spans (including their delimiters). */
function extractQuotes(t: string): string[] {
  return t.match(QUOTE_RE_GLOBAL) ?? [];
}

/** Text with every quoted span removed — i.e. the pure narration. */
function stripQuotes(t: string): string {
  return t.replace(QUOTE_RE_GLOBAL, '');
}

/** Minimum non-whitespace narration length worth refining. */
const MIN_NARRATION_CHARS = 20;

/**
 * True only when there is substantial prose OUTSIDE quotes. Pure-dialogue
 * paragraphs (or near-pure) are skipped so the pass never runs for nothing.
 */
export function containsNarration(t: string): boolean {
  const narration = stripQuotes(t).replace(/\s+/g, '');
  return narration.length >= MIN_NARRATION_CHARS;
}

// ── Prompt building blocks ──────────────────────────────────────────────────

/** Overriding constraint: complete natural sentences + meaning preservation, no compression. */
const NATURALNESS_FLOOR = `最高原則（凌駕一切）：
- 改寫後的每一句敘述都必須是「真人會這樣寫」的完整、通順、自然繁體中文，讀者一看就懂。
- 嚴禁電報式的殘缺縮略片段。例如「不硬打」「不硬衝」這種沒人會講的寫法，必須展開成自然完整的說法，如「不會跟他們硬拼」「保險起見，先不正面衝突」。慣用語也不可漏字自創縮略。
- 不要為了精簡而刪減。真人寫的句子常常較長、甚至有點囉嗦，這沒關係——寧可自然而長，也不要為求短而寫成生硬的片段。輸出可以比原文長。
- 「只改說法，不改意思」：嚴禁改變任何劇情資訊、角色行為、因果或設定，只能調整措辭、意象與節奏。絕不可遺漏原文交代的任何情節。`;

const NARRATION_RUBRIC = `評估標準（敘述品質四維度）：
1. 節奏變化 (rhythm variety)：句子長短與結構要有變化，避免每句都差不多長、差不多句型的機械式排比與流水帳。
2. 具體意象 (concrete imagery)：用具體、專屬於此場景的描寫，取代空泛通用的套語。
3. 演出而非告知 (show, don't tell)：透過動作、感官細節與環境呈現情緒與狀態，而不是直接下結論斷言。
4. 自然完整 (natural & complete)：每句都是真人會寫的完整句子，沒有看不懂的縮略或斷裂。`;

const NARRATION_BAN_LIST = `禁止清單（必須改寫）：
- 陳腐套語意象：「彷彿」「一絲」「空氣彷彿凝固了」「心中一凜」「嘴角勾起一抹弧度」「不知為何」「莫名地」等公式化描寫，改成具體寫法。
- 機械式節奏：連續多句長度與句型雷同的排比、流水帳。
- 電報式片段：「不硬打」「不硬衝」這類沒人會講的殘缺縮略，展開成自然完整句。
- 冗詞濫情的紫色散文：堆砌形容詞、過度誇飾。`;

/** Inverse of the dialogue editor: only narration may change; quotes stay verbatim. */
const NARRATION_REWRITE_RULES = `改寫規則：
- 只改寫「引號外」的敘述、動作描寫與場景文字。引號內的對話（「」『』與西文 "" ''）一律「逐字保留」，一個字都不能動。
- 不得改變任何劇情資訊、角色行為、因果關係或世界設定；只能調整措辭、意象與節奏。不可遺漏原文交代的情節。
- 不得改變敘事視角與時態，不得新增或刪除對話段落。
- 不要為求精簡而刪減內容；自然而完整優先。
- 直接輸出完整段落（改寫後敘述 + 原樣對話），不要附加說明、評語或標記。`;

function buildSinglePassSystemPrompt(): string {
  return [
    '你是一位小說敘述潤飾編輯。針對下方小說段落，「只改寫引號外的敘述」，讓敘述讀起來像真人寫的——意象具體、節奏有變化、句子自然完整，引號內的對話逐字保留。',
    '',
    NATURALNESS_FLOOR,
    '',
    '在「看得懂、不改意思、不刪情節」的前提下，再依下列四維度提升品質：',
    NARRATION_RUBRIC,
    '',
    NARRATION_BAN_LIST,
    '',
    NARRATION_REWRITE_RULES,
  ].join('\n');
}

function buildCritiqueSystemPrompt(): string {
  return [
    '你是一位敘述審稿員。針對下方小說段落中「引號外的敘述」，找出最像 AI 寫的、最不自然的句子。',
    '以純文字條列輸出，每行一條，格式：',
    '- 「原句」→ 問題（屬於哪一類：陳腐套語意象／機械式節奏／電報式片段／演出不足，為何不自然）',
    '只列出真正有問題的敘述（最多 6 條）。不要輸出 JSON、不要程式碼區塊、不要客套或總評，也不要直接改寫——只做診斷。',
    '',
    NARRATION_RUBRIC,
    '',
    NARRATION_BAN_LIST,
  ].join('\n');
}

function buildRewriteSystemPrompt(critiqueText: string): string {
  const critique = critiqueText.trim();
  const parts = [
    '你是一位小說敘述潤飾編輯。針對下方小說段落，「只改寫引號外的敘述」，引號內的對話逐字保留。',
    '',
    NATURALNESS_FLOOR,
  ];
  if (critique) {
    parts.push('', '參考以下敘述診斷，優先改寫被點名的句子：', critique);
  }
  parts.push('', NARRATION_BAN_LIST);
  parts.push('', NARRATION_REWRITE_RULES);
  return parts.join('\n');
}

// ── LLM call tuning constants (mirror the dialogue editor) ─────────────────────
const REWRITE_MAX_TOKENS = 2000;
const REWRITE_TEMPERATURE = 0.7;
const CRITIQUE_MAX_TOKENS = 1000;
const CRITIQUE_TEMPERATURE = 0.3;

// Degenerate-output guard: a genuine refinement keeps (or grows) the length, so a
// result far shorter than the input means the model didn't do the task (e.g. a
// weak model replying conversationally). Lower bound only — longer is allowed.
const DEGENERATE_GUARD_MIN_INPUT = 80;
const DEGENERATE_GUARD_RATIO = 0.5;

// ── Passes ────────────────────────────────────────────────────────────────────

async function runSingle(
  storyText: string,
  aiService: ReturnType<typeof getAIProviderService>,
  providerConfig: ProviderConfig,
  model: string,
  signal?: AbortSignal,
  onUsage?: (rec: Omit<StepUsageRecord, 'step'>) => void,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSinglePassSystemPrompt() },
    { role: 'user', content: storyText },
  ];
  const start = performance.now();
  const { text, usage } = await callLLM(messages, aiService, providerConfig, model, { maxTokens: REWRITE_MAX_TOKENS, temperature: REWRITE_TEMPERATURE }, signal);
  onUsage?.({
    model,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    latencyMs: performance.now() - start,
  });
  return text;
}

async function runCritique(
  storyText: string,
  aiService: ReturnType<typeof getAIProviderService>,
  providerConfig: ProviderConfig,
  model: string,
  signal?: AbortSignal,
  onUsage?: (rec: Omit<StepUsageRecord, 'step'>) => void,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildCritiqueSystemPrompt() },
    { role: 'user', content: storyText },
  ];
  const start = performance.now();
  const { text: raw, usage } = await callLLM(
    messages, aiService, providerConfig, model,
    { maxTokens: CRITIQUE_MAX_TOKENS, temperature: CRITIQUE_TEMPERATURE },
    signal,
  );
  onUsage?.({
    model,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    latencyMs: performance.now() - start,
  });
  const text = (raw ?? '').trim();
  if (!text) {
    console.warn('[narration-editor] critique returned empty — proceeding with direct rewrite (no structured feedback)');
  } else {
    console.warn(`[narration-editor] critique done (len=${text.length})`);
  }
  return text;
}

async function runRewrite(
  storyText: string,
  critiqueText: string,
  aiService: ReturnType<typeof getAIProviderService>,
  providerConfig: ProviderConfig,
  model: string,
  signal?: AbortSignal,
  onUsage?: (rec: Omit<StepUsageRecord, 'step'>) => void,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildRewriteSystemPrompt(critiqueText) },
    { role: 'user', content: storyText },
  ];
  const start = performance.now();
  const { text, usage } = await callLLM(messages, aiService, providerConfig, model, { maxTokens: REWRITE_MAX_TOKENS, temperature: REWRITE_TEMPERATURE }, signal);
  onUsage?.({
    model,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    latencyMs: performance.now() - start,
  });
  return text;
}

// ── getNarrationEditorSettings ────────────────────────────────────────────────

/**
 * Reads narration_editor_enabled / narration_editor_mode from the per-project
 * key-value project_settings table. Applies defaults when keys are absent
 * (enabled, two-pass). Mirrors getDialogueEditorSettings.
 */
export function getNarrationEditorSettings(
  projectId: string,
  getOpenProject?: (id: string) => { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } } | null,
): NarrationEditorSettings {
  const defaults: NarrationEditorSettings = { enabled: true, mode: 'two-pass' };
  if (!getOpenProject) return defaults;

  try {
    const projectDb = getOpenProject(projectId);
    if (!projectDb) return defaults;

    const enabledRow = projectDb
      .prepare("SELECT value FROM project_settings WHERE key='narration_editor_enabled'")
      .get() as { value: string } | undefined;

    const modeRow = projectDb
      .prepare("SELECT value FROM project_settings WHERE key='narration_editor_mode'")
      .get() as { value: string } | undefined;

    const enabled = enabledRow
      ? (JSON.parse(String(enabledRow.value)) as boolean)
      : true;
    const modeRaw = modeRow
      ? (JSON.parse(String(modeRow.value)) as string)
      : 'two-pass';
    const mode: 'single' | 'two-pass' = modeRaw === 'single' ? 'single' : 'two-pass';

    return { enabled, mode };
  } catch {
    return defaults;
  }
}

// ── refineNarration ────────────────────────────────────────────────────────────

/**
 * Best-effort. Returns refined story text on success, or null on any
 * failure / abort / no-narration / empty result / guard rejection. Caller keeps
 * the unrefined draft when this returns null.
 */
export async function refineNarration(params: RefineNarrationParams): Promise<string | null> {
  const { aiService, providerConfig, model, storyText, mode, signal, onUsage } = params;

  // Step 1: cheap pre-check — skip if there's no substantial narration
  if (!containsNarration(storyText)) {
    console.warn('[narration-editor] skipped: no substantial narration outside quotes');
    return null;
  }

  // Step 2: best-effort early-out for explicit ai:cancel
  if (signal?.aborted) return null;

  console.warn(
    `[narration-editor] running: mode=${mode}, provider=${providerConfig.authMethod ?? 'api_key'}, model=${model}, inputLen=${storyText.length}`,
  );

  try {
    let refined: string;
    if (mode === 'two-pass') {
      const critique = await runCritique(storyText, aiService, providerConfig, model, signal, onUsage);
      refined = await runRewrite(storyText, critique, aiService, providerConfig, model, signal, onUsage);
    } else {
      refined = await runSingle(storyText, aiService, providerConfig, model, signal, onUsage);
    }

    // Post-await abort guard — discard partial results from a timed-out pass.
    if (signal?.aborted) {
      console.warn('[narration-editor] signal aborted after LLM returned — keeping draft (partial result discarded)');
      return null;
    }

    if (!refined || !refined.trim()) {
      console.warn('[narration-editor] LLM returned empty refined text — keeping draft');
      return null;
    }
    const result = refined.trim();
    const inputLen = storyText.trim().length;

    // Degenerate guard (lower bound only): far shorter means the model didn't
    // perform the task. Longer output is expected and allowed.
    if (inputLen >= DEGENERATE_GUARD_MIN_INPUT && result.length < inputLen * DEGENERATE_GUARD_RATIO) {
      console.warn(
        `[narration-editor] refined text too short (${result.length} vs input ${inputLen}) — likely not a real refinement, keeping draft`,
      );
      return null;
    }

    // Quote-integrity guard: this pass must never touch dialogue. If the ordered
    // list of quoted spans changed, the model edited inside quotes — reject and
    // keep the draft to protect dialogue and plot facts.
    const beforeQuotes = extractQuotes(storyText);
    const afterQuotes = extractQuotes(result);
    const quotesIntact =
      beforeQuotes.length === afterQuotes.length &&
      beforeQuotes.every((q, i) => q === afterQuotes[i]);
    if (!quotesIntact) {
      console.warn(
        `[narration-editor] quotes changed (before=${beforeQuotes.length}, after=${afterQuotes.length}) — model edited dialogue, keeping draft`,
      );
      return null;
    }

    console.warn(
      `[narration-editor] done: outputLen=${result.length}, changed=${result !== storyText.trim()}`,
    );
    return result;
  } catch (err) {
    console.error('[narration-editor] refine FAILED, keeping draft:', err);
    return null;
  }
}

// ── Exports for testing (internal helpers) ───────────────────────────────────

export {
  buildSinglePassSystemPrompt,
  buildCritiqueSystemPrompt,
  buildRewriteSystemPrompt,
  extractQuotes,
  stripQuotes,
  NATURALNESS_FLOOR,
  NARRATION_RUBRIC,
  NARRATION_BAN_LIST,
  NARRATION_REWRITE_RULES,
};
