/**
 * Shared formatting helpers for token-usage display.
 * Used by StoryStats and PromptViewerModal.
 */

import { zhTW } from '@/i18n/zh-TW';
import type { PipelineStep } from '@/types/ipc';

/**
 * Human-readable zh-TW label for a pipeline step.
 * Falls back to the raw step identifier when no translation exists.
 */
export function stepLabel(step: PipelineStep): string {
  const t = zhTW.promptViewer;
  switch (step) {
    case 'director-directive':   return t.stepDirectorDirective;
    case 'director-research':    return t.stepDirectorResearch;
    case 'world-memory-query':   return t.stepWorldMemoryQuery;
    case 'story-generation':     return t.stepStoryGeneration;
    case 'narration-edit':       return t.stepNarrationEdit;
    case 'dialogue-edit':        return t.stepDialogueEdit;
    case 'world-memory-update':  return t.stepWorldMemoryUpdate;
    case 'suggestions':          return t.stepSuggestions;
    case 'roadmap-reconcile':    return t.stepRoadmapReconcile;
    case 'compaction':           return t.stepCompaction;
    default:                     return step;
  }
}

/**
 * Format a token count or latency number.
 * Returns em-dash for null/undefined (value not recorded or not applicable).
 */
export function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}
