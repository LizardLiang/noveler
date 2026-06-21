/**
 * dialogueCraft.ts
 *
 * Single source of truth for dialogue-writing rules, shared by:
 *   - ContextManager.BASE_SYSTEM_PROMPT (story generation)  → DIALOGUE_CRAFT_COMPACT
 *   - DialogueEditorService prompts (post-gen refinement)    → CLARITY_FLOOR / RUBRIC / BAN_LIST / REWRITE_RULES
 *
 * Previously these rules were duplicated in both places, which let them drift.
 * Keep this file dependency-free (pure string constants) to avoid import cycles.
 */

/** Overriding constraint: comprehensibility + meaning preservation beat subtext. */
export const CLARITY_FLOOR = `最高原則（凌駕一切）：
- 每一句對話都必須是「讀者一看就懂」的完整、通順、口語化繁體中文。
- 潛台詞與含蓄是加分項，但絕不可犧牲理解——寧可稍微直白，也不要寫出脫離上下文就看不懂的殘缺短句（例如單獨丟出「不硬打。」這種讓人困惑的片段）。
- 只改說法，不改意思：不得更動對話的原意、角色意圖或劇情資訊，只能調整措辭、語氣與節奏。`;

/** Four quality dimensions for dialogue. The four Chinese terms are asserted in tests. */
export const RUBRIC = `對話品質四維度：
1. 聲音辨識度：每個角色有可辨識的語氣、用詞、節奏，讀者不靠標籤也能分辨誰在說話。
2. 潛台詞深度：透過迂迴、迴避、暗示傳達情緒與意圖，而非直接說破。
3. 避免直白：不讓角色把感受與動機講白（如「我很生氣因為你背叛了我」）。
4. 權力動態：對話反映角色之間的地位、控制、讓步與試探。`;

/** Anti-patterns to remove or rewrite. Key substrings are asserted in tests. */
export const BAN_LIST = `禁止清單（必須移除或改寫）：
- 破折號濫用（— 過度堆疊）
- 「他點點頭」「她嘆了口氣」這類陳腐動作標籤
- 治療式語言（「當你做 X 時我感到 Y」）
- 「眾所周知」式資訊傾倒（"As you know Bob" 說明）
- 對話中途反覆呼喚對方名字
- 角色直接陳述自己的動機`;

/** Refinement-only output contract: what to touch, what to preserve, how to emit. */
export const REWRITE_RULES = `改寫規則：
- 只改寫「引號內」的對話。引號外的敘述、動作、場景文字一律逐字保留，不得更動。
- 不得改變對話的原意、角色意圖或劇情資訊，只能調整措辭、語氣與節奏。
- 中文引號（「」『』）與西文引號（"" ''）皆支援；改寫後維持原本的引號樣式。
- 不得新增或刪除對話段落，不得改變敘事視角。
- 直接輸出完整段落（敘述 + 改寫後對話），不要附加說明、評語或標記。`;

/**
 * Compact dialogue guidance injected into the story-generation system prompt.
 * Distils CLARITY_FLOOR + RUBRIC + BAN_LIST into generation-time advice with a
 * single ✗/✓ example (the refinement prompts carry the full detail).
 */
export const DIALOGUE_CRAFT_COMPACT = `【對話寫作】
對話要「像真人說話」，但底線是讀者一看就懂——含蓄靠語氣與說法，不是靠省略到看不懂。
- 讓每個角色有自己的語氣與用詞，避免千人一面。
- 用迂迴、停頓、答非所問傳達情緒，不要讓角色把感受與動機直接講白。
- 對話多半伴隨一個小動作或視線，而非連續純對白。
- 若角色有設定「說話方式」，台詞必須遵循。
- 避免：直陳情緒、替讀者解說劇情、陳腐動作標籤、為含蓄而寫出看不懂的破碎短句。
範例 ✗ 「我現在非常憤怒，因為你背叛了我們的約定。」
範例 ✓ 「……約定？」他笑了一下，沒看她。「你還記得有這回事啊。」`;
