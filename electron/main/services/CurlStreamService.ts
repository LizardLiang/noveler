import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { TokenUsage, AIError, StreamChunk } from './AIProviderService.js';

const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

export interface CurlStreamOptions {
  messages: ChatCompletionMessageParam[];
  model: string;
  accessToken: string;
  accountId: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onChunk: (chunk: StreamChunk) => void;
  onError: (error: AIError) => void;
  onDone: (usage: TokenUsage) => void;
}

interface ResponsesInputMessage {
  role: string;
  content: string | Array<{ type: string; text: string }>;
}

function convertMessages(messages: ChatCompletionMessageParam[]): { instructions: string; input: ResponsesInputMessage[] } {
  let instructions = '';
  const input: ResponsesInputMessage[] = [];

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (msg.role === 'system') {
      instructions += (instructions ? '\n' : '') + content;
    } else if (msg.role === 'user') {
      input.push({ role: 'user', content: [{ type: 'input_text', text: content }] });
    } else if (msg.role === 'assistant') {
      input.push({ role: 'assistant', content: [{ type: 'output_text', text: content }] });
    }
  }

  if (!instructions) instructions = 'You are a helpful assistant.';

  return { instructions, input };
}

function parseSseLines(raw: string): Array<{ type: string; data: Record<string, unknown> }> {
  const results: Array<{ type: string; data: Record<string, unknown> }> = [];
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;
    let dataStr = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) dataStr = line.slice(6);
    }
    if (!dataStr || dataStr === '[DONE]') continue;
    try {
      const parsed = JSON.parse(dataStr) as Record<string, unknown>;
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      results.push({ type, data: parsed });
    } catch { /* skip */ }
  }
  return results;
}

export async function curlStream(options: CurlStreamOptions): Promise<void> {
  const sessionId = crypto.randomUUID();
  const { instructions, input } = convertMessages(options.messages);
  const body = JSON.stringify({
    model: options.model,
    instructions,
    input,
    stream: true,
    store: false,
    ...(options.maxOutputTokens != null ? { max_output_tokens: options.maxOutputTokens } : {}),
  });

  return new Promise<void>((resolve) => {
    const args = [
      '-N', '-s', '-S',
      '--max-time', '300',
      '-X', 'POST',
      CODEX_ENDPOINT,
      '-H', `Authorization: Bearer ${options.accessToken}`,
      '-H', 'Content-Type: application/json',
      '-H', `ChatGPT-Account-Id: ${options.accountId}`,
      '-H', 'originator: opencode',
      '-H', `User-Agent: noveler/1.0.0 (${process.platform} ${process.arch})`,
      '-H', `session-id: ${sessionId}`,
      '-d', body,
    ];

    const curl = spawn('curl', args);
    let buffer = '';
    let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: null };
    let errored = false;
    let stderrOutput = '';

    if (options.signal) {
      const onAbort = () => {
        curl.kill('SIGTERM');
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      curl.on('close', () => options.signal!.removeEventListener('abort', onAbort));
    }

    curl.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // Only parse complete SSE blocks (ending with double newline)
      const lastDoubleNewline = buffer.lastIndexOf('\n\n');
      if (lastDoubleNewline === -1) return;
      const complete = buffer.slice(0, lastDoubleNewline + 2);
      buffer = buffer.slice(lastDoubleNewline + 2);

      const events = parseSseLines(complete);
      for (const evt of events) {
        if (evt.type === 'response.output_text.delta') {
          const delta = evt.data.delta as string;
          if (delta) {
            options.onChunk({ delta, done: false });
          }
        } else if (evt.type === 'response.completed') {
          const resp = evt.data.response as Record<string, unknown>;
          const u = resp?.usage as Record<string, unknown> | undefined;
          if (u) {
            const rd = u.output_tokens_details as { reasoning_tokens?: number } | undefined;
            usage = {
              promptTokens: (u.input_tokens as number) ?? 0,
              completionTokens: (u.output_tokens as number) ?? 0,
              totalTokens: (u.total_tokens as number) ?? 0,
              reasoningTokens: typeof rd?.reasoning_tokens === 'number' ? rd.reasoning_tokens : null,
            };
          }
        } else if (evt.type === 'response.failed' || evt.type === 'response.incomplete') {
          errored = true;
          const resp = evt.data.response as Record<string, unknown>;
          const error = resp?.error as Record<string, string> | undefined;
          const incomplete = resp?.incomplete_details as Record<string, string> | undefined;
          options.onError({
            code: 'UNKNOWN',
            message: error?.message ?? (incomplete?.reason ? `模型輸出未完成：${incomplete.reason}` : '生成失敗'),
          });
        }
      }
    });

    curl.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString('utf-8');
    });

    curl.on('close', (code) => {
      if (options.signal?.aborted) {
        options.onChunk({ delta: '', done: true });
        options.onDone({ promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: null });
        resolve();
        return;
      }

      if (code !== 0 && !errored) {
        // Check if the output contains HTML (Cloudflare challenge)
        if (stderrOutput.includes('403') || stderrOutput.includes('cf_chl_opt') || buffer.includes('cf_chl_opt') || buffer.includes('Enable JavaScript')) {
          options.onError({
            code: 'NETWORK_ERROR',
            message: 'Cloudflare 攔截了請求。請確認 curl 版本支援 TLS 1.3，或嘗試更新 curl。',
          });
        } else {
          options.onError({
            code: 'NETWORK_ERROR',
            message: `curl 執行失敗 (exit ${code}): ${stderrOutput.slice(0, 200)}`,
          });
        }
        resolve();
        return;
      }

      if (!errored) {
        options.onChunk({ delta: '', done: true });
        options.onDone(usage);
      }
      resolve();
    });

    curl.on('error', (err) => {
      if (!errored) {
        errored = true;
        options.onError({
          code: 'NETWORK_ERROR',
          message: `無法執行 curl：${err.message}。請確認系統已安裝 curl。`,
        });
      }
      resolve();
    });
  });
}

