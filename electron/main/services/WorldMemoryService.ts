import { v4 as uuidv4 } from 'uuid';
import type { ProjectDatabase } from './database.js';
import type { Character, Relationship, RelationshipChange, RelationshipTrend, StoryEvent, EventHorizon } from '../../shared/worldMemoryTypes.js';

const VALID_HORIZONS: ReadonlySet<EventHorizon> = new Set(['short', 'mid', 'long']);

function normalizeHorizon(value: unknown): EventHorizon {
  return VALID_HORIZONS.has(value as EventHorizon) ? (value as EventHorizon) : 'mid';
}

// ============================================================
// WorldMemoryService — CRUD for characters, relationships, events
// Uses the project's sql.js database.
// ============================================================

function parseJsonSafe<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToCharacter(row: Record<string, unknown>): Character {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    aliases: parseJsonSafe<string[]>(row.aliases, []),
    appearance: String(row.appearance ?? ''),
    personality: String(row.personality ?? ''),
    background: String(row.background ?? ''),
    abilities: String(row.abilities ?? ''),
    faction: String(row.faction ?? ''),
    voiceStyle: String(row.voice_style ?? ''),
    customFields: parseJsonSafe<Record<string, string>>(row.custom_fields, {}),
    status: (row.status as Character['status']) ?? 'active',
    sourceParagraphId: row.source_paragraph_id ? String(row.source_paragraph_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const VALID_TRENDS: ReadonlySet<RelationshipTrend> = new Set(['warming', 'cooling', 'stable']);

function normalizeTrend(value: unknown): RelationshipTrend {
  return VALID_TRENDS.has(value as RelationshipTrend) ? (value as RelationshipTrend) : 'stable';
}

function clampImportance(value: unknown, fallback = 3): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, n));
}

// Unique-role / identity-defining relationship types — these are inherently
// high-importance (there is only one 初戀, 師父, 配偶…). Matched as substrings so
// "青梅竹馬／初戀" or "結拜兄弟" still count.
const HIGH_IMPORTANCE_TYPE_KEYWORDS = [
  '初戀', '戀人', '愛人', '情人', '夫', '妻', '配偶', '未婚', '結拜', '師父', '師傅',
  '師尊', '師徒', '宿敵', '摯愛', '摯友', '生死',
];

/** Bump importance to at least 4 for identity-defining/unique-role relationship types. */
function importanceForType(type: string, fallback = 3): number {
  const base = clampImportance(fallback);
  const isUniqueRole = HIGH_IMPORTANCE_TYPE_KEYWORDS.some(k => type.includes(k));
  return isUniqueRole ? Math.max(base, 4) : base;
}

/** Derive the trend from an affinity delta; a zero delta keeps the prior trend. */
function deriveTrend(affinityChange: number, prev: RelationshipTrend = 'stable'): RelationshipTrend {
  if (affinityChange > 0) return 'warming';
  if (affinityChange < 0) return 'cooling';
  return prev;
}

/** Short Chinese label for a relationship trend, used in prompt context. */
function trendLabel(t: RelationshipTrend): string {
  return t === 'warming' ? '↑升溫' : t === 'cooling' ? '↓降溫' : '→平穩';
}

