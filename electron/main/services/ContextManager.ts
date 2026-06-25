import { getEncoding } from 'js-tiktoken';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { getContextWindowSize } from './AIProviderService.js';
import { DIALOGUE_CRAFT_COMPACT } from './dialogueCraft.js';

// 4-segment token budget (percentages)
const BUDGET_RATIOS = {
  system: 0.10,
  worldMemory: 0.20,
  storyHistory: 0.60,
  userInput: 0.10,
} as const;

// For now we use cl100k_base (GPT-4 tokenizer) as a reasonable approximation for all models.
// This avoids per-model tokenizer lookup complexity in Phase 2.
let encoding: ReturnType<typeof getEncoding> | null = null;

function getTokenEncoder() {
  if (!encoding) {
    encoding = getEncoding('cl100k_base');
  }
  return encoding;
}

export function countTokens(text: string): number {
  try {
    const enc = getTokenEncoder();
    return enc.encode(text).length;
  } catch {
    // Fallback: rough estimate (1 token ≈ 4 chars for English, ≈ 2 chars for Chinese)
    return Math.ceil(text.length / 3);
  }
}

export interface ContextBudget {
  totalTokens: number;
  system: number;
  worldMemory: number;
  storyHistory: number;
  userInput: number;
}

export function computeBudget(model: string): ContextBudget {
  const totalTokens = getContextWindowSize(model);
  return {
    totalTokens,
    system: Math.floor(totalTokens * BUDGET_RATIOS.system),
    worldMemory: Math.floor(totalTokens * BUDGET_RATIOS.worldMemory),
    storyHistory: Math.floor(totalTokens * BUDGET_RATIOS.storyHistory),
    userInput: Math.floor(totalTokens * BUDGET_RATIOS.userInput),
  };
}

export interface ParagraphContext {
  paragraphId: string;
  type: 'user' | 'ai' | 'system';
  content: string;
}

export interface AssembleOptions {
  model: string;
  systemPrompt: string;
  customInstructions: string;
  worldRules: string;
  writingStyleHints: string;
  worldDirectory: string;
  worldMemorySummary: string;
  storyHistory: ParagraphContext[];
  userInput: string;
  // Plot steering (optional). Long-term goals fold into the system prompt (primacy);
  // near-term directive is injected as the last system message before the user turn (recency).
  plotLongGoals?: string;
  plotNearTerm?: string;
  /** Steering note from the Director pre-step — biases output toward planned events. */
  directorDirective?: string;
  /** Running 前情提要 from manual compaction; preserves context the budget would truncate. */
  storySummary?: string;
  /**
   * Target word count per generated paragraph. When set (>0), the system prompt asks for
   * roughly this many 字; when unset, the original 200-500 字 range is kept so existing
   * projects behave identically.
   */
  targetWordCount?: number;
}

export interface AssembledContext {
  messages: ChatCompletionMessageParam[];
  budget: ContextBudget;
  used: {
    system: number;
    worldMemory: number;
    storyHistory: number;
    userInput: number;
  };
  isTruncated: boolean;
  truncatedCount: number;
}