/**
 * Non-streaming completion over the same Codex endpoint — accumulates the
 * streamed deltas and returns the full text plus usage. Throws on stream error.
 * Abort path: throws before returning (abort=omit invariant — no usage surfaced).
 */
export async function curlComplete(options: {
  messages: ChatCompletionMessageParam[];
  model: string;
  accessToken: string;
  accountId: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: TokenUsage | null }> {
  let text = '';
  let usage: TokenUsage | null = null;
  let error: AIError | null = null;
  await curlStream({
    ...options,
    onChunk: (chunk) => {
      if (!chunk.done && chunk.delta) text += chunk.delta;
    },
    onError: (err) => {
      error = err;
    },
    onDone: (u) => { usage = u; },
  });
  if (error) throw new Error((error as AIError).message);
  // If the signal was aborted (e.g. dialogue-pass timeout), the stream resolved
  // cleanly via the abort branch but the accumulated text is partial. Reject so
  // callers (curlComplete consumers such as refineDialogue) fail closed and keep
  // the original draft rather than adopting a truncated result.
  // NOTE: curlStream itself is NOT changed — its streaming contract for the
  // story-generation cancel path (ai:cancel) is preserved. Only this blocking
  // wrapper rejects on abort.
  if (options.signal?.aborted) {
    throw new Error('AbortError: stream was aborted');
  }
  return { text, usage };
}

export async function curlTestConnection(
  accessToken: string,
  accountId: string,
  model: string,
): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const sessionId = crypto.randomUUID();
    const body = JSON.stringify({
      model,
      instructions: 'You are a helpful assistant.',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
      stream: true,
      store: false,
    });

    const args = [
      '-s', '-S',
      '--max-time', '30',
      '-w', '\n%{http_code}',
      '-X', 'POST',
      CODEX_ENDPOINT,
      '-H', `Authorization: Bearer ${accessToken}`,
      '-H', 'Content-Type: application/json',
      '-H', `ChatGPT-Account-Id: ${accountId}`,
      '-H', 'originator: opencode',
      '-H', `User-Agent: noveler/1.0.0 (${process.platform} ${process.arch})`,
      '-H', `session-id: ${sessionId}`,
      '-d', body,
    ];

    const curl = spawn('curl', args);
    let output = '';
    let stderrOut = '';

    curl.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf-8'); });
    curl.stderr.on('data', (chunk: Buffer) => { stderrOut += chunk.toString('utf-8'); });

    curl.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, message: `curl 失敗 (exit ${code}): ${stderrOut.slice(0, 200)}` });
        return;
      }

      if (output.includes('response.completed')) {
        resolve({ success: true, message: '連線成功' });
      } else if (output.includes('response.failed')) {
        resolve({ success: false, message: '連線失敗：模型回應錯誤' });
      } else if (output.includes('cf_chl_opt') || output.includes('Enable JavaScript')) {
        resolve({ success: false, message: 'Cloudflare 攔截。請嘗試更新系統的 curl 版本。' });
      } else if (output.includes('"detail"')) {
        resolve({ success: false, message: output.slice(0, 300) });
      } else {
        resolve({ success: false, message: `未知回應：${output.slice(0, 300)}` });
      }
    });

    curl.on('error', (err) => {
      resolve({ success: false, message: `無法執行 curl：${err.message}` });
    });
  });
}
