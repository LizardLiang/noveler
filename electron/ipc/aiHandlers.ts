import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import { getAIProviderService } from '../main/services/AIProviderService.js';
import { getContextManager } from '../main/services/ContextManager.js';
import { getParagraphService } from '../main/services/ParagraphService.js';
import { getWorldChangeParser } from '../main/services/WorldChangeParser.js';
import { getWorldMemoryService } from '../main/services/WorldMemoryService.js';
import { getGlobalDatabase } from '../main/services/database.js';
import { getCryptoService } from '../main/services/CryptoService.js';
import { getOAuthService } from '../main/services/OAuthService.js';
import { curlStream, curlComplete, curlTestConnection } from '../main/services/CurlStreamService.js';
import { ollamaChatStream, ollamaChatComplete, computeNumCtx } from '../main/services/OllamaNativeService.js';
import type { OAuthTokens } from '../shared/types.js';
import { getProjectStoragePath, getOpenProject } from './projectHandlers.js';
import { refineDialogue, containsDialogue, getDialogueEditorSettings } from '../main/services/DialogueEditorService.js';
import type { CharacterForRoster, DialogueEditorSettings } from '../main/services/DialogueEditorService.js';
import {
  WORLD_MEMORY_TOOLS,
  executeWorldMemoryQuery,
  buildWorldDirectory,
} from '../main/services/WorldMemoryTools.js';
import type { QueryWorldMemoryArgs } from '../main/services/WorldMemoryTools.js';
import { applyWorldChange } from './worldMemoryHandlers.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { IpcResult } from '../shared/types.js';
import type { GenerateRequest, StreamCompletePayload, ContextBudgetPayload, SuggestionsRequest, SuggestionsResponse } from '../shared/types.js';

// Track active generation controllers per project
const activeControllers = new Map<string, AbortController>();

// Generation-token write guard (FR-D013): per-projectId monotonic counter.
// Incremented at each handler entry; re-read before adopting refined text.
// Never deleted — overwritten on next generation (monotonically increasing, no leak).
const generationTokens = new Map<string, number>();

// Last computed budget (updated after each generation)
let lastBudgetPayload: ContextBudgetPayload | null = null;

/**
 * Read writing style from project_settings and return as hint string.
 */
function getWritingStyleHints(projectId: string): string {
  try {
    const projectDb = getOpenProject(projectId);
    if (!projectDb) return '';
    const styleRow = projectDb.prepare(
      "SELECT value FROM project_settings WHERE key='writing_style'",
    ).get() as { value: string } | undefined;
    if (!styleRow) return '';
    const style = JSON.parse(String(styleRow.value)) as Record<string, string>;
    const hints: string[] = [];
    if (style.perspective) hints.push(`敘事視角：${style.perspective}`);
    if (style.tone) hints.push(`語氣：${style.tone}`);
    if (style.detailLevel) hints.push(`描寫細膩度：${style.detailLevel}`);
    if (style.languageStyle) hints.push(`語言風格：${style.languageStyle}`);
    return hints.join('\n');
  } catch {
    return '';
  }
}

/**
 * Read custom instructions from project_settings (formerly "system_prompt").
 */
function getCustomInstructions(projectId: string): string {
  try {
    const projectDb = getOpenProject(projectId);
    if (!projectDb) return '';
    const row = projectDb.prepare(
      "SELECT value FROM project_settings WHERE key='system_prompt'",
    ).get() as { value: string } | undefined;
    if (!row) return '';
    return JSON.parse(String(row.value)) as string;
  } catch {
    return '';
  }
}

/**
 * Read the project's world rules (世界規則) from project_settings.
 * Injected into the system prompt as the highest-priority, must-not-break world setting.
 */
function getWorldRules(projectId: string): string {
  try {
    const projectDb = getOpenProject(projectId);
    if (!projectDb) return '';
    const row = projectDb.prepare(
      "SELECT value FROM project_settings WHERE key='world_rules'",
    ).get() as { value: string } | undefined;
    if (!row) return '';
    return JSON.parse(String(row.value)) as string;
  } catch {
    return '';
  }
}

/**
 * Build world memory summary with smart filtering.
 * Active characters (mentioned in recentText) get full details,
 * others get a directory listing only.
 */
function buildWorldMemorySummary(
  worldMemoryService: ReturnType<typeof getWorldMemoryService>,
  projectId: string,
  branchId: string,
  recentText: string,
): string {
  try {
    const projectDb = getOpenProject(projectId);
    if (!projectDb) return '';
    return worldMemoryService.buildSmartSummary(projectDb, projectId, branchId, recentText);
  } catch {
    return '';
  }
}

function buildBudgetPayload(assembled: import('../main/services/ContextManager.js').AssembledContext): ContextBudgetPayload {
  const totalUsed = assembled.used.system + assembled.used.worldMemory + assembled.used.storyHistory + assembled.used.userInput;
  const percentage = assembled.budget.totalTokens > 0
    ? Math.round((totalUsed / assembled.budget.totalTokens) * 100)
    : 0;
  const payload: ContextBudgetPayload = {
    totalTokens: assembled.budget.totalTokens,
    used: assembled.used,
    budget: {
      system: assembled.budget.system,
      worldMemory: assembled.budget.worldMemory,
      storyHistory: assembled.budget.storyHistory,
      userInput: assembled.budget.userInput,
    },
    percentage,
  };
  lastBudgetPayload = payload;
  return payload;
}

// Story generation runs hot for livelier prose; world-change extraction runs cold for reliable JSON
const STORY_TEMPERATURE = 0.9;

