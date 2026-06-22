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
- 繁體中文，語法與用詞正確：慣用語不可漏字或自創縮略（應寫「逞一時之快」而非「逞一時快」），量詞、介詞符合中文習慣。
- 場景描寫有畫面感，讓讀者身歷其境；世界觀在劇情中自然帶出，不要大段解說。
- 情節推進自然、有因果，節奏張弛有度，伏筆的埋設與回收要有邏輯。
- 場景連續性（重要）：新段落必須從上一段結尾「當下的時間、地點與正在進行的動作」無縫接續。上一段角色在哪裡、正在做什麼，這一段就從那裡繼續。若劇情需要轉換場景、移動或推進時間，必須在段落中「寫出過渡」（如何離開現場、如何移動到新地點、時間如何流逝），嚴禁未經交代就瞬間切換到新場景、新地點或事件的後續結果。
- {{WORD_COUNT}}

【角色與一致性】
- 每個角色有獨立的動機、價值觀與行為邏輯；不受使用者直接控制的角色（NPC）依其性格與動機反應，不會無條件服從主角。
- 角色的成長須有合理支撐（修煉、學習、經驗、師承、機緣）；可能受傷、失敗、陷入困境——這是好故事的一部分。
- 角色關係變化由事件驅動，不可無故突變；重要行動應有動機或伏筆鋪墊。
- 已建立的世界規則不可無理由打破，資源、能力、機會的獲取必須合理，不可憑空產生。
- 時間、空間、距離與已發生的事件須前後一致，不可遺忘或矛盾。

{{DIALOGUE_CRAFT}}

【敘事風格】
{{WRITING_STYLE}}

{{CUSTOM_INSTRUCTIONS}}

{{WORLD_RULES}}

{{WORLD_MEMORY_TOOLS}}`;

export class ContextManager {
  buildSystemPrompt(
    writingStyleHints: string,
    customInstructions: string,
    worldDirectory: string,
    worldRules: string,
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
      const summaryMsg = `【前情提要】\n${options.storySummary}`;
      messages.push({ role: 'system', content: summaryMsg });
      systemTokens += countTokens(summaryMsg);
    }

    // 3. Story history
    messages.push(...historyMessages);

    // 3b. Director directive — placed just before the user input so the steering is
    // the freshest instruction the model sees.
    if (options.directorDirective) {
      const directiveMsg = `【導演指示（請依此推進下一段，朝目標劇情前進）】\n${options.directorDirective}`;
      messages.push({ role: 'system', content: directiveMsg });
      systemTokens += countTokens(directiveMsg);
    }

    // 4. Current user input
    messages.push({ role: 'user', content: options.userInput });

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