// Built-in structured system prompt — users don't edit this directly.
// Custom instructions and writing style are injected via placeholders.
const BASE_SYSTEM_PROMPT = `你是一位高穩定性的互動小說創作夥伴與世界管理者，依使用者的提示以生動細膩的繁體中文續寫故事的下一段，並維持長篇故事的一致性與沉浸感。

【寫作原則】
- 使用繁體中文撰寫，語法與用詞必須正確：慣用語不可漏字或自創縮略（例如應寫「逞一時之快」而非「逞一時快」、「不知所蹤」而非「不知蹤」），量詞、介詞使用要符合中文習慣
- 場景描寫要有畫面感與沉浸感，讓讀者彷彿身歷其境
- 對話要符合角色性格與身份，避免千人一面
- 情節推進要自然，避免突兀的跳轉或無因果的發展
- 保持適當的敘事節奏，張弛有度
- 伏筆的埋設與回收要有邏輯性
- 避免過度解說世界觀，應在劇情中自然帶出
- 敘述要像真人寫的：句子完整自然、長短與句型有變化，意象具體而非套語（避免「彷彿」「一絲」「空氣彷彿凝固了」這類公式化描寫）
- 嚴禁電報式縮略片段：例如「不硬打」「不硬衝」這種沒人會講的寫法，要展開成自然完整句（如「不會跟他們硬拼」「保險起見，先不正面衝突」）
- 不必為了精簡而刻意縮短；自然完整優先，必要時句子長一點、囉嗦一點也沒關係
- 場景連續性（重要）：新段落必須從上一段結尾「當下的時間、地點與正在進行的動作」無縫接續。上一段角色在哪裡、正在做什麼，這一段就從那裡繼續。若劇情需要轉換場景、移動或推進時間，必須在段落中「寫出過渡」（如何離開現場、如何移動到新地點、時間如何流逝），嚴禁未經交代就瞬間切換到新場景、新地點或事件的後續結果。
- 作者指示的解讀：使用者（作者）輸入的內容是「對下一段的寫作指示／期望走向」，描述的是「希望接下來發生的事」，而非「已經發生、已完成的既定事實」。請把指示中提到、但故事裡尚未實際發生的安排與動作，當場、循序地演出來（角色去準備、去執行的過程），不可假設它已經完成，也不可直接跳到其結果。
- {{WORD_COUNT}}

【角色與一致性】
- 每個角色有獨立的動機、價值觀與行為邏輯；不受使用者直接控制的角色（NPC）依其性格與動機反應，不會無條件服從主角。
- 角色的成長須有合理支撐（修煉、學習、經驗、師承、機緣）；可能受傷、失敗、陷入困境——這是好故事的一部分。
- 角色關係變化由事件驅動，不可無故突變；重要行動應有動機或伏筆鋪墊。
- 已建立的世界規則不可無理由打破，資源、能力、機會的獲取必須合理，不可憑空產生。
- 時間、空間、距離與已發生的事件須前後一致，不可遺忘或矛盾。
- 獨一無二的關係與身份（如初戀、師父、結拜、配偶、宿敵）一旦確立，就只能有那一個對象，絕不可再為同一角色新增第二個同類對象（例如不可出現第二個初戀），也不可與【世界記憶】或【前情提要】中既有的人物關係矛盾。若不確定某關係是否已確立，以【世界記憶】中的設定為準。

{{DIALOGUE_CRAFT}}

【敘事風格】
{{WRITING_STYLE}}

{{CUSTOM_INSTRUCTIONS}}

{{WORLD_RULES}}

{{PLOT_LONG_GOALS}}

{{WORLD_MEMORY_TOOLS}}`;

export class ContextManager {
  buildSystemPrompt(
    writingStyleHints: string,
    customInstructions: string,
    worldDirectory: string,
    worldRules: string,
    plotLongGoals = '',
    targetWordCount?: number,
  ): string {
    let prompt = BASE_SYSTEM_PROMPT;

    // A configured target overrides the default range; unset keeps the original 200-500 字.
    const wordCountLine = targetWordCount && targetWordCount > 0
      ? `每次回應約 ${Math.round(targetWordCount)} 字。`
      : '每次回應約 200-500 字。';
    prompt = prompt.replace('{{WORD_COUNT}}', wordCountLine);

    prompt = prompt.replace('{{DIALOGUE_CRAFT}}', DIALOGUE_CRAFT_COMPACT);

    const styleBlock = writingStyleHints
      ? writingStyleHints
      : '以流暢、沉浸的文學風格撰寫，保持畫面感與角色深度。';
    prompt = prompt.replace('{{WRITING_STYLE}}', styleBlock);

    const customBlock = customInstructions
      ? `\n【創作者補充指令】\n${customInstructions}`
      : '';
    prompt = prompt.replace('{{CUSTOM_INSTRUCTIONS}}', customBlock);

    const worldRulesBlock = worldRules
      ? `\n【本作世界設定（最高優先，違背即錯誤）】\n以下是本作品不可違背的世界觀與規則，敘事與角色行為都必須嚴格遵守：\n${worldRules}`
      : '';
    prompt = prompt.replace('{{WORLD_RULES}}', worldRulesBlock);

    const plotGoalsBlock = plotLongGoals
      ? `\n【長期劇情走向】\n${plotLongGoals}`
      : '';
    prompt = prompt.replace('{{PLOT_LONG_GOALS}}', plotGoalsBlock);

    const toolBlock = worldDirectory
      ? `\n【世界資料查詢】\n你可以使用 query_world_memory 工具查詢角色詳細資料、關係與事件。在生成故事前，請先查詢與當前劇情相關的角色，以確保一致性。\n\n${worldDirectory}`
      : '';
    prompt = prompt.replace('{{WORLD_MEMORY_TOOLS}}', toolBlock);

    return prompt;
  }

