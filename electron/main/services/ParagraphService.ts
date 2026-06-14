import { v4 as uuidv4 } from 'uuid';
import type { ProjectDatabase } from './database.js';
import { getFileStorageService } from './FileStorageService.js';

export interface ParagraphRecord {
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateParagraphOptions {
  projectPath: string;
  projectId: string;
  branchId: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  modelUsed?: string;
  tokenCount?: number;
}

export interface ParagraphWithContent extends ParagraphRecord {
  content: string;
}

class ParagraphService {
  createParagraph(db: ProjectDatabase, options: CreateParagraphOptions): ParagraphRecord {
    const fileStorage = getFileStorageService();
    const id = uuidv4();

    // Get the next position for this branch
    const maxPosRow = db.prepare(
      'SELECT MAX(position) as max_pos FROM paragraph_meta WHERE branch_id=?',
    ).get(options.branchId) as { max_pos: number | null } | undefined;
    const position = (maxPosRow?.max_pos ?? -1) + 1;

    // Insert into DB
    db.prepare(`
      INSERT INTO paragraph_meta
        (id, project_id, branch_id, type, status, position, active_version, total_versions, model_used, token_count, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, 'normal', ?, 1, 1, ?, ?, datetime('now'), datetime('now'))
    `).run(
      id,
      options.projectId,
      options.branchId,
      options.type,
      position,
      options.modelUsed ?? null,
      options.tokenCount ?? 0,
    );

    // Write content to filesystem
    fileStorage.writeParagraphContent(options.projectPath, options.branchId, id, 1, options.content);

    // Write metadata file
    fileStorage.writeParagraphMetadata(options.projectPath, options.branchId, id, {
      paragraphId: id,
      versions: [{
        version: 1,
        createdAt: new Date().toISOString(),
        modelUsed: options.modelUsed ?? null,
        tokenCount: options.tokenCount ?? 0,
        isActive: true,
      }],
    });

    const row = db.prepare('SELECT * FROM paragraph_meta WHERE id=?').get(id) as Record<string, unknown>;
    return this.rowToRecord(row);
  }

  updateParagraphContent(
    db: ProjectDatabase,
    projectPath: string,
    branchId: string,
    paragraphId: string,
    content: string,
    modelUsed?: string,
    tokenCount?: number,
  ): void {
    const fileStorage = getFileStorageService();

    // Get current version
    const row = db.prepare('SELECT active_version, total_versions FROM paragraph_meta WHERE id=?').get(paragraphId) as
      { active_version: number; total_versions: number } | undefined;
    if (!row) throw new Error(`段落不存在：${paragraphId}`);

    const version = row.active_version;
    fileStorage.writeParagraphContent(projectPath, branchId, paragraphId, version, content);

    // Update DB
    db.prepare(`
      UPDATE paragraph_meta
      SET model_used=?, token_count=?, updated_at=datetime('now')
      WHERE id=?
    `).run(modelUsed ?? null, tokenCount ?? 0, paragraphId);
  }

  addNewVersion(
    db: ProjectDatabase,
    projectPath: string,
    branchId: string,
    paragraphId: string,
    content: string,
    modelUsed?: string,
    tokenCount?: number,
    refined?: boolean,
  ): number {
    const fileStorage = getFileStorageService();

    const row = db.prepare('SELECT total_versions FROM paragraph_meta WHERE id=?').get(paragraphId) as
      { total_versions: number } | undefined;
    if (!row) throw new Error(`段落不存在：${paragraphId}`);

    const newVersion = row.total_versions + 1;

    // Write new version file
    fileStorage.writeParagraphContent(projectPath, branchId, paragraphId, newVersion, content);

    // Update metadata file
    const metaFile = fileStorage.readParagraphMetadata(projectPath, branchId, paragraphId);
    if (metaFile) {
      // Deactivate old versions
      const updatedVersions = metaFile.versions.map(v => ({ ...v, isActive: false }));
      updatedVersions.push({
        version: newVersion,
        createdAt: new Date().toISOString(),
        modelUsed: modelUsed ?? null,
        tokenCount: tokenCount ?? 0,
        isActive: true,
        refined: refined ?? false,
      });
      fileStorage.writeParagraphMetadata(projectPath, branchId, paragraphId, {
        paragraphId,
        versions: updatedVersions,
      });
    }

    // Update DB
    db.prepare(`
      UPDATE paragraph_meta
      SET active_version=?, total_versions=?, model_used=?, token_count=?, updated_at=datetime('now')
      WHERE id=?
    `).run(newVersion, newVersion, modelUsed ?? null, tokenCount ?? 0, paragraphId);

    return newVersion;
  }

