import { create } from 'zustand';
import type { Character, Relationship, StoryEvent } from '@/types/models';
import { worldMemoryApi } from '@/lib/ipc';

export interface ParagraphParseStatus {
  parseError: boolean;
  noDetection: boolean;
  hasChanges: boolean;
}

interface WorldMemoryState {
  characters: Character[];
  relationships: Relationship[];
  events: StoryEvent[];
  isLoading: boolean;

  // Parse status per paragraph (for informational display)
  paragraphParseStatuses: Map<string, ParagraphParseStatus>;

  // ---- Local store actions (no IPC) ----
  setCharacters: (characters: Character[]) => void;
  addCharacter: (character: Character) => void;
  updateCharacter: (id: string, updates: Partial<Character>) => void;
  removeCharacter: (id: string) => void;

  setRelationships: (relationships: Relationship[]) => void;
  addRelationship: (relationship: Relationship) => void;
  updateRelationship: (id: string, updates: Partial<Relationship>) => void;
  removeRelationship: (id: string) => void;

  setEvents: (events: StoryEvent[]) => void;
  addEvent: (event: StoryEvent) => void;
  updateEvent: (id: string, updates: Partial<StoryEvent>) => void;
  removeEvent: (id: string) => void;

  setLoading: (loading: boolean) => void;
  reset: () => void;

  setParagraphParseStatus: (paragraphId: string, status: ParagraphParseStatus) => void;

  // ---- IPC-backed actions ----
  loadCharacters: (projectId: string) => Promise<void>;
  loadRelationships: (projectId: string, branchId: string) => Promise<void>;
  loadEvents: (projectId: string, branchId: string) => Promise<void>;
  loadAll: (projectId: string, branchId: string) => Promise<void>;

  createCharacter: (projectId: string, data: Partial<Character> & { name: string }) => Promise<Character | null>;
  updateCharacterRemote: (projectId: string, id: string, updates: Partial<Character>) => Promise<void>;
  deleteCharacter: (projectId: string, id: string) => Promise<void>;
  deleteAllCharacters: (projectId: string) => Promise<number>;

  createRelationship: (
    projectId: string,
    branchId: string,
    data: {
      characterAId: string;
      characterBId: string;
      relationshipType: string;
      affinityScore?: number;
      description?: string;
    },
  ) => Promise<Relationship | null>;
  updateRelationshipRemote: (
    projectId: string,
    id: string,
    updates: { relationshipType?: string; affinityScore?: number; description?: string },
  ) => Promise<void>;
  deleteRelationship: (projectId: string, id: string) => Promise<void>;
  deleteAllRelationships: (projectId: string, branchId: string) => Promise<number>;

  createEvent: (
    projectId: string,
    branchId: string,
    data: {
      name: string;
      description: string;
      participatingCharacters?: string[];
      impact?: string;
      storyTimestamp?: string;
      status?: 'occurred' | 'planned';
    },
  ) => Promise<StoryEvent | null>;
  updateEventRemote: (
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
  ) => Promise<void>;
  deleteEvent: (projectId: string, id: string) => Promise<void>;
  deleteAllEvents: (projectId: string, branchId: string) => Promise<number>;

  importCharacters: (projectId: string) => Promise<{ created: Character[]; updated: Character[]; skipped: string[] } | null>;
  importCharactersText: (projectId: string, jsonText: string) => Promise<{ created: Character[]; updated: Character[]; skipped: string[] } | null>;

  importRelationships: (projectId: string, branchId: string) => Promise<{ created: Relationship[]; updated: Relationship[]; skipped: string[] } | null>;
  importRelationshipsText: (projectId: string, branchId: string, jsonText: string) => Promise<{ created: Relationship[]; updated: Relationship[]; skipped: string[] } | null>;

  importEvents: (projectId: string, branchId: string) => Promise<{ created: StoryEvent[]; updated: StoryEvent[]; skipped: string[] } | null>;
  importEventsText: (projectId: string, branchId: string, jsonText: string) => Promise<{ created: StoryEvent[]; updated: StoryEvent[]; skipped: string[] } | null>;

}

