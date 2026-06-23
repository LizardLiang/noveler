import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import { getParagraphService } from '../main/services/ParagraphService.js';
import { getWorldMemoryService } from '../main/services/WorldMemoryService.js';
import { getProjectStoragePath, getOpenProject } from './projectHandlers.js';
import type { IpcResult } from '../shared/types.js';
import type { ParagraphRecord } from '../main/services/ParagraphService.js';

export function registerParagraphHandlers(): void {
  const paragraphService = getParagraphService();

  // List paragraphs for a branch
  ipcMain.handle(
    IPC_CHANNELS.PARAGRAPH_LIST,
    (_event, projectId: string, branchId: string): IpcResult<ParagraphRecord[]> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }
        const paragraphs = paragraphService.listParagraphs(db, branchId);
        return { success: true, data: paragraphs };
      } catch (err) {
        return { success: false, error: { code: 'PARAGRAPH_LIST_ERROR', message: '讀取段落失敗', details: err } };
      }
    },
  );

  // Get paragraph content
  ipcMain.handle(
    IPC_CHANNELS.PARAGRAPH_GET_CONTENT,
    (_event, projectId: string, branchId: string, paragraphId: string, version?: number): IpcResult<string> => {
      try {
        const db = getOpenProject(projectId);
        const projectPath = getProjectStoragePath(projectId);
        if (!db || !projectPath) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }
        const content = paragraphService.getParagraphContent(db, projectPath, branchId, paragraphId, version);
        return { success: true, data: content };
      } catch (err) {
        return { success: false, error: { code: 'PARAGRAPH_READ_ERROR', message: '讀取段落內容失敗', details: err } };
      }
    },
  );

  // Delete paragraph (with optional cascade delete of associated world memory)
  ipcMain.handle(
    IPC_CHANNELS.PARAGRAPH_DELETE,
    (_event, projectId: string, branchId: string, paragraphId: string, cascade = false): IpcResult<void> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }

        // Cascade: delete associated world memory items before deleting the paragraph
        if (cascade) {
          try {
            // Delete characters associated with this paragraph
            db.prepare('DELETE FROM characters WHERE source_paragraph_id=?').run(paragraphId);
            // Delete events associated with this paragraph
            db.prepare('DELETE FROM events WHERE paragraph_id=?').run(paragraphId);
          } catch {
            // Non-blocking — best effort for cascade
          }
        }

        paragraphService.deleteParagraph(db, paragraphId);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'PARAGRAPH_DELETE_ERROR', message: '刪除段落失敗', details: err } };
      }
    },
  );

  // Create an opening paragraph (開場白) — user-authored prose saved directly as
  // the story's first block, without invoking the AI. Stored as a 'system' type so
  // it renders as story prose (not a user chat bubble) and the model treats it as
  // prior story content to continue from. Ensures the main branch exists first so
  // this works on a brand-new, empty story.
  ipcMain.handle(
    IPC_CHANNELS.PARAGRAPH_CREATE_OPENING,
    (_event, projectId: string, branchId: string, content: string): IpcResult<ParagraphRecord> => {
      try {
        const db = getOpenProject(projectId);
        const projectPath = getProjectStoragePath(projectId);
        if (!db || !projectPath) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }
        const text = (content ?? '').trim();
        if (!text) {
          return { success: false, error: { code: 'EMPTY_OPENING', message: '開場白內容不可為空' } };
        }
        const effectiveBranchId = branchId || paragraphService.getOrCreateMainBranch(db, projectPath, projectId);
        const paragraph = paragraphService.createParagraph(db, {
          projectPath,
          projectId,
          branchId: effectiveBranchId,
          type: 'system',
          content: text,
        });
        return { success: true, data: paragraph };
      } catch (err) {
        return { success: false, error: { code: 'PARAGRAPH_CREATE_OPENING_ERROR', message: '建立開場白失敗', details: err } };
      }
    },
  );

  // Get world memory items linked to a paragraph
  ipcMain.handle(
    IPC_CHANNELS.PARAGRAPH_GET_LINKED_WORLD_MEMORY,
    (_event, projectId: string, paragraphId: string): IpcResult<{ type: string; name: string }[]> => {
      try {
        const projectDb = getOpenProject(projectId);
        if (!projectDb) {
          return { success: true, data: [] };
        }

        const items: { type: string; name: string }[] = [];

        // Characters with source_paragraph_id matching
        const characters = projectDb
          .prepare("SELECT name FROM characters WHERE source_paragraph_id=? AND project_id=?")
          .all(paragraphId, projectId) as { name: string }[];
        for (const char of characters) {
          items.push({ type: 'character', name: String(char.name) });
        }

        // Events with paragraph_id matching
        const events = projectDb
          .prepare("SELECT name FROM events WHERE paragraph_id=? AND project_id=?")
          .all(paragraphId, projectId) as { name: string }[];
        for (const ev of events) {
          items.push({ type: 'event', name: String(ev.name) });
        }

        return { success: true, data: items };
      } catch {
        return { success: true, data: [] };
      }
    },
  );

  // Switch paragraph version
  ipcMain.handle(
    IPC_CHANNELS.PARAGRAPH_SWITCH_VERSION,
    (_event, projectId: string, paragraphId: string, version: number): IpcResult<void> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }
        paragraphService.switchVersion(db, paragraphId, version);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'PARAGRAPH_SWITCH_VERSION_ERROR', message: '切換版本失敗', details: err } };
      }
    },
  );

  // Edit — author manually rewrites a paragraph. Saves a NEW version (the original
  // is preserved as a prior version) and makes it active, so the next generation —
  // which reads the active version via getParagraphContent — uses the edited text.
  ipcMain.handle(
    IPC_CHANNELS.PARAGRAPH_EDIT,
    (_event, projectId: string, branchId: string, paragraphId: string, content: string): IpcResult<ParagraphRecord> => {
      try {
        const db = getOpenProject(projectId);
        const projectPath = getProjectStoragePath(projectId);
        if (!db || !projectPath) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }
        // modelUsed omitted (author edit, not a model output); a new active version is created.
        paragraphService.addNewVersion(db, projectPath, branchId, paragraphId, content);
        const updated = paragraphService.getParagraph(db, paragraphId);
        if (!updated) {
          return { success: false, error: { code: 'PARAGRAPH_NOT_FOUND', message: '段落不存在' } };
        }
        return { success: true, data: updated };
      } catch (err) {
        return { success: false, error: { code: 'PARAGRAPH_EDIT_ERROR', message: '編輯段落失敗', details: err } };
      }
    },
  );

  // Rollback — mark paragraphs after a point as detached + rollback world memory
  ipcMain.handle(
    IPC_CHANNELS.PARAGRAPH_ROLLBACK,
    (_event, projectId: string, branchId: string, paragraphId: string): IpcResult<void> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) {
          return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        }
        const worldMemoryService = getWorldMemoryService();
        db.beginTransaction();
        try {
          worldMemoryService.rollbackWorldMemory(db, projectId, branchId, paragraphId);
          paragraphService.rollbackFromParagraph(db, branchId, paragraphId);
          db.commitTransaction();
        } catch (txErr) {
          db.rollbackTransaction();
          throw txErr;
        }
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'PARAGRAPH_ROLLBACK_ERROR', message: '回溯段落失敗', details: err } };
      }
    },
  );
}
