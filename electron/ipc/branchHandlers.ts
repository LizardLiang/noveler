import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import { getBranchService } from '../main/services/BranchService.js';
import { getOpenProject } from './projectHandlers.js';
import type { IpcResult } from '../shared/types.js';
import type { BranchRecord, BranchTreeNode } from '../main/services/BranchService.js';

// ============================================================
// Branch IPC Handlers
// ============================================================

export function registerBranchHandlers(): void {
  const service = getBranchService();

  // Get the full branch tree for the project
  ipcMain.handle(
    IPC_CHANNELS.BRANCH_GET_TREE,
    (_event, projectId: string): IpcResult<BranchTreeNode[]> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const tree = service.getBranchTree(db, projectId);
        return { success: true, data: tree };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // Create a new branch (copy-on-fork)
  ipcMain.handle(
    IPC_CHANNELS.BRANCH_CREATE,
    (
      _event,
      projectId: string,
      parentBranchId: string,
      forkParagraphId: string | null,
      name: string,
    ): IpcResult<BranchRecord> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const branch = service.createBranch(db, projectId, parentBranchId, forkParagraphId, name);
        return { success: true, data: branch };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // Switch branch — returns the branch record (renderer updates its state)
  ipcMain.handle(
    IPC_CHANNELS.BRANCH_SWITCH,
    (_event, projectId: string, branchId: string): IpcResult<BranchRecord> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const branch = service.getBranch(db, branchId);
        if (!branch) return { success: false, error: { code: 'NOT_FOUND', message: '找不到分支' } };
        return { success: true, data: branch };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // Rename a branch
  ipcMain.handle(
    IPC_CHANNELS.BRANCH_RENAME,
    (_event, projectId: string, branchId: string, newName: string): IpcResult<BranchRecord> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const branch = service.renameBranch(db, branchId, newName);
        if (!branch) return { success: false, error: { code: 'NOT_FOUND', message: '找不到分支' } };
        return { success: true, data: branch };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // Delete a branch
  ipcMain.handle(
    IPC_CHANNELS.BRANCH_DELETE,
    (_event, projectId: string, branchId: string): IpcResult<void> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        service.deleteBranch(db, branchId);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // Set a branch as the main branch
  ipcMain.handle(
    IPC_CHANNELS.BRANCH_SET_MAIN,
    (_event, projectId: string, branchId: string): IpcResult<void> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        service.setMainBranch(db, projectId, branchId);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );
}
