import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { IPC_CHANNELS } from './channels.js';
import { getWorldMemoryService, type WorldMemoryService } from '../main/services/WorldMemoryService.js';
import { getOpenProject } from './projectHandlers.js';
import type { ProjectDatabase } from '../main/services/database.js';
import type { IpcResult } from '../shared/types.js';
import type { Character, Relationship, RelationshipChange, RelationshipTrend, StoryEvent } from '../shared/worldMemoryTypes.js';

// ============================================================
// World Memory IPC Handlers
// Character / Relationship / Event CRUD + accept/reject detection
// ============================================================

export function registerWorldMemoryHandlers(): void {
  const service = getWorldMemoryService();

  // ---- Characters ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_GET_CHARACTERS,
    (_event, projectId: string): IpcResult<Character[]> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const characters = service.listCharacters(db, projectId);
        return { success: true, data: characters };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_CREATE_CHARACTER,
    (_event, projectId: string, data: Partial<Character> & { name: string }): IpcResult<Character> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const character = service.createCharacter(db, projectId, data);
        return { success: true, data: character };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_UPDATE_CHARACTER,
    (_event, projectId: string, id: string, updates: Partial<Character>): IpcResult<Character> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const character = service.updateCharacter(db, id, updates);
        if (!character) return { success: false, error: { code: 'NOT_FOUND', message: '找不到角色' } };
        return { success: true, data: character };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_DELETE_CHARACTER,
    (_event, projectId: string, id: string): IpcResult<void> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        service.deleteCharacter(db, id);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // ---- Relationships ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_GET_RELATIONSHIPS,
    (_event, projectId: string, branchId: string): IpcResult<Relationship[]> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const relationships = service.listRelationships(db, projectId, branchId);
        return { success: true, data: relationships };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_CREATE_RELATIONSHIP,
    (
      _event,
      projectId: string,
      branchId: string,
      data: {
        characterAId: string;
        characterBId: string;
        relationshipType: string;
        affinityScore?: number;
        description?: string;
        sourceParagraphId?: string | null;
      },
    ): IpcResult<Relationship> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const relationship = service.createRelationship(db, projectId, branchId, data);
        return { success: true, data: relationship };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_UPDATE_RELATIONSHIP,
    (
      _event,
      projectId: string,
      id: string,
      updates: { relationshipType?: string; affinityScore?: number; description?: string; importance?: number; trend?: RelationshipTrend },
    ): IpcResult<Relationship> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const relationship = service.updateRelationship(db, id, updates);
        if (!relationship) return { success: false, error: { code: 'NOT_FOUND', message: '找不到關係' } };
        return { success: true, data: relationship };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_GET_RELATIONSHIP_CHANGES,
    (_event, projectId: string, relationshipId: string): IpcResult<RelationshipChange[]> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        return { success: true, data: service.listRelationshipChanges(db, relationshipId) };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_DELETE_RELATIONSHIP,
    (_event, projectId: string, id: string): IpcResult<void> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        service.deleteRelationship(db, id);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // ---- Events ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_GET_EVENTS,
    (_event, projectId: string, branchId: string): IpcResult<StoryEvent[]> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const events = service.listEvents(db, projectId, branchId);
        return { success: true, data: events };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_CREATE_EVENT,
    (
      _event,
      projectId: string,
      branchId: string,
      data: {
        name: string;
        description: string;
        participatingCharacters?: string[];
        impact?: string;
        storyTimestamp?: string;
        status?: 'occurred' | 'planned';
        paragraphId?: string | null;
      },
    ): IpcResult<StoryEvent> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const event = service.createEvent(db, projectId, branchId, data);
        return { success: true, data: event };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_UPDATE_EVENT,
    (
      _event,
      projectId: string,
      id: string,
      updates: {
        name?: string;
        description?: string;
        storyTimestamp?: string;
        impact?: string;
        participatingCharacters?: string[];
        status?: 'occurred' | 'planned';
      },
    ): IpcResult<StoryEvent> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const event = service.updateEvent(db, id, updates);
        if (!event) return { success: false, error: { code: 'NOT_FOUND', message: '找不到事件' } };
        return { success: true, data: event };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_DELETE_EVENT,
    (_event, projectId: string, id: string): IpcResult<void> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        service.deleteEvent(db, id);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // ---- Bulk delete (clear all) ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_DELETE_ALL_CHARACTERS,
    (_event, projectId: string): IpcResult<{ deleted: number }> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const deleted = service.deleteAllCharacters(db, projectId);
        return { success: true, data: { deleted } };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_DELETE_ALL_RELATIONSHIPS,
    (_event, projectId: string, branchId: string): IpcResult<{ deleted: number }> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const deleted = service.deleteAllRelationships(db, projectId, branchId);
        return { success: true, data: { deleted } };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_DELETE_ALL_EVENTS,
    (_event, projectId: string, branchId: string): IpcResult<{ deleted: number }> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };
        const deleted = service.deleteAllEvents(db, projectId, branchId);
        return { success: true, data: { deleted } };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // ---- Import characters from JSON file ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_IMPORT_CHARACTERS,
    async (
      event,
      projectId: string,
    ): Promise<IpcResult<{ created: Character[]; updated: Character[]; skipped: string[] }>> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };

        const win = BrowserWindow.fromWebContents(event.sender);
        const dialogResult = await dialog.showOpenDialog(win!, {
          title: '匯入角色 JSON',
          filters: [{ name: 'JSON', extensions: ['json'] }],
          properties: ['openFile'],
        });
        if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
          return { success: false, error: { code: 'CANCELLED', message: '使用者取消' } };
        }

        const raw = await readFile(dialogResult.filePaths[0], 'utf-8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return { success: false, error: { code: 'INVALID_JSON', message: 'JSON 格式錯誤' } };
        }

        const items = Array.isArray(parsed) ? parsed : [parsed];
        const valid = items.filter(
          (item): item is Record<string, unknown> & { name: string } =>
            typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).name === 'string',
        );
        if (valid.length === 0) {
          return { success: false, error: { code: 'NO_VALID_CHARACTERS', message: '找不到有效角色資料（需包含 name 欄位）' } };
        }

        const result = service.importCharacters(db, projectId, valid);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // ---- Import characters from pasted JSON text ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_IMPORT_CHARACTERS_TEXT,
    (
      _event,
      projectId: string,
      jsonText: string,
    ): IpcResult<{ created: Character[]; updated: Character[]; skipped: string[] }> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          return { success: false, error: { code: 'INVALID_JSON', message: 'JSON 格式錯誤' } };
        }

        const items = Array.isArray(parsed) ? parsed : [parsed];
        const valid = items.filter(
          (item): item is Record<string, unknown> & { name: string } =>
            typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).name === 'string',
        );
        if (valid.length === 0) {
          return { success: false, error: { code: 'NO_VALID_CHARACTERS', message: '找不到有效角色資料（需包含 name 欄位）' } };
        }

        const result = service.importCharacters(db, projectId, valid);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // ---- Import relationships from JSON file ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_IMPORT_RELATIONSHIPS,
    async (
      event,
      projectId: string,
      branchId: string,
    ): Promise<IpcResult<{ created: Relationship[]; updated: Relationship[]; skipped: string[] }>> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };

        const win = BrowserWindow.fromWebContents(event.sender);
        const dialogResult = await dialog.showOpenDialog(win!, {
          title: '匯入關係 JSON',
          filters: [{ name: 'JSON', extensions: ['json'] }],
          properties: ['openFile'],
        });
        if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
          return { success: false, error: { code: 'CANCELLED', message: '使用者取消' } };
        }

        const raw = await readFile(dialogResult.filePaths[0], 'utf-8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return { success: false, error: { code: 'INVALID_JSON', message: 'JSON 格式錯誤' } };
        }

        const items = Array.isArray(parsed) ? parsed : [parsed];
        const valid = items.filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null &&
            typeof (item as Record<string, unknown>).characterA === 'string' &&
            typeof (item as Record<string, unknown>).characterB === 'string',
        );
        if (valid.length === 0) {
          return { success: false, error: { code: 'NO_VALID_DATA', message: '找不到有效關係資料（需包含 characterA 及 characterB 欄位）' } };
        }

        const result = service.importRelationships(db, projectId, branchId, valid);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // ---- Import relationships from pasted JSON text ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_IMPORT_RELATIONSHIPS_TEXT,
    (
      _event,
      projectId: string,
      branchId: string,
      jsonText: string,
    ): IpcResult<{ created: Relationship[]; updated: Relationship[]; skipped: string[] }> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          return { success: false, error: { code: 'INVALID_JSON', message: 'JSON 格式錯誤' } };
        }

        const items = Array.isArray(parsed) ? parsed : [parsed];
        const valid = items.filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null &&
            typeof (item as Record<string, unknown>).characterA === 'string' &&
            typeof (item as Record<string, unknown>).characterB === 'string',
        );
        if (valid.length === 0) {
          return { success: false, error: { code: 'NO_VALID_DATA', message: '找不到有效關係資料（需包含 characterA 及 characterB 欄位）' } };
        }

        const result = service.importRelationships(db, projectId, branchId, valid);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // ---- Import events from JSON file ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_IMPORT_EVENTS,
    async (
      event,
      projectId: string,
      branchId: string,
    ): Promise<IpcResult<{ created: StoryEvent[]; updated: StoryEvent[]; skipped: string[] }>> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };

        const win = BrowserWindow.fromWebContents(event.sender);
        const dialogResult = await dialog.showOpenDialog(win!, {
          title: '匯入事件 JSON',
          filters: [{ name: 'JSON', extensions: ['json'] }],
          properties: ['openFile'],
        });
        if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
          return { success: false, error: { code: 'CANCELLED', message: '使用者取消' } };
        }

        const raw = await readFile(dialogResult.filePaths[0], 'utf-8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return { success: false, error: { code: 'INVALID_JSON', message: 'JSON 格式錯誤' } };
        }

        const items = Array.isArray(parsed) ? parsed : [parsed];
        const valid = items.filter(
          (item): item is Record<string, unknown> & { name: string } =>
            typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).name === 'string',
        );
        if (valid.length === 0) {
          return { success: false, error: { code: 'NO_VALID_DATA', message: '找不到有效事件資料（需包含 name 欄位）' } };
        }

        const result = service.importEvents(db, projectId, branchId, valid);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

  // ---- Import events from pasted JSON text ----

  ipcMain.handle(
    IPC_CHANNELS.WORLD_MEMORY_IMPORT_EVENTS_TEXT,
    (
      _event,
      projectId: string,
      branchId: string,
      jsonText: string,
    ): IpcResult<{ created: StoryEvent[]; updated: StoryEvent[]; skipped: string[] }> => {
      try {
        const db = getOpenProject(projectId);
        if (!db) return { success: false, error: { code: 'PROJECT_NOT_OPEN', message: '專案未開啟' } };

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          return { success: false, error: { code: 'INVALID_JSON', message: 'JSON 格式錯誤' } };
        }

        const items = Array.isArray(parsed) ? parsed : [parsed];
        const valid = items.filter(
          (item): item is Record<string, unknown> & { name: string } =>
            typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).name === 'string',
        );
        if (valid.length === 0) {
          return { success: false, error: { code: 'NO_VALID_DATA', message: '找不到有效事件資料（需包含 name 欄位）' } };
        }

        const result = service.importEvents(db, projectId, branchId, valid);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: { code: 'DB_ERROR', message: String(err) } };
      }
    },
  );

}