export const useWorldMemoryStore = create<WorldMemoryState>((set, get) => ({
  characters: [],
  relationships: [],
  events: [],
  isLoading: false,
  paragraphParseStatuses: new Map(),

  // ---- Local state setters ----
  setCharacters: (characters) => set({ characters }),
  addCharacter: (character) =>
    set((state) => ({ characters: [...state.characters, character] })),
  updateCharacter: (id, updates) =>
    set((state) => ({
      characters: state.characters.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),
  removeCharacter: (id) =>
    set((state) => ({ characters: state.characters.filter((c) => c.id !== id) })),

  setRelationships: (relationships) => set({ relationships }),
  addRelationship: (relationship) =>
    set((state) => ({ relationships: [...state.relationships, relationship] })),
  updateRelationship: (id, updates) =>
    set((state) => ({
      relationships: state.relationships.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    })),
  removeRelationship: (id) =>
    set((state) => ({ relationships: state.relationships.filter((r) => r.id !== id) })),

  setEvents: (events) => set({ events }),
  addEvent: (event) =>
    set((state) => ({ events: [...state.events, event] })),
  updateEvent: (id, updates) =>
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    })),
  removeEvent: (id) =>
    set((state) => ({ events: state.events.filter((e) => e.id !== id) })),

  setLoading: (loading) => set({ isLoading: loading }),
  reset: () =>
    set({
      characters: [],
      relationships: [],
      events: [],
      paragraphParseStatuses: new Map(),
    }),

  setParagraphParseStatus: (paragraphId, status) =>
    set((state) => {
      const next = new Map(state.paragraphParseStatuses);
      next.set(paragraphId, status);
      return { paragraphParseStatuses: next };
    }),

  // ---- IPC-backed loaders ----
  loadCharacters: async (projectId) => {
    const result = await worldMemoryApi.getCharacters(projectId);
    if (result.success) {
      set({ characters: result.data as Character[] });
    }
  },

  loadRelationships: async (projectId, branchId) => {
    const result = await worldMemoryApi.getRelationships(projectId, branchId);
    if (result.success) {
      set({ relationships: result.data as Relationship[] });
    }
  },

  loadEvents: async (projectId, branchId) => {
    const result = await worldMemoryApi.getEvents(projectId, branchId);
    if (result.success) {
      set({ events: result.data as StoryEvent[] });
    }
  },

  loadAll: async (projectId, branchId) => {
    set({ isLoading: true });
    await Promise.all([
      get().loadCharacters(projectId),
      get().loadRelationships(projectId, branchId),
      get().loadEvents(projectId, branchId),
    ]);
    set({ isLoading: false });
  },

  // ---- Character CRUD ----
  createCharacter: async (projectId, data) => {
    const result = await worldMemoryApi.createCharacter(projectId, data);
    if (result.success) {
      get().addCharacter(result.data as Character);
      return result.data as Character;
    }
    return null;
  },

  updateCharacterRemote: async (projectId, id, updates) => {
    const result = await worldMemoryApi.updateCharacter(projectId, id, updates);
    if (result.success) {
      get().updateCharacter(id, result.data as Partial<Character>);
    }
  },

  deleteCharacter: async (projectId, id) => {
    const result = await worldMemoryApi.deleteCharacter(projectId, id);
    if (result.success) {
      get().removeCharacter(id);
    }
  },

  deleteAllCharacters: async (projectId) => {
    const result = await worldMemoryApi.deleteAllCharacters(projectId);
    if (result.success) {
      set({ characters: [] });
      return (result.data as { deleted: number }).deleted;
    }
    return 0;
  },

  // ---- Relationship CRUD ----
  createRelationship: async (projectId, branchId, data) => {
    const result = await worldMemoryApi.createRelationship(projectId, branchId, data);
    if (result.success) {
      get().addRelationship(result.data as Relationship);
      return result.data as Relationship;
    }
    return null;
  },

  updateRelationshipRemote: async (projectId, id, updates) => {
    const result = await worldMemoryApi.updateRelationship(projectId, id, updates);
    if (result.success) {
      get().updateRelationship(id, result.data as Partial<Relationship>);
    }
  },

  deleteRelationship: async (projectId, id) => {
    const result = await worldMemoryApi.deleteRelationship(projectId, id);
    if (result.success) {
      get().removeRelationship(id);
    }
  },

  deleteAllRelationships: async (projectId, branchId) => {
    const result = await worldMemoryApi.deleteAllRelationships(projectId, branchId);
    if (result.success) {
      set({ relationships: [] });
      return (result.data as { deleted: number }).deleted;
    }
    return 0;
  },

  // ---- Event CRUD ----
  createEvent: async (projectId, branchId, data) => {
    const result = await worldMemoryApi.createEvent(projectId, branchId, data);
    if (result.success) {
      get().addEvent(result.data as StoryEvent);
      return result.data as StoryEvent;
    }
    return null;
  },

  updateEventRemote: async (projectId, id, updates) => {
    const result = await worldMemoryApi.updateEvent(projectId, id, updates);
    if (result.success) {
      get().updateEvent(id, result.data as Partial<StoryEvent>);
    }
  },

  deleteEvent: async (projectId, id) => {
    const result = await worldMemoryApi.deleteEvent(projectId, id);
    if (result.success) {
      get().removeEvent(id);
    }
  },

  deleteAllEvents: async (projectId, branchId) => {
    const result = await worldMemoryApi.deleteAllEvents(projectId, branchId);
    if (result.success) {
      set({ events: [] });
      return (result.data as { deleted: number }).deleted;
    }
    return 0;
  },

  // ---- Import characters from JSON (import = overwrite by name) ----
  importCharacters: async (projectId) => {
    const result = await worldMemoryApi.importCharacters(projectId);
    if (result.success) {
      const { created, updated, skipped } = result.data as { created: Character[]; updated: Character[]; skipped: string[] };
      for (const c of created) get().addCharacter(c);
      for (const c of updated) get().updateCharacter(c.id, c);
      return { created, updated, skipped };
    }
    return null;
  },

  importCharactersText: async (projectId, jsonText) => {
    const result = await worldMemoryApi.importCharactersText(projectId, jsonText);
    if (result.success) {
      const { created, updated, skipped } = result.data as { created: Character[]; updated: Character[]; skipped: string[] };
      for (const c of created) get().addCharacter(c);
      for (const c of updated) get().updateCharacter(c.id, c);
      return { created, updated, skipped };
    }
    return null;
  },

  // ---- Import relationships from JSON (import = overwrite by character pair) ----
  importRelationships: async (projectId, branchId) => {
    const result = await worldMemoryApi.importRelationships(projectId, branchId);
    if (result.success) {
      const { created, updated, skipped } = result.data as { created: Relationship[]; updated: Relationship[]; skipped: string[] };
      for (const r of created) get().addRelationship(r);
      for (const r of updated) get().updateRelationship(r.id, r);
      return { created, updated, skipped };
    }
    return null;
  },

  importRelationshipsText: async (projectId, branchId, jsonText) => {
    const result = await worldMemoryApi.importRelationshipsText(projectId, branchId, jsonText);
    if (result.success) {
      const { created, updated, skipped } = result.data as { created: Relationship[]; updated: Relationship[]; skipped: string[] };
      for (const r of created) get().addRelationship(r);
      for (const r of updated) get().updateRelationship(r.id, r);
      return { created, updated, skipped };
    }
    return null;
  },

  // ---- Import events from JSON (import = overwrite by name) ----
  importEvents: async (projectId, branchId) => {
    const result = await worldMemoryApi.importEvents(projectId, branchId);
    if (result.success) {
      const { created, updated, skipped } = result.data as { created: StoryEvent[]; updated: StoryEvent[]; skipped: string[] };
      for (const e of created) get().addEvent(e);
      for (const e of updated) get().updateEvent(e.id, e);
      return { created, updated, skipped };
    }
    return null;
  },

  importEventsText: async (projectId, branchId, jsonText) => {
    const result = await worldMemoryApi.importEventsText(projectId, branchId, jsonText);
    if (result.success) {
      const { created, updated, skipped } = result.data as { created: StoryEvent[]; updated: StoryEvent[]; skipped: string[] };
      for (const e of created) get().addEvent(e);
      for (const e of updated) get().updateEvent(e.id, e);
      return { created, updated, skipped };
    }
    return null;
  },

}));
