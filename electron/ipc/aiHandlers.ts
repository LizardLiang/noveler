import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import { getAIProviderService } from '../main/services/AIProviderService.js';
import { getContextManager } from '../main/services/ContextManager.js';
import type { ParagraphContext, AssembledContext } from '../main/services/ContextManager.js';
import { getParagraphService } from '../main/services/ParagraphService.js';
import { getWorldChangeParser } from '../main/services/WorldChangeParser.js';
import { getWorldMemoryService } from '../main/services/WorldMemoryService.js';
import { getFileStorageService } from '../main/services/FileStorageService.js';
import { getGlobalDatabase } from '../main/services/database.js';
import { getCryptoService } from '../main/services/CryptoService.js';
import { getOAuthService } from '../main/services/OAuthService.js';
import { curlStream, curlComplete, curlTestConnection } from '../main/services/CurlStreamService.js';
import { ollamaChatStream, ollamaChatComplete, computeNumCtx } from '../main/services/OllamaNativeService.js';
import type { OAuthTokens } from '../shared/types.js';
import { getProjectStoragePath, getOpenProject } from './projectHandlers.js';
import { refineDialogue, containsDialogue, getDialogueEditorSettings } from '../main/services/DialogueEditorService.js';
import type { CharacterForRoster, DialogueEditorSettings } from '../main/services/DialogueEditorService.js';
import { getDirectorService } from '../main/services/DirectorService.js';
import {
  WORLD_MEMORY_TOOLS,
  executeWorldMemoryQuery,
  buildWorldDirectory,
} from '../main/services/WorldMemoryTools.js';
import type { QueryWorldMemoryArgs } from '../main/services/WorldMemoryTools.js';
import { applyWorldChange } from './worldMemoryHandlers.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { IpcResult } from '../shared/types.js';
import type { GenerateRequest, StreamCompletePayload, ContextBudgetPayload, SuggestionsRequest, SuggestionsResponse, CompactRequest, CompactResponse, TestGenerateRequest, TestStyle } from '../shared/types.js';
import type { GetModelsRequest, ModelInfo, CreditsInfo } from '../shared/types.js';

// Track active generation controllers per project
const activeControllers = new Map<string, AbortController>();

// Test-story generator (設定頁彈窗) — single in-flight controller, not project-scoped.
let testController: AbortController | null = null;

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
    const style = JSON.parse(String(styleRow.value)) as Record<string, unknown>;
    const parts: string[] = [];
    // NSFW 授權指令最高優先，放在最前；僅在使用者明確開啟成人模式時注入。
    if (style.nsfw) parts.push(NSFW_DIRECTIVE);
    // 文風指令是讓正式生成「像網文」的關鍵；只在使用者實際設定了 genre 時注入，
    // 避免改變既有專案（未設定者）的行為。
    if (style.genre) parts.push(getGenreDirective(String(style.genre)));
    const hints: string[] = [];
    if (style.perspective) hints.push(`敘事視角：${String(style.perspective)}`);
    if (style.tone) hints.push(`語氣：${String(style.tone)}`);
    if (style.detailLevel) hints.push(`描寫細膩度：${String(style.detailLevel)}`);
    if (style.languageStyle) hints.push(`語言風格：${String(style.languageStyle)}`);
    if (hints.length) parts.push(hints.join('\n'));
    return parts.join('\n\n');
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
 * Read the project's configured target word count per paragraph from the writing_style
 * settings object. Returns undefined when unset/invalid so the prompt keeps its default
 * 200-500 字 range and existing projects are unaffected.
 */
