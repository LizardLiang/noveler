import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import { getSearchService } from '../main/services/SearchService.js';
import { getOpenProject, getProjectStoragePath } from './projectHandlers.js';
import type { IpcResult } from '../shared/types.js';
import type {
  CharacterSearchResult,
  EventSearchResult,
  FulltextSearchResult,
  EventSearchFilters,
} from '../main/services/SearchService.js';

// ============================================================
// Search IPC Handlers
// ============================================================

export function registerSearchHandlers(): void {
  const service = getSearchService();

  // Character search
  ipcMain.handle(
    IPC_CHANNELS.SEARCH_CHARACTERS,
    (_event, projectId: string, query: string): IpcResult<CharacterSearchResult[]> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const results = service.searchCharacters(db, projectId, query);
        return { success: true, data: results };
      } catch (err) {
        return { success: false, error: { code: 'SEARCH_ERROR', message: String(err) } };
      }
    },
  );

  // Event search
  ipcMain.handle(
    IPC_CHANNELS.SEARCH_EVENTS,
    (
      _event,
      projectId: string,
      query: string,
      filters?: EventSearchFilters,
    ): IpcResult<EventSearchResult[]> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const results = service.searchEvents(db, projectId, query, filters);
        return { success: true, data: results };
      } catch (err) {
        return { success: false, error: { code: 'SEARCH_ERROR', message: String(err) } };
      }
    },
  );

  // Fulltext search
  ipcMain.handle(
    IPC_CHANNELS.SEARCH_FULLTEXT,
    (
      _event,
      projectId: string,
      branchId: string,
      query: string,
    ): IpcResult<FulltextSearchResult[]> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const storagePath = getProjectStoragePath(projectId);
        if (!storagePath) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案路徑未知' } };
        const results = service.searchFulltext(db, storagePath, projectId, branchId, query);
        return { success: true, data: results };
      } catch (err) {
        return { success: false, error: { code: 'SEARCH_ERROR', message: String(err) } };
      }
    },
  );
}
