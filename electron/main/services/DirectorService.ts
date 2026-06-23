/**
 * DirectorService.ts
 *
 * Encapsulates all Director planner logic:
 *   - countPlannedAhead()     — cheap count of unfulfilled planned events
 *   - reconcileRoadmap()      — single keep/discard/new model call + defensive parse
 *   - buildDirective()        — directive generation (moved from aiHandlers.ts)
 *   - planAndDirect()         — orchestration: count → reconcile → directive
 *
 * Design mirrors DialogueEditorService: stateless, takes providerConfig per call,
 * dual-provider via the same three transports (OAuth/curl, Ollama native, OpenAI SDK).
 * Never throws into the caller; returns '' on any failure.
 *
 * Constants:
 *   PLAN_TRIGGER_THRESHOLD = 2  — fire when planned-ahead count < 2
 *   PLAN_HORIZON = 3            — keep + new ≤ 3 AI beats total
 */

import { v4 as uuidv4 } from 'uuid';
import { curlComplete } from './CurlStreamService.js';
import { ollamaChatComplete } from './OllamaNativeService.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { ProjectDatabase } from './database.js';
import { getWorldMemoryService } from './WorldMemoryService.js';
import type { StoryEvent, EventHorizon } from '../../shared/worldMemoryTypes.js';

// ── Horizon helpers ───────────────────────────────────────────────────────────

const VALID_HORIZONS: ReadonlySet<EventHorizon> = new Set(['short', 'mid', 'long']);

function normalizeHorizon(value: unknown): EventHorizon {
  return VALID_HORIZONS.has(value as EventHorizon) ? (value as EventHorizon) : 'mid';
}

/** Human label for a planning horizon, used in director-facing prompts. */
function horizonLabel(h: EventHorizon): string {
  return h === 'short' ? '近期' : h === 'long' ? '遠期' : '中期';
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ActiveProvider {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  authMethod?: 'api_key' | 'oauth';
  accountId?: string;
  isOllama?: boolean;
}

export interface PlanAndDirectArgs {
  providerConfig: ActiveProvider;
  model: string;
  db: ProjectDatabase;
  projectId: string;
  branchId: string;
  recentStory: string;
  /** Token captured at handler entry; re-checked before any DB write. */
  generationToken: number;
  isCurrentToken: (projectId: string, token: number) => boolean;
  /** When false, skip the planning step and only build the directive. */
  plan?: boolean;
  /** When true, force a reconcile even if planned-ahead count ≥ threshold. */
  force?: boolean;
  /** Standing author direction (創作走向) — biases reconcile + directive toward it. */
  directorBrief?: string;
  /** One-off director steer for this single generation. Not persisted; feeds the
   *  directive only (never the roadmap reconcile). */
  directorNote?: string;
  /** World rules string (read from project settings by the caller). */
  worldRules?: string;
  /** OpenAI client (from AIProviderService) for API-key path. */
  aiClient?: AiClient | null;
}

/** Minimal OpenAI client shape needed by this service. */
export interface AiClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: ChatCompletionMessageParam[];
        max_tokens: number;
        temperature: number;
      }): Promise<{ choices: Array<{ message: { content: string | null } }> }>;
    };
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

const PLAN_TRIGGER_THRESHOLD = 2; // fire when planned-ahead count < this value
const PLAN_HORIZON = 3;           // keep + new ≤ this many AI beats total

// ── Dual-provider LLM call ───────────────────────────────────────────────────