const WORLD_CHANGE_EXTRACTION_PROMPT = `你是世界狀態追蹤器。閱讀使用者提供的小說段落，找出值得記錄的世界狀態變更，並只輸出一個合法的 JSON 物件，不要輸出任何其他文字或說明。

格式：
{
  "changes": [
    { "type": "new_character", "data": { "name": "角色名稱", "appearance": "外觀（可選）", "personality": "性格（可選）", "voiceStyle": "說話方式與口頭禪（可選）", "faction": "陣營（可選）" } },
    { "type": "update_character", "data": { "name": "角色名稱", "updates": { "status": "新狀態", "personality": "更新後性格", "voiceStyle": "更新後說話方式" } } },
    { "type": "new_relationship", "data": { "characterA": "角色A名稱", "characterB": "角色B名稱", "type": "關係類型", "affinityChange": 10, "description": "描述（可選）" } },
    { "type": "update_relationship", "data": { "characterA": "角色A名稱", "characterB": "角色B名稱", "affinityChange": -5, "description": "描述（可選）" } },
    { "type": "new_event", "data": { "name": "事件名稱", "description": "事件描述", "participatingCharacters": ["角色名稱1"], "impact": "影響（可選）" } }
  ]
}

規則：
- 只記錄段落中實際發生的變更：新角色登場、角色資訊更新、關係建立或變化、重大事件
- 「已知角色」名單中的角色使用 update_character，名單外的才用 new_character
- 新角色若有獨特的說話方式（口頭禪、語氣、用詞習慣），記錄在 voiceStyle
- 沒有任何值得記錄的變更時，輸出 {"changes": []}`;

/**
 * Second pass after story generation: extract world changes from the finished
 * story text with a cheap low-temperature call, so the main generation prompt
 * stays pure prose. Best-effort — returns null on any failure.
 */
async function extractWorldChanges(
  aiService: ReturnType<typeof getAIProviderService>,
  providerConfig: { apiKey: string; baseUrl: string; defaultModel: string; authMethod?: 'api_key' | 'oauth'; accountId?: string; isOllama?: boolean },
  model: string,
  storyText: string,
  knownCharacterNames: string[],
): Promise<import('../main/services/WorldChangeParser.js').WorldChangeParseResult | null> {
  try {
    const known = knownCharacterNames.length > 0 ? knownCharacterNames.join('、') : '（無）';
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: WORLD_CHANGE_EXTRACTION_PROMPT },
      { role: 'user', content: `已知角色：${known}\n\n小說段落：\n${storyText}` },
    ];

    let text = '';
    if (providerConfig.authMethod === 'oauth' && providerConfig.accountId) {
      text = await curlComplete({
        messages,
        model,
        accessToken: providerConfig.apiKey,
        accountId: providerConfig.accountId,
      });
    } else if (providerConfig.isOllama) {
      text = await ollamaChatComplete({
        baseUrl: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
        messages,
        model,
        temperature: 0.2,
        maxTokens: 1500,
      });
    } else {
      const client = aiService.getClient();
      if (!client) return null;
      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: 1500,
        temperature: 0.2,
      });
      text = response.choices[0]?.message?.content ?? '';
    }

    if (!text.trim()) return null;
    return getWorldChangeParser().parse(`---WORLD_CHANGES---\n${text}`);
  } catch {
    return null;
  }
}

// True when generation should use Ollama's native /api/chat (so we can raise num_ctx):
// Ollama direct (type 'ollama' or :11434) AND Open WebUI (type 'openwebui' or a
// Base URL ending in /api, which proxies Ollama under /ollama).
function isOllamaProvider(providerType: string, baseUrl: string): boolean {
  return (
    providerType === 'ollama' ||
    providerType === 'openwebui' ||
    baseUrl.includes(':11434') ||
    /\/api\/?$/.test(baseUrl)
  );
}

function getActiveProvider(): { apiKey: string; baseUrl: string; defaultModel: string; authMethod?: 'api_key' | 'oauth'; accountId?: string; isOllama?: boolean } | null {
  try {
    const db = getGlobalDatabase();
    const row = db.prepare(
      'SELECT api_key_encrypted, base_url, default_model, auth_method, provider_type FROM ai_providers WHERE is_active=1 LIMIT 1',
    ).get() as { api_key_encrypted: string; base_url: string; default_model: string; auth_method: string; provider_type: string } | undefined;

    if (!row) return null;

    const encrypted = Buffer.from(String(row.api_key_encrypted), 'base64');
    const decrypted = getCryptoService().decrypt(encrypted);
    const authMethod = String(row.auth_method) || 'api_key';

    if (authMethod === 'oauth') {
      const tokens = JSON.parse(decrypted) as OAuthTokens;
      return {
        apiKey: tokens.access_token,
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: String(row.default_model),
        authMethod: 'oauth',
        accountId: tokens.account_id,
      };
    }

    return {
      apiKey: decrypted,
      baseUrl: String(row.base_url),
      defaultModel: String(row.default_model),
      authMethod: 'api_key',
      // Ollama's native /api/chat is used for generation so we can raise num_ctx.
      // Detect by provider type OR the default Ollama port (handles a provider
      // whose Base URL was pointed at :11434 but whose type wasn't changed).
      isOllama: isOllamaProvider(String(row.provider_type), String(row.base_url)),
    };
  } catch {
    return null;
  }
}

