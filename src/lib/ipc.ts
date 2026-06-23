// 型別安全的 IPC 呼叫包裝
import type { IpcRendererEvent } from 'electron';
import type {
  IpcResult,
  CreateProjectRequest,
  ProjectInfo,
  ImportNovelRequest,
  ImportNovelResult,
  GenerateRequest,
  SaveProviderRequest,
  ProviderInfo,
  RecoveryCheckResult,
  StreamChunkPayload,
  StreamCompletePayload,
  ContextBudgetInfo,
  SuggestionsRequest,
  SuggestionsResponse,
  CompactRequest,
  CompactResponse,
  TestGenerateRequest,
  GetModelsRequest,
  ModelInfo,
  CreditsInfo,
} from '@/types/ipc';
import type { GlobalConfig, RecentProject, ParagraphMeta } from '@/types/models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ipcInvoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

export function ipcOn<T>(
  channel: string,
  callback: (event: IpcRendererEvent, data: T) => void,
): () => void {
  const dispose = window.ipcRenderer.on(channel, callback as Parameters<typeof window.ipcRenderer.on>[1]);
  if (typeof dispose === 'function') return dispose as () => void;
  return () => window.ipcRenderer.off(channel, callback as Parameters<typeof window.ipcRenderer.off>[1]);
}

// ===== 視窗控制 =====
export const windowApi = {
  minimize: () => ipcInvoke<void>('window:minimize'),
  maximize: () => ipcInvoke<void>('window:maximize'),
  close: () => ipcInvoke<void>('window:close'),
  isMaximized: () => ipcInvoke<boolean>('window:isMaximized'),
};

// ===== 專案管理 =====
export const projectApi = {
  create: (req: CreateProjectRequest) =>
    ipcInvoke<IpcResult<ProjectInfo>>('project:create', req),
  open: (projectId: string) =>
    ipcInvoke<IpcResult<ProjectInfo>>('project:open', projectId),
  delete: (projectId: string) =>
    ipcInvoke<IpcResult<void>>('project:delete', projectId),
  list: () =>
    ipcInvoke<IpcResult<ProjectInfo[]>>('project:list'),
  getRecent: () =>
    ipcInvoke<IpcResult<RecentProject[]>>('project:getRecent'),
  selectPath: (title?: string) =>
    ipcInvoke<IpcResult<string>>('project:selectPath', title),
  selectNovelFile: () =>
    ipcInvoke<IpcResult<string>>('project:selectNovelFile'),
  importNovel: (req: ImportNovelRequest) =>
    ipcInvoke<IpcResult<ImportNovelResult>>('project:importNovel', req),
};

// ===== 設定 =====
export const settingsApi = {
  get: () =>
    ipcInvoke<IpcResult<GlobalConfig>>('settings:get'),
  set: (key: keyof GlobalConfig, value: unknown) =>
    ipcInvoke<IpcResult<void>>('settings:set', key, value),
  getProviders: () =>
    ipcInvoke<IpcResult<ProviderInfo[]>>('settings:getProviders'),
  saveProvider: (req: SaveProviderRequest) =>
    ipcInvoke<IpcResult<ProviderInfo>>('settings:saveProvider', req),
  deleteProvider: (id: string) =>
    ipcInvoke<IpcResult<void>>('settings:deleteProvider', id),
  setActiveProvider: (id: string) =>
    ipcInvoke<IpcResult<void>>('settings:setActiveProvider', id),
};

// ===== 自動儲存 =====
export const autosaveApi = {
  trigger: (data: unknown) =>
    ipcInvoke<IpcResult<void>>('autosave:trigger', data),
  recoveryCheck: () =>
    ipcInvoke<IpcResult<RecoveryCheckResult>>('autosave:recoveryCheck'),
  recoveryRestore: (projectId: string) =>
    ipcInvoke<IpcResult<unknown>>('autosave:recoveryRestore', projectId),
  recoveryDiscard: (projectId: string) =>
    ipcInvoke<IpcResult<void>>('autosave:recoveryDiscard', projectId),
};