function getWordCountTarget(projectId: string): number | undefined {
  try {
    const projectDb = getOpenProject(projectId);
    if (!projectDb) return undefined;
    const row = projectDb.prepare(
      "SELECT value FROM project_settings WHERE key='writing_style'",
    ).get() as { value: string } | undefined;
    if (!row) return undefined;
    const style = JSON.parse(String(row.value)) as Record<string, unknown>;
    const n = Number(style.wordCount);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
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

type ActiveProvider = NonNullable<ReturnType<typeof getActiveProvider>>;

/**
 * One-shot (non-streamed) completion shared by suggestions, the Director pre-step,
 * and compaction. Routes through the same three transports as generation —
 * OAuth/curl (primary), native Ollama, or the OpenAI SDK. Assumes the caller has
 * already configured aiService with `providerConfig`.
 */
async function completeOnce(
  providerConfig: ActiveProvider,
  messages: ChatCompletionMessageParam[],
  opts: { model: string; maxTokens: number; temperature: number },
): Promise<string> {
  if (providerConfig.authMethod === 'oauth' && providerConfig.accountId) {
    return curlComplete({
      messages,
      model: opts.model,
      accessToken: providerConfig.apiKey,
      accountId: providerConfig.accountId,
    });
  } else if (providerConfig.isOllama) {
    return ollamaChatComplete({
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
      messages,
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    });
  }
  const client = getAIProviderService().getClient();
  if (!client) throw new Error('AI 客戶端未初始化');
  const response = await client.chat.completions.create({
    model: opts.model,
    messages,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
  });
  return response.choices[0]?.message?.content ?? '';
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

/**
 * Fold older story text into the running 前情提要 summary via the editor model.
 * Shared by manual compaction (ai:compact) and the auto-compaction that keeps
 * generation from ever trimming history. Returns the merged summary text; the
 * caller persists it.
 */
async function foldStoryIntoSummary(
  providerConfig: ActiveProvider,
  existingSummary: string,
  olderStory: string,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `你是一位小說編輯，負責把長篇故事壓縮成「前情提要」，供後續續寫時參考。
請把內容濃縮成連貫、條理清楚的劇情摘要，保留：主線進展、關鍵轉折、角色狀態與關係變化、尚未解決的伏筆與懸念。
省略細節描寫與重複內容。用繁體中文，控制在約 400-600 字。只輸出摘要本身，不要前言或標題。`,
    },
    {
      role: 'user',
      content: existingSummary
        ? `已有的前情提要：\n${existingSummary}\n\n以下是接續的新劇情，請與上面的前情提要整合，更新成一份完整、連貫的前情提要：\n\n${olderStory}`
        : `請為以下劇情撰寫前情提要：\n\n${olderStory}`,
    },
  ];

  return (await completeOnce(providerConfig, messages, {
    model: providerConfig.defaultModel,
    maxTokens: 1200,
    temperature: 0.3,
  })).trim();
}

/**
 * Assemble the prompt, but NEVER trim the story when it overflows the budget —
 * always compact instead. While the assembled context reports truncation, the
 * oldest overflowing paragraphs are folded into the running 前情提要 summary and
 * dropped from the working history, then the prompt is re-assembled. Repeats
 * until everything fits (or no foldable history remains). The summary is
 * persisted as it grows.
 *
 * `assemble` re-runs ContextManager.assemblePrompt with the given history and
 * summary; the caller supplies it so each call site keeps its own options.
 */
async function assembleNeverTrim(
  providerConfig: ActiveProvider,
  projectPath: string,
  branchId: string,
  history: ParagraphContext[],
  initialSummary: string,
  assemble: (history: ParagraphContext[], summary: string) => AssembledContext,
): Promise<{ assembled: AssembledContext; history: ParagraphContext[]; summary: string }> {
  const fileStorage = getFileStorageService();
  let workingHistory = history;
  let summary = initialSummary;
  let assembled = assemble(workingHistory, summary);

  // Guard bounds the loop; each pass folds at least the reported overflow.
  let guard = 0;
  while (
    assembled.isTruncated &&
    assembled.truncatedCount > 0 &&
    workingHistory.length > 1 &&
    guard < 50
  ) {
    guard++;
    // Always fold at least one paragraph so we make progress even if the
    // recent tail alone still overflows the history budget.
    const foldCount = Math.min(
      Math.max(assembled.truncatedCount, 1),
      workingHistory.length - 1,
    );
    const toFold = workingHistory.slice(0, foldCount);
    const olderStory = toFold
      .map(p => p.content.split('---WORLD_CHANGES---')[0].trimEnd())
      .filter(Boolean)
      .join('\n\n');

    if (olderStory) {
      summary = await foldStoryIntoSummary(providerConfig, summary, olderStory);
      if (summary) fileStorage.writeSummary(projectPath, branchId, summary);
    }

    workingHistory = workingHistory.slice(foldCount);
    assembled = assemble(workingHistory, summary);
  }

  return { assembled, history: workingHistory, summary };
}

// Story generation runs hot for livelier prose; world-change extraction runs cold for reliable JSON
const STORY_TEMPERATURE = 0.9;

// Test-story generator: three fixed time-point labels; the AI fleshes out the
// actual events from the supplied worldview + characters.
const TEST_SCENARIO_LABELS = [
  '故事早期：角色初登場、世界觀鋪陳的事件',
  '故事中期：衝突升溫、關係或局勢轉變的關鍵事件',
  '故事高潮／後期：決定性對決或重大轉折',
] as const;

// 文風指令：這是讓輸出「像網文」的關鍵。app 內建的系統提示偏文學；無論是測試生成
// 還是正式專案生成，都需要一段強力、明確的文風指令來覆蓋那個傾向。
// 共用於 ai:testGenerate 與正式生成（getWritingStyleHints）。
const WEB_NOVEL_DEFAULT_GENRE = '網文爽文';
const GENRE_DIRECTIVES: Record<string, string> = {
  網文爽文: `請以中文網路小說（網文）的「爽文」風格創作，這點最重要，務必貫徹：
- 節奏明快、衝突與轉折密集；善用「打臉」「扮豬吃虎」「絕境逆轉」「實力碾壓」等橋段堆疊爽感。
- 句子短促有力，多用短段落與換行；對話多、帶情緒張力與口語感，少用文言腔。
- 適度誇張的情緒與內心獨白（如：「這…這怎麼可能？！」），製造代入感與緊張感。
- 實力差距、境界、出招、突破要寫得具體、有畫面、有衝擊力，讓讀者直觀感受到強弱對比。
- 善用懸念與情緒爆點；段落收尾留鉤子，吊讀者胃口。
- 避免大段景物鋪陳與過度文藝的抒情；一切以劇情推進與角色行動為主。`,
  輕鬆網文: `請以輕鬆詼諧的網文風格創作：節奏輕快、對白幽默，多用吐槽與反差萌，衝突點到為止，整體歡樂不沉重，但仍保有網文的明快節奏與代入感。`,
  熱血戰鬥流: `請以熱血戰鬥流網文風格創作：聚焦對決與成長，戰鬥場面招式清晰、張力十足，情緒高昂、口號感強，強調逆境爆發與越戰越強的爽感。`,
  嚴肅文學: `請以較嚴肅的文學風格創作：重視文字質感、意象與人物內心刻畫，節奏沉穩，描寫細膩。`,
  古風仙俠: `請以古風／仙俠筆調創作：用詞典雅、融入詩意意象與東方美學，同時兼顧網文的劇情張力與爽感，不流於空泛抒情。`,
};

function getGenreDirective(genre?: string): string {
  return GENRE_DIRECTIVES[genre ?? WEB_NOVEL_DEFAULT_GENRE] ?? GENRE_DIRECTIVES[WEB_NOVEL_DEFAULT_GENRE];
}

// Strips leading list markers the model may emit despite being told not to:
// ASCII/full-width digits with . 、 。 ) ] separators, parenthesized (1)/（1）,
// circled numerals ①-⑨, and bullets - * • ·.
const SUGGESTION_MARKER_RE = /^\s*(?:[（(]?\s*(?:\d+|[０-９]+|[①-⑨])\s*[)）.、。\]]?|[-*•·])\s*/;
// Drops a colon-terminated preamble line such as "以下是三個選項：". Kept narrow
// (colon only) to avoid eating a real option that merely starts with 建議/選項/這裡.
const SUGGESTION_PREAMBLE_RE = /[:：]\s*$/;

