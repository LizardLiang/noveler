import { create } from 'zustand';
import type { ParagraphMeta } from '@/types/models';

interface StreamingState {
  paragraphId: string;
  content: string;
  isStreaming: boolean;
}

interface StoryState {
  paragraphs: ParagraphMeta[];
  paragraphContents: Map<string, string>;
  streaming: StreamingState | null;
  isGenerating: boolean;
  currentBranchId: string | null;
  suggestions: string[];
  suggestionsLoading: boolean;
  /** Transient: set while the dialogue-editor pass is running for a paragraph. */
  refiningParagraphId: string | null;
  /** Transient: set when dialogue refinement fails (W3 / FR-D012); cleared by user dismissal or next generation. */
  refineUnavailableNotify: boolean;
  /** Session-scoped: ids of paragraphs whose active version was produced by the refine pass (drives the "潤色" badge). */
  refinedParagraphIds: Set<string>;
  /** Transient: error message from the last failed generation; cleared on next attempt or user dismissal. */
  generationError: string | null;
  /** Per-paragraph accumulated "thinking" (reasoning) text from thinking models. Display-only, never saved. */
  reasoningByParagraph: Map<string, string>;

  // Actions
  setParagraphs: (paragraphs: ParagraphMeta[]) => void;
  addParagraph: (paragraph: ParagraphMeta) => void;
  updateParagraph: (id: string, updates: Partial<ParagraphMeta>) => void;
  removeParagraph: (id: string) => void;
  setParagraphContent: (id: string, content: string) => void;
  startStreaming: (paragraphId: string) => void;
  appendStreamDelta: (paragraphId: string, delta: string) => void;
  finishStreaming: () => void;
  setGenerating: (generating: boolean) => void;
  setCurrentBranchId: (branchId: string | null) => void;
  setBulkContents: (contents: Map<string, string>) => void;
  setSuggestions: (suggestions: string[]) => void;
  setSuggestionsLoading: (loading: boolean) => void;
  clearSuggestions: () => void;
  setRefiningParagraphId: (id: string | null) => void;
  setRefineUnavailableNotify: (notify: boolean) => void;
  setParagraphRefined: (id: string, refined: boolean) => void;
  setGenerationError: (message: string | null) => void;
  appendReasoning: (paragraphId: string, delta: string) => void;
  reset: () => void;
}

export const useStoryStore = create<StoryState>((set, get) => ({
  paragraphs: [],
  paragraphContents: new Map(),
  streaming: null,
  isGenerating: false,
  currentBranchId: null,
  suggestions: [],
  suggestionsLoading: false,
  refiningParagraphId: null,
  refineUnavailableNotify: false,
  refinedParagraphIds: new Set<string>(),
  generationError: null,
  reasoningByParagraph: new Map<string, string>(),

  setParagraphs: (paragraphs: ParagraphMeta[]) =>
    set({ paragraphs }),
  addParagraph: (paragraph: ParagraphMeta) =>
    set(state => {
      // Avoid duplicates
      const exists = state.paragraphs.some(p => p.id === paragraph.id);
      if (exists) return state;
      return { paragraphs: [...state.paragraphs, paragraph] };
    }),
  updateParagraph: (id: string, updates: Partial<ParagraphMeta>) =>
    set(state => ({
      paragraphs: state.paragraphs.map(p => p.id === id ? { ...p, ...updates } : p),
    })),
  removeParagraph: (id: string) =>
    set(state => {
      const newContents = new Map(state.paragraphContents);
      newContents.delete(id);
      return {
        paragraphs: state.paragraphs.filter(p => p.id !== id),
        paragraphContents: newContents,
      };
    }),
  setParagraphContent: (id: string, content: string) =>
    set(state => {
      const newContents = new Map(state.paragraphContents);
      newContents.set(id, content);
      return { paragraphContents: newContents };
    }),
  startStreaming: (paragraphId: string) =>
    set(state => {
      // Fresh attempt: clear any prior thinking for this paragraph.
      const reasoning = new Map(state.reasoningByParagraph);
      reasoning.delete(paragraphId);
      return { streaming: { paragraphId, content: '', isStreaming: true }, isGenerating: true, generationError: null, reasoningByParagraph: reasoning };
    }),
  appendStreamDelta: (paragraphId: string, delta: string) => {
    const { streaming } = get();
    if (streaming?.paragraphId === paragraphId) {
      set({ streaming: { ...streaming, content: streaming.content + delta } });
    }
  },
  finishStreaming: () =>
    set(state => {
      if (state.streaming) {
        const newContents = new Map(state.paragraphContents);
        newContents.set(state.streaming.paragraphId, state.streaming.content);
        return { streaming: null, isGenerating: false, paragraphContents: newContents };
      }
      return { streaming: null, isGenerating: false };
    }),
  setGenerating: (generating: boolean) =>
    set({ isGenerating: generating }),
  setCurrentBranchId: (branchId: string | null) =>
    set({ currentBranchId: branchId }),
  setBulkContents: (contents: Map<string, string>) =>
    set({ paragraphContents: contents }),
  setSuggestions: (suggestions: string[]) =>
    set({ suggestions, suggestionsLoading: false }),
  setSuggestionsLoading: (loading: boolean) =>
    set({ suggestionsLoading: loading }),
  clearSuggestions: () =>
    set({ suggestions: [], suggestionsLoading: false }),
  setRefiningParagraphId: (id: string | null) =>
    set({ refiningParagraphId: id }),
  setRefineUnavailableNotify: (notify: boolean) =>
    set({ refineUnavailableNotify: notify }),
  setParagraphRefined: (id: string, refined: boolean) =>
    set(state => {
      const next = new Set(state.refinedParagraphIds);
      if (refined) next.add(id); else next.delete(id);
      return { refinedParagraphIds: next };
    }),
  setGenerationError: (message: string | null) =>
    set({ generationError: message }),
  appendReasoning: (paragraphId: string, delta: string) =>
    set(state => {
      const reasoning = new Map(state.reasoningByParagraph);
      reasoning.set(paragraphId, (reasoning.get(paragraphId) ?? '') + delta);
      return { reasoningByParagraph: reasoning };
    }),
  reset: () =>
    set({ paragraphs: [], paragraphContents: new Map(), streaming: null, isGenerating: false, currentBranchId: null, suggestions: [], suggestionsLoading: false, refiningParagraphId: null, refineUnavailableNotify: false, refinedParagraphIds: new Set<string>(), generationError: null, reasoningByParagraph: new Map<string, string>() }),
}));