// ---- Helper: record a changelog entry for rollback support ----

function recordChangelog(
  db: ProjectDatabase,
  projectId: string,
  branchId: string,
  paragraphId: string,
  entityType: 'character' | 'relationship' | 'event',
  entityId: string,
  changeType: 'create' | 'update',
  previousData: unknown | null,
  appliedData: unknown,
): void {
  db.prepare(
    `INSERT INTO world_memory_changelog
      (id, project_id, branch_id, paragraph_id, entity_type, entity_id, change_type, previous_data, applied_data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    uuidv4(),
    projectId,
    branchId,
    paragraphId,
    entityType,
    entityId,
    changeType,
    previousData != null ? JSON.stringify(previousData) : null,
    JSON.stringify(appliedData),
  );
}

// ---- Helper: apply a single parsed world change to the DB ----

export async function applyWorldChange(
  service: WorldMemoryService,
  db: ProjectDatabase,
  projectId: string,
  branchId: string,
  paragraphId: string,
  change: { type: string; data: Record<string, unknown> },
): Promise<void> {
  switch (change.type) {
    case 'new_character': {
      const d = change.data;
      const name = String(d.name ?? '');
      if (!name) break;
      const existing = service.findCharacterByName(db, projectId, name);
      if (!existing) {
        const created = service.createCharacter(db, projectId, {
          name,
          appearance: d.appearance != null ? String(d.appearance) : '',
          personality: d.personality != null ? String(d.personality) : '',
          background: d.background != null ? String(d.background) : '',
          abilities: d.abilities != null ? String(d.abilities) : '',
          faction: d.faction != null ? String(d.faction) : '',
          voiceStyle: d.voiceStyle != null ? String(d.voiceStyle) : '',
          sourceParagraphId: paragraphId,
        });
        recordChangelog(db, projectId, branchId, paragraphId, 'character', created.id, 'create', null, d);
      }
      break;
    }

    case 'update_character': {
      const d = change.data;
      const name = String(d.name ?? '');
      if (!name) break;
      const existing = service.findCharacterByName(db, projectId, name);
      if (existing) {
        const updates = (d.updates as Record<string, unknown> | undefined) ?? {};
        const charUpdates: Record<string, string> = {};
        if (updates.appearance != null) charUpdates.appearance = String(updates.appearance);
        if (updates.personality != null) charUpdates.personality = String(updates.personality);
        if (updates.background != null) charUpdates.background = String(updates.background);
        if (updates.abilities != null) charUpdates.abilities = String(updates.abilities);
        if (updates.faction != null) charUpdates.faction = String(updates.faction);
        if (updates.voiceStyle != null) charUpdates.voiceStyle = String(updates.voiceStyle);
        if (Object.keys(charUpdates).length > 0) {
          const snapshot = { ...existing };
          service.updateCharacter(db, existing.id, charUpdates);
          recordChangelog(db, projectId, branchId, paragraphId, 'character', existing.id, 'update', snapshot, d);
        }
      }
      break;
    }

    case 'new_relationship': {
      const d = change.data;
      const nameA = String(d.characterA ?? '');
      const nameB = String(d.characterB ?? '');
      if (!nameA || !nameB) break;

      const charA = service.findCharacterByName(db, projectId, nameA);
      const charB = service.findCharacterByName(db, projectId, nameB);
      if (!charA || !charB) break;

      const existing = service.findRelationshipByCharacters(db, branchId, charA.id, charB.id);
      if (!existing) {
        const initialAffinity = typeof d.affinityChange === 'number' ? d.affinityChange : 0;
        const created = service.createRelationship(db, projectId, branchId, {
          characterAId: charA.id,
          characterBId: charB.id,
          relationshipType: String(d.type ?? 'acquaintance'),
          affinityScore: initialAffinity,
          description: d.description != null ? String(d.description) : '',
          importance: typeof d.importance === 'number' ? d.importance : undefined,
          sourceParagraphId: paragraphId,
        });
        recordChangelog(db, projectId, branchId, paragraphId, 'relationship', created.id, 'create', null, d);
        // Seed the timeline with the relationship's first beat.
        service.recordRelationshipChange(db, projectId, branchId, {
          relationshipId: created.id,
          paragraphId,
          affinityChange: initialAffinity,
          affinityAfter: created.affinityScore,
          typeBefore: '',
          typeAfter: created.relationshipType,
          note: d.description != null ? String(d.description) : '關係建立',
        });
      }
      break;
    }

    case 'update_relationship': {
      const d = change.data;
      const nameA = String(d.characterA ?? '');
      const nameB = String(d.characterB ?? '');
      if (!nameA || !nameB) break;

      const charA = service.findCharacterByName(db, projectId, nameA);
      const charB = service.findCharacterByName(db, projectId, nameB);
      if (!charA || !charB) break;

      const rel = service.findRelationshipByCharacters(db, branchId, charA.id, charB.id);
      if (rel) {
        const snapshot = { ...rel };
        // Append to the timeline (list, not override): adjusts the snapshot's
        // cumulative affinity + trend and records this beat as a history entry.
        service.applyRelationshipChange(db, projectId, branchId, rel.id, {
          affinityChange: typeof d.affinityChange === 'number' ? d.affinityChange : 0,
          relationshipType: d.type != null ? String(d.type) : undefined,
          description: d.description != null ? String(d.description) : undefined,
          importance: typeof d.importance === 'number' ? d.importance : undefined,
          note: d.description != null ? String(d.description) : undefined,
          paragraphId,
        });
        recordChangelog(db, projectId, branchId, paragraphId, 'relationship', rel.id, 'update', snapshot, d);
      }
      break;
    }

    case 'new_event': {
      const d = change.data;
      const name = String(d.name ?? '');
      if (!name) break;
      const participants = Array.isArray(d.participatingCharacters)
        ? (d.participatingCharacters as unknown[]).map(String)
        : [];
      const created = service.createEvent(db, projectId, branchId, {
        name,
        description: String(d.description ?? ''),
        participatingCharacters: participants,
        impact: d.impact != null ? String(d.impact) : '',
        storyTimestamp: d.storyTimestamp != null ? String(d.storyTimestamp) : '',
        paragraphId,
      });
      recordChangelog(db, projectId, branchId, paragraphId, 'event', created.id, 'create', null, d);
      break;
    }

    default:
      break;
  }
}

// ---- Helper: apply plot-fulfillment results + advance the horizon queue ----

/**
 * Flips fulfilled planned beats to `occurred` (linking the paragraph that enacted
 * them). Author `short` beats also slide the author queue forward: for each
 * fulfilled author beat, promote the next `mid` → `short` and `long` → `mid`
 * (lowest order_in_horizon first, source-scoped so director beats are untouched).
 * Director beats are marked occurred at any horizon but never drive promotion —
 * their horizon advancement is owned by the director's reconcile. All writes are
 * recorded in the changelog so detach/rollback reverts them.
 *
 * Returns true when any event changed (so the caller can refresh the renderer).
 */
export function applyPlotFulfillment(
  service: WorldMemoryService,
  db: ProjectDatabase,
  projectId: string,
  branchId: string,
  paragraphId: string,
  fulfilledIds: string[],
): boolean {
  if (fulfilledIds.length === 0) return false;

  let changed = 0;

  // 1. Mark fulfilled planned beats as occurred.
  //   - Author beats: only the steered `short` bucket counts, and each fulfillment
  //     advances the author horizon queue (below).
  //   - Director beats: any horizon counts (the directive steers toward all of them);
  //     horizon advancement is owned by the director's reconcile, NOT a forced queue
  //     push here — so these never trigger promotion.
  let authorPromotionsNeeded = 0;
  for (const id of fulfilledIds) {
    const existing = service.getEvent(db, id);
    if (!existing || existing.status !== 'planned') continue;

    const isDirector = existing.source === 'director';
    if (!isDirector && existing.horizon !== 'short') continue;

    const snapshot = { ...existing };
    service.updateEvent(db, id, { status: 'occurred', paragraphId });
    recordChangelog(db, projectId, branchId, paragraphId, 'event', id, 'update', snapshot, {
      status: 'occurred',
      paragraphId,
    });
    changed++;
    if (!isDirector) authorPromotionsNeeded++;
  }

  if (changed === 0) return false;

  // 2. Advance the AUTHOR queue: promote `authorPromotionsNeeded` mid→short, then
  //    long→mid. Scoped to source!=='director' so director beats are never moved here.
  const promote = (from: 'mid' | 'long', to: 'short' | 'mid', count: number): void => {
    if (count <= 0) return;
    const candidates = service
      .listEvents(db, projectId, branchId)
      .filter(e => e.status === 'planned' && e.horizon === from && e.source !== 'director')
      .sort((a, b) =>
        a.orderInHorizon !== b.orderInHorizon
          ? a.orderInHorizon - b.orderInHorizon
          : a.createdAt.localeCompare(b.createdAt),
      )
      .slice(0, count);
    for (const e of candidates) {
      const snapshot = { ...e };
      service.updateEvent(db, e.id, { horizon: to });
      recordChangelog(db, projectId, branchId, paragraphId, 'event', e.id, 'update', snapshot, { horizon: to });
    }
  };

  promote('mid', 'short', authorPromotionsNeeded);
  promote('long', 'mid', authorPromotionsNeeded);

  return true;
}