// ===== AI Generation =====
export const aiApi = {
  generate: (req: GenerateRequest) =>
    ipcInvoke<IpcResult<{ paragraphId: string }>>('ai:generate', req),
  cancel: (projectId: string) =>
    ipcInvoke<IpcResult<void>>('ai:cancel', projectId),
  testConnection: (providerId?: string) =>
    ipcInvoke<IpcResult<{ message: string }>>('ai:testConnection', providerId),
  getModels: (req: GetModelsRequest) =>
    ipcInvoke<IpcResult<ModelInfo[]>>('ai:getModels', req),
  getCredits: (req: GetModelsRequest) =>
    ipcInvoke<IpcResult<CreditsInfo>>('ai:getCredits', req),
  suggestions: (req: SuggestionsRequest) =>
    ipcInvoke<IpcResult<SuggestionsResponse>>('ai:suggestions', req),
  compact: (req: CompactRequest) =>
    ipcInvoke<IpcResult<CompactResponse>>('ai:compact', req),
  testGenerate: (req: TestGenerateRequest) =>
    ipcInvoke<IpcResult<void>>('ai:testGenerate', req),
  testGenerateCancel: () =>
    ipcInvoke<IpcResult<void>>('ai:testGenerate:cancel'),
};

// ===== Paragraph Management =====
export const paragraphApi = {
  list: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<ParagraphMeta[]>>('paragraph:list', projectId, branchId),
  getContent: (projectId: string, branchId: string, paragraphId: string, version?: number) =>
    ipcInvoke<IpcResult<string>>('paragraph:getContent', projectId, branchId, paragraphId, version),
  delete: (projectId: string, branchId: string, paragraphId: string, cascade?: boolean) =>
    ipcInvoke<IpcResult<void>>('paragraph:delete', projectId, branchId, paragraphId, cascade),
  getLinkedWorldMemory: (projectId: string, paragraphId: string) =>
    ipcInvoke<IpcResult<{ type: string; name: string }[]>>('paragraph:getLinkedWorldMemory', projectId, paragraphId),
  createOpening: (projectId: string, branchId: string, content: string) =>
    ipcInvoke<IpcResult<ParagraphMeta>>('paragraph:createOpening', projectId, branchId, content),
  switchVersion: (projectId: string, paragraphId: string, version: number) =>
    ipcInvoke<IpcResult<void>>('paragraph:switchVersion', projectId, paragraphId, version),
  rollback: (projectId: string, branchId: string, paragraphId: string) =>
    ipcInvoke<IpcResult<void>>('paragraph:rollback', projectId, branchId, paragraphId),
  regenerate: (req: GenerateRequest & { targetParagraphId: string }) =>
    ipcInvoke<IpcResult<void>>('paragraph:regenerate', req),
};

// ===== World Memory =====
export const worldMemoryApi = {
  getCharacters: (projectId: string) =>
    ipcInvoke<IpcResult<unknown[]>>('worldMemory:getCharacters', projectId),
  createCharacter: (projectId: string, data: unknown) =>
    ipcInvoke<IpcResult<unknown>>('worldMemory:createCharacter', projectId, data),
  updateCharacter: (projectId: string, id: string, updates: unknown) =>
    ipcInvoke<IpcResult<unknown>>('worldMemory:updateCharacter', projectId, id, updates),
  deleteCharacter: (projectId: string, id: string) =>
    ipcInvoke<IpcResult<void>>('worldMemory:deleteCharacter', projectId, id),
  deleteAllCharacters: (projectId: string) =>
    ipcInvoke<IpcResult<{ deleted: number }>>('worldMemory:deleteAllCharacters', projectId),

  getRelationships: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<unknown[]>>('worldMemory:getRelationships', projectId, branchId),
  createRelationship: (projectId: string, branchId: string, data: unknown) =>
    ipcInvoke<IpcResult<unknown>>('worldMemory:createRelationship', projectId, branchId, data),
  updateRelationship: (projectId: string, id: string, updates: unknown) =>
    ipcInvoke<IpcResult<unknown>>('worldMemory:updateRelationship', projectId, id, updates),
  deleteRelationship: (projectId: string, id: string) =>
    ipcInvoke<IpcResult<void>>('worldMemory:deleteRelationship', projectId, id),
  deleteAllRelationships: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<{ deleted: number }>>('worldMemory:deleteAllRelationships', projectId, branchId),

  getEvents: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<unknown[]>>('worldMemory:getEvents', projectId, branchId),
  createEvent: (projectId: string, branchId: string, data: unknown) =>
    ipcInvoke<IpcResult<unknown>>('worldMemory:createEvent', projectId, branchId, data),
  updateEvent: (projectId: string, id: string, updates: unknown) =>
    ipcInvoke<IpcResult<unknown>>('worldMemory:updateEvent', projectId, id, updates),
  deleteEvent: (projectId: string, id: string) =>
    ipcInvoke<IpcResult<void>>('worldMemory:deleteEvent', projectId, id),
  deleteAllEvents: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<{ deleted: number }>>('worldMemory:deleteAllEvents', projectId, branchId),

  importCharacters: (projectId: string) =>
    ipcInvoke<IpcResult<{ created: unknown[]; updated: unknown[]; skipped: string[] }>>('worldMemory:importCharacters', projectId),
  importCharactersText: (projectId: string, jsonText: string) =>
    ipcInvoke<IpcResult<{ created: unknown[]; updated: unknown[]; skipped: string[] }>>('worldMemory:importCharactersText', projectId, jsonText),

  importRelationships: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<{ created: unknown[]; updated: unknown[]; skipped: string[] }>>('worldMemory:importRelationships', projectId, branchId),
  importRelationshipsText: (projectId: string, branchId: string, jsonText: string) =>
    ipcInvoke<IpcResult<{ created: unknown[]; updated: unknown[]; skipped: string[] }>>('worldMemory:importRelationshipsText', projectId, branchId, jsonText),

  importEvents: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<{ created: unknown[]; updated: unknown[]; skipped: string[] }>>('worldMemory:importEvents', projectId, branchId),
  importEventsText: (projectId: string, branchId: string, jsonText: string) =>
    ipcInvoke<IpcResult<{ created: unknown[]; updated: unknown[]; skipped: string[] }>>('worldMemory:importEventsText', projectId, branchId, jsonText),
};

