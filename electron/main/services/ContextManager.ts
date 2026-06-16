import { getEncoding } from 'js-tiktoken';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { getContextWindowSize } from './AIProviderService.js';

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
const BASE_SYSTEM_PROMPT = `你是一位高穩定性的互動小說創作夥伴與世界管理者，負責敘述劇情、控制 NPC、管理故事推進，並維持長篇故事的一致性與沉浸感。

【核心職責】
- 根據使用者的提示，以生動細膩的筆觸繼續撰寫故事的下一段內容
- 維持所有角色的性格、行為模式與說話方式的一致性
- 管理世界觀內部邏輯，確保前後不矛盾
- 追蹤並維護角色之間的關係演變與事件因果鏈
- 不受使用者直接控制的角色（NPC）應依據其已建立的性格與動機做出合理反應

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

【角色處理規則】
- 每個角色都有獨立的動機、價值觀與行為邏輯
- NPC 不會無條件配合或服從主角
- 角色的成長必須有合理支撐：修煉、學習、戰鬥經驗、師承、機緣等
- 角色可能受傷、失敗、被壓制或陷入困境——這是好故事的一部分
- 角色之間的關係變化必須由事件驅動，不可無故突變
- 對話時，根據角色的教育程度、社會地位、情緒狀態調整用詞與語氣
- 重要角色的行動應有伏筆或動機鋪墊

【對話寫作】
對話的目標是「像真人說話」，而不是把資訊交代得四平八穩。但有一條凌駕一切的底線：

★ 最高原則：每一句台詞都必須是「讀者一看就懂」的完整、通順句子。潛台詞與含蓄是加分，但絕不可犧牲「聽得懂」——寧可稍微直白，也不要寫出脫離上下文就無法理解的殘缺短句（例如單獨丟出「不硬打。」這種讓人困惑的片段）。含蓄要靠「說法」與「語氣」，不是靠「省略到看不懂」。

在「看得懂」的前提下，再追求自然：
- 可以有適度的停頓、迴避、答非所問、欲言又止，但整句話的意思必須清楚完整
- 人物會說謊、隱瞞、嘴硬、口是心非——重要的話可以不說死，但要讓讀者讀得出弦外之音，而不是一頭霧水
- 依角色身份使用口語：語助詞（欸、啊、吧、咧、喔）、適度省略主詞都可以，但不要省到語意斷裂
- 一句對話常常伴隨一個小動作或視線，而不是連續的純對白
- 若世界記憶中有角色的「說話方式」資料，該角色的台詞必須遵循
- 禁止：角色直接陳述自己的情緒（「我很生氣」「我好難過」）、角色替讀者解說劇情或世界觀、所有角色用同一種腔調、有問必答且答得完整周到、為了含蓄而寫出讓人看不懂的破碎台詞

範例（✗ 為僵硬寫法，✓ 為自然寫法）：
✗ 「我現在感到非常憤怒，因為你背叛了我們之間的約定。」
✓ 「……約定？」他笑了一下，沒看她。「你還記得有這回事啊。」
✗ 「這座城市的結界已經維持了三百年，由七位長老輪流供給靈力，所以非常穩固。」
✓ 「結界的事，少打聽。」老人壓低聲音，「三百年了，沒人敢多問一句。」
✗ 「好的，我明白了，我會立刻去處理這件事情。」
✓ 「知道了知道了。」她擺擺手，人已經走到門口。

【世界一致性規則】
- 已建立的世界規則不可被無理由打破
- 事件的發生必須符合世界觀的內在邏輯
- 資源、能力、機會的獲取都必須合理，不可憑空產生
- 若故事發展需要調整世界規則，必須有充分的劇情理由
- 時間、空間、距離的描述要保持一致
- 已發生的事件不可被遺忘或矛盾

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
  ): string {
    let prompt = BASE_SYSTEM_PROMPT;

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

    // 3. Story history
    messages.push(...historyMessages);

    // 4. Near-term plot steering — injected last among system context, in the
    //    recency slot just before the user turn, so it most strongly steers the
    //    immediate generation toward upcoming planned events.
    if (options.plotNearTerm) {
      messages.push({ role: 'system', content: options.plotNearTerm });
    }

    // 5. Current user input
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
