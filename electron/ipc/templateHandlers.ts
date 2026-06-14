import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import { getTemplateService } from '../main/services/TemplateService.js';
import { getWorldMemoryService } from '../main/services/WorldMemoryService.js';
import { getOpenProject } from './projectHandlers.js';
import { getGlobalDatabase } from '../main/services/database.js';
import type { IpcResult } from '../shared/types.js';
import type { WorldTemplateData } from '../main/services/TemplateService.js';

// ============================================================
// Template IPC Handlers
// ============================================================

export function registerTemplateHandlers(): void {
  const service = getTemplateService();
  const worldMemoryService = getWorldMemoryService();

  // List all templates
  ipcMain.handle(
    IPC_CHANNELS.TEMPLATE_LIST,
    (): IpcResult<WorldTemplateData[]> => {
      try {
        const globalDb = getGlobalDatabase();
        if (!globalDb) return { success: false, error: { code: 'DB_ERROR', message: '全域資料庫未初始化' } };
        service.seedBuiltinTemplates(globalDb);
        const templates = service.listTemplates(globalDb);
        return { success: true, data: templates };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // Apply a template to a project
  ipcMain.handle(
    IPC_CHANNELS.TEMPLATE_APPLY,
    (_event, projectId: string, templateId: string): IpcResult<void> => {
      try {
        const globalDb = getGlobalDatabase();
        if (!globalDb) return { success: false, error: { code: 'DB_ERROR', message: '全域資料庫未初始化' } };
        const projectDb = getOpenProject(projectId);
        if (!projectDb) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        service.applyTemplate(globalDb, projectDb, projectId, templateId, worldMemoryService);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // Export current project as template
  ipcMain.handle(
    IPC_CHANNELS.TEMPLATE_EXPORT,
    (_event, projectId: string, templateName: string): IpcResult<WorldTemplateData> => {
      try {
        const globalDb = getGlobalDatabase();
        if (!globalDb) return { success: false, error: { code: 'DB_ERROR', message: '全域資料庫未初始化' } };
        const projectDb = getOpenProject(projectId);
        if (!projectDb) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const template = service.exportTemplate(globalDb, projectDb, projectId, templateName, worldMemoryService);
        return { success: true, data: template };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );
}
