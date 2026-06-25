export interface CharacterAppearanceStat {
  characterId: string;
  characterName: string;
  paragraphCount: number;
}

export interface DailyWordCount {
  date: string; // YYYY-MM-DD
  wordCount: number;
}

// ===== Token Usage Stats (§7.6) =====

import type { PipelineStep } from './ipc';

export interface StepTokenAggregate {
  step: PipelineStep;
  callCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalReasoningTokens: number | null;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgReasoningTokens: number | null;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

export interface ModelTokenAggregate {
  model: string;
  callCount: number;
  totalTokens: number;
  avgTokens: number;
  totalReasoningTokens: number | null;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

export interface DailyTokenCount {
  date: string; // YYYY-MM-DD
  totalTokens: number;
}

export interface TokenUsageStats {
  hasData: boolean;
  perStep: StepTokenAggregate[];
  perModel: ModelTokenAggregate[];
  dailyTrend: DailyTokenCount[];
  grandTotal: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number | null;
    totalTokens: number;
    callCount: number;
  };
}

export interface StoryStats {
  totalWordCount: number;
  totalParagraphs: number;
  characterAppearances: CharacterAppearanceStat[];
  dailyTrend: DailyWordCount[];
  tokenUsage: TokenUsageStats;
}