function rowToRelationship(row: Record<string, unknown>): Relationship {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    branchId: String(row.branch_id),
    characterAId: String(row.character_a_id),
    characterBId: String(row.character_b_id),
    characterAName: row.character_a_name ? String(row.character_a_name) : undefined,
    characterBName: row.character_b_name ? String(row.character_b_name) : undefined,
    relationshipType: String(row.relationship_type ?? 'acquaintance'),
    affinityScore: Number(row.affinity_score ?? 0),
    description: String(row.description ?? ''),
    sharedEvents: parseJsonSafe<string[]>(row.shared_events, []),
    importance: clampImportance(row.importance, 3),
    trend: normalizeTrend(row.trend),
    sourceParagraphId: row.source_paragraph_id ? String(row.source_paragraph_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToRelationshipChange(row: Record<string, unknown>): RelationshipChange {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    branchId: String(row.branch_id),
    relationshipId: String(row.relationship_id),
    paragraphId: row.paragraph_id ? String(row.paragraph_id) : null,
    affinityChange: Number(row.affinity_change ?? 0),
    affinityAfter: Number(row.affinity_after ?? 0),
    typeBefore: String(row.type_before ?? ''),
    typeAfter: String(row.type_after ?? ''),
    note: String(row.note ?? ''),
    storyTimestamp: String(row.story_timestamp ?? ''),
    createdAt: String(row.created_at),
  };
}

function rowToEvent(row: Record<string, unknown>): StoryEvent {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    branchId: String(row.branch_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    storyTimestamp: String(row.story_timestamp ?? ''),
    impact: String(row.impact ?? ''),
    participatingCharacters: parseJsonSafe<string[]>(row.participating_characters, []),
    status: row.status === 'planned' ? 'planned' : 'occurred',
    horizon: normalizeHorizon(row.horizon),
    orderInHorizon: Number(row.order_in_horizon ?? 0),
    source: row.source === 'director' ? 'director' : 'author',
    technique: String(row.technique ?? ''),
    paragraphId: row.paragraph_id ? String(row.paragraph_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class WorldMemoryService {
  // ---- Characters ----

  listCharacters(db: ProjectDatabase, projectId: string): Character[] {
    const rows = db
      .prepare('SELECT * FROM characters WHERE project_id=? ORDER BY created_at ASC')
      .all(projectId);
    return rows.map(rowToCharacter);
  }

  getCharacter(db: ProjectDatabase, id: string): Character | null {
    const row = db.prepare('SELECT * FROM characters WHERE id=?').get(id);
    return row ? rowToCharacter(row) : null;
  }

  createCharacter(
    db: ProjectDatabase,
    projectId: string,
    data: Partial<Character> & { name: string },
  ): Character {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO characters
        (id, project_id, name, aliases, appearance, personality, background, abilities, faction, voice_style, custom_fields, status, source_paragraph_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      String(data.name),
      JSON.stringify(data.aliases ?? []),
      String(data.appearance ?? ''),
      String(data.personality ?? ''),
      String(data.background ?? ''),
      String(data.abilities ?? ''),
      String(data.faction ?? ''),
      String(data.voiceStyle ?? ''),
      JSON.stringify(data.customFields ?? {}),
      String(data.status ?? 'active'),
      data.sourceParagraphId != null ? String(data.sourceParagraphId) : null,
      now,
      now,
    );
    return this.getCharacter(db, id)!;
  }

  updateCharacter(db: ProjectDatabase, id: string, updates: Partial<Character>): Character | null {
    const existing = this.getCharacter(db, id);
    if (!existing) return null;

    const now = new Date().toISOString();

    db.prepare(
      `UPDATE characters SET
        name=?, aliases=?, appearance=?, personality=?, background=?,
        abilities=?, faction=?, voice_style=?, custom_fields=?, status=?, updated_at=?
       WHERE id=?`,
    ).run(
      String(updates.name ?? existing.name),
      JSON.stringify(updates.aliases ?? existing.aliases),
      String(updates.appearance ?? existing.appearance),
      String(updates.personality ?? existing.personality),
      String(updates.background ?? existing.background),
      String(updates.abilities ?? existing.abilities),
      String(updates.faction ?? existing.faction),
      String(updates.voiceStyle ?? existing.voiceStyle),
      JSON.stringify(updates.customFields ?? existing.customFields),
      String(updates.status ?? existing.status),
      now,
      id,
    );
    return this.getCharacter(db, id);
  }

  deleteCharacter(db: ProjectDatabase, id: string): void {
    db.prepare('DELETE FROM characters WHERE id=?').run(id);
  }

  findCharacterByName(db: ProjectDatabase, projectId: string, name: string): Character | null {
    const row = db
      .prepare('SELECT * FROM characters WHERE project_id=? AND name=? LIMIT 1')
      .get(projectId, name);
    return row ? rowToCharacter(row) : null;
  }

  // ---- Relationships ----

  listRelationships(db: ProjectDatabase, projectId: string, branchId: string): Relationship[] {
    // Join with characters table to get names
    const rows = db.prepare(
      `SELECT r.*,
              a.name as character_a_name,
              b.name as character_b_name
       FROM relationships r
       LEFT JOIN characters a ON a.id = r.character_a_id
       LEFT JOIN characters b ON b.id = r.character_b_id
       WHERE r.project_id=? AND r.branch_id=?
       ORDER BY r.created_at ASC`,
    ).all(projectId, branchId);
    return rows.map(rowToRelationship);
  }

  getRelationship(db: ProjectDatabase, id: string): Relationship | null {
    const row = db.prepare(
      `SELECT r.*,
              a.name as character_a_name,
              b.name as character_b_name
       FROM relationships r
       LEFT JOIN characters a ON a.id = r.character_a_id
       LEFT JOIN characters b ON b.id = r.character_b_id
       WHERE r.id=?`,
    ).get(id);
    return row ? rowToRelationship(row) : null;
  }

  findRelationshipByCharacters(
    db: ProjectDatabase,
    branchId: string,
    charAId: string,
    charBId: string,
  ): Relationship | null {
    const row = db.prepare(
      `SELECT r.*,
              a.name as character_a_name,
              b.name as character_b_name
       FROM relationships r
       LEFT JOIN characters a ON a.id = r.character_a_id
       LEFT JOIN characters b ON b.id = r.character_b_id
       WHERE r.branch_id=?
         AND ((r.character_a_id=? AND r.character_b_id=?)
              OR (r.character_a_id=? AND r.character_b_id=?))
       LIMIT 1`,
    ).get(branchId, charAId, charBId, charBId, charAId);
    return row ? rowToRelationship(row) : null;
  }

  createRelationship(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    data: {
      characterAId: string;
      characterBId: string;
      relationshipType: string;
      affinityScore?: number;
      description?: string;
      importance?: number;
      trend?: RelationshipTrend;
      sourceParagraphId?: string | null;
    },
  ): Relationship {
    const id = uuidv4();
    const now = new Date().toISOString();
    const relType = String(data.relationshipType);
    // Unique-role types start at high importance unless the caller set one explicitly.
    const importance = data.importance != null
      ? clampImportance(data.importance)
      : importanceForType(relType, 3);
    db.prepare(
      `INSERT INTO relationships
        (id, project_id, branch_id, character_a_id, character_b_id, relationship_type, affinity_score, description, shared_events, importance, trend, source_paragraph_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      branchId,
      String(data.characterAId),
      String(data.characterBId),
      relType,
      Number(data.affinityScore ?? 0),
      String(data.description ?? ''),
      '[]',
      importance,
      normalizeTrend(data.trend),
      data.sourceParagraphId != null ? String(data.sourceParagraphId) : null,
      now,
      now,
    );
    return this.getRelationship(db, id)!;
  }

  updateRelationship(
    db: ProjectDatabase,
    id: string,
    updates: {
      relationshipType?: string;
      affinityScore?: number;
      description?: string;
      importance?: number;
      trend?: RelationshipTrend;
    },
  ): Relationship | null {
    const existing = this.getRelationship(db, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE relationships SET
        relationship_type=?, affinity_score=?, description=?, importance=?, trend=?, updated_at=?
       WHERE id=?`,
    ).run(
      String(updates.relationshipType ?? existing.relationshipType),
      Number(updates.affinityScore ?? existing.affinityScore),
      String(updates.description ?? existing.description),
      updates.importance != null ? clampImportance(updates.importance) : existing.importance,
      updates.trend != null ? normalizeTrend(updates.trend) : existing.trend,
      now,
      id,
    );
    return this.getRelationship(db, id);
  }

  deleteRelationship(db: ProjectDatabase, id: string): void {
    db.prepare('DELETE FROM relationships WHERE id=?').run(id);
    // Cascade the timeline so a deleted relationship leaves no orphan history.
    db.prepare('DELETE FROM relationship_changes WHERE relationship_id=?').run(id);
  }

  // ---- Relationship change timeline (list, not override) ----

  /** Append one entry to a relationship's change timeline. */
  recordRelationshipChange(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    data: {
      relationshipId: string;
      paragraphId?: string | null;
      affinityChange: number;
      affinityAfter: number;
      typeBefore: string;
      typeAfter: string;
      note?: string;
      storyTimestamp?: string;
    },
  ): void {
    db.prepare(
      `INSERT INTO relationship_changes
        (id, project_id, branch_id, relationship_id, paragraph_id, affinity_change, affinity_after, type_before, type_after, note, story_timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uuidv4(),
      projectId,
      branchId,
      String(data.relationshipId),
      data.paragraphId != null ? String(data.paragraphId) : null,
      Number(data.affinityChange ?? 0),
      Number(data.affinityAfter ?? 0),
      String(data.typeBefore ?? ''),
      String(data.typeAfter ?? ''),
      String(data.note ?? ''),
      String(data.storyTimestamp ?? ''),
      new Date().toISOString(),
    );
  }

  /** Newest-first timeline for a relationship. */
  listRelationshipChanges(db: ProjectDatabase, relationshipId: string): RelationshipChange[] {
    const rows = db.prepare(
      'SELECT * FROM relationship_changes WHERE relationship_id=? ORDER BY created_at DESC',
    ).all(relationshipId);
    return rows.map(rowToRelationshipChange);
  }

  /**
   * Apply a relationship change as an APPEND (not an override): adjust the snapshot
   * (cumulative affinity, recomputed trend, optional type/description/importance) and
   * record a timeline entry. This is the path the AI world-change extractor uses so
   * the bond accrues history instead of being clobbered each beat.
   */
  applyRelationshipChange(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    relationshipId: string,
    change: {
      affinityChange?: number;
      relationshipType?: string;
      description?: string;
      importance?: number;
      note?: string;
      paragraphId?: string | null;
      storyTimestamp?: string;
    },
  ): Relationship | null {
    const existing = this.getRelationship(db, relationshipId);
    if (!existing) return null;

    const affinityChange = Number(change.affinityChange ?? 0);
    const affinityAfter = Math.min(100, Math.max(-100, existing.affinityScore + affinityChange));
    const typeAfter = change.relationshipType != null ? String(change.relationshipType) : existing.relationshipType;
    const trend = deriveTrend(affinityChange, existing.trend);
    // A type change to a unique role raises importance; otherwise honor an explicit value.
    const importance = change.importance != null
      ? clampImportance(change.importance)
      : importanceForType(typeAfter, existing.importance);

    this.updateRelationship(db, relationshipId, {
      relationshipType: typeAfter,
      affinityScore: affinityAfter,
      description: change.description,
      importance,
      trend,
    });

    this.recordRelationshipChange(db, projectId, branchId, {
      relationshipId,
      paragraphId: change.paragraphId ?? null,
      affinityChange,
      affinityAfter,
      typeBefore: existing.relationshipType,
      typeAfter,
      note: change.note ?? change.description ?? '',
      storyTimestamp: change.storyTimestamp ?? '',
    });

    return this.getRelationship(db, relationshipId);
  }

  // ---- Events ----

  listEvents(db: ProjectDatabase, projectId: string, branchId: string): StoryEvent[] {
    const rows = db.prepare(
      'SELECT * FROM events WHERE project_id=? AND branch_id=? ORDER BY created_at DESC',
    ).all(projectId, branchId);
    return rows.map(rowToEvent);
  }

  getEvent(db: ProjectDatabase, id: string): StoryEvent | null {
    const row = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    return row ? rowToEvent(row) : null;
  }

  createEvent(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    data: {
      name: string;
      description: string;
      participatingCharacters?: string[];
      impact?: string;
      storyTimestamp?: string;
      status?: 'occurred' | 'planned';
      horizon?: EventHorizon;
      orderInHorizon?: number;
      source?: 'author' | 'director';
      technique?: string;
      paragraphId?: string | null;
    },
  ): StoryEvent {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO events
        (id, project_id, branch_id, name, description, story_timestamp, impact, participating_characters, status, horizon, order_in_horizon, source, technique, paragraph_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      branchId,
      String(data.name),
      String(data.description ?? ''),
      String(data.storyTimestamp ?? ''),
      String(data.impact ?? ''),
      JSON.stringify(data.participatingCharacters ?? []),
      data.status === 'planned' ? 'planned' : 'occurred',
      normalizeHorizon(data.horizon),
      Number(data.orderInHorizon ?? 0),
      data.source === 'director' ? 'director' : 'author',
      String(data.technique ?? ''),
      data.paragraphId != null ? String(data.paragraphId) : null,
      now,
      now,
    );
    return this.getEvent(db, id)!;
  }

  updateEvent(
    db: ProjectDatabase,
    id: string,
    updates: {
      name?: string;
      description?: string;
      storyTimestamp?: string;
      impact?: string;
      participatingCharacters?: string[];
      status?: 'occurred' | 'planned';
      horizon?: EventHorizon;
      orderInHorizon?: number;
      technique?: string;
      paragraphId?: string | null;
    },
  ): StoryEvent | null {
    const existing = this.getEvent(db, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const nextStatus = updates.status ?? existing.status;
    const nextParagraphId =
      updates.paragraphId !== undefined ? updates.paragraphId : existing.paragraphId;
    db.prepare(
      `UPDATE events SET
        name=?, description=?, story_timestamp=?, impact=?, participating_characters=?, status=?, horizon=?, order_in_horizon=?, technique=?, paragraph_id=?, updated_at=?
       WHERE id=?`,
    ).run(
      String(updates.name ?? existing.name),
      String(updates.description ?? existing.description),
      String(updates.storyTimestamp ?? existing.storyTimestamp),
      String(updates.impact ?? existing.impact),
      JSON.stringify(updates.participatingCharacters ?? existing.participatingCharacters),
      nextStatus === 'planned' ? 'planned' : 'occurred',
      normalizeHorizon(updates.horizon ?? existing.horizon),
      Number(updates.orderInHorizon ?? existing.orderInHorizon),
      String(updates.technique ?? existing.technique),
      nextParagraphId != null ? String(nextParagraphId) : null,
      now,
      id,
    );
    return this.getEvent(db, id);
  }

  deleteEvent(db: ProjectDatabase, id: string): void {
    db.prepare('DELETE FROM events WHERE id=?').run(id);
  }

  // ---- Bulk delete (clear all) ----

  deleteAllCharacters(db: ProjectDatabase, projectId: string): number {
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM characters WHERE project_id=?')
      .get(projectId) as { n: number } | undefined;
    db.prepare('DELETE FROM characters WHERE project_id=?').run(projectId);
    return Number(row?.n ?? 0);
  }

  deleteAllRelationships(db: ProjectDatabase, projectId: string, branchId: string): number {
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM relationships WHERE project_id=? AND branch_id=?')
      .get(projectId, branchId) as { n: number } | undefined;
    db.prepare('DELETE FROM relationships WHERE project_id=? AND branch_id=?').run(projectId, branchId);
    return Number(row?.n ?? 0);
  }

  deleteAllEvents(db: ProjectDatabase, projectId: string, branchId: string): number {
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM events WHERE project_id=? AND branch_id=?')
      .get(projectId, branchId) as { n: number } | undefined;
    db.prepare('DELETE FROM events WHERE project_id=? AND branch_id=?').run(projectId, branchId);
    return Number(row?.n ?? 0);
  }

  // ---- Import ----

  importCharacters(
    db: ProjectDatabase,
    projectId: string,
    items: Array<Partial<Character> & { name: string }>,
  ): { created: Character[]; updated: Character[]; skipped: string[] } {
    const created: Character[] = [];
    const updated: Character[] = [];
    const skipped: string[] = [];

    for (const item of items) {
      if (!item.name || typeof item.name !== 'string') {
        skipped.push(String(item.name ?? '(unnamed)'));
        continue;
      }
      const fields = {
        name: item.name,
        aliases: Array.isArray(item.aliases) ? item.aliases : [],
        appearance: item.appearance ?? '',
        personality: item.personality ?? '',
        background: item.background ?? '',
        abilities: item.abilities ?? '',
        faction: item.faction ?? '',
        voiceStyle: item.voiceStyle ?? '',
        customFields: item.customFields && typeof item.customFields === 'object' ? item.customFields : {},
        status: item.status ?? 'active',
      };
      // Import means overwrite: update the existing entry by name, else create.
      const existing = this.findCharacterByName(db, projectId, item.name);
      if (existing) {
        const u = this.updateCharacter(db, existing.id, fields);
        if (u) updated.push(u);
        continue;
      }
      created.push(this.createCharacter(db, projectId, fields));
    }

    return { created, updated, skipped };
  }

  importRelationships(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    items: Array<Record<string, unknown>>,
  ): { created: Relationship[]; updated: Relationship[]; skipped: string[] } {
    const created: Relationship[] = [];
    const updated: Relationship[] = [];
    const skipped: string[] = [];

    for (const item of items) {
      const nameA = typeof item.characterA === 'string' ? item.characterA : '';
      const nameB = typeof item.characterB === 'string' ? item.characterB : '';
      if (!nameA || !nameB) {
        skipped.push(`${nameA || '?'} — ${nameB || '?'}`);
        continue;
      }
      const charA = this.findCharacterByName(db, projectId, nameA);
      const charB = this.findCharacterByName(db, projectId, nameB);
      if (!charA || !charB) {
        skipped.push(`${nameA} — ${nameB}`);
        continue;
      }
      const fields = {
        relationshipType: typeof item.relationshipType === 'string' ? item.relationshipType : 'acquaintance',
        affinityScore: typeof item.affinityScore === 'number' ? item.affinityScore : 0,
        description: typeof item.description === 'string' ? item.description : '',
      };
      // Import means overwrite: update the existing relationship for this pair, else create.
      const existing = this.findRelationshipByCharacters(db, branchId, charA.id, charB.id);
      if (existing) {
        const u = this.updateRelationship(db, existing.id, fields);
        if (u) updated.push(u);
        continue;
      }
      created.push(this.createRelationship(db, projectId, branchId, {
        characterAId: charA.id,
        characterBId: charB.id,
        ...fields,
      }));
    }

    return { created, updated, skipped };
  }

  importEvents(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    items: Array<Record<string, unknown> & { name: string }>,
  ): { created: StoryEvent[]; updated: StoryEvent[]; skipped: string[] } {
    const created: StoryEvent[] = [];
    const updated: StoryEvent[] = [];
    const skipped: string[] = [];

    for (const item of items) {
      if (!item.name || typeof item.name !== 'string') {
        skipped.push(String(item.name ?? '(unnamed)'));
        continue;
      }
      const participants = Array.isArray(item.participatingCharacters)
        ? (item.participatingCharacters as unknown[]).map(String)
        : [];
      const fields = {
        name: item.name,
        description: typeof item.description === 'string' ? item.description : '',
        participatingCharacters: participants,
        impact: typeof item.impact === 'string' ? item.impact : '',
        storyTimestamp: typeof item.storyTimestamp === 'string' ? item.storyTimestamp : '',
        status: (item.status === 'planned' ? 'planned' : 'occurred') as 'occurred' | 'planned',
        horizon: normalizeHorizon(item.horizon),
        orderInHorizon: typeof item.orderInHorizon === 'number' ? item.orderInHorizon : 0,
      };
      // Import means overwrite: update the existing event by name, else create.
      const existing = db
        .prepare('SELECT id FROM events WHERE project_id=? AND branch_id=? AND name=? LIMIT 1')
        .get(projectId, branchId, item.name) as { id: string } | undefined;
      if (existing) {
        const u = this.updateEvent(db, existing.id, fields);
        if (u) updated.push(u);
        continue;
      }
      created.push(this.createEvent(db, projectId, branchId, fields));
    }

    return { created, updated, skipped };
  }

  // ---- Author-only planned events (for director directive context) ----

  /**
   * Returns only author-sourced planned events, in intended writing order
   * (oldest-created first). Used by DirectorService to build the directive
   * so AI-planned beats never leak into the world-memory context block.
   */
  listAuthorPlannedForContext(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
  ): StoryEvent[] {
    const rows = db.prepare(
      `SELECT * FROM events
       WHERE project_id=? AND branch_id=? AND status='planned' AND source='author'
       ORDER BY created_at ASC`,
    ).all(projectId, branchId);
    return rows.map(rowToEvent);
  }

  // ---- World memory summary for context injection ----

  buildSummary(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    maxChars = 3000,
  ): string {
    return this.buildSmartSummary(db, projectId, branchId, '', maxChars);
  }

  /**
   * Smart summary: active characters (mentioned in recentText) get full details,
   * inactive characters get a directory listing, relationships filtered to
   * active chars, and only recent events are included.
   */
  buildSmartSummary(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    recentText: string,
    maxChars = 3000,
  ): string {
    const characters = this.listCharacters(db, projectId);
    const relationships = this.listRelationships(db, projectId, branchId);
    const events = this.listEvents(db, projectId, branchId);

    const activeCharIds = new Set<string>();
    if (recentText) {
      for (const c of characters) {
        if (recentText.includes(c.name)) {
          activeCharIds.add(c.id);
          continue;
        }
        for (const alias of c.aliases) {
          if (alias && recentText.includes(alias)) {
            activeCharIds.add(c.id);
            break;
          }
        }
      }
    } else {
      for (const c of characters) activeCharIds.add(c.id);
    }

    const activeChars = characters.filter(c => activeCharIds.has(c.id));
    const inactiveChars = characters.filter(c => !activeCharIds.has(c.id));

    const parts: string[] = [];

    if (activeChars.length > 0) {
      parts.push('【活躍角色】');
      for (const c of activeChars) {
        const lines = [`■ ${c.name}（${c.faction || '未知陣營'}，${c.status}）`];
        if (c.appearance) lines.push(`  外觀：${c.appearance}`);
        if (c.personality) lines.push(`  性格：${c.personality}`);
        if (c.background) lines.push(`  背景：${c.background}`);
        if (c.abilities) lines.push(`  能力：${c.abilities}`);
        if (c.voiceStyle) lines.push(`  說話方式：${c.voiceStyle}`);
        const customEntries = Object.entries(c.customFields ?? {});
        for (const [key, val] of customEntries) {
          if (val) lines.push(`  ${key}：${val}`);
        }
        parts.push(lines.join('\n'));
      }
    }

    if (inactiveChars.length > 0) {
      parts.push('【其他已知角色】');
      for (const c of inactiveChars) {
        parts.push(`- ${c.name}（${c.faction || '未知'}，${c.status}）`);
      }
    }

    const activeRelationships = relationships.filter(
      r => activeCharIds.has(r.characterAId) || activeCharIds.has(r.characterBId),
    );
    if (activeRelationships.length > 0) {
      parts.push('【角色關係】');
      for (const r of activeRelationships) {
        const nameA = r.characterAName ?? r.characterAId;
        const nameB = r.characterBName ?? r.characterBId;
        const affinity = r.affinityScore >= 0 ? `+${r.affinityScore}` : String(r.affinityScore);
        const desc = r.description ? `：${r.description}` : '';
        parts.push(`${nameA} —[${r.relationshipType}]— ${nameB}（好感${affinity}，重要度${r.importance}/5，${trendLabel(r.trend)}）${desc}`);
      }
    }

    // Identity-defining relationships (初戀, 師父, 配偶…) must NEVER silently drop from
    // context just because both parties are momentarily off-screen — that is exactly
    // how the model "forgets" a unique role and invents a second one (a new 初戀).
    // So always surface off-screen relationships too, compactly (no affinity/desc churn).
    const inactiveRelationships = relationships.filter(
      r => !activeCharIds.has(r.characterAId) && !activeCharIds.has(r.characterBId),
    );
    if (inactiveRelationships.length > 0) {
      parts.push('【其他既定關係（設定，不可變更或新增矛盾）】');
      for (const r of inactiveRelationships) {
        const nameA = r.characterAName ?? r.characterAId;
        const nameB = r.characterBName ?? r.characterBId;
        const desc = r.description ? `：${r.description}` : '';
        parts.push(`- ${nameA} —[${r.relationshipType}]— ${nameB}（重要度${r.importance}/5，${trendLabel(r.trend)}）${desc}`);
      }
    }

    const occurredEvents = events.filter(e => e.status !== 'planned');
    // Exclude director-planned beats from the world-memory context block:
    // speculative AI beats must not read as established canon to the writer model.
    // Director events feed the director directive only (see DirectorService).
    const plannedEvents = events.filter(e => e.status === 'planned' && e.source !== 'director');

    const recentEvents = occurredEvents.slice(0, 8);
    const olderEvents = occurredEvents.slice(8, 20);
    if (recentEvents.length > 0) {
      parts.push('【近期事件（已發生）】');
      for (const e of recentEvents) {
        const chars = e.participatingCharacters.join('、') || '無';
        parts.push(`- ${e.name}：${e.description}（參與：${chars}）`);
      }
    }
    if (olderEvents.length > 0) {
      parts.push('【歷史事件索引（已發生）】');
      for (const e of olderEvents) {
        parts.push(`- ${e.name}（${e.storyTimestamp || '時間不明'}）`);
      }
    }

    if (plannedEvents.length > 0) {
      // Planned events are a roadmap, not history. listEvents returns newest-created
      // first, so reverse to roughly the intended writing order.
      const roadmap = [...plannedEvents].reverse();
      parts.push('【劇情規劃（尚未發生，禁止當成已發生）】');
      parts.push('以下是作者規劃、尚未在故事中發生的劇情走向。請依序朝這些方向自然推進，但在劇情實際演到之前，絕不可當作已經發生、也不可直接劇透結果：');
      for (const e of roadmap) {
        const chars = e.participatingCharacters.join('、') || '無';
        const when = e.storyTimestamp ? `[${e.storyTimestamp}] ` : '';
        parts.push(`- ${when}${e.name}：${e.description}（涉及：${chars}）`);
      }
    }

    const summary = parts.join('\n');
    if (summary.length <= maxChars) return summary;
    return summary.slice(0, maxChars) + '\n…（已截斷）';
  }

  /**
   * Canonical, must-not-be-contradicted facts: every character's identity line and
   * every relationship, UNFILTERED by recency. Used to anchor 前情提要 compaction so
   * the summariser never drops or alters an established setting (e.g. who is whose
   * 初戀). Kept compact (identities + relationships only, no events).
   */
  buildCanonFacts(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    maxChars = 1500,
  ): string {
    const characters = this.listCharacters(db, projectId);
    const relationships = this.listRelationships(db, projectId, branchId);
    const parts: string[] = [];

    if (characters.length > 0) {
      parts.push('【角色設定】');
      for (const c of characters) {
        const faction = c.faction ? `（${c.faction}）` : '';
        const status = c.status ? `：${c.status}` : '';
        parts.push(`- ${c.name}${faction}${status}`);
      }
    }

    if (relationships.length > 0) {
      parts.push('【角色關係（既定設定，不可變更或新增矛盾）】');
      for (const r of relationships) {
        const nameA = r.characterAName ?? r.characterAId;
        const nameB = r.characterBName ?? r.characterBId;
        const desc = r.description ? `：${r.description}` : '';
        const imp = r.importance >= 4 ? `（重要度${r.importance}/5）` : '';
        parts.push(`- ${nameA} —[${r.relationshipType}]— ${nameB}${imp}${desc}`);
      }
    }

    const out = parts.join('\n');
    if (!out) return '';
    return out.length <= maxChars ? out : out.slice(0, maxChars) + '\n…（已截斷）';
  }

  // ---- Plot steering (horizon-weighted compliance injection) ----

  /**
   * Return planned events sorted within a horizon bucket: orderInHorizon ASC,
   * then created_at ASC (older first, roughly the intended writing order).
   */
  private plannedByHorizon(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    horizon: EventHorizon,
  ): StoryEvent[] {
    const rows = db.prepare(
      `SELECT * FROM events
       WHERE project_id=? AND branch_id=? AND status='planned' AND horizon=?
       ORDER BY order_in_horizon ASC, created_at ASC`,
    ).all(projectId, branchId, horizon);
    return rows.map(rowToEvent);
  }

  /**
   * Build horizon-weighted steering text for prompt injection.
   *
   * - longGoals: the `long` bucket — folded into the system prompt (primacy),
   *   background direction the story should ultimately move toward.
   * - nearTermDirective: `short` (write toward now) + `mid` (build toward) buckets,
   *   injected near the end of the prompt (recency) with an explicit
   *   "foreshadow but don't resolve yet" guard.
   *
   * Returns empty strings when a bucket has no planned events.
   */
  buildPlotSteering(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
  ): { longGoals: string; nearTermDirective: string } {
    const short = this.plannedByHorizon(db, projectId, branchId, 'short');
    const mid = this.plannedByHorizon(db, projectId, branchId, 'mid');
    const long = this.plannedByHorizon(db, projectId, branchId, 'long');

    const fmt = (e: StoryEvent): string => {
      const chars = e.participatingCharacters.join('、');
      const who = chars ? `（涉及：${chars}）` : '';
      const desc = e.description ? `：${e.description}` : '';
      return `- ${e.name}${desc}${who}`;
    };

    const longParts: string[] = [];
    if (long.length > 0) {
      longParts.push('本作的長期劇情走向（最終要朝這些方向發展，但距離尚遠，目前只需保持一致、不可提前發生）：');
      for (const e of long) longParts.push(fmt(e));
    }

    const nearParts: string[] = [];
    if (short.length > 0) {
      nearParts.push('【接下來的劇情目標（必須朝此推進）】');
      nearParts.push('以下是作者規劃、即將發生的劇情。請讓接下來這幾段自然地朝這些方向推進、實際演出：');
      for (const e of short) nearParts.push(fmt(e));
    }
    if (mid.length > 0) {
      nearParts.push('【中期鋪陳（可埋伏筆，但尚未發生）】');
      nearParts.push('以下劇情稍後才會發生。可以為它們鋪陳、埋下伏筆，但在劇情實際演到之前，絕不可當成已經發生、也不可直接寫出結局：');
      for (const e of mid) nearParts.push(fmt(e));
    }

    return {
      longGoals: longParts.join('\n'),
      nearTermDirective: nearParts.join('\n'),
    };
  }

  // ---- Rollback world memory changes for detached paragraphs ----

  rollbackWorldMemory(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    targetParagraphId: string,
    options?: { inclusive?: boolean },
  ): void {
    const targetRow = db
      .prepare('SELECT position FROM paragraph_meta WHERE id=?')
      .get(targetParagraphId) as { position: number } | undefined;
    if (!targetRow) return;

    // Default: undo changes from paragraphs *after* the target (rollback keeps the
    // target). `inclusive` also undoes the target's own changes — used by regenerate,
    // which rewrites the target and must not feed the old version's world facts back
    // into the next prompt.
    const comparator = options?.inclusive ? '>=' : '>';
    const detachedParagraphs = db
      .prepare(
        `SELECT id FROM paragraph_meta WHERE branch_id=? AND position ${comparator} ? ORDER BY position ASC`,
      )
      .all(branchId, targetRow.position) as { id: string }[];

    if (detachedParagraphs.length === 0) return;

    const detachedIds = detachedParagraphs.map((p) => String(p.id));
    const placeholders = detachedIds.map(() => '?').join(',');

    const changelogEntries = db
      .prepare(
        `SELECT * FROM world_memory_changelog
         WHERE paragraph_id IN (${placeholders}) AND branch_id=?
         ORDER BY created_at DESC`,
      )
      .all(...detachedIds, branchId) as Array<{
      id: string;
      entity_type: string;
      entity_id: string;
      change_type: string;
      previous_data: string | null;
    }>;

    for (const entry of changelogEntries) {
      const entityId = String(entry.entity_id);

      if (entry.change_type === 'create') {
        switch (entry.entity_type) {
          case 'character':
            this.deleteCharacter(db, entityId);
            break;
          case 'relationship':
            this.deleteRelationship(db, entityId);
            break;
          case 'event':
            this.deleteEvent(db, entityId);
            break;
        }
      } else if (entry.change_type === 'update' && entry.previous_data) {
        const prev = JSON.parse(entry.previous_data);
        switch (entry.entity_type) {
          case 'character':
            this.updateCharacter(db, entityId, prev);
            break;
          case 'relationship':
            this.updateRelationship(db, entityId, {
              relationshipType: prev.relationshipType,
              affinityScore: prev.affinityScore,
              description: prev.description,
              importance: prev.importance,
              trend: prev.trend,
            });
            break;
          case 'event':
            this.updateEvent(db, entityId, {
              name: prev.name,
              description: prev.description,
              storyTimestamp: prev.storyTimestamp,
              impact: prev.impact,
              participatingCharacters: prev.participatingCharacters,
              status: prev.status,
              horizon: prev.horizon,
              orderInHorizon: prev.orderInHorizon,
              paragraphId: prev.paragraphId,
            });
            break;
        }
      }

      db.prepare('DELETE FROM world_memory_changelog WHERE id=?').run(String(entry.id));
    }

    // Drop relationship timeline entries attributed to the rolled-back paragraphs so
    // the bond history doesn't show changes from beats that no longer exist.
    db.prepare(
      `DELETE FROM relationship_changes WHERE branch_id=? AND paragraph_id IN (${placeholders})`,
    ).run(branchId, ...detachedIds);
  }
}

let instance: WorldMemoryService | null = null;

export function getWorldMemoryService(): WorldMemoryService {
  if (!instance) {
    instance = new WorldMemoryService();
  }
  return instance;
}
