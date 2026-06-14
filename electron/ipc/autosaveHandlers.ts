import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import { getAutoSaveService } from '../main/services/AutoSaveService.js';
import { getProjectStoragePath } from './projectHandlers.js';
import type { IpcResult, RecoveryCheckResult, RecoverySnapshot } from '../shared/types.js';

export function registerAutosaveHandlers(): void {
  const autoSave = getAutoSaveService();

  // Trigger autosave
  ipcMain.handle(
    IPC_CHANNELS.AUTOSAVE_TRIGGER,
    (_event, snapshot: RecoverySnapshot): IpcResult<void> => {
      try {
        const projectPath = getProjectStoragePath(snapshot.projectId);
        if (!projectPath) {
          return {
            success: false,
            error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' },
          };
        }
        autoSave.scheduleSave(projectPath, snapshot);
        return { success: true, data: undefined };
      } catch (err) {
        return {
          success: false,
          error: { code: 'AUTOSAVE_ERROR', message: '自動儲存失敗', details: err },
        };
      }
    },
  );

  // Check for recovery file
  ipcMain.handle(
    IPC_CHANNELS.AUTOSAVE_RECOVERY_CHECK,
    (_event, projectId: string): IpcResult<RecoveryCheckResult> => {
      try {
        const projectPath = getProjectStoragePath(projectId);
        if (!projectPath) {
          return { success: true, data: { hasRecovery: false } };
        }
        const recovery = autoSave.checkRecovery(projectPath);
        if (!recovery) {
          return { success: true, data: { hasRecovery: false } };
        }
        return {
          success: true,
          data: {
            hasRecovery: true,
            projectId: recovery.projectId,
            timestamp: recovery.timestamp,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: { code: 'RECOVERY_CHECK_ERROR', message: '檢查恢復檔案失敗', details: err },
        };
      }
    },
  );

  // Restore from recovery
  ipcMain.handle(
    IPC_CHANNELS.AUTOSAVE_RECOVERY_RESTORE,
    (_event, projectId: string): IpcResult<RecoverySnapshot> => {
      try {
        const projectPath = getProjectStoragePath(projectId);
        if (!projectPath) {
          return {
            success: false,
            error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' },
          };
        }
        const recovery = autoSave.checkRecovery(projectPath);
        if (!recovery) {
          return {
            success: false,
            error: { code: 'NO_RECOVERY', message: '找不到恢復檔案' },
          };
        }
        return { success: true, data: recovery };
      } catch (err) {
        return {
          success: false,
          error: { code: 'RECOVERY_RESTORE_ERROR', message: '恢復資料失敗', details: err },
        };
      }
    },
  );

  // Discard recovery
  ipcMain.handle(
    IPC_CHANNELS.AUTOSAVE_RECOVERY_DISCARD,
    (_event, projectId: string): IpcResult<void> => {
      try {
        const projectPath = getProjectStoragePath(projectId);
        if (projectPath) {
          autoSave.discardRecovery(projectPath);
        }
        return { success: true, data: undefined };
      } catch (err) {
        return {
          success: false,
          error: { code: 'RECOVERY_DISCARD_ERROR', message: '捨棄恢復檔案失敗', details: err },
        };
      }
    },
  );
}
