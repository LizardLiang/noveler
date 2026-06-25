// ============================================================
// Shared types for main process — mirrors src/types/models.ts
// These are duplicated here to avoid cross-project TypeScript references
// between tsconfig.json (renderer) and tsconfig.node.json (electron)
// ============================================================

export interface GlobalConfig {
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  defaultStoragePath: string;
  activeProviderId: string | null;
  onboardingCompleted: boolean;
  locale: 'zh-TW';
  windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    isMaximized: boolean;
  };
}

export interface RecentProject {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
}

export interface ParagraphMetadataFile {
  paragraphId: string;
  versions: {
    version: number;
    createdAt: string;
    modelUsed: string | null;
    tokenCount: number;
    isActive: boolean;
    /** True when this version was produced by the dialogue-editor refine pass. */
    refined?: boolean;
  }[];
}

/** One message in a persisted prompt log — the actual messages sent to the model. */
export interface PromptLogMessage {
  role: string;
  /** Text content; null for assistant tool-call messages (see toolCalls). */
  content: string | null;
  /** Present on tool-result messages. */
  toolCallId?: string;
  /** Present on assistant messages that requested tool calls. */
  toolCalls?: { id: string; name: string; arguments: string }[];
}

/** Persisted record of the prompt sent to the model when generating a paragraph. */
export interface PromptLog {
  paragraphId: string;
  model: string;
  createdAt: string;
  messages: PromptLogMessage[];
}

// ============================================================
// Token Usage Tracking types (§3.2)
// ============================================================

/** Pipeline steps that make LLM calls (FR-004). 9 values. */
export type PipelineStep =
  | 'director-directive'
  | 'world-memory-query'
  | 'story-generation'
  | 'narration-edit'      // runNarrationPass → refineNarration (1–2 calls/paragraph)
  | 'dialogue-edit'       // runDialoguePass  → refineDialogue   (1–2 calls/paragraph)
  | 'world-memory-update'
  | 'suggestions'         // standalone AI_SUGGESTIONS handler
  | 'roadmap-reconcile'   // generate path AND standalone DIRECTOR_REPLAN handler
  | 'compaction';         // standalone AI_COMPACT handler

/** One LLM call's usage record. A step that fires N times yields N records. */
export interface StepUsageRecord {
  step: PipelineStep;
  model: string;                    // FR-006 — model used for THIS call
  promptTokens: number | null;      // FR-001
  completionTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;   // FR-003 — null when unreported (never 0-as-real)
  latencyMs: number | null;         // FR-005 — wall-clock; null on abort
}

/** Per-paragraph rollup. FR-007. */
export interface ParagraphUsageRollup {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number | null;   // null when NO step reported reasoning; else sum of reported
  latencyMs: number;
  callCount: number;
}

/** Persisted at {paragraphDir}/usage.json. FR-008. */
export interface ParagraphUsageLog {
  paragraphId: string;
  createdAt: string;                // ISO; set at flush time
  steps: StepUsageRecord[];
  rollup: ParagraphUsageRollup;
}

/**
 * One LLM call from a standalone handler (suggestions / compaction / forced
 * replan) that has no single owning paragraph. Appended to the branch-level
 * usage-events.json. `originStep` is redundant with `record.step` but kept for
 * fast filtering; `tipParagraphId` is the branch tip at call time (suggestions /
 * replan) or null (compaction operates on a range), recorded for diagnostics
 * only — it is NOT used to attach the record to a paragraph's usage.json.
 */
export interface StandaloneUsageEvent {
  createdAt: string;                // ISO; set at append time
  tipParagraphId: string | null;
  record: StepUsageRecord;
}

/** Persisted at {branchDir}/usage-events.json — append-only array of events. */
export interface BranchUsageEvents {
  events: StandaloneUsageEvent[];
}

export interface RecoverySnapshot {
  timestamp: string;
  projectId: string;
  currentBranchId: string;
  unsavedParagraphs: {
    paragraphId: string;
    content: string;
    version: number;
  }[];
  pendingWorldChanges: {
    paragraphId: string;
    changes: WorldChange[];
  }[];
  uiState: {
    sidebarCollapsed: boolean;
    worldMemoryPanelCollapsed: boolean;
    scrollPosition: number;
  };
}

export interface WorldChange {
  type:
    | 'new_character'
    | 'update_character'
    | 'new_relationship'
    | 'update_relationship'
    | 'new_event';
  data: Record<string, unknown>;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  storagePath: string;
  wordCount: number;
  paragraphCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IpcSuccess<T> {
  success: true;
  data: T;
}

export interface IpcError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type IpcResult<T> = IpcSuccess<T> | IpcError;

export type ProviderType = 'openai' | 'openrouter' | 'nvidia' | 'ollama' | 'openwebui';
export type AuthMethod = 'api_key' | 'oauth';

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  account_id: string;
}

