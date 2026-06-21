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
}

export interface SuggestionsResponse {
  suggestions: string[];
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
