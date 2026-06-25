/**
 * AIProviderService.usage.test.ts
 *
 * TC-U08: OpenAI SDK transport — extracts completion_tokens_details.reasoning_tokens
 * TC-U09: OpenAI SDK transport — completeWithTools extracts reasoning tokens
 * TC-U12: Reasoning probe — passive observation sets openRouterReasoningUnderExclude
 * TC-U13: Story-generation reasoning recorded as null under exclude:true (standard path)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the OpenAI SDK ───────────────────────────────────────────────────────

function makeStreamMock(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < chunks.length) {
            return { value: chunks[i++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function deltaChunk(content: string): unknown {
  return {
    choices: [{ delta: { content, reasoning_content: null } }],
    usage: null,
  };
}

function usageChunk(opts: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}): unknown {
  return {
    choices: [{ delta: { content: '' } }],
    usage: {
      prompt_tokens: opts.promptTokens,
      completion_tokens: opts.completionTokens,
      total_tokens: opts.totalTokens,
      ...(opts.reasoningTokens !== undefined
        ? { completion_tokens_details: { reasoning_tokens: opts.reasoningTokens } }
        : {}),
    },
  };
}

// The mock `create` function — we swap it per test
let mockCreate = vi.fn();

// OpenAI mock must be a constructor (class)
vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    };
  }
  // Attach APIError as a static-like member
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }
  (MockOpenAI as unknown as Record<string, unknown>).APIError = APIError;
  return { default: MockOpenAI };
});

import {
  AIProviderService,
  extractReasoningTokens,
  type TokenUsage,
} from '../AIProviderService.js';

function makeService(baseUrl = 'https://openrouter.ai/api/v1') {
  const svc = new AIProviderService();
  svc.configure({
    apiKey: 'test-key',
    baseUrl,
    defaultModel: 'test-model',
    authMethod: 'api_key',
  });
  return svc;
}

// ── TC-U08: streamChat extracts completion_tokens_details.reasoning_tokens ──

describe('AIProviderService — TC-U08: streamChat reasoning token extraction', () => {
  it('extracts reasoningTokens from completion_tokens_details', async () => {
    const svc = makeService('https://api.openai.com/v1');
    const chunks = [
      deltaChunk('hello'),
      usageChunk({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500, reasoningTokens: 120 }),
    ];
    mockCreate = vi.fn().mockResolvedValue(makeStreamMock(chunks));

    let capturedUsage: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens: number | null } | undefined;
    await svc.streamChat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'gpt-4o',
      onChunk: () => undefined,
      onError: () => undefined,
      onDone: (u: TokenUsage) => { capturedUsage = u; },
    });

    expect(capturedUsage).toBeDefined();
    expect(capturedUsage!.promptTokens).toBe(1000);
    expect(capturedUsage!.completionTokens).toBe(500);
    expect(capturedUsage!.totalTokens).toBe(1500);
    expect(capturedUsage!.reasoningTokens).toBe(120);
  });

  it('returns reasoningTokens: null when completion_tokens_details is absent', async () => {
    const svc = makeService('https://api.openai.com/v1');
    const chunks = [
      deltaChunk('hello'),
      {
        choices: [{ delta: { content: '' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          // no completion_tokens_details
        },
      },
    ];
    mockCreate = vi.fn().mockResolvedValue(makeStreamMock(chunks));

    let capturedUsage: { reasoningTokens: number | null } | undefined;
    await svc.streamChat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'gpt-4o',
      onChunk: () => undefined,
      onError: () => undefined,
      onDone: (u: TokenUsage) => { capturedUsage = u; },
    });

    expect(capturedUsage!.reasoningTokens).toBeNull();
  });

  it('returns reasoningTokens: null when reasoning_tokens field is undefined in details', async () => {
    const svc = makeService('https://api.openai.com/v1');
    const chunks = [
      deltaChunk('hello'),
      {
        choices: [{ delta: { content: '' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          completion_tokens_details: { /* reasoning_tokens omitted */ },
        },
      },
    ];
    mockCreate = vi.fn().mockResolvedValue(makeStreamMock(chunks));

    let capturedUsage: { reasoningTokens: number | null } | undefined;
    await svc.streamChat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'gpt-4o',
      onChunk: () => undefined,
      onError: () => undefined,
      onDone: (u: TokenUsage) => { capturedUsage = u; },
    });

    expect(capturedUsage!.reasoningTokens).toBeNull();
  });
});

// ── TC-U09: completeWithTools extracts reasoning tokens ─────────────────────

describe('AIProviderService — TC-U09: completeWithTools reasoning tokens', () => {
  it('extracts reasoningTokens from completion_tokens_details', async () => {
    const svc = makeService('https://api.openai.com/v1');
    mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'answer', tool_calls: null } }],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 80,
        total_tokens: 280,
        completion_tokens_details: { reasoning_tokens: 80 },
      },
    });

    const result = await svc.completeWithTools({
      messages: [{ role: 'user', content: 'test' }],
      model: 'gpt-4o',
      tools: [],
    });

    expect(result.usage.reasoningTokens).toBe(80);
    expect(result.usage.promptTokens).toBe(200);
    expect(result.usage.completionTokens).toBe(80);
  });

  it('returns reasoningTokens: null when completion_tokens_details is absent', async () => {
    const svc = makeService('https://api.openai.com/v1');
    mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'answer', tool_calls: null } }],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 80,
        total_tokens: 280,
        // no completion_tokens_details
      },
    });

    const result = await svc.completeWithTools({
      messages: [{ role: 'user', content: 'test' }],
      model: 'gpt-4o',
      tools: [],
    });

    expect(result.usage.reasoningTokens).toBeNull();
  });
});