// ===== Branch Management =====
export const branchApi = {
  getTree: (projectId: string) =>
    ipcInvoke<IpcResult<unknown>>('branch:getTree', projectId),
  create: (projectId: string, parentBranchId: string, forkParagraphId: string | null, name: string) =>
    ipcInvoke<IpcResult<unknown>>('branch:create', projectId, parentBranchId, forkParagraphId, name),
  switch: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<unknown>>('branch:switch', projectId, branchId),
  rename: (projectId: string, branchId: string, newName: string) =>
    ipcInvoke<IpcResult<unknown>>('branch:rename', projectId, branchId, newName),
  delete: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<void>>('branch:delete', projectId, branchId),
  setMain: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<void>>('branch:setMain', projectId, branchId),
};

// ===== Template Management =====
export const templateApi = {
  list: () =>
    ipcInvoke<IpcResult<{ id: string; name: string; genre: string; description: string; worldRules: string; systemPrompt: string; starterCharacters: unknown[]; starterFactions: unknown[]; isBuiltin: boolean; createdAt: string }[]>>('template:list'),
  apply: (projectId: string, templateId: string) =>
    ipcInvoke<IpcResult<void>>('template:apply', projectId, templateId),
  export: (projectId: string, templateName: string) =>
    ipcInvoke<IpcResult<unknown>>('template:export', projectId, templateName),
};

// ===== Search =====
export const searchApi = {
  characters: (projectId: string, query: string) =>
    ipcInvoke<IpcResult<unknown[]>>('search:characters', projectId, query),
  events: (projectId: string, query: string, filters?: unknown) =>
    ipcInvoke<IpcResult<unknown[]>>('search:events', projectId, query, filters),
  fulltext: (projectId: string, branchId: string, query: string) =>
    ipcInvoke<IpcResult<{ paragraphId: string; position: number; excerpt: string }[]>>('search:fulltext', projectId, branchId, query),
};

// ===== Project Settings (per-project) =====
export const projectSettingsApi = {
  get: (projectId: string, key: string) =>
    ipcInvoke<IpcResult<unknown>>('project:getSetting', projectId, key),
  set: (projectId: string, key: string, value: unknown) =>
    ipcInvoke<IpcResult<void>>('project:setSetting', projectId, key, value),
};

// ===== Stats =====
export const statsApi = {
  get: (projectId: string, branchId: string) =>
    ipcInvoke<IpcResult<import('@/types/stats').StoryStats>>('stats:get', projectId, branchId),
};

// ===== OAuth =====
export const oauthApi = {
  requestCode: () =>
    ipcInvoke<IpcResult<{ userCode: string; deviceAuthId: string; verificationUrl: string }>>('oauth:requestCode'),
  poll: (deviceAuthId: string, userCode: string) =>
    ipcInvoke<IpcResult<{ providerId: string; email?: string }>>('oauth:poll', deviceAuthId, userCode),
  cancel: () =>
    ipcInvoke<IpcResult<void>>('oauth:cancel'),
  status: (providerId: string) =>
    ipcInvoke<IpcResult<{ valid: boolean; email?: string; expiresAt?: number }>>('oauth:status', providerId),
  revoke: (providerId: string) =>
    ipcInvoke<IpcResult<void>>('oauth:revoke', providerId),
};

// Re-export generate request type
export type { GenerateRequest, StreamChunkPayload, StreamCompletePayload, ContextBudgetInfo };
