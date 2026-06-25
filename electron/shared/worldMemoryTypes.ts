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

/** Direction the bond is currently moving — its "temperature". */
export type RelationshipTrend = 'warming' | 'cooling' | 'stable';

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
  /** Importance 1-5 — how central this bond is; filterable by the model. */
  importance: number;
  /** Whether the bond is warming, cooling, or stable (from recent changes). */
  trend: RelationshipTrend;
  sourceParagraphId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One entry in a relationship's append-only change timeline. */
export interface RelationshipChange {
  id: string;
  projectId: string;
  branchId: string;
  relationshipId: string;
  paragraphId: string | null;
  /** Affinity delta this beat applied (+ closer, − apart). */
  affinityChange: number;
  /** Cumulative affinity after this change. */
  affinityAfter: number;
  /** Relationship type before/after, when this beat changed it (else equal). */
  typeBefore: string;
  typeAfter: string;
  /** Short human note on what happened ("雨中告白"). */
  note: string;
  storyTimestamp: string;
  createdAt: string;
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