// ── TC-U12: Reasoning probe — openRouterReasoningUnderExclude ──────────────
// Note: openRouterReasoningUnderExclude is a module-level `let` but ESM exports
// are live bindings (readonly in the consuming module). We can't directly set it
// from the outside, but we CAN observe its value after a streamChat call.
// We test that the FIRST call to streamChat on an OpenRouter base URL sets the probe.

describe('AIProviderService — TC-U12: openRouterReasoningUnderExclude passive probe', () => {
  beforeEach(async () => {
    // Reset the module by re-requiring — since vitest caches modules, we
    // test the probe behavior in isolation using fresh service instances
    vi.resetModules();
  });

  it('reasoning probe is observable after a streamChat call on OpenRouter', async () => {
    // Fresh import after reset
    const mod = await import('../AIProviderService.js?v=' + Date.now());
    const ServiceClass = mod.AIProviderService;

    const svc = new ServiceClass();
    svc.configure({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'test-model',
      authMethod: 'api_key',
    });

    const chunks = [
      deltaChunk('story content'),
      usageChunk({ promptTokens: 100, completionTokens: 50, totalTokens: 150, reasoningTokens: 50 }),
    ];
    mockCreate = vi.fn().mockResolvedValue(makeStreamMock(chunks));

    await svc.streamChat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'deepseek-v4-flash',
      onChunk: () => undefined,
      onError: () => undefined,
      onDone: () => undefined,
    });

    // The probe value is set after the call (observable via the module export)
    expect(mod.openRouterReasoningUnderExclude).not.toBeNull();
  });

  it('probe is set to true when reasoning_tokens is present in usage chunk', async () => {
    const mod = await import('../AIProviderService.js?v=' + (Date.now() + 1));
    const ServiceClass = mod.AIProviderService;
    const svc = new ServiceClass();
    svc.configure({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'test-model',
      authMethod: 'api_key',
    });

    const chunks = [
      { choices: [{ delta: { content: 'text' } }], usage: null },
      {
        choices: [{ delta: { content: '' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          completion_tokens_details: { reasoning_tokens: 50 },
        },
      },
    ];
    mockCreate = vi.fn().mockResolvedValue(makeStreamMock(chunks));

    let capturedUsage: { reasoningTokens: number | null } | undefined;
    await svc.streamChat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'deepseek-v4-flash',
      onChunk: () => undefined,
      onError: () => undefined,
      onDone: (u: TokenUsage) => { capturedUsage = u; },
    });

    expect(mod.openRouterReasoningUnderExclude).toBe(true);
    expect(capturedUsage!.reasoningTokens).toBe(50);
  });
});

// ── TC-U13: Story-generation reasoning null under exclude:true standard path ─

describe('AIProviderService — TC-U13: story-generation reasoningTokens null when no reasoning_tokens', () => {
  it('captures reasoningTokens: null (not 0) when no reasoning_tokens in chunk', async () => {
    const svc = makeService('https://openrouter.ai/api/v1');
    const chunks = [
      deltaChunk('story text'),
      {
        choices: [{ delta: { content: '' } }],
        usage: {
          prompt_tokens: 6400,
          completion_tokens: 1900,
          total_tokens: 8300,
          // no reasoning_tokens — standard exclude:true path with field absent
        },
      },
    ];
    mockCreate = vi.fn().mockResolvedValue(makeStreamMock(chunks));

    let capturedUsage: { reasoningTokens: number | null; promptTokens: number; completionTokens: number } | undefined;
    await svc.streamChat({
      messages: [{ role: 'user', content: 'generate story' }],
      model: 'deepseek-v4-flash',
      onChunk: () => undefined,
      onError: () => undefined,
      onDone: (u: TokenUsage) => { capturedUsage = u; },
    });

    // Must be null, not 0 — FR-001/FR-003 null fallback for absent reasoning field
    expect(capturedUsage!.reasoningTokens).toBeNull();
    expect(capturedUsage!.promptTokens).toBe(6400);
    expect(capturedUsage!.completionTokens).toBe(1900);
  });
});

// ── extractReasoningTokens helper — direct unit test ─────────────────────────

describe('extractReasoningTokens helper', () => {
  it('returns number when completion_tokens_details.reasoning_tokens is present', () => {
    const usage = {
      completion_tokens_details: { reasoning_tokens: 120 },
    };
    expect(extractReasoningTokens(usage)).toBe(120);
  });

  it('returns null when completion_tokens_details is absent', () => {
    expect(extractReasoningTokens({ prompt_tokens: 10 })).toBeNull();
  });

  it('returns null when reasoning_tokens is undefined', () => {
    expect(extractReasoningTokens({ completion_tokens_details: {} })).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(extractReasoningTokens(null)).toBeNull();
    expect(extractReasoningTokens(undefined)).toBeNull();
  });

  it('preserves 0 as a real value (not coerced to null)', () => {
    expect(extractReasoningTokens({ completion_tokens_details: { reasoning_tokens: 0 } })).toBe(0);
  });
});
