// ============================================================
// 資料模型 TypeScript 介面
// ============================================================

export interface Project {
  id: string;
  name: string;
  description: string;
  storagePath: string;
  wordCount: number;
  paragraphCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  projectId: string;
  parentBranchId: string | null;
  forkParagraphId: string | null;
  name: string;
  isMain: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  aliases: string[];
  appearance: string;
  personality: string;
  background: string;
  abilities: string;
  faction: string;
  voiceStyle: string;
  customFields: Record<string, string>;
  status: 'active' | 'retired' | 'deceased';
  sourceParagraphId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Relationship {
  id: string;
  projectId: string;
  branchId: string;
  characterAId: string;
  characterBId: string;
  characterAName?: string;
  characterBName?: string;
  relationshipType: string;
  affinityScore: number;
  description: string;
  sharedEvents: string[];
  sourceParagraphId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryEvent {
  id: string;
  projectId: string;
  branchId: string;
  name: string;
  description: string;
  storyTimestamp: string;
  impact: string;
  participatingCharacters: string[];
  status: 'occurred' | 'planned';
  source: 'author' | 'director';
  paragraphId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParagraphMeta {
  id: string;
  projectId: string;
  branchId: string;
  type: 'user' | 'ai' | 'system';
  status: 'normal' | 'generating' | 'detached' | 'draft' | 'review_pending';
  position: number;
  activeVersion: number;
  totalVersions: number;
  modelUsed: string | null;
  tokenCount: number;
  detectionHistory: DetectionRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface DetectionRecord {
  id: string;
  paragraphId: string;
  changeType: 'new_character' | 'relationship_update' | 'new_event';
  changeData: unknown;
  status: 'pending' | 'accepted' | 'rejected';
  targetId: string | null;
  createdAt: string;
}

export type ProviderType = 'openai' | 'openrouter' | 'nvidia' | 'ollama' | 'openwebui';
export type AuthMethod = 'api_key' | 'oauth';

export interface AIProvider {
  id: string;
  providerType: ProviderType;
  authMethod: AuthMethod;
  baseUrl: string;
  defaultModel: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorldTemplate {
  id: string;
  name: string;
  genre: 'fantasy' | 'scifi' | 'modern' | 'historical';
  description: string;
  worldRules: string;
  starterCharacters: unknown[];
  starterFactions: unknown[];
  isBuiltin: boolean;
  createdAt: string;
}

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
  data:
    | NewCharacterChange
    | UpdateCharacterChange
    | NewRelationshipChange
    | UpdateRelationshipChange
    | NewEventChange;
}

export interface NewCharacterChange {
  name: string;
  appearance?: string;
  personality?: string;
  background?: string;
  abilities?: string;
  faction?: string;
  voiceStyle?: string;
}

export interface UpdateCharacterChange {
  name: string;
  updates: Partial<Omit<NewCharacterChange, 'name'>>;
}

export interface NewRelationshipChange {
  characterA: string;
  characterB: string;
  type: string;
  affinityChange?: number;
  description?: string;
}

export interface UpdateRelationshipChange {
  characterA: string;
  characterB: string;
  type?: string;
  affinityChange?: number;
  description?: string;
}

export interface NewEventChange {
  name: string;
  description: string;
  participatingCharacters: string[];
  impact?: string;
}