async function ensureFreshOAuthToken(): Promise<void> {
  try {
    const db = getGlobalDatabase();
    const row = db.prepare(
      'SELECT id, api_key_encrypted, auth_method FROM ai_providers WHERE is_active=1 LIMIT 1',
    ).get() as { id: string; api_key_encrypted: string; auth_method: string } | undefined;

    if (!row || String(row.auth_method) !== 'oauth') return;

    const encrypted = Buffer.from(String(row.api_key_encrypted), 'base64');
    const decrypted = getCryptoService().decrypt(encrypted);
    const tokens = JSON.parse(decrypted) as OAuthTokens & { email?: string };

    const oauthService = getOAuthService();
    if (!oauthService.isExpired(tokens)) return;

    const refreshed = await oauthService.refreshToken(tokens.refresh_token);
    const updatedBlob = JSON.stringify({ ...refreshed, email: tokens.email });
    const newEncrypted = getCryptoService().encrypt(updatedBlob).toString('base64');
    db.prepare('UPDATE ai_providers SET api_key_encrypted=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(newEncrypted, String(row.id));
  } catch {
    // Refresh failed — the next API call will get a 401 and the user will need to re-auth
  }
}

// M-001: Max wall-clock time for the dialogue-pass LLM call.
// The streaming controller is deleted before the pass runs, so its signal is
// always undefined. A dedicated short-lived AbortController with this timeout
// caps the pass regardless of curl --max-time (300 s default).
// Plain cloud SDK models are fast (12 s). Slow paths get a longer cap:
//   - local models (Ollama/Open WebUI) are slow, especially right after a
//     large-context generation;
//   - the OAuth/Codex path routes through reasoning models (e.g. gpt-5.5) that
//     spend seconds "thinking" before emitting any output, so 12 s reliably
//     aborts a legitimate refine mid-stream.
const DIALOGUE_REFINE_TIMEOUT_MS = 12_000;
const DIALOGUE_REFINE_TIMEOUT_MS_LOCAL = 90_000;

/**
 * W2: Shared dialogue-editor pass block, extracted from the generate and
 * regenerate handlers (previously ~34 lines of ~95%-identical code at each site).
 *
 * Runs the dialogue refinement pass with a dedicated 12 s AbortController
 * (M-001). Emits dialogue_refining indicator chunks. Re-checks the generation
 * token before adopting the refined text (FR-D013). Emits dialogue_refine_failed
 * when the pass fails while enabled (W3 / FR-D012).
 *
 * Returns the text to write (refined if adopted, original otherwise) and a flag
 * indicating whether a failure notification should be surfaced to the renderer.
 *
 * IMPORTANT: The token re-read is done synchronously immediately before the
 * conditional assignment — no `await` between the guard check and the write.
 */
async function runDialoguePass(
  event: IpcMainInvokeEvent,
  paragraphId: string,
  storyText: string,
  characters: CharacterForRoster[],
  settings: DialogueEditorSettings,
  aiService: ReturnType<typeof getAIProviderService>,
  providerConfig: { apiKey: string; baseUrl: string; defaultModel: string; authMethod?: 'api_key' | 'oauth'; accountId?: string; isOllama?: boolean },
  model: string,
  projectId: string,
  myToken: number,
): Promise<{ adoptedText: string; refineFailedNotify: boolean }> {
  // M-001: dedicated AbortController with fixed timeout for the dialogue pass.
  // Slow paths (local models + OAuth/Codex reasoning models) get a longer cap;
  // plain cloud SDK models stay at 12 s.
  const isSlowPath = providerConfig.isOllama || providerConfig.authMethod === 'oauth';
  const refineTimeoutMs = isSlowPath ? DIALOGUE_REFINE_TIMEOUT_MS_LOCAL : DIALOGUE_REFINE_TIMEOUT_MS;
  const passController = new AbortController();
  const passTimer = setTimeout(() => passController.abort(), refineTimeoutMs);

  let adoptedText = storyText;
  let refineFailedNotify = false;

  try {
    event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
      paragraphId,
      delta: '',
      done: false,
      type: 'dialogue_refining',
      meta: { refining: true },
    });

    const refined = await refineDialogue({
      aiService,
      providerConfig,
      model,
      storyText,
      characters,
      mode: settings.mode,
      signal: passController.signal,
    });

    // Generation-token write guard — synchronous read immediately before the
    // conditional assignment, no await in between (FR-D013).
    const stillCurrent = generationTokens.get(projectId) === myToken;
    if (refined && stillCurrent) {
      adoptedText = refined;
    } else if (refined === null) {
      // Hard failure OR refine timeout — both are FR-D012 failure cases that must notify.
      // Supersede is handled silently above by the stillCurrent guard; this dedicated
      // passController aborts ONLY via the refineTimeoutMs timer
      // (never via ai:cancel or token-supersede), so signal.aborted === true means
      // exactly "timeout", which FR-D012 explicitly requires to surface a notification.
      refineFailedNotify = true;
    }
  } finally {
    clearTimeout(passTimer);
    event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
      paragraphId,
      delta: '',
      done: false,
      type: 'dialogue_refining',
      meta: { refining: false },
    });
    if (refineFailedNotify) {
      event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
        paragraphId,
        delta: '',
        done: false,
        type: 'dialogue_refine_failed',
        meta: {},
      });
    }
  }

  return { adoptedText, refineFailedNotify };
}