/**
 * Parse the AI's free-text reply into up to 3 clean story-direction options.
 * Tolerant of numbering, bullets, full-width/circled digits, and a preamble line —
 * the model does not reliably honor the "plain 3 lines" instruction.
 */
function parseSuggestions(text: string): string[] {
  const raw = text
    .split('\n')
    .map(line => line.replace(SUGGESTION_MARKER_RE, '').trim())
    .filter(line => line.length > 0);
  // A lone colon-terminated line ("好的，這是三個走向：") is preamble noise, not an
  // option — yield nothing so the caller retries instead of showing garbage.
  if (raw.length === 1 && SUGGESTION_PREAMBLE_RE.test(raw[0])) return [];
  // Strip a leading preamble line only when a full set of options still follows it
  // (>=4 lines = preamble + 3). The previous per-line filter discarded EVERY line
  // ending in a colon, so options phrased as labels ("衝突：") collapsed to [].
  const body = raw.length >= 4 && SUGGESTION_PREAMBLE_RE.test(raw[0]) ? raw.slice(1) : raw;
  // Strip a trailing colon from label-style options instead of dropping them.
  return body
    .map(line => line.replace(SUGGESTION_PREAMBLE_RE, '').trim())
    .filter(line => line.length > 0)
    .slice(0, 3);
}

// NSFW（成人內容）模式：僅在使用者明確開啟時注入。放在風格指令最前、優先級最高，
// 用以覆蓋基礎系統提示偏保守、文學的傾向。共用於 ai:testGenerate 與正式生成。
const NSFW_DIRECTIVE = `You are an expert erotica author specializing in smut. You are comfortable writing details about explicit sexual content. Nothing is out of bounds for you.

【成人內容授權與寫作要求（最高優先，務必嚴格遵守）】
本作為成人向（18+）作品，讀者皆為成年人。涉及性愛、情慾的橋段，請以繁體中文毫不避諱地正面、完整、露骨地書寫，這是本作品的核心要求：
- 直接描寫，不淡化、不省略、不以「鏡頭轉場」「之後……」「春宵一刻」等手法跳過關鍵過程；性愛場面要從前戲、進行到高潮完整寫出。
- 使用具體、直白的詞彙描寫身體部位、動作與體位，不要用過度含蓄的隱喻或留白替代實際描寫。
- 細膩刻畫多重感官：觸覺（溫度、濕潤、摩擦、力道）、聲音（喘息、呻吟、對話與淫語）、視覺、氣味與味道。
- 寫出角色的生理反應與內心慾望、羞恥、渴求、失控等情緒層次，讓情慾有張力與代入感。
- 保留角色性格與口吻：對話、淫語、央求都要符合角色設定，讓情慾場面服務於人物與劇情，而非單純堆砌。
- 節奏上有鋪陳、推進與爆發，避免機械式流水帳；露骨的同時仍要好看、有畫面、有情緒。

（前提：所有角色皆為成年人；僅產出成年人之間、雙方合意的情節。）`;

