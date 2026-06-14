import fs from 'node:fs';
import path from 'node:path';
import type { ProjectDatabase } from './database.js';

// ============================================================
// SearchService — Search across characters, events, and story paragraphs
// ============================================================

export interface CharacterSearchResult {
  id: string;
  name: string;
  faction: string;
  status: string;
  aliases: string[];
}

export interface EventSearchResult {
  id: string;
  name: string;
  description: string;
  storyTimestamp: string;
  participatingCharacters: string[];
  branchId: string;
}

export interface FulltextSearchResult {
  paragraphId: string;
  position: number;
  type: 'user' | 'ai' | 'system';
  excerpt: string;
}

export interface EventSearchFilters {
  characterName?: string;
  branchId?: string;
}

export class SearchService {
  // ----------------------------------------------------------
  // Character search — by name, faction, or alias
  // ----------------------------------------------------------
  searchCharacters(
    db: ProjectDatabase,
    projectId: string,
    query: string,
  ): CharacterSearchResult[] {
    const q = `%${query.toLowerCase()}%`;
    const rows = db
      .prepare(
        `SELECT id, name, faction, status, aliases
         FROM characters
         WHERE project_id=?
           AND (LOWER(name) LIKE ?
             OR LOWER(faction) LIKE ?
             OR LOWER(aliases) LIKE ?)
         ORDER BY name ASC
         LIMIT 50`,
      )
      .all(projectId, q, q, q);

    return rows.map(row => ({
      id: String(row.id),
      name: String(row.name),
      faction: String(row.faction ?? ''),
      status: String(row.status ?? 'active'),
      aliases: this.parseJson<string[]>(row.aliases, []),
    }));
  }

  // ----------------------------------------------------------
  // Event search — by name, description, or filters
  // ----------------------------------------------------------
  searchEvents(
    db: ProjectDatabase,
    projectId: string,
    query: string,
    filters?: EventSearchFilters,
  ): EventSearchResult[] {
    const q = `%${query.toLowerCase()}%`;

    let sql = `
      SELECT id, name, description, story_timestamp, participating_characters, branch_id
      FROM events
      WHERE project_id=?
        AND (? = '' OR LOWER(name) LIKE ? OR LOWER(description) LIKE ?)
    `;
    const params: unknown[] = [projectId, query, q, q];

    if (filters?.branchId) {
      sql += ' AND branch_id=?';
      params.push(filters.branchId);
    }

    if (filters?.characterName) {
      sql += ' AND LOWER(participating_characters) LIKE ?';
      params.push(`%${filters.characterName.toLowerCase()}%`);
    }

    sql += ' ORDER BY story_timestamp ASC LIMIT 50';

    const rows = db.prepare(sql).all(...params);

    return rows.map(row => ({
      id: String(row.id),
      name: String(row.name),
      description: String(row.description ?? ''),
      storyTimestamp: String(row.story_timestamp ?? ''),
      participatingCharacters: this.parseJson<string[]>(row.participating_characters, []),
      branchId: String(row.branch_id),
    }));
  }

  // ----------------------------------------------------------
  // Full-text search — scan paragraph content files
  // ----------------------------------------------------------
  searchFulltext(
    db: ProjectDatabase,
    projectStoragePath: string,
    projectId: string,
    branchId: string,
    query: string,
  ): FulltextSearchResult[] {
    const lq = query.toLowerCase();
    if (!lq.trim()) return [];

    // Get all paragraphs for the branch
    const paragraphs = db
      .prepare(
        `SELECT id, position, type, active_version
         FROM paragraph_meta
         WHERE project_id=? AND branch_id=?
         ORDER BY position ASC`,
      )
      .all(projectId, branchId);

    const results: FulltextSearchResult[] = [];
    const storyDir = path.join(projectStoragePath, 'story', branchId, 'content');

    if (!fs.existsSync(storyDir)) return [];

    for (const para of paragraphs) {
      const paragraphId = String(para.id);
      const version = Number(para.active_version ?? 1);
      const paraDir = path.join(storyDir, paragraphId);
      const contentPath = path.join(paraDir, `v${version}.md`);

      if (!fs.existsSync(contentPath)) continue;

      let content: string;
      try {
        content = fs.readFileSync(contentPath, 'utf-8');
      } catch {
        continue;
      }

      if (!content.toLowerCase().includes(lq)) continue;

      // Build excerpt around the first match
      const idx = content.toLowerCase().indexOf(lq);
      const start = Math.max(0, idx - 60);
      const end = Math.min(content.length, idx + query.length + 60);
      let excerpt = content.slice(start, end).replace(/\n+/g, ' ').trim();
      if (start > 0) excerpt = '...' + excerpt;
      if (end < content.length) excerpt = excerpt + '...';

      results.push({
        paragraphId,
        position: Number(para.position),
        type: (String(para.type) as 'user' | 'ai' | 'system') ?? 'ai',
        excerpt,
      });

      if (results.length >= 30) break; // cap results
    }

    return results;
  }

  private parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}

let _searchService: SearchService | null = null;
export function getSearchService(): SearchService {
  if (!_searchService) _searchService = new SearchService();
  return _searchService;
}
