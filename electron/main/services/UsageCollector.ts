/**
 * UsageCollector.ts
 *
 * Per-invocation accumulator for LLM usage records (§7.2).
 *
 * Design constraints:
 *   - Never singleton — callers create one instance per generation/invocation.
 *   - Never throws — if something is wrong with a record, it is silently skipped.
 *   - Fire-and-forget off the hot path: flush/drain are called after the
 *     generation completes, not inside it.
 *
 * Usage pattern:
 *   const collector = new UsageCollector();
 *   // Pass collector.add.bind(collector) as the onUsage callback to services.
 *   const log = collector.flush(paragraphId);   // → ParagraphUsageLog
 *   // or for standalone handlers:
 *   const recs = collector.drain();             // → StepUsageRecord[]
 */

import type { PipelineStep, StepUsageRecord, ParagraphUsageLog, ParagraphUsageRollup } from '../../shared/types.js';

// ── usageToRec ──────────────────────────────────────────────────────────────

export interface UsageToRecInput {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  latencyMs: number | null;
}

/**
 * Builds a `StepUsageRecord` from raw transport values and a step tag.
 * All nullable fields are preserved as-is (no coercion to 0).
 */
export function usageToRec(step: PipelineStep, input: UsageToRecInput): StepUsageRecord {
  return {
    step,
    model: input.model,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.totalTokens,
    reasoningTokens: input.reasoningTokens,
    latencyMs: input.latencyMs,
  };
}

// ── UsageCollector ──────────────────────────────────────────────────────────

export class UsageCollector {
  private readonly records: StepUsageRecord[] = [];

  /**
   * Add a step record. Safe to call with null/undefined — those are silently
   * ignored so the hot path never throws.
   */
  add(step: PipelineStep, rec: Omit<StepUsageRecord, 'step'>): void {
    try {
      this.records.push({ step, ...rec });
    } catch {
      // best-effort — never throw
    }
  }

  /** Number of records accumulated so far. */
  get size(): number {
    return this.records.length;
  }

  /**
   * Drain accumulated records and return them as-is (for standalone handlers
   * that write to branch-level usage-events.json, not paragraph usage.json).
   * Clears the internal buffer.
   */
  drain(): StepUsageRecord[] {
    const recs = this.records.splice(0, this.records.length);
    return recs;
  }

  /**
   * Flush accumulated records into a `ParagraphUsageLog`.
   * Computes a rollup over all records (null token fields treated as 0 in
   * the sum, but `reasoningTokens` is only non-null in the rollup when at
   * least one record has a non-null reasoningTokens).
   * Clears the internal buffer.
   */
  flush(paragraphId: string): ParagraphUsageLog {
    const steps = this.records.splice(0, this.records.length);
    const rollup = buildRollup(steps);
    return {
      paragraphId,
      createdAt: new Date().toISOString(),
      steps,
      rollup,
    };
  }
}

// ── buildRollup ─────────────────────────────────────────────────────────────

function buildRollup(steps: StepUsageRecord[]): ParagraphUsageRollup {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let reasoningTokens: number | null = null;
  let latencyMs = 0;
  const callCount = steps.length;

  for (const s of steps) {
    promptTokens += s.promptTokens ?? 0;
    completionTokens += s.completionTokens ?? 0;
    totalTokens += s.totalTokens ?? 0;
    latencyMs += s.latencyMs ?? 0;
    if (s.reasoningTokens != null) {
      reasoningTokens = (reasoningTokens ?? 0) + s.reasoningTokens;
    }
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,
    latencyMs,
    callCount,
  };
}
