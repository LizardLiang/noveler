// OllamaNativeService.ts
//
// Ollama's OpenAI-compatible /v1 endpoint ignores num_ctx, so a large prompt
// plus a "thinking" model exhausts the default 4096-token window and the model
// is truncated before it writes any story content (finish_reason=length).
//
// The native /api/chat endpoint DOES honor options.num_ctx and returns thinking
// separately as message.thinking. This service streams generation through it for
// Ollama providers, sizing num_ctx to the prompt plus generous output headroom.

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { TokenUsage, AIError, StreamChunk } from './AIProviderService.js';

export interface OllamaChatStreamOptions {
  /** OpenAI-style base URL (e.g. http://localhost:11434/v1); the native URL is derived from it. */
  baseUrl: string;
  /** Bearer token — required for Open WebUI's /ollama proxy, ignored by Ollama direct. */
  apiKey?: string;
  messages: ChatCompletionMessageParam[];
  model: string;
  /** Effective context window to request from Ollama. */
  numCtx: number;
  temperature?: number;
  signal?: AbortSignal;
  onChunk: (chunk: StreamChunk) => void;
  onError: (error: AIError) => void;
  onDone: (usage: TokenUsage) => void;
}

const OUTPUT_HEADROOM = 8192;   // tokens reserved for thinking + the story itself
const CTX_BUCKET = 8192;        // round num_ctx to this so the runner stays loaded across similar prompts
const MIN_NUM_CTX = 8192;
const MAX_NUM_CTX = 32768;      // ceiling to bound VRAM use

/**
 * Size num_ctx to fit the prompt plus output headroom, bucketed for stability and
 * clamped to a safe range. Bucketing avoids a model reload on every small prompt change.
 */
export function computeNumCtx(promptTokens: number): number {
  const needed = promptTokens + OUTPUT_HEADROOM;
  const bucketed = Math.ceil(needed / CTX_BUCKET) * CTX_BUCKET;
  return Math.min(MAX_NUM_CTX, Math.max(MIN_NUM_CTX, bucketed));
}

/**
 * Resolve the native Ollama /api/chat URL from an OpenAI-style base URL.
 * - Ollama direct (…/v1 or bare host):  {host}/api/chat
 * - Open WebUI (…/api):  {host}/ollama/api/chat  (Open WebUI proxies Ollama under /ollama)
 */
export function resolveOllamaChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/api$/.test(trimmed)) {
    return trimmed.replace(/\/api$/, '') + '/ollama/api/chat';
  }
  return trimmed.replace(/\/v1$/, '') + '/api/chat';
}

/**
 * Rough prompt-token estimate for sizing num_ctx on non-streaming calls (where the
 * caller has no tiktoken count). Over-estimates slightly (CJK-heavy text) so num_ctx
 * is never too small; computeNumCtx then adds the output headroom.
 */
function estimatePromptTokens(messages: ChatCompletionMessageParam[]): number {
  const chars = messages.reduce((sum, m) => sum + messageContentToString(m.content).length, 0);
  return Math.ceil(chars / 2.5);
}

function messageContentToString(content: ChatCompletionMessageParam['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : 'text' in part ? part.text : ''))
      .join('');
  }
  return '';
}

function toOllamaMessages(messages: ChatCompletionMessageParam[]): Array<{ role: string; content: string }> {
  return messages
    .map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: messageContentToString(m.content) }))
    .filter(m => m.content.length > 0);
}

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: null };
export { ZERO_USAGE };

