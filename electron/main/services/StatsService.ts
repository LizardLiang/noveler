import type { ProjectDatabase } from './database.js';
import { getFileStorageService } from './FileStorageService.js';
import type { PipelineStep, StepUsageRecord } from '../../shared/types.js';

export interface CharacterAppearanceStat {
  characterId: string;
  characterName: string;
  paragraphCount: number;
}

export interface DailyWordCount {
  date: string; // YYYY-MM-DD
  wordCount: number;
}

// ===== Token Usage Stats =====

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

// Count characters in text: each CJK character counts as 1, English words count as 1
export function countWords(text: string): number {
  if (!text) return 0;
  // Use a simple length-based approach for Chinese text
  // Filter punctuation and spaces, count remaining characters
  const stripped = text.replace(/[\s\n\r\t，。！？、；：「」『』【】《》〈〉「」""''…—\-,.!?;:()\[\]{}'"/\\]/g, '');
  return stripped.length > 0 ? stripped.length : 0;
}

class StatsService {
  getStats(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    projectPath: string,
  ): StoryStats {
    const fileStorage = getFileStorageService();

    // 1. Get all AI paragraphs in this branch
    const paragraphRows = db.prepare(
      `SELECT id, active_version, created_at FROM paragraph_meta
       WHERE branch_id=? AND type='ai' AND status!='detached'
       ORDER BY position ASC`,
    ).all(branchId) as Array<{ id: string; active_version: number; created_at: string }>;

    // 2. Read content for word counting
    let totalWordCount = 0;
    const paragraphContents = new Map<string, string>();

    for (const row of paragraphRows) {
      try {
        const content = fileStorage.readParagraphContent(
          projectPath,
          branchId,
          row.id,
          row.active_version,
        );
        if (content) {
          paragraphContents.set(row.id, content);
          totalWordCount += countWords(content);
        }
      } catch {
        // File may not exist yet
      }
    }

    const totalParagraphs = paragraphRows.length;

    // 3. Character appearance stats — count how many paragraphs mention each character's name
    const characters = db.prepare(
      `SELECT id, name FROM characters WHERE project_id=?`,
    ).all(projectId) as Array<{ id: string; name: string }>;

    const characterAppearances: CharacterAppearanceStat[] = [];

    for (const char of characters) {
      let count = 0;
      for (const [, content] of paragraphContents) {
        if (content.includes(char.name)) {
          count++;
        }
      }
      if (count > 0) {
        characterAppearances.push({
          characterId: char.id,
          characterName: char.name,
          paragraphCount: count,
        });
      }
    }

    // Sort by appearance count descending
    characterAppearances.sort((a, b) => b.paragraphCount - a.paragraphCount);

    // 4. Daily word count trend — group paragraph creation by date
    const dailyMap = new Map<string, number>();

    for (const row of paragraphRows) {
      const content = paragraphContents.get(row.id);
      if (!content) continue;

      // Extract date portion from created_at (SQLite datetime: YYYY-MM-DD HH:MM:SS)
      const date = row.created_at.slice(0, 10);
      const wc = countWords(content);
      dailyMap.set(date, (dailyMap.get(date) ?? 0) + wc);
    }

    // Build last-7-days trend
    const today = new Date();
    const dailyTrend: DailyWordCount[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      dailyTrend.push({
        date: dateStr,
        wordCount: dailyMap.get(dateStr) ?? 0,
      });
    }

    // 5. Token usage — scan all per-paragraph usage.json and branch usage-events.json
    const allRecords: Array<{ rec: StepUsageRecord; createdAt: string }> = [];

    // 5a. Per-paragraph records
    for (const row of paragraphRows) {
      try {
        const usageLog = fileStorage.readUsageLog(projectPath, branchId, row.id);
        if (usageLog) {
          for (const step of usageLog.steps) {
            allRecords.push({ rec: step, createdAt: usageLog.createdAt });
          }
        }
      } catch { /* file may not exist */ }
    }

    // 5b. Branch-level standalone events
    try {
      const branchEvents = fileStorage.readUsageEvents(projectPath, branchId);
      for (const event of branchEvents.events) {
        allRecords.push({ rec: event.record, createdAt: event.createdAt });
      }
    } catch { /* best-effort */ }

    const tokenUsage = aggregateUsageRecords(allRecords);

    return {
      totalWordCount,
      totalParagraphs,
      characterAppearances,
      dailyTrend,
      tokenUsage,
    };
  }
}

function aggregateUsageRecords(
  allRecords: Array<{ rec: StepUsageRecord; createdAt: string }>,
): TokenUsageStats {
  if (allRecords.length === 0) {
    return {
      hasData: false,
      perStep: [],
      perModel: [],
      dailyTrend: [],
      grandTotal: { promptTokens: 0, completionTokens: 0, reasoningTokens: null, totalTokens: 0, callCount: 0 },
    };
  }

  // Per-step aggregation
  const stepMap = new Map<PipelineStep, {
    callCount: number;
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number | null;
    latencyMs: number;
  }>();

  // Per-model aggregation
  const modelMap = new Map<string, {
    callCount: number;
    totalTokens: number;
    reasoningTokens: number | null;
    latencyMs: number;
  }>();

  // Daily token map
  const dailyTokenMap = new Map<string, number>();

  let grandPrompt = 0;
  let grandCompletion = 0;
  let grandTotal = 0;
  let grandReasoning: number | null = null;
  let grandCallCount = 0;

  for (const { rec, createdAt } of allRecords) {
    const pt = rec.promptTokens ?? 0;
    const ct = rec.completionTokens ?? 0;
    const tt = rec.totalTokens ?? (pt + ct);
    const lt = rec.latencyMs ?? 0;
    const rt = rec.reasoningTokens;

    grandPrompt += pt;
    grandCompletion += ct;
    grandTotal += tt;
    grandCallCount++;
    if (rt != null) grandReasoning = (grandReasoning ?? 0) + rt;

    // Step
    const existing = stepMap.get(rec.step);
    if (existing) {
      existing.callCount++;
      existing.promptTokens += pt;
      existing.completionTokens += ct;
      existing.latencyMs += lt;
      if (rt != null) existing.reasoningTokens = (existing.reasoningTokens ?? 0) + rt;
    } else {
      stepMap.set(rec.step, {
        callCount: 1,
        promptTokens: pt,
        completionTokens: ct,
        reasoningTokens: rt,
        latencyMs: lt,
      });
    }

    // Model
    const modelEntry = modelMap.get(rec.model);
    if (modelEntry) {
      modelEntry.callCount++;
      modelEntry.totalTokens += tt;
      modelEntry.latencyMs += lt;
      if (rt != null) modelEntry.reasoningTokens = (modelEntry.reasoningTokens ?? 0) + rt;
    } else {
      modelMap.set(rec.model, { callCount: 1, totalTokens: tt, reasoningTokens: rt, latencyMs: lt });
    }

    // Daily
    const date = createdAt.slice(0, 10);
    dailyTokenMap.set(date, (dailyTokenMap.get(date) ?? 0) + tt);
  }

  const perStep: StepTokenAggregate[] = [];
  for (const [step, s] of stepMap) {
    perStep.push({
      step,
      callCount: s.callCount,
      totalPromptTokens: s.promptTokens,
      totalCompletionTokens: s.completionTokens,
      totalReasoningTokens: s.reasoningTokens,
      avgPromptTokens: s.callCount > 0 ? Math.round(s.promptTokens / s.callCount) : 0,
      avgCompletionTokens: s.callCount > 0 ? Math.round(s.completionTokens / s.callCount) : 0,
      avgReasoningTokens: s.reasoningTokens != null && s.callCount > 0 ? Math.round(s.reasoningTokens / s.callCount) : null,
      totalLatencyMs: s.latencyMs,
      avgLatencyMs: s.callCount > 0 ? Math.round(s.latencyMs / s.callCount) : 0,
    });
  }

  const perModel: ModelTokenAggregate[] = [];
  for (const [model, m] of modelMap) {
    perModel.push({
      model,
      callCount: m.callCount,
      totalTokens: m.totalTokens,
      avgTokens: m.callCount > 0 ? Math.round(m.totalTokens / m.callCount) : 0,
      totalReasoningTokens: m.reasoningTokens,
      totalLatencyMs: m.latencyMs,
      avgLatencyMs: m.callCount > 0 ? Math.round(m.latencyMs / m.callCount) : 0,
    });
  }

  // Daily trend: last 7 days
  const today = new Date();
  const dailyTrend: DailyTokenCount[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    dailyTrend.push({ date: dateStr, totalTokens: dailyTokenMap.get(dateStr) ?? 0 });
  }

  return {
    hasData: true,
    perStep,
    perModel,
    dailyTrend,
    grandTotal: {
      promptTokens: grandPrompt,
      completionTokens: grandCompletion,
      reasoningTokens: grandReasoning,
      totalTokens: grandTotal,
      callCount: grandCallCount,
    },
  };
}

let instance: StatsService | null = null;

export function getStatsService(): StatsService {
  if (!instance) {
    instance = new StatsService();
  }
  return instance;
}
