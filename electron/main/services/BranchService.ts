import { v4 as uuidv4 } from 'uuid';
import type { ProjectDatabase } from './database.js';

// ============================================================
// BranchService — Branch CRUD + copy-on-fork world memory
// ============================================================

export interface BranchRecord {
  id: string;
  projectId: string;
  parentBranchId: string | null;
  forkParagraphId: string | null;
  name: string;
  isMain: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToBranch(row: Record<string, unknown>): BranchRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    parentBranchId: row.parent_branch_id ? String(row.parent_branch_id) : null,
    forkParagraphId: row.fork_paragraph_id ? String(row.fork_paragraph_id) : null,
    name: String(row.name),
    isMain: Boolean(row.is_main),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export interface BranchTreeNode {
  branch: BranchRecord;
  children: BranchTreeNode[];
}

export class BranchService {
  // ----------------------------------------------------------
  // List all branches for a project
  // ----------------------------------------------------------
  listBranches(db: ProjectDatabase, projectId: string): BranchRecord[] {
    const rows = db
      .prepare('SELECT * FROM branches WHERE project_id=? ORDER BY created_at ASC')
      .all(projectId);
    return rows.map(rowToBranch);
  }

  // ----------------------------------------------------------
  // Get a single branch
  // ----------------------------------------------------------
  getBranch(db: ProjectDatabase, branchId: string): BranchRecord | null {
    const row = db.prepare('SELECT * FROM branches WHERE id=?').get(branchId);
    return row ? rowToBranch(row) : null;
  }

  // ----------------------------------------------------------
  // Get the main branch for a project
  // ----------------------------------------------------------
  getMainBranch(db: ProjectDatabase, projectId: string): BranchRecord | null {
    const row = db
      .prepare('SELECT * FROM branches WHERE project_id=? AND is_main=1 LIMIT 1')
      .get(projectId);
    if (row) return rowToBranch(row);

    // Fallback: return first branch
    const first = db
      .prepare('SELECT * FROM branches WHERE project_id=? ORDER BY created_at ASC LIMIT 1')
      .get(projectId);
    return first ? rowToBranch(first) : null;
  }

  // ----------------------------------------------------------
  // Create a new branch (copy-on-fork model)
  // Characters are SHARED (global to project), relationships and
  // events are COPIED to the new branch.
  // ----------------------------------------------------------
  createBranch(
    db: ProjectDatabase,
    projectId: string,
    parentBranchId: string,
    forkParagraphId: string | null,
    name: string,
  ): BranchRecord {
    const now = new Date().toISOString();
    const newBranchId = uuidv4();

    db.beginTransaction();
    try {
      // Insert new branch record
      db.prepare(
        `INSERT INTO branches (id, project_id, parent_branch_id, fork_paragraph_id, name, is_main, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      ).run(newBranchId, projectId, parentBranchId, forkParagraphId ?? null, name, now, now);

      // Copy relationships from parent branch to new branch
      const relationships = db
        .prepare('SELECT * FROM relationships WHERE project_id=? AND branch_id=?')
        .all(projectId, parentBranchId);

      for (const rel of relationships) {
        const newRelId = uuidv4();
        db.prepare(
          `INSERT INTO relationships
            (id, project_id, branch_id, character_a_id, character_b_id,
             relationship_type, affinity_score, description, shared_events,
             source_paragraph_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newRelId,
          projectId,
          newBranchId,
          rel.character_a_id,
          rel.character_b_id,
          rel.relationship_type,
          rel.affinity_score,
          rel.description,
          rel.shared_events,
          rel.source_paragraph_id ?? null,
          now,
          now,
        );
      }

      // Copy events from parent branch to new branch
      const events = db
        .prepare('SELECT * FROM events WHERE project_id=? AND branch_id=?')
        .all(projectId, parentBranchId);

      for (const evt of events) {
        const newEvtId = uuidv4();
        db.prepare(
          `INSERT INTO events
            (id, project_id, branch_id, name, description, story_timestamp,
             impact, participating_characters, paragraph_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newEvtId,
          projectId,
          newBranchId,
          evt.name,
          evt.description,
          evt.story_timestamp,
          evt.impact,
          evt.participating_characters,
          evt.paragraph_id ?? null,
          now,
          now,
        );
      }

      db.commitTransaction();
    } catch (err) {
      db.rollbackTransaction();
      throw err;
    }

    return this.getBranch(db, newBranchId)!;
  }

  // ----------------------------------------------------------
  // Rename a branch
  // ----------------------------------------------------------
  renameBranch(db: ProjectDatabase, branchId: string, newName: string): BranchRecord | null {
    const now = new Date().toISOString();
    db.prepare('UPDATE branches SET name=?, updated_at=? WHERE id=?').run(newName, now, branchId);
    return this.getBranch(db, branchId);
  }

  // ----------------------------------------------------------
  // Delete a branch (cannot delete the main branch)
  // ----------------------------------------------------------
  deleteBranch(db: ProjectDatabase, branchId: string): void {
    const branch = this.getBranch(db, branchId);
    if (!branch) return;
    if (branch.isMain) throw new Error('無法刪除主線分支');

    // Delete branch-specific world memory data
    db.prepare('DELETE FROM relationships WHERE branch_id=?').run(branchId);
    db.prepare('DELETE FROM events WHERE branch_id=?').run(branchId);

    // Delete paragraph metadata for this branch
    db.prepare('DELETE FROM paragraph_meta WHERE branch_id=?').run(branchId);

    // Delete the branch record
    db.prepare('DELETE FROM branches WHERE id=?').run(branchId);
  }

  // ----------------------------------------------------------
  // Set a branch as the main branch
  // ----------------------------------------------------------
  setMainBranch(db: ProjectDatabase, projectId: string, branchId: string): void {
    // Unset all main flags for this project
    db.prepare('UPDATE branches SET is_main=0, updated_at=? WHERE project_id=?').run(
      new Date().toISOString(),
      projectId,
    );
    // Set the new main
    db.prepare('UPDATE branches SET is_main=1, updated_at=? WHERE id=?').run(
      new Date().toISOString(),
      branchId,
    );
  }

  // ----------------------------------------------------------
  // Build branch tree structure for UI rendering
  // ----------------------------------------------------------
  getBranchTree(db: ProjectDatabase, projectId: string): BranchTreeNode[] {
    const branches = this.listBranches(db, projectId);
    const nodeMap = new Map<string, BranchTreeNode>();

    for (const branch of branches) {
      nodeMap.set(branch.id, { branch, children: [] });
    }

    const roots: BranchTreeNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.branch.parentBranchId && nodeMap.has(node.branch.parentBranchId)) {
        nodeMap.get(node.branch.parentBranchId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}

let _branchService: BranchService | null = null;
export function getBranchService(): BranchService {
  if (!_branchService) _branchService = new BranchService();
  return _branchService;
}
