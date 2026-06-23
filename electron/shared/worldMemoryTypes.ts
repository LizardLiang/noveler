// ============================================================
// Shared world memory types for main process
// Mirrors the relevant parts of src/types/models.ts
// ============================================================

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
  // Planning horizon for planned events (ignored for occurred events):
  // 'short' = next few paragraphs, 'mid' = this chapter/arc, 'long' = eventual goal.
  horizon: 'short' | 'mid' | 'long';
  // Manual ordering within a horizon bucket (lower = sooner).
  orderInHorizon: number;
  source: 'author' | 'director';
  // Cinematic/writing technique tag the director picks for a planned beat
  // (e.g. 平行剪輯／蒙太奇／空鏡). Empty for author beats and occurred events.
  technique: string;
  paragraphId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EventHorizon = StoryEvent['horizon'];
