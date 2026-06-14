import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import { getStatsService } from '../main/services/StatsService.js';
import { getOpenProject, getProjectStoragePath } from './projectHandlers.js';
import type { IpcResult } from '../shared/types.js';
import type { StoryStats } from '../main/services/StatsService.js';

export function registerStatsHandlers(): void {
  // stats:get — compute story statistics for a project/branch
  ipcMain.handle(
    IPC_CHANNELS.STATS_GET,
    async (_event, projectId: string, branchId: string): Promise<IpcResult<StoryStats>> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) {
          return {
            success: false,
            error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' },
          };
        }

        const projectPath = getProjectStoragePath(projectId);
        if (!projectPath) {
          return {
            success: false,
            error: { code: 'PROJECT_PATH_MISSING', message: '找不到專案路徑' },
          };
        }

        const statsService = getStatsService();
        const stats = statsService.getStats(db, projectId, branchId, projectPath);

        return { success: true, data: stats };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'STATS_ERROR', message: `統計計算失敗：${message}`, details: err },
        };
      }
    },
  );
}