async function callLLM(
  messages: ChatCompletionMessageParam[],
  providerConfig: ActiveProvider,
  model: string,
  options: { maxTokens: number; temperature: number },
  aiClient?: AiClient | null,
): Promise<string> {
  if (providerConfig.authMethod === 'oauth' && providerConfig.accountId) {
    return curlComplete({
      messages,
      model,
      accessToken: providerConfig.apiKey,
      accountId: providerConfig.accountId,
    });
  } else if (providerConfig.isOllama) {
    return ollamaChatComplete({
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
      messages,
      model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  } else {
    if (!aiClient) throw new Error('AI 客戶端未初始化');
    const response = await aiClient.chat.completions.create({
      model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
    });
    return response.choices[0]?.message?.content ?? '';
  }
}

// ── Reconcile response shape ──────────────────────────────────────────────────

interface ReconcileResponse {
  keep: number[];
  discard: number[];
  /** Re-tier kept beats whose imminence changed as the story advanced. The model
   *  only lists beats it actively wants to move — omitted beats keep their horizon
   *  (advancement is never forced; it must comply with the story's pacing). */
  retier: Array<{ index: number; horizon: EventHorizon }>;
  new: Array<{
    name: string;
    description: string;
    storyTimestamp: string;
    participatingCharacters: string[];
    technique: string;
    horizon: EventHorizon;
  }>;
}

function parseReconcileResponse(raw: string): ReconcileResponse | null {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.keep) || !Array.isArray(obj.discard) || !Array.isArray(obj.new)) {
      return null;
    }
    return {
      keep: (obj.keep as unknown[]).filter((x): x is number => typeof x === 'number'),
      discard: (obj.discard as unknown[]).filter((x): x is number => typeof x === 'number'),
      retier: Array.isArray(obj.retier)
        ? (obj.retier as unknown[])
            .filter((item): item is { index: number; horizon: unknown } =>
              typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).index === 'number')
            .map(item => ({
              index: Number((item as Record<string, unknown>).index),
              horizon: normalizeHorizon((item as Record<string, unknown>).horizon),
            }))
        : [],
      new: (obj.new as unknown[]).filter((item): item is ReconcileResponse['new'][number] => {
        if (typeof item !== 'object' || item === null) return false;
        const o = item as Record<string, unknown>;
        return typeof o.name === 'string' && typeof o.description === 'string';
      }).map(item => ({
        name: String(item.name),
        description: String(item.description),
        storyTimestamp: typeof item.storyTimestamp === 'string' ? item.storyTimestamp : '',
        participatingCharacters: Array.isArray(item.participatingCharacters)
          ? (item.participatingCharacters as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
        technique: typeof item.technique === 'string' ? item.technique : '',
        horizon: normalizeHorizon((item as Record<string, unknown>).horizon),
      })),
    };
  } catch {
    return null;
  }
}

// ── DirectorService ───────────────────────────────────────────────────────────

export class DirectorService {
  private readonly worldMemoryService = getWorldMemoryService();