  assemblePrompt(options: AssembleOptions): AssembledContext {
    const budget = computeBudget(options.model);

    // --- System message ---
    const systemText = this.buildSystemPrompt(
      options.writingStyleHints,
      options.customInstructions,
      options.worldDirectory,
      options.worldRules,
      options.plotLongGoals ?? '',
      options.targetWordCount,
    );
    let systemTokens = countTokens(systemText);
    let effectiveSystem = systemText;
    if (systemTokens > budget.system) {
      const ratio = budget.system / systemTokens;
      effectiveSystem = systemText.slice(0, Math.floor(systemText.length * ratio));
      systemTokens = countTokens(effectiveSystem);
    }

    // --- World memory message ---
    let worldMemoryTokens = 0;
    let worldMemoryContent = '';
    if (options.worldMemorySummary) {
      worldMemoryTokens = countTokens(options.worldMemorySummary);
      if (worldMemoryTokens <= budget.worldMemory) {
        worldMemoryContent = options.worldMemorySummary;
      } else {
        // Truncate to budget
        const ratio = budget.worldMemory / worldMemoryTokens;
        worldMemoryContent = options.worldMemorySummary.slice(
          0,
          Math.floor(options.worldMemorySummary.length * ratio),
        );
        worldMemoryTokens = countTokens(worldMemoryContent);
      }
    }

    // --- User input ---
    const userInputTokens = countTokens(options.userInput);

    // --- Story history: fill remaining budget, truncate from oldest ---
    const remainingForHistory = budget.storyHistory;
    const historyMessages: ChatCompletionMessageParam[] = [];
    let historyTokens = 0;
    let isTruncated = false;

    // Walk history from newest to oldest, collecting as much as fits
    const historyParagraphs = [...options.storyHistory];
    const selectedParagraphs: ParagraphContext[] = [];

    for (let i = historyParagraphs.length - 1; i >= 0; i--) {
      const para = historyParagraphs[i];
      const tokens = countTokens(para.content);
      if (historyTokens + tokens <= remainingForHistory) {
        selectedParagraphs.unshift(para);
        historyTokens += tokens;
      } else {
        isTruncated = true;
        // Count remaining items that didn't fit (i + 1 items from index 0..i)
        break;
      }
    }

    const truncatedCount = historyParagraphs.length - selectedParagraphs.length;

    // Convert to chat messages: user paragraphs → role user, ai/system → role assistant
    for (const para of selectedParagraphs) {
      if (para.type === 'user') {
        historyMessages.push({ role: 'user', content: para.content });
      } else {
        historyMessages.push({ role: 'assistant', content: para.content });
      }
    }

    // --- Assemble final messages array ---
    const messages: ChatCompletionMessageParam[] = [];

    // 1. System message
    messages.push({ role: 'system', content: effectiveSystem });

    // 2. World memory (if any) — injected as a system message for Phase 2
    if (worldMemoryContent) {
      messages.push({ role: 'system', content: `【世界記憶】\n${worldMemoryContent}` });
    }

    // 2b. Story summary (前情提要) from manual compaction — older context the budget
    // truncation would otherwise drop. Counted toward the system budget for reporting.
    if (options.storySummary) {
      // The 前情提要 is a lossy convenience recap; the canonical 世界記憶/角色設定 win on
      // any conflict. State that explicitly so a summary that dropped or garbled a fact
      // (e.g. who is whose 初戀) can never override the authoritative world memory.
      const summaryMsg = `【前情提要】（僅為劇情回顧；若與【世界記憶】或角色設定衝突，一律以世界記憶為準，且不可據此新增與既有設定矛盾的人物關係）\n${options.storySummary}`;
      messages.push({ role: 'system', content: summaryMsg });
      systemTokens += countTokens(summaryMsg);
    }

    // 3. Story history
    messages.push(...historyMessages);

    // 4. Near-term plot steering — injected last among system context, in the
    //    recency slot just before the user turn, so it most strongly steers the
    //    immediate generation toward upcoming planned events.
    if (options.plotNearTerm) {
      messages.push({ role: 'system', content: options.plotNearTerm });
    }

    // 4b. Director directive — placed just before the user input so the steering is
    // the freshest instruction the model sees.
    if (options.directorDirective) {
      const directiveMsg = `【導演指示（請依此推進下一段，朝目標劇情前進）】\n${options.directorDirective}`;
      messages.push({ role: 'system', content: directiveMsg });
      systemTokens += countTokens(directiveMsg);
    }

    // 5. Current user input — framed as an author directive (what to write next),
    // not as already-happened narration, so the model dramatizes it unfolding
    // instead of jumping to the completed result.
    if (options.userInput && options.userInput.trim()) {
      messages.push({
        role: 'user',
        content:
          `【作者指示】\n${options.userInput}\n\n` +
          `（以上是作者對「接下來這一段要寫什麼」的指示，描述的是「希望接下來發生的事」，` +
          `不是已經發生、已完成的劇情。請從目前故事的當下場景無縫接續，把指示中尚未發生的安排與動作` +
          `「當場、循序地演出來」——描寫角色去準備、去執行的過程，不可預設這些動作已經完成，也不可直接跳到其結果。）`,
      });
    } else {
      messages.push({ role: 'user', content: options.userInput });
    }

    return {
      messages,
      budget,
      used: {
        system: systemTokens,
        worldMemory: worldMemoryTokens,
        storyHistory: historyTokens,
        userInput: userInputTokens,
      },
      isTruncated,
      truncatedCount,
    };
  }
}

let instance: ContextManager | null = null;

export function getContextManager(): ContextManager {
  if (!instance) {
    instance = new ContextManager();
  }
  return instance;
}
