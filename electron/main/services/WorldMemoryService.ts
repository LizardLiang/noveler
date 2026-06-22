import { v4 as uuidv4 } from 'uuid';
import type { ProjectDatabase } from './database.js';
import type { Character, Relationship, StoryEvent } from '../../shared/worldMemoryTypes.js';

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
    sourceParagraphId: row.source_paragraph_id ? String(row.source_paragraph_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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
    source: row.source === 'director' ? 'director' : 'author',
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
      sourceParagraphId?: string | null;
    },
  ): Relationship {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO relationships
        (id, project_id, branch_id, character_a_id, character_b_id, relationship_type, affinity_score, description, shared_events, source_paragraph_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      branchId,
      String(data.characterAId),
      String(data.characterBId),
      String(data.relationshipType),
      Number(data.affinityScore ?? 0),
      String(data.description ?? ''),
      '[]',
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
    },
  ): Relationship | null {
    const existing = this.getRelationship(db, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE relationships SET
        relationship_type=?, affinity_score=?, description=?, updated_at=?
       WHERE id=?`,
    ).run(
      String(updates.relationshipType ?? existing.relationshipType),
      Number(updates.affinityScore ?? existing.affinityScore),
      String(updates.description ?? existing.description),
      now,
      id,
    );
    return this.getRelationship(db, id);
  }

  deleteRelationship(db: ProjectDatabase, id: string): void {
    db.prepare('DELETE FROM relationships WHERE id=?').run(id);
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
      source?: 'author' | 'director';
      paragraphId?: string | null;
    },
  ): StoryEvent {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO events
        (id, project_id, branch_id, name, description, story_timestamp, impact, participating_characters, status, source, paragraph_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      data.source === 'director' ? 'director' : 'author',
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
    },
  ): StoryEvent | null {
    const existing = this.getEvent(db, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const nextStatus = updates.status ?? existing.status;
    db.prepare(
      `UPDATE events SET
        name=?, description=?, story_timestamp=?, impact=?, participating_characters=?, status=?, updated_at=?
       WHERE id=?`,
    ).run(
      String(updates.name ?? existing.name),
      String(updates.description ?? existing.description),
      String(updates.storyTimestamp ?? existing.storyTimestamp),
      String(updates.impact ?? existing.impact),
      JSON.stringify(updates.participatingCharacters ?? existing.participatingCharacters),
      nextStatus === 'planned' ? 'planned' : 'occurred',
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
        parts.push(`${nameA} —[${r.relationshipType}]— ${nameB}（好感${affinity}）${desc}`);
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
            });
            break;
          case 'event':
            this.updateEvent(db, entityId, {
              name: prev.name,
              description: prev.description,
              storyTimestamp: prev.storyTimestamp,
              impact: prev.impact,
              participatingCharacters: prev.participatingCharacters,
            });
            break;
        }
      }

      db.prepare('DELETE FROM world_memory_changelog WHERE id=?').run(String(entry.id));
    }
  }
}

let instance: WorldMemoryService | null = null;

export function getWorldMemoryService(): WorldMemoryService {
  if (!instance) {
    instance = new WorldMemoryService();
  }
  return instance;
}