  /**
   * Count the number of planned events (any source) ahead in the roadmap.
   * "Ahead" = status === 'planned'. Used to decide whether to fire the planner.
   */
  countPlannedAhead(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
  ): number {
    const row = db.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE project_id=? AND branch_id=? AND status='planned'",
    ).get(projectId, branchId) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }

  /**
   * Reconcile the AI roadmap: call the model once with current director-planned
   * events + story context, parse the keep/discard/new response, then:
   *   - Delete discarded source='director' rows
   *   - Insert new beats (capped to HORIZON)
   *
   * Invariant: ONLY rows with source='director' are ever deleted.
   * Token guard: re-checks isCurrentToken before every DB write.
   * Malformed JSON response → no-op (returns false).
   */
  async reconcileRoadmap(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    recentStory: string,
    generationToken: number,
    isCurrentToken: (projectId: string, token: number) => boolean,
    providerConfig: ActiveProvider,
    model: string,
    worldRules: string,
    directorBrief: string,
    aiClient?: AiClient | null,
  ): Promise<boolean> {
    // Collect current director-planned beats (with stable indices)
    const allEvents = this.worldMemoryService.listEvents(db, projectId, branchId);
    const directorBeats = allEvents.filter(
      e => e.status === 'planned' && e.source === 'director',
    );
    const authorBeats = allEvents.filter(
      e => e.status === 'planned' && e.source === 'author',
    );
    const occurredEvents = allEvents.filter(e => e.status !== 'planned').slice(0, 5);

    const directorBeatsText = directorBeats.length > 0
      ? directorBeats.map((e, i) => {
          const chars = e.participatingCharacters.join('、') || '無';
          const when = e.storyTimestamp ? `[${e.storyTimestamp}] ` : '';
          return `[${i}]（${horizonLabel(e.horizon)}）${when}${e.name}：${e.description}（涉及：${chars}）`;
        }).join('\n')
      : '（目前無 AI 規劃事件）';

    const authorBeatsText = authorBeats.length > 0
      ? authorBeats.map(e => {
          const chars = e.participatingCharacters.join('、') || '無';
          const when = e.storyTimestamp ? `[${e.storyTimestamp}] ` : '';
          return `- ${when}${e.name}：${e.description}（涉及：${chars}）`;
        }).join('\n')
      : '（無）';

    const occurredText = occurredEvents.length > 0
      ? occurredEvents.map(e => `- ${e.name}：${e.description}`).join('\n')
      : '（尚無已記錄的關鍵事件）';

    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `你是一位故事「導演」，負責維護一份短小的 AI 規劃事件清單（最多 ${PLAN_HORIZON} 個），確保故事有明確的短期走向。${worldRules ? `\n\n本作世界規則（須遵守）：\n${worldRules}` : ''}${directorBrief ? `\n\n【作者創作走向（最高優先，須貫徹）】\n${directorBrief}\n保留、丟棄與新增 AI 規劃事件時，都必須讓整體走向明確朝這個方向發展；與此方向不符的舊 AI 規劃事件應傾向丟棄。` : ''}

任務：根據「故事近況」「已發生事件」「作者規劃事件（唯讀）」以及「目前 AI 規劃事件（附索引與時程）」，判斷哪些 AI 規劃事件仍然合理（keep）、哪些已過時或矛盾（discard），並補充新事件（new），使 keep + new ≤ ${PLAN_HORIZON}。

每個 AI 規劃事件都有「時程」，代表它距離現在還有多遠：
- 近期（short）：故事即將演到、下一兩段就該實際發生。
- 中期（mid）：稍後才會發生，目前可鋪陳、埋伏筆。
- 遠期（long）：更遠的方向，現在只需保持一致、不可提前發生。

維護時程（retier）：隨著故事推進，若某個保留事件已逼近、該開始實際演出，就把它從中期調近期、或遠期調中期。但這必須符合故事當下的節奏——只有當故事真的走到那一步時才前移，絕不可為了推進而強行提前。沒有變動的事件不要列入 retier。

嚴格限制：
- 作者規劃事件為唯讀，絕對不可出現在 discard、retier 或 new 的 name 中。
- discard 與 retier 的 index 只填入 AI 規劃事件的索引數字（對應上方 [索引] 格式）。
- new 事件須具體、可推進，且不直接劇透故事結局；每個 new 事件須標明 horizon（"short"／"mid"／"long"），通常最該銜接的下一個事件設為 short，較遠的設為 mid 或 long。
- 每個 new 事件可選填一個「technique」運鏡或寫作手法（例如：平行剪輯、蒙太奇、空鏡、特寫推近、藏反打、伏筆鋪陳、爽點打臉），用來指示這一段該如何呈現；若無合適手法則填空字串。
- 只回覆嚴格的 JSON，不要加任何說明、標題或 markdown 語法。

回覆格式（嚴格 JSON，不含其他文字）：
{
  "keep": [<保留的 AI 規劃事件索引，整數陣列>],
  "discard": [<丟棄的 AI 規劃事件索引，整數陣列>],
  "retier": [{ "index": <保留事件的索引>, "horizon": "short|mid|long" }],
  "new": [{ "name": "...", "description": "...", "storyTimestamp": "", "participatingCharacters": ["<已知角色名>"], "technique": "<手法或空字串>", "horizon": "short|mid|long" }]
}`,
      },
      {
        role: 'user',
        content: `【故事近況】\n${recentStory || '（故事尚未開始）'}\n\n【已發生事件（最近 5 個）】\n${occurredText}\n\n【作者規劃事件（唯讀，不可修改）】\n${authorBeatsText}\n\n【目前 AI 規劃事件（附索引）】\n${directorBeatsText}\n\n請輸出 JSON。`,
      },
    ];

    let raw: string;
    try {
      raw = await callLLM(messages, providerConfig, model, { maxTokens: 500, temperature: 0.5 }, aiClient);
    } catch {
      return false;
    }

    const result = parseReconcileResponse(raw);
    if (!result) return false;

    // B-1: Implicit-discard — beats the model didn't mention in keep OR discard are
    // treated as forgotten/stale. Prevents silent accumulation past HORIZON over time.
    const mentionedSet = new Set([
      ...result.keep,
      ...result.discard,
      ...result.retier.map(r => r.index),
    ]);
    for (let i = 0; i < directorBeats.length; i++) {
      if (!mentionedSet.has(i)) {
        result.discard.push(i);
      }
    }

    // Count how many AI beats remain after discards
    const keptCount = result.keep.filter(
      idx => directorBeats[idx] !== undefined,
    ).length;

    // Insert new beats (capped to HORIZON)
    const slotsAvailable = PLAN_HORIZON - keptCount;
    const toInsert = result.new.slice(0, Math.max(0, slotsAvailable));

    // B-2: Single token guard + atomic DB transaction so delete(s) and insert(s)
    // either both execute or both rollback — no partial-prune state possible.
    db.beginTransaction();
    try {
      // Single entry check: if stale, skip ALL writes atomically.
      if (!isCurrentToken(projectId, generationToken)) {
        db.rollbackTransaction();
        return false;
      }

      // Delete discarded director rows (invariant: ONLY source='director' rows)
      const discardSet = new Set(result.discard);
      for (const idx of result.discard) {
        const beat = directorBeats[idx];
        if (!beat) continue;
        // Double-check the invariant in code: only delete source='director'
        if (beat.source !== 'director') continue;
        db.prepare("DELETE FROM events WHERE id=? AND source='director'").run(beat.id);
      }

      // Re-tier kept beats whose imminence changed (mid→short / long→mid, etc).
      // Story-driven, never forced: only the beats the model explicitly listed move,
      // and discarded beats are never re-tiered.
      for (const { index, horizon } of result.retier) {
        if (discardSet.has(index)) continue;
        const beat = directorBeats[index];
        if (!beat || beat.source !== 'director') continue;
        if (beat.horizon === horizon) continue;
        const now = new Date().toISOString();
        db.prepare(
          "UPDATE events SET horizon=?, updated_at=? WHERE id=? AND source='director'",
        ).run(horizon, now, beat.id);
      }

      // Insert new beats (no per-iteration token re-check needed inside transaction)
      for (const beat of toInsert) {
        if (!beat.name.trim()) continue;

        const id = uuidv4();
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO events
            (id, project_id, branch_id, name, description, story_timestamp, impact,
             participating_characters, status, horizon, source, technique, paragraph_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, 'director', ?, NULL, ?, ?)`,
        ).run(
          id,
          projectId,
          branchId,
          beat.name,
          beat.description,
          beat.storyTimestamp,
          '',
          JSON.stringify(beat.participatingCharacters),
          normalizeHorizon(beat.horizon),
          beat.technique ?? '',
          now,
          now,
        );
      }

      db.commitTransaction();
    } catch (e) {
      db.rollbackTransaction();
      throw e;
    }

    return true;
  }

  /**
   * Build a steering directive from the combined author + AI planned roadmap.
   * Author beats are preferred in tiebreaks (listed before director beats at equal distance).
   * Returns '' when there are no planned events.
   * Moved from buildDirectorDirective in aiHandlers.ts.
   */
  async buildDirective(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    recentStory: string,
    worldRules: string,
    directorBrief: string,
    providerConfig: ActiveProvider,
    model: string,
    aiClient?: AiClient | null,
    // One-off steer for this single generation (trailing-optional to keep existing
    // positional callers working). When set, a directive is produced even with an
    // empty roadmap, and the note takes top priority for this paragraph only.
    directorNote: string = '',
  ): Promise<string> {
    const allEvents = this.worldMemoryService.listEvents(db, projectId, branchId);
    const plannedAll = allEvents.filter(e => e.status === 'planned');
    if (plannedAll.length === 0 && !directorNote.trim()) return '';

    // Author-priority tiebreak: sort author beats before director beats.
    // listEvents returns newest-created first; reverse to writing order,
    // then stable-sort author before director.
    const roadmap = [...plannedAll].reverse();
    const authorBeats: StoryEvent[] = roadmap.filter(e => e.source !== 'director');
    const directorBeats: StoryEvent[] = roadmap.filter(e => e.source === 'director');
    // Interleave: author events first, then director events.
    const ordered = [...authorBeats, ...directorBeats];

    const roadmapText = ordered.map(e => {
      const chars = e.participatingCharacters.join('、') || '無';
      const when = e.storyTimestamp ? `[${e.storyTimestamp}] ` : '';
      const tech = e.technique ? `（建議手法：${e.technique}）` : '';
      const tier = e.source === 'director' ? `（${horizonLabel(e.horizon)}）` : '';
      return `- ${tier}${when}${e.name}：${e.description}（涉及：${chars}）${tech}`;
    }).join('\n') || '（目前沒有預先規劃的事件，請依作者的當下指示推進）';

    const occurred = allEvents.filter(e => e.status !== 'planned').slice(0, 5);
    const occurredText = occurred.length > 0
      ? occurred.map(e => `- ${e.name}：${e.description}`).join('\n')
      : '（尚無已記錄的關鍵事件）';

    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `你是一位故事「導演」，職責是確保故事朝作者規劃的劇情推進，而不是漫無目的地發展。
依據「故事近況」「已發生事件」與「劇情規劃（尚未發生）」，判斷目前最該銜接的下一個規劃事件，並給出能把故事推往該事件的具體下一步指示。${worldRules ? `\n\n本作世界規則（須遵守）：\n${worldRules}` : ''}${directorBrief ? `\n\n【作者創作走向（最高優先，須貫徹）】\n${directorBrief}\n你的指示必須讓這一段的情緒、選材與筆觸明確朝這個方向走。` : ''}${directorNote.trim() ? `\n\n【作者對「下一段」的即時指示（僅此一段，最優先，凌駕其他規劃）】\n${directorNote.trim()}\n這一段必須優先滿足這個即時指示；若與既有規劃衝突，以此即時指示為準，但仍須從目前場景自然接續、不可跳場或劇透。` : ''}

回覆要求：用繁體中文，約 100-200 字，只輸出導演指示本身（不要前言、不要標題、不要解釋）。內容需涵蓋：
1. 目前最該朝向的目標事件是哪一個。
2. 從現在的故事狀態到該事件之間還缺哪些鋪墊。
3. 下一段該寫什麼以朝該目標推進一步——但不可直接跳到事件結果，也不可劇透。
4. 若目標事件附有「建議手法」，在指示末尾加一句「本段建議手法：<手法>」，並簡述如何在保持劇情連貫的前提下運用該手法。

重要：你的指示只能讓故事「前進一步」，且必須從目前故事的當下場景、地點與正在進行的動作接續。若目標事件發生在不同場景或時間，指示須描述「如何過渡」過去（移動、離場、時間流逝），絕不可要求或暗示直接跳到目標事件所在的場景。`,
      },
      {
        role: 'user',
        content: `【故事近況】\n${recentStory || '（故事尚未開始）'}\n\n【已發生事件】\n${occurredText}\n\n【劇情規劃（尚未發生，需朝此推進）】\n${roadmapText}\n\n請給出導演指示。`,
      },
    ];

    return (await callLLM(messages, providerConfig, model, { maxTokens: 400, temperature: 0.4 }, aiClient)).trim();
  }

  /**
   * Main entry point: optionally reconcile the AI roadmap, then build and return
   * the steering directive. Never throws; returns '' on failure.
   *
   * plan=true  (default): run the full planner pre-step on the main generate path.
   * plan=false           : directive-only, no planning (options/suggestions path).
   */
  async planAndDirect(args: PlanAndDirectArgs): Promise<string> {
    try {
      const {
        providerConfig,
        model,
        db,
        projectId,
        branchId,
        recentStory,
        generationToken,
        isCurrentToken,
        plan = true,
        force = false,
        directorBrief = '',
        directorNote = '',
        worldRules = '',
        aiClient,
      } = args;

      // Empty-story no-op: planner skips when there is no story text yet (v1 spec).
      if (plan && recentStory.trim()) {
        const ahead = this.countPlannedAhead(db, projectId, branchId);
        // force=true (author talked to the director) reconciles regardless of count.
        if (force || ahead < PLAN_TRIGGER_THRESHOLD) {
          await this.reconcileRoadmap(
            db, projectId, branchId, recentStory,
            generationToken, isCurrentToken,
            providerConfig, model, worldRules, directorBrief, aiClient,
          );
        }
      }

      return await this.buildDirective(
        db, projectId, branchId, recentStory,
        worldRules, directorBrief, providerConfig, model, aiClient, directorNote,
      );
    } catch {
      return '';
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let directorServiceInstance: DirectorService | null = null;

export function getDirectorService(): DirectorService {
  if (!directorServiceInstance) {
    directorServiceInstance = new DirectorService();
  }
  return directorServiceInstance;
}