export async function ollamaChatStream(options: OllamaChatStreamOptions): Promise<void> {
  const url = resolveOllamaChatUrl(options.baseUrl);
  const body = JSON.stringify({
    model: options.model,
    messages: toOllamaMessages(options.messages),
    think: true,
    stream: true,
    options: {
      num_ctx: options.numCtx,
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
    },
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.apiKey) headers['Authorization'] = `Bearer ${options.apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: options.signal,
    });
  } catch (err) {
    if (options.signal?.aborted) {
      options.onChunk({ delta: '', done: true });
      options.onDone(ZERO_USAGE);
      return;
    }
    options.onError({ code: 'NETWORK_ERROR', message: `無法連線至 Ollama：${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    if (res.status === 404) {
      options.onError({ code: 'MODEL_NOT_FOUND', message: `找不到模型「${options.model}」，請確認已用 ollama pull 下載`, status: 404 });
    } else {
      options.onError({ code: 'UNKNOWN', message: `Ollama 回應錯誤 (${res.status})：${text.slice(0, 200)}`, status: res.status });
    }
    return;
  }

  let usage: TokenUsage = { ...ZERO_USAGE };
  let buffer = '';
  let diagContentChars = 0;
  let diagThinkingChars = 0;
  const decoder = new TextDecoder();

  try {
    // res.body is an async-iterable web ReadableStream in Node/Electron.
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(part, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (typeof obj.error === 'string') {
          options.onError({ code: 'UNKNOWN', message: obj.error });
          return;
        }
        const msg = (obj.message ?? {}) as { content?: string; thinking?: string };
        if (msg.thinking) {
          // Reasoning channel — display only, never the saved story.
          diagThinkingChars += msg.thinking.length;
          options.onChunk({ delta: msg.thinking, done: false, reasoning: true });
        }
        if (msg.content) {
          diagContentChars += msg.content.length;
          options.onChunk({ delta: msg.content, done: false });
        }
        if (obj.done) {
          const promptTokens = typeof obj.prompt_eval_count === 'number' ? obj.prompt_eval_count : 0;
          const completionTokens = typeof obj.eval_count === 'number' ? obj.eval_count : 0;
          usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, reasoningTokens: null };
        }
      }
    }
  } catch (err) {
    if (options.signal?.aborted) {
      options.onChunk({ delta: '', done: true });
      options.onDone(ZERO_USAGE);
      return;
    }
    options.onError({ code: 'NETWORK_ERROR', message: `Ollama 串流中斷：${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // [diag] remove once confirmed
  console.log(`[ollama] ${url} numCtx=${options.numCtx} contentChars=${diagContentChars} thinkingChars=${diagThinkingChars} usage=${JSON.stringify(usage)}`);

  options.onChunk({ delta: '', done: true });
  options.onDone(usage);
}

export interface OllamaChatCompleteOptions {
  baseUrl: string;
  apiKey?: string;
  messages: ChatCompletionMessageParam[];
  model: string;
  temperature?: number;
  /** Maps to Ollama options.num_predict (max output tokens). */
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Non-streaming native completion (mirrors curlComplete). Returns message.content
 * plus usage; the model's thinking (message.thinking) is discarded — these are
 * utility calls (JSON extraction, suggestions, dialogue rewrite) that want only
 * the answer. num_ctx is sized from the message lengths. Throws on transport/HTTP
 * error. Abort=omit: if signal is aborted the fetch throws before return, so no
 * usage is surfaced (invariant preserved without explicit handling here).
 */
export async function ollamaChatComplete(options: OllamaChatCompleteOptions): Promise<{ text: string; usage: TokenUsage | null }> {
  const url = resolveOllamaChatUrl(options.baseUrl);
  const body = JSON.stringify({
    model: options.model,
    messages: toOllamaMessages(options.messages),
    think: true,
    stream: false,
    options: {
      num_ctx: computeNumCtx(estimatePromptTokens(options.messages)),
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      ...(options.maxTokens != null ? { num_predict: options.maxTokens } : {}),
    },
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.apiKey) headers['Authorization'] = `Bearer ${options.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama 回應錯誤 (${res.status})：${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
    done_reason?: string;
    error?: string;
  };
  if (data.error) throw new Error(data.error);
  if (data.done_reason === 'length') throw new Error('模型輸出因長度限制而截斷');

  const pt = typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : null;
  const ct = typeof data.eval_count === 'number' ? data.eval_count : null;
  const usage: TokenUsage | null = (pt != null || ct != null)
    ? { promptTokens: pt ?? 0, completionTokens: ct ?? 0, totalTokens: (pt ?? 0) + (ct ?? 0), reasoningTokens: null }
    : null;

  return { text: data.message?.content ?? '', usage };
}