export interface SaveProviderRequest {
  id?: string;
  providerType: ProviderType;
  authMethod?: AuthMethod;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

export interface ProviderInfo {
  id: string;
  providerType: ProviderType;
  authMethod: AuthMethod;
  baseUrl: string;
  defaultModel: string;
  isActive: boolean;
  hasApiKey: boolean;
  oauthEmail?: string;
}

// Request shape shared by ai:getModels / ai:getCredits. The picker lives in the
// add/edit-provider form, so config arrives from the unsaved form. When editing
// with a blank/__KEEP_EXISTING__ key, the handler falls back to the stored key by id.
export interface GetModelsRequest {
  baseUrl: string;
  apiKey?: string;
  providerId?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  // Per-token USD prices (OpenRouter only; undefined for providers without pricing).
  pricePrompt?: number;
  priceCompletion?: number;
  isFree: boolean;
}

export interface CreditsInfo {
  totalCredits: number;
  totalUsage: number;
  remaining: number;
}

export interface CreateProjectRequest {
  name: string;
  description: string;
  storagePath: string;
  templateId?: string;
}

export interface ImportNovelRequest {
  name: string;
  description: string;
  storagePath: string;
  filePath: string;
}

export interface ImportNovelResult {
  project: ProjectInfo;
  paragraphsImported: number;
  wordCount: number;
}

export interface RecoveryCheckResult {
  hasRecovery: boolean;
  projectId?: string;
  timestamp?: string;
}

// ===== AI Generation =====
export interface GenerateRequest {
  projectId: string;
  branchId: string;
  userMessage: string;
  modelOverride?: string;
  /** Per-generation target word count; overrides the project default when set. */
  targetWordCount?: number;
  /** One-off director steer for THIS paragraph only. Not persisted; does not
   *  touch the standing brief or the roadmap. Fed into the director's directive. */
  directorNote?: string;
}

// ===== Test Story Generator (設定頁彈窗，獨立於專案) =====
export interface TestStyle {
  genre?: string;       // 文風／類型（如「網文爽文」）→ 映射為強風格指令
  perspective?: string;
  tone?: string;
  detailLevel?: string;
  languageStyle?: string;
  nsfw?: boolean;       // 成人內容模式 → 注入 NSFW 授權指令
}

export interface TestGenerateRequest {
  worldview: string;          // 世界觀背景 → 注入為 worldRules
  characterSettings: string;  // 角色設定 → 注入為 customInstructions
  guidance: string;           // 引導提示詞 → 併入每段 userInput
  style: TestStyle;
  modelOverride?: string;
}

export interface TestChunkPayload {
  scenarioIndex: number;
  delta: string;
}

export interface TestScenarioDonePayload {
  scenarioIndex: number;
}

export interface TestErrorPayload {
  scenarioIndex?: number;
  error: { code: string; message: string };
}

export interface StreamChunkPayload {
  paragraphId: string;
  delta: string;
  done: boolean;
  type?: string;
  meta?: Record<string, unknown>;
}

export interface ContextBudgetPayload {
  totalTokens: number;
  used: {
    system: number;
    worldMemory: number;
    storyHistory: number;
    userInput: number;
  };
  budget: {
    system: number;
    worldMemory: number;
    storyHistory: number;
    userInput: number;
  };
  percentage: number;
}

export interface SuggestionsRequest {
  projectId: string;
  branchId: string;
  // Bypass the per-branch suggestions cache (manual regenerate).
  force?: boolean;
}

export interface SuggestionsResponse {
  suggestions: string[];
}

export interface CompactRequest {
  projectId: string;
  branchId: string;
}

export interface CompactResponse {
  /** The merged running summary after compaction. */
  summary: string;
  /** How many paragraphs were folded into the summary this run. */
  compactedCount: number;
}

export interface StreamCompletePayload {
  paragraphId: string;
  fullText: string;
  worldChanges: WorldChange[] | null;
  worldChangesAutoApplied?: boolean;
  parseError: boolean;
  noDetection: boolean;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens: number | null;
  };
  contextBudget?: ContextBudgetPayload;
  isTruncated?: boolean;
  truncatedCount?: number;
  /** Active version after save (e.g. 2 when the refine pass created a refined v2). */
  activeVersion?: number;
  /** Total versions after save. */
  totalVersions?: number;
  /** True when the dialogue-editor pass produced and adopted a refined version. */
  refined?: boolean;
}