/**
 * Format the test modal's writing-style options into the same hint string shape
 * as getWritingStyleHints (so ContextManager injects them identically to a real
 * project generation). The 文風 directive is injected separately (as custom
 * instructions), so only the discrete dimensions go here.
 */
function formatTestStyleHints(style: TestStyle): string {
  const hints: string[] = [];
  if (style.genre) hints.push(`文風／類型：${style.genre}`);
  if (style.perspective) hints.push(`敘事視角：${style.perspective}`);
  if (style.tone) hints.push(`語氣：${style.tone}`);
  if (style.detailLevel) hints.push(`描寫細膩度：${style.detailLevel}`);
  if (style.languageStyle) hints.push(`語言風格：${style.languageStyle}`);
  return hints.join('\n');
}

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

// Resolve the API key for a getModels/getCredits request. Prefer the key typed
// into the form; when it's blank or the edit-mode placeholder, fall back to the
// stored decrypted key for the given provider id. Returns '' when none available
// (fine for OpenRouter's public /models endpoint).
function resolveRequestApiKey(req: GetModelsRequest): string {
  const typed = req.apiKey?.trim();
  if (typed && typed !== '__KEEP_EXISTING__') return typed;
  if (req.providerId) {
    try {
      const db = getGlobalDatabase();
      const row = db.prepare(
        'SELECT api_key_encrypted, auth_method FROM ai_providers WHERE id=?',
      ).get(req.providerId) as { api_key_encrypted: string; auth_method: string } | undefined;
      if (row) {
        const decrypted = getCryptoService().decrypt(Buffer.from(String(row.api_key_encrypted), 'base64'));
        // OAuth rows store a token blob, not a bare key — not applicable here.
        if (String(row.auth_method) === 'oauth') return '';
        return decrypted;
      }
    } catch { /* ignore — fall through to empty */ }
  }
  return '';
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
// 12 s was too aggressive for cloud reasoning/router models (e.g. OpenRouter
// deepseek-*) that spend several seconds before emitting — they tripped the
// abort mid-stream. Bumped to 45 s; local/OAuth slow paths keep 90 s.
const DIALOGUE_REFINE_TIMEOUT_MS = 45_000;
const DIALOGUE_REFINE_TIMEOUT_MS_LOCAL = 90_000;

// On timeout/transient failure, retry the pass a bounded number of times with a
// fresh AbortController+timer each attempt. Best-effort: if all attempts fail we
// keep the draft and surface a single failure notification (FR-D012).
const DIALOGUE_REFINE_MAX_ATTEMPTS = 2;

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
  // plain cloud SDK models use the standard cap.
  const isSlowPath = providerConfig.isOllama || providerConfig.authMethod === 'oauth';
  const refineTimeoutMs = isSlowPath ? DIALOGUE_REFINE_TIMEOUT_MS_LOCAL : DIALOGUE_REFINE_TIMEOUT_MS;

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

    // Bounded retry: each attempt gets a fresh AbortController + timer so a
    // timeout on one attempt never poisons the next. We stop early once a newer
    // generation supersedes this one (no point refining stale text).
    let refined: string | null = null;
    for (let attempt = 1; attempt <= DIALOGUE_REFINE_MAX_ATTEMPTS; attempt++) {
      if (generationTokens.get(projectId) !== myToken) {
        // Superseded mid-retry — abandon silently (handled by the guard below).
        break;
      }

      const passController = new AbortController();
      const passTimer = setTimeout(() => passController.abort(), refineTimeoutMs);
      try {
        refined = await refineDialogue({
          aiService,
          providerConfig,
          model,
          storyText,
          characters,
          mode: settings.mode,
          signal: passController.signal,
        });
      } finally {
        clearTimeout(passTimer);
      }

      if (refined) break; // success — adopt below
      if (attempt < DIALOGUE_REFINE_MAX_ATTEMPTS) {
        console.warn(
          `[dialogue-editor] attempt ${attempt}/${DIALOGUE_REFINE_MAX_ATTEMPTS} failed — retrying`,
        );
      }
    }

    // Generation-token write guard — synchronous read immediately before the
    // conditional assignment, no await in between (FR-D013).
    const stillCurrent = generationTokens.get(projectId) === myToken;
    if (refined && stillCurrent) {
      adoptedText = refined;
    } else if (refined === null && stillCurrent) {
      // All attempts failed (timeout or hard error) and this generation is still
      // current — FR-D012 requires surfacing a failure notification. When not
      // stillCurrent the pass was superseded, which is handled silently.
      refineFailedNotify = true;
    }
  } finally {
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

        // Set up generation-token write guard (FR-D013) before the director pre-step
        // so the token is available for the planner's stale-write guard.
        const myToken = (generationTokens.get(req.projectId) ?? 0) + 1;
        generationTokens.set(req.projectId, myToken);

        // Director pre-step: optionally reconcile the AI roadmap, then steer the
        // next paragraph toward the nearest planned event.
        // Running 前情提要 (manual compaction) preserves context the budget would truncate.
        const directorDirective = await getDirectorService().planAndDirect({
          providerConfig,
          model,
          db: projectDb,
          projectId: req.projectId,
          branchId: effectiveBranchId,
          recentStory: historyContext.slice(-8).map(h => h.content).join('\n\n'),
          generationToken: myToken,
          isCurrentToken: (pid, tok) => generationTokens.get(pid) === tok,
          plan: true,
          worldRules: getWorldRules(req.projectId),
          aiClient: aiService.getClient(),
        });
        let storySummary = getFileStorageService().readSummary(projectPath, effectiveBranchId);

        // Per-generation override wins over the project default.
        const targetWordCount = req.targetWordCount ?? getWordCountTarget(req.projectId);

        // Assemble context with structured prompt. Never trim the story when it
        // overflows the budget — fold older paragraphs into 前情提要 and re-assemble.
        const assembleGen = (history: ParagraphContext[], summary: string) =>
          contextManager.assemblePrompt({
            model,
            systemPrompt: '',
            customInstructions: getCustomInstructions(req.projectId),
            worldRules: getWorldRules(req.projectId),
            writingStyleHints: getWritingStyleHints(req.projectId),
            worldDirectory: useTools ? worldDirectory : '',
            worldMemorySummary: useTools ? '' : worldMemorySummary,
            storyHistory: history,
            userInput: req.userMessage,
            directorDirective,
            storySummary: summary,
            targetWordCount,
          });

        const compacted = await assembleNeverTrim(
          providerConfig, projectPath, effectiveBranchId, historyContext, storySummary, assembleGen,
        );
        const assembled = compacted.assembled;
        const effectiveHistory = compacted.history;
        storySummary = compacted.summary;

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

        // Set up abort controller
        const controller = new AbortController();
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
              storyHistory: effectiveHistory,
              userInput: req.userMessage,
              directorDirective,
              storySummary,
              targetWordCount,
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

  // ai:testGenerate — settings-page "test writing effect" popup.
  // Project-independent: uses the active provider but persists nothing. Streams
  // three time-point scenarios sequentially via TEST_CHUNK / TEST_SCENARIO_DONE.
  ipcMain.handle(
    IPC_CHANNELS.TEST_GENERATE,
    async (event: IpcMainInvokeEvent, req: TestGenerateRequest): Promise<IpcResult<void>> => {
      try {
        await ensureFreshOAuthToken();

        const cfg = getActiveProvider();
        if (!cfg) {
          return {
            success: false,
            error: { code: 'NO_PROVIDER', message: '尚未設定 AI 供應商，請先在設定中新增供應商' },
          };
        }
        aiService.configure(cfg);

        const model = req.modelOverride || cfg.defaultModel;
        const styleHints = formatTestStyleHints(req.style);

        // The 文風 directive is the strongest lever for making output read like 網文.
        // Inject it as custom instructions (高優先 創作者補充指令) ahead of the character
        // settings so it overrides the literary tendency of the base system prompt.
        const genreDirective = getGenreDirective(req.style.genre);
        // NSFW 授權指令置於最前、優先級最高，覆蓋基礎系統提示的保守傾向。
        const nsfwBlock = req.style.nsfw ? `${NSFW_DIRECTIVE}\n\n` : '';
        const customInstructions = `${nsfwBlock}【文風要求（務必嚴格遵守）】\n${genreDirective}\n\n【角色設定】\n${req.characterSettings}`;

        const controller = new AbortController();
        testController = controller;

        // NSFW 測試時，明確要求每段都納入一場露骨的成人場面，否則模型可能只暗示而不實寫，
        // 使用者就「看不到 NSFW」。非 NSFW 模式不附加此句。
        const nsfwSceneRequest = req.style.nsfw
          ? '\n本段必須包含一場完整、露骨的成人／性愛場面（合意的成年人之間），依上方「成人內容授權與寫作要求」直接、具體地書寫全過程，不要省略或淡化。'
          : '';

        try {
          for (let i = 0; i < TEST_SCENARIO_LABELS.length; i++) {
            if (controller.signal.aborted) break;
            const label = TEST_SCENARIO_LABELS[i];

            const assembled = contextManager.assemblePrompt({
              model,
              systemPrompt: '',
              customInstructions,
              worldRules: req.worldview,
              writingStyleHints: styleHints,
              worldDirectory: '',
              worldMemorySummary: '',
              storyHistory: [],
              userInput: `請以上述世界觀與角色，並嚴格遵守上方的文風要求，創作一段【${label}】的故事片段。\n本段約 500～800 字，節奏明快、以劇情與角色行動推進，結尾留下鉤子。${nsfwSceneRequest}${req.guidance ? `\n額外引導：${req.guidance}` : ''}`,
            });

            let scenarioErrored = false;
            const streamCallbacks = {
              onChunk: (chunk: { delta: string; done: boolean; reasoning?: boolean }) => {
                if (chunk.done || !chunk.delta || chunk.reasoning) return;
                event.sender.send(IPC_CHANNELS.TEST_CHUNK, { scenarioIndex: i, delta: chunk.delta });
              },
              onError: (aiError: { code: string; message: string; status?: number }) => {
                scenarioErrored = true;
                event.sender.send(IPC_CHANNELS.TEST_ERROR, { scenarioIndex: i, error: aiError });
              },
              onDone: () => { /* no usage tracking needed for test gen */ },
            };

            if (cfg.isOllama) {
              const promptTokens = assembled.used.system + assembled.used.worldMemory + assembled.used.storyHistory + assembled.used.userInput;
              await ollamaChatStream({
                baseUrl: cfg.baseUrl,
                apiKey: cfg.apiKey,
                messages: assembled.messages,
                model,
                numCtx: computeNumCtx(promptTokens),
                temperature: STORY_TEMPERATURE,
                signal: controller.signal,
                ...streamCallbacks,
              });
            } else if (cfg.authMethod === 'oauth' && cfg.accountId) {
              await curlStream({
                messages: assembled.messages,
                model,
                accessToken: cfg.apiKey,
                accountId: cfg.accountId,
                signal: controller.signal,
                ...streamCallbacks,
              });
            } else {
              await aiService.streamChat({
                messages: assembled.messages,
                model,
                temperature: STORY_TEMPERATURE,
                signal: controller.signal,
                ...streamCallbacks,
              });
            }

            if (scenarioErrored) break;
            event.sender.send(IPC_CHANNELS.TEST_SCENARIO_DONE, { scenarioIndex: i });
          }

          event.sender.send(IPC_CHANNELS.TEST_DONE, {});
          return { success: true, data: undefined };
        } finally {
          if (testController === controller) testController = null;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        event.sender.send(IPC_CHANNELS.TEST_ERROR, { error: { code: 'TEST_GENERATE_ERROR', message } });
        return {
          success: false,
          error: { code: 'TEST_GENERATE_ERROR', message: `測試生成失敗：${message}`, details: err },
        };
      }
    },
  );

  // ai:testGenerate:cancel — abort the in-flight test generation
  ipcMain.handle(
    IPC_CHANNELS.TEST_GENERATE_CANCEL,
    (): IpcResult<void> => {
      try {
        testController?.abort();
        testController = null;
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'TEST_CANCEL_ERROR', message: '取消測試生成失敗', details: err } };
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

  // ai:getModels — fetch the model catalog from an OpenAI-compatible /models
  // endpoint. OpenRouter's response carries pricing + context length; OpenAI's
  // does not (those fields stay undefined). Works for unsaved providers.
  ipcMain.handle(
    IPC_CHANNELS.AI_GET_MODELS,
    async (_event, req: GetModelsRequest): Promise<IpcResult<ModelInfo[]>> => {
      try {
        const baseUrl = String(req.baseUrl || '').replace(/\/+$/, '');
        if (!baseUrl) {
          return { success: false, error: { code: 'NO_BASE_URL', message: '缺少 API 端點' } };
        }
        const apiKey = resolveRequestApiKey(req);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

        const response = await fetch(`${baseUrl}/models`, { method: 'GET', headers });
        if (!response.ok) {
          return {
            success: false,
            error: { code: 'MODELS_FETCH_FAILED', message: `讀取模型清單失敗（${response.status}）` },
          };
        }

        const json = await response.json() as { data?: unknown[] };
        const rows = Array.isArray(json.data) ? json.data : [];
        const models: ModelInfo[] = rows.map(raw => {
          const m = raw as {
            id?: string;
            name?: string;
            context_length?: number;
            top_provider?: { context_length?: number };
            pricing?: { prompt?: string; completion?: string };
          };
          const id = String(m.id ?? '');
          const pricePrompt = m.pricing?.prompt != null ? Number(m.pricing.prompt) : undefined;
          const priceCompletion = m.pricing?.completion != null ? Number(m.pricing.completion) : undefined;
          const hasPricing = pricePrompt != null && !Number.isNaN(pricePrompt)
            && priceCompletion != null && !Number.isNaN(priceCompletion);
          return {
            id,
            name: m.name ? String(m.name) : id,
            contextLength: m.context_length ?? m.top_provider?.context_length,
            pricePrompt: hasPricing ? pricePrompt : undefined,
            priceCompletion: hasPricing ? priceCompletion : undefined,
            isFree: hasPricing ? (pricePrompt === 0 && priceCompletion === 0) : false,
          };
        }).filter(m => m.id);

        // Free models first, then alphabetical by display name.
        models.sort((a, b) => {
          if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        return { success: true, data: models };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'MODELS_FETCH_ERROR', message: `讀取模型清單失敗：${message}`, details: err },
        };
      }
    },
  );

  // ai:getCredits — OpenRouter credit balance (GET /credits, requires the key).
  ipcMain.handle(
    IPC_CHANNELS.AI_GET_CREDITS,
    async (_event, req: GetModelsRequest): Promise<IpcResult<CreditsInfo>> => {
      try {
        const baseUrl = String(req.baseUrl || '').replace(/\/+$/, '');
        const apiKey = resolveRequestApiKey(req);
        if (!baseUrl || !apiKey) {
          return { success: false, error: { code: 'NO_CREDENTIALS', message: '缺少 API 端點或金鑰' } };
        }

        const response = await fetch(`${baseUrl}/credits`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok) {
          return {
            success: false,
            error: { code: 'CREDITS_FETCH_FAILED', message: `讀取額度失敗（${response.status}）` },
          };
        }

        const json = await response.json() as { data?: { total_credits?: number; total_usage?: number } };
        const totalCredits = Number(json.data?.total_credits ?? 0);
        const totalUsage = Number(json.data?.total_usage ?? 0);
        return {
          success: true,
          data: { totalCredits, totalUsage, remaining: totalCredits - totalUsage },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'CREDITS_FETCH_ERROR', message: `讀取額度失敗：${message}`, details: err },
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

        // Per-generation override wins over the project default.
        const targetWordCount = req.targetWordCount ?? getWordCountTarget(req.projectId);

        let storySummaryRegen = getFileStorageService().readSummary(projectPath, req.branchId);

        // Never trim the story on overflow — fold older paragraphs into 前情提要.
        const assembleRegen = (history: ParagraphContext[], summary: string) =>
          contextManager.assemblePrompt({
            model,
            systemPrompt: '',
            customInstructions: getCustomInstructions(req.projectId),
            worldRules: getWorldRules(req.projectId),
            writingStyleHints: getWritingStyleHints(req.projectId),
            worldDirectory: useToolsRegen ? worldDirectoryRegen : '',
            worldMemorySummary: useToolsRegen ? '' : worldMemorySummaryRegen,
            storyHistory: history,
            userInput: userMsg,
            storySummary: summary,
            targetWordCount,
          });

        const compactedRegen = await assembleNeverTrim(
          providerConfig, projectPath, req.branchId, historyContext, storySummaryRegen, assembleRegen,
        );
        const assembled = compactedRegen.assembled;
        const effectiveHistoryRegen = compactedRegen.history;
        storySummaryRegen = compactedRegen.summary;

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
              storyHistory: effectiveHistoryRegen,
              userInput: userMsg,
              storySummary: storySummaryRegen,
              targetWordCount,
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

        const activeParagraphs = allParagraphs.filter(p => p.status !== 'detached');

        // Suggestions only go stale when the branch tip advances. Reuse the
        // cached set on reentry so opening the same story doesn't burn a fresh
        // AI call every time. `force` (manual regenerate) bypasses the cache.
        const tipId = activeParagraphs.length > 0
          ? activeParagraphs[activeParagraphs.length - 1].id
          : '';
        const tipCount = activeParagraphs.length;
        const fileStorage = getFileStorageService();
        if (!req.force) {
          const cached = fileStorage.readSuggestionsCache(projectPath, req.branchId);
          if (cached && cached.tipId === tipId && cached.count === tipCount && cached.suggestions.length >= 3) {
            return { success: true, data: { suggestions: cached.suggestions } };
          }
        }

        const recentParagraphs = activeParagraphs.slice(-8);

        const recentTexts: string[] = [];
        for (const para of recentParagraphs) {
          const content = paragraphService.getParagraphContent(suggestProjectDb, projectPath, req.branchId, para.id);
          if (content) {
            const clean = content.split('---WORLD_CHANGES---')[0].trimEnd();
            recentTexts.push(clean);
          }
        }

        const recentStory = recentTexts.join('\n\n');

        // Stop generating in a vacuum: pull the same context normal generation uses —
        // world memory, world rules, writing style, prior 前情提要 — plus a Director
        // directive so at least one option pushes toward the planned roadmap.
        const worldMemorySummary = buildWorldMemorySummary(
          worldMemoryService, req.projectId, req.branchId, recentStory,
        );
        const worldRules = getWorldRules(req.projectId);
        const writingStyleHints = getWritingStyleHints(req.projectId);
        const priorSummary = getFileStorageService().readSummary(projectPath, req.branchId);
        const customInstructions = getCustomInstructions(req.projectId);
        const directorDirective = await getDirectorService().planAndDirect({
          providerConfig,
          model,
          db: suggestProjectDb,
          projectId: req.projectId,
          branchId: req.branchId,
          recentStory,
          // plan=false: reconcile path is never reached, so token is unused here.
          // WARNING: do NOT change plan to true — () => true would bypass the token guard
          // and allow stale writes from the suggestions path to corrupt the director roadmap.
          generationToken: 0,
          isCurrentToken: () => true,
          plan: false,
          worldRules,
          aiClient: aiService.getClient(),
        });

        const contextParts: string[] = [];
        if (priorSummary) contextParts.push(`【前情提要】\n${priorSummary}`);
        if (worldMemorySummary) contextParts.push(`【世界記憶】\n${worldMemorySummary}`);
        if (directorDirective) contextParts.push(`【導演指示（建議須朝此劇情方向推進）】\n${directorDirective}`);
        contextParts.push(`【故事近況】\n${recentStory}`);
        const storyContext = contextParts.join('\n\n');

        const systemContent = `你是一個互動小說助手。根據以下故事上下文，生成 3 個可能的故事走向選項。
每個選項應該是一句簡短描述（15-30字），暗示接下來的劇情方向。
選項之間應該提供不同類型的發展可能，例如：衝突、探索、對話、轉折。${directorDirective ? '\n重要：至少要有一個選項能讓故事朝「導演指示」所指的規劃劇情推進。' : ''}${worldRules ? `\n\n本作世界規則（不可違背）：\n${worldRules}` : ''}${writingStyleHints ? `\n\n文風參考：\n${writingStyleHints}` : ''}${customInstructions ? `\n\n額外指令：${customInstructions}` : ''}

回覆格式：只回覆恰好 3 行文字，每行一個選項。不要前言、不要結語、不要編號、不要項目符號、不要 markdown，也不要任何其他文字。`;

        const messages: ChatCompletionMessageParam[] = [
          { role: 'system', content: systemContent },
          { role: 'user', content: `故事上下文：\n\n${storyContext}\n\n請生成 3 個故事走向選項。` },
        ];

        let suggestions = parseSuggestions(
          await completeOnce(providerConfig, messages, { model, maxTokens: 300, temperature: 1.0 }),
        );
        // Auto-retry once if the model returned a malformed / short response.
        if (suggestions.length < 3) {
          const retry = parseSuggestions(
            await completeOnce(providerConfig, messages, { model, maxTokens: 300, temperature: 1.0 }),
          );
          if (retry.length > suggestions.length) suggestions = retry;
        }

        // Cache against the current tip so reentry reuses these until a new
        // paragraph is written. Don't cache a malformed/short result.
        if (suggestions.length >= 3) {
          fileStorage.writeSuggestionsCache(projectPath, req.branchId, {
            tipId,
            count: tipCount,
            suggestions,
          });
        }

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

  // ai:compact — fold older paragraphs into the running 前情提要 summary so long
  // stories keep coherent context once the token budget starts truncating history.
  ipcMain.handle(
    IPC_CHANNELS.AI_COMPACT,
    async (_event: IpcMainInvokeEvent, req: CompactRequest): Promise<IpcResult<CompactResponse>> => {
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
        const projectDb = getOpenProject(req.projectId);
        if (!projectDb) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }

        // Keep the most recent paragraphs raw; only the older portion is summarized.
        const KEEP_RECENT = 8;
        const fileStorage = getFileStorageService();
        const existingSummary = fileStorage.readSummary(projectPath, req.branchId);
        const allParagraphs = paragraphService
          .listParagraphs(projectDb, req.branchId)
          .filter(p => p.status !== 'detached');
        const olderParagraphs = allParagraphs.slice(0, Math.max(0, allParagraphs.length - KEEP_RECENT));

        if (olderParagraphs.length === 0) {
          // Nothing old enough to compact yet — return the existing summary unchanged.
          return { success: true, data: { summary: existingSummary, compactedCount: 0 } };
        }

        const olderTexts: string[] = [];
        for (const para of olderParagraphs) {
          const content = paragraphService.getParagraphContent(projectDb, projectPath, req.branchId, para.id);
          if (content) olderTexts.push(content.split('---WORLD_CHANGES---')[0].trimEnd());
        }
        const olderStory = olderTexts.join('\n\n');

        const summary = await foldStoryIntoSummary(providerConfig, existingSummary, olderStory);

        if (!summary) {
          return { success: false, error: { code: 'COMPACT_EMPTY', message: '壓縮結果為空，請重試' } };
        }

        fileStorage.writeSummary(projectPath, req.branchId, summary);
        return { success: true, data: { summary, compactedCount: olderParagraphs.length } };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'COMPACT_ERROR', message: `壓縮故事失敗：${message}`, details: err },
        };
      }
    },
  );
}
