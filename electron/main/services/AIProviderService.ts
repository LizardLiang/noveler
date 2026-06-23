import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions.js';

export interface StreamChunk {
  delta: string;
  done: boolean;
  /** True when this delta is the model's reasoning/thinking, not story content. */
  reasoning?: boolean;
}

export interface AIStreamOptions {
  messages: ChatCompletionMessageParam[];
  model: string;
  temperature?: number;
  signal?: AbortSignal;
  onChunk: (chunk: StreamChunk) => void;
  onError: (error: AIError) => void;
  onDone: (usage: TokenUsage) => void;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIError {
  code: 'AUTH_ERROR' | 'RATE_LIMIT' | 'MODEL_NOT_FOUND' | 'NETWORK_ERROR' | 'UNKNOWN';
  message: string;
  status?: number;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  authMethod?: 'api_key' | 'oauth';
  accountId?: string;
}

export interface OAuthProviderConfig {
  accessToken: string;
  defaultModel: string;
  accountId: string;
}

// Map of common model context window sizes (tokens)
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  'claude-3-5-sonnet': 200000,
  'claude-3-5-haiku': 200000,
  'anthropic/claude-sonnet-4': 200000,
  'anthropic/claude-3.5-sonnet': 200000,
  'meta/llama-3.1-70b-instruct': 128000,
  'meta/llama-3.1-8b-instruct': 128000,
  'mistralai/mixtral-8x7b-instruct': 32768,
};

const DEFAULT_CONTEXT_WINDOW = 32000;

export function getContextWindowSize(model: string): number {
  // Exact match
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];
  // Partial match
  for (const [key, size] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.includes(key) || key.includes(model)) return size;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

class AIProviderService {
  private client: OpenAI | null = null;
  private currentConfig: ProviderConfig | null = null;

  configure(config: ProviderConfig): void {
    this.currentConfig = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': 'https://noveler.app',
        'X-Title': 'Noveler',
      },
    });
  }

  getClient(): OpenAI | null {
    return this.client;
  }

  getCurrentConfig(): ProviderConfig | null {
    return this.currentConfig;
  }

  async completeWithTools(options: {
    messages: ChatCompletionMessageParam[];
    model: string;
    tools: ChatCompletionTool[];
    signal?: AbortSignal;
  }): Promise<{
    content: string | null;
    toolCalls: Array<{
      id: string;
      function: { name: string; arguments: string };
    }> | null;
    usage: TokenUsage;
  }> {
    if (!this.client || !this.currentConfig) {
      throw new Error('尚未設定 AI 供應商');
    }

    const response = await this.client.chat.completions.create({
      model: options.model || this.currentConfig.defaultModel,
      messages: options.messages,
      tools: options.tools,
      tool_choice: 'auto',
    }, {
      signal: options.signal,
    });

    const choice = response.choices[0];
    const usage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    const toolCalls = choice.message.tool_calls
      ?.filter(tc => tc.type === 'function')
      .map(tc => ({
        id: tc.id,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));

    return {
      content: choice.message.content,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : null,
      usage,
    };
  }

  async streamChat(options: AIStreamOptions): Promise<void> {
    if (!this.client || !this.currentConfig) {
      options.onError({
        code: 'UNKNOWN',
        message: '尚未設定 AI 供應商',
      });
      return;
    }

    try {
      // Hybrid-reasoning models on OpenRouter (e.g. deepseek-v4-flash) stream
      // narrative into the `reasoning` field. We route reasoning to a display-only
      // "thinking" channel that is never saved, so any story prose the model emits
      // there is lost and the saved paragraph comes back short.
      //
      // `reasoning.enabled: false` tries to turn reasoning off entirely, but many
      // models ignore it and keep reasoning anyway — the thinking box still fills
      // with leaked story prose. `reasoning.exclude: true` is universally supported
      // ("All models support this" per OpenRouter docs): the model still reasons
      // internally (preserving quality) but the reasoning tokens are NEVER returned
      // on the stream, so nothing leaks into the thinking channel and the full
      // narrative lands in `content`. Other providers ignore the param via the guard.
      const isOpenRouter = (this.currentConfig.baseUrl || '').includes('openrouter.ai');
      const stream = await this.client.chat.completions.create({
        model: options.model || this.currentConfig.defaultModel,
        messages: options.messages,
        ...(options.temperature != null ? { temperature: options.temperature } : {}),
        ...(isOpenRouter ? { reasoning: { exclude: true } } : {}),
        stream: true,
        stream_options: { include_usage: true },
      } as Parameters<typeof this.client.chat.completions.create>[0], {
        signal: options.signal,
      });

      let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      for await (const chunk of stream) {
        // Thinking models split output into delta.content (the answer/story) and
        // delta.reasoning_content (the thinking). Content is the saved story;
        // reasoning is streamed on a separate channel for the UI's thinking box
        // only — never merged into the story.
        const delta = chunk.choices[0]?.delta as
          | { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
          | undefined;
        const content = delta?.content ?? '';
        if (content) {
          options.onChunk({ delta: content, done: false });
        } else {
          const reasoning = delta?.reasoning_content ?? delta?.reasoning ?? '';
          if (reasoning) {
            options.onChunk({ delta: reasoning, done: false, reasoning: true });
          }
        }
        // Capture usage from last chunk (stream_options.include_usage)
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }

      options.onChunk({ delta: '', done: true });
      options.onDone(usage);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Cancelled — send done without error
        options.onChunk({ delta: '', done: true });
        options.onDone({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        return;
      }

      const aiError = this.classifyError(err);
      options.onError(aiError);
    }
  }

  async testConnection(model: string): Promise<{ success: boolean; message: string }> {
    if (!this.client) {
      return { success: false, message: '尚未設定 AI 供應商' };
    }

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      });

      if (response.choices.length > 0) {
        return { success: true, message: '連線成功' };
      }
      return { success: false, message: '無效的回應' };
    } catch (err) {
      const aiError = this.classifyError(err);
      return { success: false, message: aiError.message };
    }
  }

  private classifyError(err: unknown): AIError {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) {
        return { code: 'AUTH_ERROR', message: 'API 金鑰無效（401）', status: 401 };
      }
      if (err.status === 402 || err.status === 429) {
        return { code: 'RATE_LIMIT', message: '已超出使用限額或速率限制', status: err.status };
      }
      if (err.status === 404) {
        return { code: 'MODEL_NOT_FOUND', message: '找不到指定的模型', status: 404 };
      }
      return { code: 'UNKNOWN', message: err.message, status: err.status };
    }
    if (err instanceof Error) {
      if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND') || err.message.includes('fetch')) {
        return { code: 'NETWORK_ERROR', message: '無法連線至 AI 供應商，請檢查網路' };
      }
      return { code: 'UNKNOWN', message: err.message };
    }
    return { code: 'UNKNOWN', message: '發生未知錯誤' };
  }
}

let instance: AIProviderService | null = null;

export function getAIProviderService(): AIProviderService {
  if (!instance) {
    instance = new AIProviderService();
  }
  return instance;
}

export { AIProviderService };
