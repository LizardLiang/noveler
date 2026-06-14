import type { Project, WorldChange, GlobalConfig, RecentProject, AIProvider } from './models';

// ===== 通用回應包裝 =====
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

// ===== 專案 =====
export interface CreateProjectRequest {
  name: string;
  description: string;
  storagePath: string;
  templateId?: string;
}

export type ProjectInfo = Project;

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

// ===== AI 生成 =====
export interface GenerateRequest {
  projectId: string;
  branchId: string;
  userMessage: string;
  modelOverride?: string;
}

export interface StreamChunkPayload {
  paragraphId: string;
  delta: string;
  done: boolean;
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
  contextBudget?: {
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
  };
  isTruncated?: boolean;
  truncatedCount?: number;
  /** Active version after save (e.g. 2 when the refine pass created a refined v2). */
  activeVersion?: number;
  /** Total versions after save. */
  totalVersions?: number;
  /** True when the dialogue-editor pass produced and adopted a refined version. */
  refined?: boolean;
}

// ===== 故事建議 =====
export interface SuggestionsRequest {
  projectId: string;
  branchId: string;
}

export interface SuggestionsResponse {
  suggestions: string[];
}

// ===== 上下文預算 =====
export interface ContextBudgetInfo {
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
  isSummarized: boolean;
}

// ===== 分支 =====
export interface BranchTreeNode {
  id: string;
  name: string;
  isMain: boolean;
  forkParagraphId: string | null;
  paragraphCount: number;
  children: BranchTreeNode[];
}

// ===== 設定 =====
export type ProviderType = 'openai' | 'openrouter' | 'nvidia' | 'ollama' | 'openwebui';
export type AuthMethod = 'api_key' | 'oauth';

export interface SaveProviderRequest {
  id?: string;
  providerType: ProviderType;
  authMethod?: AuthMethod;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

export interface ProviderInfo extends Omit<AIProvider, 'createdAt' | 'updatedAt'> {
  hasApiKey: boolean;
  oauthEmail?: string;
}

// ===== 自動儲存 =====
export interface RecoveryCheckResult {
  hasRecovery: boolean;
  projectId?: string;
  timestamp?: string;
}

// ===== Re-export for convenience =====
export type { GlobalConfig, RecentProject };
