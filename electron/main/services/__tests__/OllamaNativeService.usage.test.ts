/**
 * OllamaNativeService.usage.test.ts
 *
 * TC-U10: Ollama transport — maps prompt_eval_count/eval_count, reasoning always null
 * TC-U11: Ollama transport — ZERO_USAGE constant has reasoningTokens: null;
 *          streaming path includes reasoningTokens: null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZERO_USAGE, ollamaChatComplete, ollamaChatStream } from '../OllamaNativeService.js';

// ── Mock global fetch ────────────────────────────────────────────────────────

// We control fetch responses per test via this variable
let mockFetchImpl: ((url: string, opts?: RequestInit) => Promise<Response>) | null = null;

vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
  if (mockFetchImpl) return mockFetchImpl(url, opts);
  throw new Error('No fetch mock set');
}));

// Build a non-streaming Ollama response body
function makeOllamaResponse(opts: {
  content?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}): object {
  return {
    model: 'test-model',
    message: { role: 'assistant', content: opts.content ?? 'hello' },
    done: true,
    prompt_eval_count: opts.prompt_eval_count,
    eval_count: opts.eval_count,
    error: opts.error,
  };
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Build a streaming Ollama response (NDJSON lines)
// Uses a custom async-iterable body so the for-await loop in OllamaNativeService works
// correctly in Node.js/Vitest (web ReadableStream async iteration may be unreliable
// in the test environment).
function makeStreamingResponse(lines: object[]): Response {
  // Each line MUST end with \n so the buffer-split logic can process the last line
  const ndjson = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(ndjson);

  // Build a minimal async-iterable that yields one Uint8Array chunk
  // and attach it as `body` on a mock Response-like object.
  const asyncIterable = {
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        async next() {
          if (!done) {
            done = true;
            return { value: bytes, done: false as const };
          }
          return { value: undefined as unknown as Uint8Array, done: true as const };
        },
      };
    },
  };

  // We return a mock object that satisfies the contract OllamaNativeService uses:
  // - ok: true
  // - body: async-iterable<Uint8Array>
  return {
    ok: true,
    status: 200,
    body: asyncIterable,
    text: () => Promise.resolve(ndjson),
  } as unknown as Response;
}

// ── TC-U11: ZERO_USAGE constant ──────────────────────────────────────────────

describe('OllamaNativeService — TC-U11: ZERO_USAGE constant', () => {
  it('ZERO_USAGE has reasoningTokens: null', () => {
    expect(ZERO_USAGE.reasoningTokens).toBeNull();
    expect(ZERO_USAGE.promptTokens).toBe(0);
    expect(ZERO_USAGE.completionTokens).toBe(0);
    expect(ZERO_USAGE.totalTokens).toBe(0);
  });
});

// ── TC-U10: ollamaChatComplete — prompt_eval_count / eval_count mapping ──────

describe('OllamaNativeService — TC-U10: ollamaChatComplete usage extraction', () => {
  beforeEach(() => {
    mockFetchImpl = null;
  });

  it('maps prompt_eval_count and eval_count, sets reasoningTokens: null', async () => {
    mockFetchImpl = async () => makeJsonResponse(makeOllamaResponse({
      content: 'story text',
      prompt_eval_count: 300,
      eval_count: 200,
    }));

    const result = await ollamaChatComplete({
      baseUrl: 'http://localhost:11434/v1',
      messages: [{ role: 'user', content: 'hello' }],
      model: 'llama3',
    });

    expect(result.usage).not.toBeNull();
    expect(result.usage!.promptTokens).toBe(300);
    expect(result.usage!.completionTokens).toBe(200);
    expect(result.usage!.totalTokens).toBe(500);
    expect(result.usage!.reasoningTokens).toBeNull();
    expect(result.text).toBe('story text');
  });

  it('returns usage: null when both prompt_eval_count and eval_count are absent', async () => {
    mockFetchImpl = async () => makeJsonResponse(makeOllamaResponse({
      content: 'response',
      // both counts omitted
    }));

    const result = await ollamaChatComplete({
      baseUrl: 'http://localhost:11434/v1',
      messages: [{ role: 'user', content: 'hello' }],
      model: 'llama3',
    });

    expect(result.usage).toBeNull();
  });

  it('handles absent prompt_eval_count with present eval_count — promptTokens: 0', async () => {
    // Only eval_count present — prompt_eval_count absent
    // Per TC-U10 edge case: promptTokens: 0, completionTokens: eval_count, total derived
    const responseBody = {
      model: 'test-model',
      message: { role: 'assistant', content: 'hello' },
      done: true,
      // prompt_eval_count deliberately omitted
      eval_count: 150,
    };
    mockFetchImpl = async () => makeJsonResponse(responseBody);

    const result = await ollamaChatComplete({
      baseUrl: 'http://localhost:11434/v1',
      messages: [{ role: 'user', content: 'hello' }],
      model: 'llama3',
    });

    // eval_count is present so usage should be non-null
    expect(result.usage).not.toBeNull();
    expect(result.usage!.completionTokens).toBe(150);
    expect(result.usage!.reasoningTokens).toBeNull();
  });

  it('throws on HTTP error status', async () => {
    mockFetchImpl = async () => new Response('not found', { status: 404 });

    await expect(ollamaChatComplete({
      baseUrl: 'http://localhost:11434/v1',
      messages: [{ role: 'user', content: 'hello' }],
      model: 'missing-model',
    })).rejects.toThrow();
  });
});

// ── TC-U11: ollamaChatStream — streaming path, reasoningTokens: null ─────────

describe('OllamaNativeService — TC-U11: ollamaChatStream reasoningTokens: null', () => {
  beforeEach(() => {
    mockFetchImpl = null;
  });

  it('onDone receives usage with reasoningTokens: null from streaming response', async () => {
    const streamLines = [
      { message: { role: 'assistant', content: 'part1' }, done: false },
      { message: { role: 'assistant', content: ' part2' }, done: false },
      {
        message: { role: 'assistant', content: '' },
        done: true,
        prompt_eval_count: 400,
        eval_count: 300,
      },
    ];
    mockFetchImpl = async () => makeStreamingResponse(streamLines);

    let capturedUsage: import('../AIProviderService.js').TokenUsage | undefined;
    const chunks: string[] = [];
    await ollamaChatStream({
      baseUrl: 'http://localhost:11434/v1',
      messages: [{ role: 'user', content: 'test' }],
      model: 'llama3',
      numCtx: 8192,
      onChunk: (c) => { if (!c.done && c.delta) chunks.push(c.delta); },
      onError: (e) => { throw new Error(e.message); },
      onDone: (u) => { capturedUsage = u; },
    });

    expect(capturedUsage).toBeDefined();
    expect(capturedUsage!.promptTokens).toBe(400);
    expect(capturedUsage!.completionTokens).toBe(300);
    expect(capturedUsage!.totalTokens).toBe(700);
    // Ollama never reports reasoning tokens — must always be null
    expect(capturedUsage!.reasoningTokens).toBeNull();
    expect(chunks.join('')).toBe('part1 part2');
  });

  it('uses ZERO_USAGE on abort (signal.aborted)', async () => {
    const controller = new AbortController();
    controller.abort();

    // fetch will throw AbortError when called with aborted signal
    mockFetchImpl = async (_url, opts) => {
      if (opts?.signal?.aborted) {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        throw err;
      }
      return makeStreamingResponse([]);
    };

    let capturedUsage: import('../AIProviderService.js').TokenUsage | undefined;
    const onError = vi.fn();
    await ollamaChatStream({
      baseUrl: 'http://localhost:11434/v1',
      messages: [{ role: 'user', content: 'test' }],
      model: 'llama3',
      numCtx: 8192,
      signal: controller.signal,
      onChunk: () => undefined,
      onError,
      onDone: (u) => { capturedUsage = u; },
    });

    expect(onError).not.toHaveBeenCalled();
    expect(capturedUsage).toBeDefined();
    expect(capturedUsage!.reasoningTokens).toBeNull();
    expect(capturedUsage!.promptTokens).toBe(0);
  });
});