export function registerAIHandlers(): void {
  const aiService = getAIProviderService();
  const contextManager = getContextManager();
  const paragraphService = getParagraphService();
  const worldChangeParser = getWorldChangeParser();
  const worldMemoryService = getWorldMemoryService();

  // ai:generate — receives prompt + context, starts streaming
  ipcMain.handle(
    IPC_CHANNELS.AI_GENERATE,
    async (event: IpcMainInvokeEvent, req: GenerateRequest): Promise<IpcResult<{ paragraphId: string }>> => {
      try {
        // Refresh OAuth token if needed
        await ensureFreshOAuthToken();

        // Get active provider config
        const providerConfig = getActiveProvider();
        if (!providerConfig) {
          return {
            success: false,
            error: { code: 'NO_PROVIDER', message: '尚未設定 AI 供應商，請先在設定中新增供應商' },
          };
        }

        // Configure AI service
        aiService.configure(providerConfig);

        const projectPath = getProjectStoragePath(req.projectId);
        if (!projectPath) {
          return {
            success: false,
            error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' },
          };
        }

        const model = req.modelOverride || providerConfig.defaultModel;

        const projectDb = getOpenProject(req.projectId);
        if (!projectDb) {
          return {
            success: false,
            error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' },
          };
        }

        // Ensure main branch exists and get its ID
        const branchId = paragraphService.getOrCreateMainBranch(projectDb, projectPath, req.projectId);

        // Get actual branchId if request supplies one, otherwise use main
        const effectiveBranchId = req.branchId || branchId;

        // Create user paragraph
        const userParagraph = paragraphService.createParagraph(projectDb, {
          projectPath,
          projectId: req.projectId,
          branchId: effectiveBranchId,
          type: 'user',
          content: req.userMessage,
        });

        // Notify renderer of user paragraph created
        event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
          paragraphId: userParagraph.id,
          delta: '',
          done: true,
          type: 'user_paragraph_created',
          meta: { ...userParagraph, content: req.userMessage },
        });

        // Build context: load story history
        const allParagraphs = paragraphService.listParagraphs(projectDb, effectiveBranchId);

        // Load content for paragraphs (excluding the just-created user paragraph)
        const historyContext = [];
        for (const para of allParagraphs) {
          if (para.id === userParagraph.id) continue;
          if (para.status === 'detached') continue;
          const content = paragraphService.getParagraphContent(projectDb, projectPath, effectiveBranchId, para.id);
          if (content) {
            historyContext.push({ paragraphId: para.id, type: para.type, content });
          }
        }

        // Build world directory for tool-use flow
        const worldDirectory = buildWorldDirectory(
          worldMemoryService, projectDb, req.projectId, effectiveBranchId,
        );

        // Extract recent text for smart world memory filtering (fallback)
        const recentText = historyContext
          .slice(-6)
          .map(h => h.content)
          .join('\n');

        // When tools are available, world memory comes via tool calls.
        // When tools fail (unsupported provider), fall back to smart summary.
        const worldMemorySummary = buildWorldMemorySummary(
          worldMemoryService, req.projectId, effectiveBranchId, recentText,
        );

        // Ollama goes through the native /api/chat path (to raise num_ctx); it does
        // not use the OpenAI tools preflight, so feed it the smart summary directly.
        const useTools = !!worldDirectory && !providerConfig.isOllama;

        // Assemble context with structured prompt
        const assembled = contextManager.assemblePrompt({
          model,
          systemPrompt: '',
          customInstructions: getCustomInstructions(req.projectId),
          worldRules: getWorldRules(req.projectId),
          writingStyleHints: getWritingStyleHints(req.projectId),
          worldDirectory: useTools ? worldDirectory : '',
          worldMemorySummary: useTools ? '' : worldMemorySummary,
          storyHistory: historyContext,
          userInput: req.userMessage,
        });

        // Create AI paragraph (placeholder, will be updated on stream end)
        const aiParagraph = paragraphService.createParagraph(projectDb, {
          projectPath,
          projectId: req.projectId,
          branchId: effectiveBranchId,
          type: 'ai',
          content: '',
          modelUsed: model,
        });

        // Update status to generating
        paragraphService.updateStatus(projectDb, aiParagraph.id, 'generating');

        // Notify renderer stream started
        event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
          paragraphId: aiParagraph.id,
          delta: '',
          done: false,
          type: 'ai_paragraph_created',
          meta: { ...aiParagraph, status: 'generating' },
        });

        // Set up abort controller + generation-token write guard (FR-D013)
        const controller = new AbortController();
        const myToken = (generationTokens.get(req.projectId) ?? 0) + 1;
        generationTokens.set(req.projectId, myToken);
        activeControllers.set(req.projectId, controller);

        // Preflight: let AI query world memory via tools if data exists
        let finalMessages: ChatCompletionMessageParam[] = assembled.messages;
        if (useTools) {
          try {
            const preflight = await aiService.completeWithTools({
              messages: assembled.messages,
              model,
              tools: WORLD_MEMORY_TOOLS,
              signal: controller.signal,
            });

            if (preflight.toolCalls) {
              const toolMessages: ChatCompletionMessageParam[] = [
                {
                  role: 'assistant',
                  content: preflight.content ?? null,
                  tool_calls: preflight.toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: tc.function,
                  })),
                },
              ];

              for (const tc of preflight.toolCalls) {
                let result = '（未知工具）';
                if (tc.function.name === 'query_world_memory') {
                  try {
                    const args = JSON.parse(tc.function.arguments) as QueryWorldMemoryArgs;
                    result = executeWorldMemoryQuery(
                      worldMemoryService, projectDb, req.projectId, effectiveBranchId, args,
                    );
                  } catch {
                    result = '（參數解析失敗）';
                  }
                }
                toolMessages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: result,
                });
              }

              finalMessages = [...assembled.messages, ...toolMessages];
            }
          } catch (toolErr) {
            // Provider doesn't support tools — fall back to smart summary
            console.warn('[ai:generate] tool preflight failed, falling back to summary', toolErr instanceof Error ? toolErr.message : toolErr);
            const fallbackAssembled = contextManager.assemblePrompt({
              model,
              systemPrompt: '',
              customInstructions: getCustomInstructions(req.projectId),
              worldRules: getWorldRules(req.projectId),
              writingStyleHints: getWritingStyleHints(req.projectId),
              worldDirectory: '',
              worldMemorySummary,
              storyHistory: historyContext,
              userInput: req.userMessage,
            });
            finalMessages = fallbackAssembled.messages;
          }
        }

        let fullText = '';
        let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        let streamErrored = false;

        const streamCallbacks = {
          onChunk: (chunk: { delta: string; done: boolean; reasoning?: boolean }) => {
            if (chunk.done || !chunk.delta) return;
            if (chunk.reasoning) {
              // Thinking-model reasoning — separate channel, not part of the saved story.
              event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
                paragraphId: aiParagraph.id,
                delta: chunk.delta,
                done: false,
                type: 'reasoning',
              });
              return;
            }
            fullText += chunk.delta;
            event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
              paragraphId: aiParagraph.id,
              delta: chunk.delta,
              done: false,
            });
          },
          onError: (aiError: { code: string; message: string; status?: number }) => {
            streamErrored = true;
            console.error('[ai:generate] stream error', { model, baseUrl: providerConfig.baseUrl, ...aiError });
            try {
              paragraphService.updateParagraphContent(
                projectDb,
                projectPath,
                effectiveBranchId,
                aiParagraph.id,
                fullText,
                model,
              );
              paragraphService.updateStatus(projectDb, aiParagraph.id, 'draft');
            } catch { /* best effort */ }

            event.sender.send(IPC_CHANNELS.STREAM_ERROR, {
              paragraphId: aiParagraph.id,
              error: aiError,
            });
          },
          onDone: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => {
            tokenUsage = usage;
          },
        };

        // [diag] routing decision — remove once local-model generation is confirmed.
        console.log(`[route] generate isOllama=${providerConfig.isOllama} auth=${providerConfig.authMethod} baseUrl=${providerConfig.baseUrl} model=${model} promptTokens=${assembled.used.system + assembled.used.worldMemory + assembled.used.storyHistory + assembled.used.userInput}`);

        // Stream final story generation — native Ollama (raises num_ctx) for Ollama,
        // curl for OAuth, SDK for other API-key providers.
        if (providerConfig.isOllama) {
          const promptTokens = assembled.used.system + assembled.used.worldMemory + assembled.used.storyHistory + assembled.used.userInput;
          await ollamaChatStream({
            baseUrl: providerConfig.baseUrl,
            apiKey: providerConfig.apiKey,
            messages: finalMessages,
            model,
            numCtx: computeNumCtx(promptTokens),
            temperature: STORY_TEMPERATURE,
            signal: controller.signal,
            ...streamCallbacks,
          });
        } else if (providerConfig.authMethod === 'oauth' && providerConfig.accountId) {
          await curlStream({
            messages: finalMessages,
            model,
            accessToken: providerConfig.apiKey,
            accountId: providerConfig.accountId,
            signal: controller.signal,
            ...streamCallbacks,
          });
        } else {
          await aiService.streamChat({
            messages: finalMessages,
            model,
            temperature: STORY_TEMPERATURE,
            signal: controller.signal,
            ...streamCallbacks,
          });
        }

        // Stream completed — parse world changes, save final content
        activeControllers.delete(req.projectId);

        // If an error was emitted during streaming, do not send stream:complete
        if (streamErrored) {
          return { success: true, data: { paragraphId: aiParagraph.id } };
        }

        // Phase 3: Parse world changes from full response
        let parseResult = worldChangeParser.parse(fullText);
        let storyText = parseResult.storyText; // text without ---WORLD_CHANGES--- block

        // Hoist listCharacters for reuse by both extractWorldChanges and the dialogue pass
        const allCharacters = worldMemoryService.listCharacters(projectDb, req.projectId);

        // Second pass: extract world changes from the finished story text
        if (parseResult.noDetection && storyText) {
          const knownNames = allCharacters.map(c => c.name);
          const extracted = await extractWorldChanges(aiService, providerConfig, model, storyText, knownNames);
          if (extracted) {
            parseResult = { ...extracted, storyText };
          }
        }

        // Dialogue editor pass — runs unconditionally when enabled + has dialogue
        const draftText = storyText; // raw draft, preserved as v1 if the refine pass changes it
        const dialogueSettings = getDialogueEditorSettings(req.projectId, getOpenProject);
        if (dialogueSettings.enabled && storyText && containsDialogue(storyText)) {
          const passResult = await runDialoguePass(
            event,
            aiParagraph.id,
            storyText,
            allCharacters,
            dialogueSettings,
            aiService,
            providerConfig,
            model,
            req.projectId,
            myToken,
          );
          storyText = passResult.adoptedText;
        }

        // When the refine pass actually changed the text, keep the raw draft as v1
        // and the refined text as an active v2 — so the user can flip between them
        // (visibility) without any accept/reject step. Otherwise overwrite in place.
        let savedActiveVersion = 1;
        let savedTotalVersions = 1;
        let dialogueRefined = false;
        if (storyText) {
          if (storyText !== draftText) {
            // v1 = raw draft
            paragraphService.updateParagraphContent(
              projectDb,
              projectPath,
              effectiveBranchId,
              aiParagraph.id,
              draftText,
              model,
              tokenUsage.completionTokens,
            );
            // v2 = refined (active)
            const newVersion = paragraphService.addNewVersion(
              projectDb,
              projectPath,
              effectiveBranchId,
              aiParagraph.id,
              storyText,
              model,
              tokenUsage.completionTokens,
              true,
            );
            savedActiveVersion = newVersion;
            savedTotalVersions = newVersion;
            dialogueRefined = true;
          } else {
            paragraphService.updateParagraphContent(
              projectDb,
              projectPath,
              effectiveBranchId,
              aiParagraph.id,
              storyText,
              model,
              tokenUsage.completionTokens,
            );
          }
          paragraphService.updateStatus(projectDb, aiParagraph.id, 'normal');
        } else if (fullText) {
          // Stream had content but storyText is empty (edge case)
          paragraphService.updateParagraphContent(
            projectDb,
            projectPath,
            effectiveBranchId,
            aiParagraph.id,
            fullText,
            model,
            tokenUsage.completionTokens,
          );
          paragraphService.updateStatus(projectDb, aiParagraph.id, 'normal');
        } else {
          // Empty response or cancelled — mark as draft
          paragraphService.updateStatus(projectDb, aiParagraph.id, 'draft');
        }

        // Auto-apply world changes to database
        if (parseResult.changes && parseResult.changes.length > 0) {
          for (const change of parseResult.changes) {
            try {
              await applyWorldChange(
                worldMemoryService,
                projectDb,
                req.projectId,
                effectiveBranchId,
                aiParagraph.id,
                { type: change.type, data: change.data as Record<string, unknown> },
              );
            } catch (applyErr) {
              console.error('Failed to auto-apply world change:', applyErr);
            }
          }
        }

        const completePayload: StreamCompletePayload = {
          paragraphId: aiParagraph.id,
          fullText: storyText || fullText,
          worldChanges: parseResult.changes
            ? parseResult.changes.map((c) => ({
                type: c.type,
                data: c.data as Record<string, unknown>,
              }))
            : null,
          worldChangesAutoApplied: true,
          parseError: parseResult.parseError,
          noDetection: parseResult.noDetection,
          tokenUsage,
          contextBudget: buildBudgetPayload(assembled),
          isTruncated: assembled.isTruncated,
          truncatedCount: assembled.truncatedCount,
          activeVersion: savedActiveVersion,
          totalVersions: savedTotalVersions,
          refined: dialogueRefined,
        };

        event.sender.send(IPC_CHANNELS.STREAM_COMPLETE, completePayload);

        return { success: true, data: { paragraphId: aiParagraph.id } };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'AI_GENERATE_ERROR', message: `生成失敗：${message}`, details: err },
        };
      }
    },
  );

  // ai:cancel — cancel in-progress generation
  ipcMain.handle(
    IPC_CHANNELS.AI_CANCEL,
    (_event, projectId: string): IpcResult<void> => {
      try {
        const controller = activeControllers.get(projectId);
        if (controller) {
          controller.abort();
          activeControllers.delete(projectId);
        }
        return { success: true, data: undefined };
      } catch (err) {
        return {
          success: false,
          error: { code: 'AI_CANCEL_ERROR', message: '取消生成失敗', details: err },
        };
      }
    },
  );

  // contextBudget:get — return last computed context budget
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_BUDGET_GET,
    (): IpcResult<ContextBudgetPayload | null> => {
      return { success: true, data: lastBudgetPayload };
    },
  );

  // ai:testConnection — test the active provider connection
  ipcMain.handle(
    IPC_CHANNELS.AI_TEST_CONNECTION,
    async (_event, providerId?: string): Promise<IpcResult<{ message: string }>> => {
      try {
        await ensureFreshOAuthToken();

        let config: { apiKey: string; baseUrl: string; defaultModel: string; authMethod?: 'api_key' | 'oauth'; accountId?: string } | null = null;

        if (providerId) {
          const db = getGlobalDatabase();
          const row = db.prepare(
            'SELECT api_key_encrypted, base_url, default_model, auth_method FROM ai_providers WHERE id=?',
          ).get(providerId) as { api_key_encrypted: string; base_url: string; default_model: string; auth_method: string } | undefined;
          if (row) {
            const encrypted = Buffer.from(String(row.api_key_encrypted), 'base64');
            const decrypted = getCryptoService().decrypt(encrypted);
            const authMethod = String(row.auth_method) || 'api_key';

            if (authMethod === 'oauth') {
              const tokens = JSON.parse(decrypted) as OAuthTokens;
              config = {
                apiKey: tokens.access_token,
                baseUrl: 'https://api.openai.com/v1',
                defaultModel: String(row.default_model),
                authMethod: 'oauth',
                accountId: tokens.account_id,
              };
            } else {
              config = {
                apiKey: decrypted,
                baseUrl: String(row.base_url),
                defaultModel: String(row.default_model),
                authMethod: 'api_key',
              };
            }
          }
        } else {
          config = getActiveProvider();
        }

        if (!config) {
          return {
            success: false,
            error: { code: 'NO_PROVIDER', message: '找不到供應商設定' },
          };
        }

        // OAuth providers use curl to bypass Cloudflare on chatgpt.com
        if (config.authMethod === 'oauth' && config.accountId) {
          const result = await curlTestConnection(config.apiKey, config.accountId, config.defaultModel);
          if (result.success) {
            return { success: true, data: { message: result.message } };
          }
          return { success: false, error: { code: 'CONNECTION_TEST_FAILED', message: result.message } };
        }

        aiService.configure(config);
        const result = await aiService.testConnection(config.defaultModel);

        if (result.success) {
          return { success: true, data: { message: result.message } };
        }
        return {
          success: false,
          error: { code: 'CONNECTION_TEST_FAILED', message: result.message },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'CONNECTION_TEST_ERROR', message: `測試連線失敗：${message}`, details: err },
        };
      }
    },
  );

  // ai:regenerate — regenerate a specific paragraph (keep old version)
  ipcMain.handle(
    IPC_CHANNELS.PARAGRAPH_REGENERATE,
    async (event: IpcMainInvokeEvent, req: GenerateRequest & { targetParagraphId: string }): Promise<IpcResult<void>> => {
      try {
        await ensureFreshOAuthToken();

        const providerConfig = getActiveProvider();
        if (!providerConfig) {
          return {
            success: false,
            error: { code: 'NO_PROVIDER', message: '尚未設定 AI 供應商' },
          };
        }

        aiService.configure(providerConfig);

        const projectPath = getProjectStoragePath(req.projectId);
        if (!projectPath) {
          return {
            success: false,
            error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' },
          };
        }

        const model = req.modelOverride || providerConfig.defaultModel;

        const regenProjectDb = getOpenProject(req.projectId);
        if (!regenProjectDb) {
          return {
            success: false,
            error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' },
          };
        }

        // Get the target paragraph's position to reconstruct prior context
        const allParagraphs = paragraphService.listParagraphs(regenProjectDb, req.branchId);
        const targetIdx = allParagraphs.findIndex(p => p.id === req.targetParagraphId);
        if (targetIdx < 0) {
          return { success: false, error: { code: 'PARAGRAPH_NOT_FOUND', message: '找不到目標段落' } };
        }

        // Context = all paragraphs before target
        const historyContext = [];
        for (const para of allParagraphs.slice(0, targetIdx)) {
          if (para.status === 'detached') continue;
          const content = paragraphService.getParagraphContent(regenProjectDb, projectPath, req.branchId, para.id);
          if (content) {
            historyContext.push({ paragraphId: para.id, type: para.type, content });
          }
        }

        // The user input is the paragraph just before the target (or from request)
        const userMsg = req.userMessage || historyContext.pop()?.content || '';

        const recentTextRegen = historyContext
          .slice(-6)
          .map(h => h.content)
          .join('\n');

        const worldDirectoryRegen = buildWorldDirectory(
          worldMemoryService, regenProjectDb, req.projectId, req.branchId,
        );

        const worldMemorySummaryRegen = buildWorldMemorySummary(
          worldMemoryService, req.projectId, req.branchId, recentTextRegen,
        );

        // Ollama uses the native path (no OpenAI tools preflight) — feed it the summary.
        const useToolsRegen = !!worldDirectoryRegen && !providerConfig.isOllama;

        const assembled = contextManager.assemblePrompt({
          model,
          systemPrompt: '',
          customInstructions: getCustomInstructions(req.projectId),
          worldRules: getWorldRules(req.projectId),
          writingStyleHints: getWritingStyleHints(req.projectId),
          worldDirectory: useToolsRegen ? worldDirectoryRegen : '',
          worldMemorySummary: useToolsRegen ? '' : worldMemorySummaryRegen,
          storyHistory: historyContext,
          userInput: userMsg,
        });

        // Update the target paragraph status
        paragraphService.updateStatus(regenProjectDb, req.targetParagraphId, 'generating');

        // Mark subsequent paragraphs as review_pending
        for (const para of allParagraphs.slice(targetIdx + 1)) {
          if (para.status !== 'detached') {
            paragraphService.updateStatus(regenProjectDb, para.id, 'review_pending');
          }
        }

        const controller = new AbortController();
        const myToken = (generationTokens.get(req.projectId) ?? 0) + 1;
        generationTokens.set(req.projectId, myToken);
        activeControllers.set(req.projectId, controller);

        // Preflight: let AI query world memory via tools
        let regenFinalMessages: ChatCompletionMessageParam[] = assembled.messages;
        if (useToolsRegen) {
          try {
            const preflight = await aiService.completeWithTools({
              messages: assembled.messages,
              model,
              tools: WORLD_MEMORY_TOOLS,
              signal: controller.signal,
            });
            if (preflight.toolCalls) {
              const toolMsgs: ChatCompletionMessageParam[] = [
                {
                  role: 'assistant',
                  content: preflight.content ?? null,
                  tool_calls: preflight.toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: tc.function,
                  })),
                },
              ];
              for (const tc of preflight.toolCalls) {
                let result = '（未知工具）';
                if (tc.function.name === 'query_world_memory') {
                  try {
                    const args = JSON.parse(tc.function.arguments) as QueryWorldMemoryArgs;
                    result = executeWorldMemoryQuery(
                      worldMemoryService, regenProjectDb, req.projectId, req.branchId, args,
                    );
                  } catch {
                    result = '（參數解析失敗）';
                  }
                }
                toolMsgs.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: result,
                });
              }
              regenFinalMessages = [...assembled.messages, ...toolMsgs];
            }
          } catch (toolErr) {
            console.warn('[ai:regenerate] tool preflight failed, falling back to summary', toolErr instanceof Error ? toolErr.message : toolErr);
            const fallback = contextManager.assemblePrompt({
              model,
              systemPrompt: '',
              customInstructions: getCustomInstructions(req.projectId),
              worldRules: getWorldRules(req.projectId),
              writingStyleHints: getWritingStyleHints(req.projectId),
              worldDirectory: '',
              worldMemorySummary: worldMemorySummaryRegen,
              storyHistory: historyContext,
              userInput: userMsg,
            });
            regenFinalMessages = fallback.messages;
          }
        }

        let fullText = '';
        let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        let regenStreamErrored = false;

        // Notify renderer that regeneration started
        event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
          paragraphId: req.targetParagraphId,
          delta: '',
          done: false,
          type: 'regenerate_start',
        });

        const regenStreamCallbacks = {
          onChunk: (chunk: { delta: string; done: boolean; reasoning?: boolean }) => {
            if (chunk.done || !chunk.delta) return;
            if (chunk.reasoning) {
              event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
                paragraphId: req.targetParagraphId,
                delta: chunk.delta,
                done: false,
                type: 'reasoning',
              });
              return;
            }
            fullText += chunk.delta;
            event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
              paragraphId: req.targetParagraphId,
              delta: chunk.delta,
              done: false,
            });
          },
          onError: (aiError: { code: string; message: string; status?: number }) => {
            regenStreamErrored = true;
            console.error('[ai:regenerate] stream error', { model, baseUrl: providerConfig.baseUrl, ...aiError });
            try {
              paragraphService.updateStatus(regenProjectDb, req.targetParagraphId, 'draft');
            } catch { /* best effort */ }
            event.sender.send(IPC_CHANNELS.STREAM_ERROR, {
              paragraphId: req.targetParagraphId,
              error: aiError,
            });
          },
          onDone: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => {
            tokenUsage = usage;
          },
        };

        if (providerConfig.isOllama) {
          const promptTokens = assembled.used.system + assembled.used.worldMemory + assembled.used.storyHistory + assembled.used.userInput;
          await ollamaChatStream({
            baseUrl: providerConfig.baseUrl,
            apiKey: providerConfig.apiKey,
            messages: regenFinalMessages,
            model,
            numCtx: computeNumCtx(promptTokens),
            temperature: STORY_TEMPERATURE,
            signal: controller.signal,
            ...regenStreamCallbacks,
          });
        } else if (providerConfig.authMethod === 'oauth' && providerConfig.accountId) {
          await curlStream({
            messages: regenFinalMessages,
            model,
            accessToken: providerConfig.apiKey,
            accountId: providerConfig.accountId,
            signal: controller.signal,
            ...regenStreamCallbacks,
          });
        } else {
          await aiService.streamChat({
            messages: regenFinalMessages,
            model,
            temperature: STORY_TEMPERATURE,
            signal: controller.signal,
            ...regenStreamCallbacks,
          });
        }

        activeControllers.delete(req.projectId);

        // If an error was emitted during streaming, do not send stream:complete
        if (regenStreamErrored) {
          return { success: true, data: undefined };
        }

        // Parse world changes from regenerated response
        let regenParseResult = worldChangeParser.parse(fullText);
        const regenStoryText = regenParseResult.storyText;

        // Hoist listCharacters for reuse by both extractWorldChanges and the dialogue pass
        const regenAllCharacters = worldMemoryService.listCharacters(regenProjectDb, req.projectId);

        // Second pass: extract world changes from the finished story text
        if (regenParseResult.noDetection && regenStoryText) {
          const knownNames = regenAllCharacters.map(c => c.name);
          const extracted = await extractWorldChanges(aiService, providerConfig, model, regenStoryText, knownNames);
          if (extracted) {
            regenParseResult = { ...extracted, storyText: regenStoryText };
          }
        }

        // Build the text-to-save before the dialogue pass
        let textToSave = regenStoryText || fullText;
        const regenDraft = textToSave; // raw regenerated draft, before refine

        // Dialogue editor pass — runs unconditionally when enabled + has dialogue
        const regenDialogueSettings = getDialogueEditorSettings(req.projectId, getOpenProject);
        if (regenDialogueSettings.enabled && textToSave && containsDialogue(textToSave)) {
          const passResult = await runDialoguePass(
            event,
            req.targetParagraphId,
            textToSave,
            regenAllCharacters,
            regenDialogueSettings,
            aiService,
            providerConfig,
            model,
            req.projectId,
            myToken,
          );
          textToSave = passResult.adoptedText;
        }

        const regenRefined = !!textToSave && textToSave !== regenDraft;
        let regenActiveVersion = 0;
        let regenTotalVersions = 0;
        if (textToSave) {
          // Add new version (old version preserved). Mark it refined when the
          // dialogue pass changed the text, so the UI can badge it.
          regenActiveVersion = paragraphService.addNewVersion(
            regenProjectDb,
            projectPath,
            req.branchId,
            req.targetParagraphId,
            textToSave,
            model,
            tokenUsage.completionTokens,
            regenRefined,
          );
          regenTotalVersions = regenActiveVersion;
          paragraphService.updateStatus(regenProjectDb, req.targetParagraphId, 'normal');
        } else {
          paragraphService.updateStatus(regenProjectDb, req.targetParagraphId, 'draft');
        }

        const completePayload: StreamCompletePayload = {
          paragraphId: req.targetParagraphId,
          fullText: regenParseResult.storyText || fullText,
          worldChanges: regenParseResult.changes
            ? regenParseResult.changes.map((c) => ({
                type: c.type,
                data: c.data as Record<string, unknown>,
              }))
            : null,
          parseError: regenParseResult.parseError,
          noDetection: regenParseResult.noDetection,
          tokenUsage,
          contextBudget: buildBudgetPayload(assembled),
          isTruncated: assembled.isTruncated,
          truncatedCount: assembled.truncatedCount,
          activeVersion: regenActiveVersion || undefined,
          totalVersions: regenTotalVersions || undefined,
          refined: regenRefined,
        };

        event.sender.send(IPC_CHANNELS.STREAM_COMPLETE, completePayload);
        return { success: true, data: undefined };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'REGENERATE_ERROR', message: `重新生成失敗：${message}`, details: err },
        };
      }
    },
  );

  // ai:suggestions — generate story direction options without creating paragraphs
  ipcMain.handle(
    IPC_CHANNELS.AI_SUGGESTIONS,
    async (_event: IpcMainInvokeEvent, req: SuggestionsRequest): Promise<IpcResult<SuggestionsResponse>> => {
      try {
        await ensureFreshOAuthToken();

        const providerConfig = getActiveProvider();
        if (!providerConfig) {
          return { success: false, error: { code: 'NO_PROVIDER', message: '尚未設定 AI 供應商' } };
        }

        aiService.configure(providerConfig);

        const projectPath = getProjectStoragePath(req.projectId);
        if (!projectPath) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }

        const suggestProjectDb = getOpenProject(req.projectId);
        if (!suggestProjectDb) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }

        const model = providerConfig.defaultModel;
        const allParagraphs = paragraphService.listParagraphs(suggestProjectDb, req.branchId);

        const recentParagraphs = allParagraphs
          .filter(p => p.status !== 'detached')
          .slice(-8);

        const recentTexts: string[] = [];
        for (const para of recentParagraphs) {
          const content = paragraphService.getParagraphContent(suggestProjectDb, projectPath, req.branchId, para.id);
          if (content) {
            const clean = content.split('---WORLD_CHANGES---')[0].trimEnd();
            recentTexts.push(clean);
          }
        }

        const storyContext = recentTexts.join('\n\n');
        const customInstructions = getCustomInstructions(req.projectId);

        const messages: ChatCompletionMessageParam[] = [
          {
            role: 'system',
            content: `你是一個互動小說助手。根據以下故事上下文，生成 3 個可能的故事走向選項。
每個選項應該是一句簡短描述（15-30字），暗示接下來的劇情方向。
選項之間應該提供不同類型的發展可能，例如：衝突、探索、對話、轉折。
${customInstructions ? `\n額外指令：${customInstructions}` : ''}

回覆格式：只回覆 3 行文字，每行一個選項，不要編號，不要其他文字。`,
          },
          {
            role: 'user',
            content: `故事上下文：\n\n${storyContext}\n\n請生成 3 個故事走向選項。`,
          },
        ];

        let text = '';
        if (providerConfig.authMethod === 'oauth' && providerConfig.accountId) {
          text = await curlComplete({
            messages,
            model,
            accessToken: providerConfig.apiKey,
            accountId: providerConfig.accountId,
          });
        } else if (providerConfig.isOllama) {
          text = await ollamaChatComplete({
            baseUrl: providerConfig.baseUrl,
            apiKey: providerConfig.apiKey,
            messages,
            model,
            temperature: 1.0,
            maxTokens: 300,
          });
        } else {
          const client = aiService.getClient();
          if (!client) {
            return { success: false, error: { code: 'NO_PROVIDER', message: 'AI 客戶端未初始化' } };
          }

          const response = await client.chat.completions.create({
            model,
            messages,
            max_tokens: 300,
            temperature: 1.0,
          });
          text = response.choices[0]?.message?.content ?? '';
        }
        const suggestions = text
          .split('\n')
          .map(line => line.replace(/^\d+[.、)\]]\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 3);

        return { success: true, data: { suggestions } };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'SUGGESTIONS_ERROR', message: `生成建議失敗：${message}`, details: err },
        };
      }
    },
  );
}
