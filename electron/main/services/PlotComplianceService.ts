/**
 * PlotComplianceService.ts
 *
 * Post-generation "beat fulfillment" check: after a paragraph is generated,
 * ask a cheap LLM call whether any of the short-term planned events were
 * actually enacted by the prose. Returns the ids of fulfilled events so the
 * caller can flip them to `occurred` and advance the plot queue.
 *
 * Mirrors DialogueEditorService: non-streaming dual-provider call, best-effort
 * (never throws into the handler), settings read from project_settings.
 */

import { curlComplete } from './CurlStreamService.js';
import { ollamaChatComplete } from './OllamaNativeService.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { getAIProviderService } from './AIProviderService.js';
import type { ProviderConfig } from './DialogueEditorService.js';

// Minimal event shape needed for the check.
export interface EventForCompliance {
  id: string;
  name: string;
  description: string;
}

export interface CheckFulfillmentParams {
  aiService: ReturnType<typeof getAIProviderService>;
  providerConfig: ProviderConfig;
  model: string;
  storyText: string;
  shortEvents: EventForCompliance[];
  signal?: AbortSignal;
}

// Bound cost: only ever check this many short-term events in one call.
const MAX_EVENTS_CHECKED = 8;
const CHECK_MAX_TOKENS = 400;
const CHECK_TEMPERATURE = 0.1;

// ── getPlotComplianceEnabled ──────────────────────────────────────────────────

/**
 * Reads plot_compliance_enabled from per-project project_settings.
 * Defaults to true when the key is absent. Mirrors getDialogueEditorSettings.
 */
export function getPlotComplianceEnabled(
  projectId: string,
  getOpenProject?: (id: string) => { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } } | null,
): boolean {
  if (!getOpenProject) return true;
  try {
    const projectDb = getOpenProject(projectId);
    if (!projectDb) return true;
    const row = projectDb
      .prepare("SELECT value FROM project_settings WHERE key='plot_compliance_enabled'")
      .get() as { value: string } | undefined;
    if (!row) return true;
    return JSON.parse(String(row.value)) as boolean;
  } catch {
    return true;
  }
}

// ── Dual-provider LLM call (mirrors DialogueEditorService.callLLM) ─────────────

async function callLLM(
  messages: ChatCompletionMessageParam[],
  aiService: ReturnType<typeof getAIProviderService>,
  providerConfig: ProviderConfig,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  if (providerConfig.authMethod === 'oauth' && providerConfig.accountId) {
    return (await curlComplete({
      messages,
      model,
      accessToken: providerConfig.apiKey,
      accountId: providerConfig.accountId,
      signal,
    })).text;
  } else if (providerConfig.isOllama) {
    return (await ollamaChatComplete({
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
      messages,
      model,
      temperature: CHECK_TEMPERATURE,
      maxTokens: CHECK_MAX_TOKENS,
      signal,
    })).text;
  } else {
    const client = aiService.getClient();
    if (!client) return '';
    const response = await client.chat.completions.create(
      { model, messages, max_tokens: CHECK_MAX_TOKENS, temperature: CHECK_TEMPERATURE },
      { signal },
    );
    return response.choices[0]?.message?.content ?? '';
  }
}

// ── Prompt + parsing ──────────────────────────────────────────────────────────

const CHECK_SYSTEM_PROMPT = `你是劇情進度檢查員。判斷以下小說段落是否「實際演出」了清單中的劇情目標。
只有當該劇情在段落中明確發生、被實際描寫出來時才算實現；僅僅是提到、鋪陳、暗示或埋伏筆，都「不算」實現。
回傳純 JSON，格式為 {"fulfilled":[編號,...]}，例如 {"fulfilled":[1,3]}；若都沒有實現，回傳 {"fulfilled":[]}。
不要輸出任何 JSON 以外的文字、說明或程式碼區塊。`;

function buildUserPrompt(shortEvents: EventForCompliance[], storyText: string): string {
  const list = shortEvents
    .map((e, i) => {
      const desc = e.description ? `：${e.description}` : '';
      return `${i + 1}. ${e.name}${desc}`;
    })
    .join('\n');
  return `劇情目標：\n${list}\n\n段落：\n${storyText}`;
}

/** Tolerant parse of {"fulfilled":[...]} → 1-based indices. */
function parseFulfilledIndices(raw: string, count: number): number[] {
  if (!raw) return [];
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { fulfilled?: unknown };
    if (!Array.isArray(parsed.fulfilled)) return [];
    const out: number[] = [];
    for (const n of parsed.fulfilled) {
      const idx = Number(n);
      if (Number.isInteger(idx) && idx >= 1 && idx <= count && !out.includes(idx)) {
        out.push(idx);
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ── checkFulfillment ──────────────────────────────────────────────────────────

/**
 * Best-effort. Returns the ids of short-term events the prose actually enacted.
 * Returns [] on any failure / abort / empty result — the caller then leaves the
 * plot queue untouched.
 */
export async function checkFulfillment(
  params: CheckFulfillmentParams,
): Promise<{ fulfilledIds: string[] }> {
  const { aiService, providerConfig, model, storyText, shortEvents, signal } = params;

  const events = shortEvents.slice(0, MAX_EVENTS_CHECKED);
  if (events.length === 0 || !storyText.trim()) return { fulfilledIds: [] };
  if (signal?.aborted) return { fulfilledIds: [] };

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: CHECK_SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(events, storyText) },
  ];

  try {
    const raw = await callLLM(messages, aiService, providerConfig, model, signal);
    if (signal?.aborted) return { fulfilledIds: [] };
    const indices = parseFulfilledIndices((raw ?? '').trim(), events.length);
    const fulfilledIds = indices.map(i => events[i - 1].id);
    console.warn(`[plot-compliance] checked ${events.length} short events, fulfilled=${fulfilledIds.length}`);
    return { fulfilledIds };
  } catch (err) {
    console.error('[plot-compliance] check FAILED, leaving queue untouched:', err);
    return { fulfilledIds: [] };
  }
}