  switchVersion(db: ProjectDatabase, paragraphId: string, version: number): void {
    db.prepare(`
      UPDATE paragraph_meta SET active_version=?, updated_at=datetime('now') WHERE id=?
    `).run(version, paragraphId);
  }

  updateStatus(db: ProjectDatabase, paragraphId: string, status: ParagraphRecord['status']): void {
    db.prepare(`
      UPDATE paragraph_meta SET status=?, updated_at=datetime('now') WHERE id=?
    `).run(status, paragraphId);
  }

  deleteParagraph(db: ProjectDatabase, paragraphId: string): void {
    db.prepare('DELETE FROM paragraph_meta WHERE id=?').run(paragraphId);

    // Optionally remove files (soft-delete in DB is already done)
    // We keep the files for potential recovery; Phase 4 can handle cleanup
  }

  listParagraphs(db: ProjectDatabase, branchId: string): ParagraphRecord[] {
    const rows = db.prepare(
      'SELECT * FROM paragraph_meta WHERE branch_id=? ORDER BY position ASC',
    ).all(branchId) as Record<string, unknown>[];
    return rows.map(r => this.rowToRecord(r));
  }

  getParagraphContent(
    db: ProjectDatabase,
    projectPath: string,
    branchId: string,
    paragraphId: string,
    version?: number,
  ): string {
    const fileStorage = getFileStorageService();

    let activeVersion = version;
    if (!activeVersion) {
      const row = db.prepare('SELECT active_version FROM paragraph_meta WHERE id=?').get(paragraphId) as
        { active_version: number } | undefined;
      activeVersion = row?.active_version ?? 1;
    }
    return fileStorage.readParagraphContent(projectPath, branchId, paragraphId, activeVersion);
  }

  rollbackFromParagraph(db: ProjectDatabase, branchId: string, paragraphId: string): void {
    // Get position of the target paragraph
    const row = db.prepare('SELECT position FROM paragraph_meta WHERE id=?').get(paragraphId) as
      { position: number } | undefined;
    if (!row) return;

    // Mark all paragraphs AFTER this position as detached
    db.prepare(`
      UPDATE paragraph_meta
      SET status='detached', updated_at=datetime('now')
      WHERE branch_id=? AND position > ?
    `).run(branchId, row.position);
  }

  getOrCreateMainBranch(db: ProjectDatabase, projectPath: string, projectId: string): string {
    const fileStorage = getFileStorageService();

    const row = db.prepare('SELECT id FROM branches WHERE project_id=? AND is_main=1').get(projectId) as
      { id: string } | undefined;
    if (row) return row.id;

    // Create main branch
    const branchId = uuidv4();
    db.prepare(`
      INSERT INTO branches (id, project_id, name, is_main, created_at, updated_at)
      VALUES (?, ?, '主線', 1, datetime('now'), datetime('now'))
    `).run(branchId, projectId);

    // Create branch directory
    fileStorage.createBranchDirectory(projectPath, branchId);

    return branchId;
  }

  getSystemPrompt(db: ProjectDatabase): string {
    const row = db.prepare("SELECT value FROM project_settings WHERE key='system_prompt'").get() as
      { value: string } | undefined;
    if (!row) return '';
    try {
      return JSON.parse(row.value) as string;
    } catch {
      return '';
    }
  }

  private rowToRecord(row: Record<string, unknown>): ParagraphRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      branchId: String(row.branch_id),
      type: row.type as 'user' | 'ai' | 'system',
      status: row.status as ParagraphRecord['status'],
      position: Number(row.position),
      activeVersion: Number(row.active_version),
      totalVersions: Number(row.total_versions),
      modelUsed: row.model_used ? String(row.model_used) : null,
      tokenCount: Number(row.token_count),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

let instance: ParagraphService | null = null;

export function getParagraphService(): ParagraphService {
  if (!instance) {
    instance = new ParagraphService();
  }
  return instance;
}

export { ParagraphService };
