import { ipcMain, dialog, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { IPC_CHANNELS } from './channels.js';
import { getConfigService } from '../main/services/ConfigService.js';
import { getFileStorageService } from '../main/services/FileStorageService.js';
import {
  openProjectDatabase,
  createProjectDirectory,
  type ProjectDatabase,
} from '../main/services/database.js';
import { getParagraphService } from '../main/services/ParagraphService.js';
import { splitNovelText } from '../main/services/NovelImportService.js';
import { countWords } from '../main/services/StatsService.js';
import { v4 as uuidv4 } from 'uuid';
import type {
  IpcResult,
  CreateProjectRequest,
  ProjectInfo,
  RecentProject,
  ImportNovelRequest,
  ImportNovelResult,
} from '../shared/types.js';

// In-memory registry of open project databases
const openProjects = new Map<string, { db: ProjectDatabase; storagePath: string }>();

function getProjectInfo(projectId: string, storagePath: string): ProjectInfo | null {
  const entry = openProjects.get(projectId);
  const db = entry?.db;
  if (!db) return null;

  try {
    const settingsRow = db
      .prepare("SELECT value FROM project_settings WHERE key='project_meta'")
      .get() as { value: string } | undefined;

    if (!settingsRow) return null;
    const meta = JSON.parse(String(settingsRow.value)) as Partial<ProjectInfo>;

    const paragraphCountRow = db
      .prepare('SELECT COUNT(*) as count FROM paragraph_meta')
      .get() as { count: number };

    return {
      id: projectId,
      name: meta.name ?? '未命名專案',
      description: meta.description ?? '',
      storagePath,
      wordCount: meta.wordCount ?? 0,
      paragraphCount: Number(paragraphCountRow?.count ?? 0),
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function registerProjectHandlers(): void {
  const configService = getConfigService();
  const fileStorage = getFileStorageService();

  // Create new project
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CREATE,
    async (_event, req: CreateProjectRequest): Promise<IpcResult<ProjectInfo>> => {
      try {
        const projectId = uuidv4();
        const projectPath = path.join(req.storagePath, req.name.replace(/[<>:"/\\|?*]/g, '_'));

        // Create directories
        createProjectDirectory(projectPath);

        // Open database (async with sql.js)
        const db = await openProjectDatabase(projectPath);

        // Store project metadata in project_settings
        const now = new Date().toISOString();
        const meta: ProjectInfo = {
          id: projectId,
          name: req.name,
          description: req.description,
          storagePath: projectPath,
          wordCount: 0,
          paragraphCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        db.prepare(
          "INSERT OR REPLACE INTO project_settings (key, value) VALUES ('project_meta', ?)",
        ).run(JSON.stringify(meta));

        // Create the default main branch
        const mainBranchId = uuidv4();
        db.prepare(
          `INSERT INTO branches (id, project_id, name, is_main)
           VALUES (?, ?, '主線', 1)`,
        ).run(mainBranchId, projectId);

        // Register in memory
        openProjects.set(projectId, { db, storagePath: projectPath });

        // Add to recent projects
        configService.addRecentProject({
          id: projectId,
          name: req.name,
          path: projectPath,
          lastOpenedAt: now,
        });

        return { success: true, data: meta };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'PROJECT_CREATE_ERROR', message: `建立專案失敗：${message}`, details: err },
        };
      }
    },
  );

  // Open existing project
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_OPEN,
    async (_event, projectPath: string): Promise<IpcResult<ProjectInfo>> => {
      try {
        if (!fileStorage.isValidProject(projectPath)) {
          return {
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: '找不到有效的專案資料庫' },
          };
        }

        const db = await openProjectDatabase(projectPath);

        const settingsRow = db
          .prepare("SELECT value FROM project_settings WHERE key='project_meta'")
          .get() as { value: string } | undefined;

        if (!settingsRow) {
          return {
            success: false,
            error: { code: 'PROJECT_CORRUPT', message: '專案資料損毀，無法讀取中繼資料' },
          };
        }

        const meta = JSON.parse(String(settingsRow.value)) as ProjectInfo;
        // Update storagePath in case it moved
        meta.storagePath = projectPath;

        openProjects.set(meta.id, { db, storagePath: projectPath });

        const now = new Date().toISOString();
        configService.addRecentProject({
          id: meta.id,
          name: meta.name,
          path: projectPath,
          lastOpenedAt: now,
        });

        const paragraphCountRow = db
          .prepare('SELECT COUNT(*) as count FROM paragraph_meta')
          .get() as { count: number };

        return {
          success: true,
          data: { ...meta, paragraphCount: Number(paragraphCountRow?.count ?? 0) },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'PROJECT_OPEN_ERROR', message: `開啟專案失敗：${message}`, details: err },
        };
      }
    },
  );

  // Delete project
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_DELETE,
    (_event, projectId: string): IpcResult<void> => {
      try {
        const entry = openProjects.get(projectId);
        if (entry) {
          entry.db.close();
          openProjects.delete(projectId);
          fileStorage.deleteProjectDirectory(entry.storagePath);
        }

        configService.removeRecentProject(projectId);
        return { success: true, data: undefined };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'PROJECT_DELETE_ERROR', message: `刪除專案失敗：${message}`, details: err },
        };
      }
    },
  );

  // List all recent projects
  ipcMain.handle(IPC_CHANNELS.PROJECT_LIST, async (): Promise<IpcResult<ProjectInfo[]>> => {
    try {
      const recentProjects = configService.getRecentProjects();
      const projects: ProjectInfo[] = [];

      for (const rp of recentProjects) {
        if (!fileStorage.isValidProject(rp.path)) continue;

        let entry = openProjects.get(rp.id);
        if (!entry) {
          try {
            const db = await openProjectDatabase(rp.path);
            entry = { db, storagePath: rp.path };
            openProjects.set(rp.id, entry);
          } catch {
            continue;
          }
        }

        const info = getProjectInfo(rp.id, rp.path);
        if (info) {
          const stats = fs.statSync(rp.path);
          projects.push({
            ...info,
            updatedAt: stats.mtime.toISOString(),
          });
        }
      }

      return { success: true, data: projects };
    } catch (err) {
      return {
        success: false,
        error: { code: 'PROJECT_LIST_ERROR', message: '讀取專案清單失敗', details: err },
      };
    }
  });

  // Get recent projects list
  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_RECENT, (): IpcResult<RecentProject[]> => {
    try {
      return { success: true, data: configService.getRecentProjects() };
    } catch (err) {
      return {
        success: false,
        error: { code: 'RECENT_LIST_ERROR', message: '讀取最近專案失敗', details: err },
      };
    }
  });

  // Get a project setting value
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_GET_SETTING,
    (_event, projectId: string, key: string): IpcResult<unknown> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const row = db.prepare('SELECT value FROM project_settings WHERE key=?').get(key) as
          | { value: string }
          | undefined;
        if (!row) return { success: true, data: null };
        try {
          return { success: true, data: JSON.parse(row.value) };
        } catch {
          return { success: true, data: row.value };
        }
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // Set a project setting value
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_SET_SETTING,
    (_event, projectId: string, key: string, value: unknown): IpcResult<void> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        db.prepare('INSERT OR REPLACE INTO project_settings (key, value) VALUES (?, ?)').run(
          key,
          JSON.stringify(value),
        );
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // Select storage path via dialog
  ipcMain.handle(IPC_CHANNELS.PROJECT_SELECT_PATH, async (_event, title?: string): Promise<IpcResult<string>> => {
    try {
      const defaultPath = configService.get('defaultStoragePath') || app.getPath('documents');
      const result = await dialog.showOpenDialog({
        title: title || '選擇專案儲存位置',
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return {
          success: false,
          error: { code: 'USER_CANCELLED', message: '使用者取消了路徑選擇' },
        };
      }

      return { success: true, data: result.filePaths[0] };
    } catch (err) {
      return {
        success: false,
        error: { code: 'PATH_SELECT_ERROR', message: '選擇路徑失敗', details: err },
      };
    }
  });

  // Select a novel text file to import via dialog
  ipcMain.handle(IPC_CHANNELS.PROJECT_SELECT_NOVEL_FILE, async (): Promise<IpcResult<string>> => {
    try {
      const result = await dialog.showOpenDialog({
        title: '選擇小說檔案',
        filters: [
          { name: '文字檔案', extensions: ['txt', 'md', 'markdown'] },
          { name: '所有檔案', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return {
          success: false,
          error: { code: 'USER_CANCELLED', message: '使用者取消了檔案選擇' },
        };
      }

      return { success: true, data: result.filePaths[0] };
    } catch (err) {
      return {
        success: false,
        error: { code: 'FILE_SELECT_ERROR', message: '選擇檔案失敗', details: err },
      };
    }
  });

  // Import an existing novel file as a new project
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_IMPORT_NOVEL,
    async (_event, req: ImportNovelRequest): Promise<IpcResult<ImportNovelResult>> => {
      try {
        if (!req.filePath || !fs.existsSync(req.filePath)) {
          return {
            success: false,
            error: { code: 'FILE_NOT_FOUND', message: `找不到檔案：${req.filePath}` },
          };
        }

        const raw = fs.readFileSync(req.filePath, 'utf-8');
        // Invalid UTF-8 bytes decode to U+FFFD; reject files that are clearly not UTF-8
        const invalidCount = (raw.match(/�/g) ?? []).length;
        if (raw.length > 0 && invalidCount > raw.length * 0.01) {
          return {
            success: false,
            error: {
              code: 'FILE_ENCODING_ERROR',
              message: '無法讀取檔案內容，請確認檔案為 UTF-8 編碼的文字檔',
            },
          };
        }

        const segments = splitNovelText(raw);
        if (segments.length === 0) {
          return {
            success: false,
            error: { code: 'FILE_EMPTY', message: '檔案內容為空，無法匯入' },
          };
        }

        const projectId = uuidv4();
        const projectPath = path.join(req.storagePath, req.name.replace(/[<>:"/\\|?*]/g, '_'));

        createProjectDirectory(projectPath);
        const db = await openProjectDatabase(projectPath);

        // Create the default main branch
        const mainBranchId = uuidv4();
        db.prepare(
          `INSERT INTO branches (id, project_id, name, is_main)
           VALUES (?, ?, '主線', 1)`,
        ).run(mainBranchId, projectId);

        // Insert all paragraphs in one transaction so the DB file is persisted once
        const paragraphService = getParagraphService();
        let wordCount = 0;
        db.beginTransaction();
        try {
          for (const content of segments) {
            paragraphService.createParagraph(db, {
              projectPath,
              projectId,
              branchId: mainBranchId,
              type: 'user',
              content,
            });
            wordCount += countWords(content);
          }
          db.commitTransaction();
        } catch (err) {
          db.rollbackTransaction();
          throw err;
        }

        const now = new Date().toISOString();
        const meta: ProjectInfo = {
          id: projectId,
          name: req.name,
          description: req.description,
          storagePath: projectPath,
          wordCount,
          paragraphCount: segments.length,
          createdAt: now,
          updatedAt: now,
        };
        db.prepare(
          "INSERT OR REPLACE INTO project_settings (key, value) VALUES ('project_meta', ?)",
        ).run(JSON.stringify(meta));

        openProjects.set(projectId, { db, storagePath: projectPath });

        configService.addRecentProject({
          id: projectId,
          name: req.name,
          path: projectPath,
          lastOpenedAt: now,
        });

        return {
          success: true,
          data: { project: meta, paragraphsImported: segments.length, wordCount },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'NOVEL_IMPORT_ERROR', message: `匯入小說失敗：${message}`, details: err },
        };
      }
    },
  );
}

// Export for use by other handlers
export function getOpenProject(projectId: string): ProjectDatabase | null {
  return openProjects.get(projectId)?.db ?? null;
}

export function getProjectStoragePath(projectId: string): string | null {
  return openProjects.get(projectId)?.storagePath ?? null;
}
