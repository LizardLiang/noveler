/**
 * CurlStreamService.usage.test.ts
 *
 * TC-U06: OAuth/curl transport — extracts input/output from response.completed SSE correctly
 * TC-U07: OAuth/curl transport — abort throws before returning, no usage captured
 *
 * Strategy: We can't easily mock `spawn` from node:child_process in this test
 * environment, so instead we test the pure SSE-parsing logic extracted from
 * curlComplete by examining the parseSseLines function's output shaping AND by
 * testing `curlComplete` with a real AbortSignal (already-aborted) to confirm the
 * abort=omit invariant holds via the public API contract.
 *
 * For TC-U06 we test the usage extraction by invoking `curlStream` with a mock
 * that simulates the completed SSE event via the child_process mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock child_process so no real curl is spawned ────────────────────────────
// We simulate the curl process by emitting controlled stdout data and then
// calling close with exit code 0.

import EventEmitter from 'node:events';

interface MockCurlProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function makeMockCurl(): MockCurlProcess {
  const proc = new EventEmitter() as MockCurlProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

// Mock must be hoisted before the import of the module under test
let mockCurlProc: MockCurlProcess | null = null;

vi.mock('node:child_process', () => ({
  spawn: vi.fn((_cmd: string, _args: string[]) => {
    mockCurlProc = makeMockCurl();
    return mockCurlProc;
  }),
}));

// Dynamically import AFTER the mock is set up
const { curlComplete, curlStream } = await import('../CurlStreamService.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildCompletedSse(usage: {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  output_tokens_details?: { reasoning_tokens?: number };
}): string {
  const payload = JSON.stringify({
    type: 'response.completed',
    response: {
      output: [],
      usage,
    },
  });
  return `data: ${payload}\n\n`;
}

// ── TC-U06: extracts input/output/reasoning from response.completed SSE ─────

describe('CurlStreamService — TC-U06: usage extraction from response.completed', () => {
  beforeEach(() => {
    mockCurlProc = null;
  });

  it('extracts promptTokens, completionTokens, totalTokens, and reasoningTokens', async () => {
    const usagePromise = new Promise<import('../AIProviderService.js').TokenUsage | null>(resolve => {
      const msgs = [{ role: 'user' as const, content: 'hello' }];
      const p = curlComplete({
        messages: msgs,
        model: 'test-model',
        accessToken: 'tok',
        accountId: 'acc',
      });
      // Emit SSE after a tick so curlStream has registered event listeners
      setTimeout(() => {
        const proc = mockCurlProc!;
        const sse = buildCompletedSse({
          input_tokens: 1820,
          output_tokens: 240,
          total_tokens: 2060,
          output_tokens_details: { reasoning_tokens: 180 },
        });
        proc.stdout.emit('data', Buffer.from(sse));
        proc.emit('close', 0);
      }, 0);
      p.then(result => resolve(result.usage)).catch(() => resolve(null));
    });

    const usage = await usagePromise;
    expect(usage).not.toBeNull();
    expect(usage!.promptTokens).toBe(1820);
    expect(usage!.completionTokens).toBe(240);
    expect(usage!.totalTokens).toBe(2060);
    expect(usage!.reasoningTokens).toBe(180);
  });

  it('returns reasoningTokens: null when output_tokens_details is absent', async () => {
    const usagePromise = new Promise<import('../AIProviderService.js').TokenUsage | null>(resolve => {
      const msgs = [{ role: 'user' as const, content: 'hello' }];
      const p = curlComplete({
        messages: msgs,
        model: 'test-model',
        accessToken: 'tok',
        accountId: 'acc',
      });
      setTimeout(() => {
        const proc = mockCurlProc!;
        const sse = buildCompletedSse({
          input_tokens: 500,
          output_tokens: 100,
          total_tokens: 600,
          // no output_tokens_details
        });
        proc.stdout.emit('data', Buffer.from(sse));
        proc.emit('close', 0);
      }, 0);
      p.then(result => resolve(result.usage)).catch(() => resolve(null));
    });

    const usage = await usagePromise;
    expect(usage).not.toBeNull();
    expect(usage!.reasoningTokens).toBeNull();
  });

  it('returns reasoningTokens: null when reasoning_tokens field is undefined', async () => {
    const usagePromise = new Promise<import('../AIProviderService.js').TokenUsage | null>(resolve => {
      const msgs = [{ role: 'user' as const, content: 'hello' }];
      const p = curlComplete({
        messages: msgs,
        model: 'test-model',
        accessToken: 'tok',
        accountId: 'acc',
      });
      setTimeout(() => {
        const proc = mockCurlProc!;
        const sse = buildCompletedSse({
          input_tokens: 500,
          output_tokens: 100,
          total_tokens: 600,
          output_tokens_details: { /* reasoning_tokens omitted */ },
        });
        proc.stdout.emit('data', Buffer.from(sse));
        proc.emit('close', 0);
      }, 0);
      p.then(result => resolve(result.usage)).catch(() => resolve(null));
    });

    const usage = await usagePromise;
    expect(usage).not.toBeNull();
    expect(usage!.reasoningTokens).toBeNull();
  });

  it('preserves reasoningTokens: 0 when provider explicitly returns 0 (real zero)', async () => {
    const usagePromise = new Promise<import('../AIProviderService.js').TokenUsage | null>(resolve => {
      const msgs = [{ role: 'user' as const, content: 'hello' }];
      const p = curlComplete({
        messages: msgs,
        model: 'test-model',
        accessToken: 'tok',
        accountId: 'acc',
      });
      setTimeout(() => {
        const proc = mockCurlProc!;
        const sse = buildCompletedSse({
          input_tokens: 500,
          output_tokens: 100,
          total_tokens: 600,
          output_tokens_details: { reasoning_tokens: 0 },
        });
        proc.stdout.emit('data', Buffer.from(sse));
        proc.emit('close', 0);
      }, 0);
      p.then(result => resolve(result.usage)).catch(() => resolve(null));
    });

    const usage = await usagePromise;
    expect(usage).not.toBeNull();
    // 0 is a real value — preserve it, do NOT convert to null
    expect(usage!.reasoningTokens).toBe(0);
  });
});

// ── TC-U07: abort throws before returning, no usage captured ────────────────

describe('CurlStreamService — TC-U07: abort=omit invariant', () => {
  it('curlComplete throws (rejects) when signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort(); // pre-aborted

    const msgs = [{ role: 'user' as const, content: 'hello' }];

    // Schedule the mock close event to happen so the promise can resolve/reject
    setTimeout(() => {
      if (mockCurlProc) {
        // Simulate the curl process being killed immediately (abort path)
        mockCurlProc.emit('close', null);
      }
    }, 0);

    // curlComplete should throw because signal.aborted is true after stream resolves
    await expect(
      curlComplete({
        messages: msgs,
        model: 'test-model',
        accessToken: 'tok',
        accountId: 'acc',
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });

  it('curlStream calls onDone with zero-usage on abort (does not throw)', async () => {
    const controller = new AbortController();
    controller.abort();

    const onDone = vi.fn();
    const onChunk = vi.fn();
    const onError = vi.fn();

    const msgs = [{ role: 'user' as const, content: 'hello' }];

    setTimeout(() => {
      if (mockCurlProc) {
        mockCurlProc.emit('close', null);
      }
    }, 0);

    await curlStream({
      messages: msgs,
      model: 'test-model',
      accessToken: 'tok',
      accountId: 'acc',
      signal: controller.signal,
      onChunk,
      onError,
      onDone,
    });

    // onDone is called but with zero-usage (abort path in curlStream)
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
    const calledUsage = onDone.mock.calls[0][0];
    expect(calledUsage.promptTokens).toBe(0);
    expect(calledUsage.completionTokens).toBe(0);
    expect(calledUsage.reasoningTokens).toBeNull();
  });
});
