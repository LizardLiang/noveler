// Verify the SHIPPED refine prompt against local Ollama (gemma4:e4b) on real paragraphs.
// Compares OLD (subtext-max) vs NEW (clarity floor + meaning-preserve) prompts.
// Usage: node scripts/dialogue-refine-ab.mjs
const ENDPOINT = 'http://localhost:11434/v1/chat/completions';
const MODEL = 'gemma4:e4b';

const STORIES = {
  'A (scheme talk)': `沈無妄靠著石壁，指尖轉著一枚火光黯淡的玉符，懶洋洋道：「所以不能讓『我們』去。」

他笑了笑：「妖螟現在相信我半死，小醫仙耗盡，妖暝昏迷。那就讓妖岐押幾個『叛亂嫌疑人』去長老居請三位大長老定罪。」

雲韻眉心微蹙：「你傷勢未穩。」

沈無妄抬眼看她，語氣輕了些：「我不硬打。這次靠演。」`,
  'B (battlefield)': `雲韻側眸：「你答應過。」

沈無妄看著血陣中心的妖螟，眼底火光沉下，聲音罕見地安靜。

「不硬打。」他抬起未傷的手，三清火影在身後淡淡浮現，「只把刀遞到該殺人的地方。」`,
};

const RUBRIC = `評估標準（對話品質四維度）：
1. 聲音辨識度：每個角色的對話是否有可辨識的個人語氣、用詞、節奏。
2. 潛台詞深度：角色是否透過迂迴、迴避、暗示傳達情緒與意圖，而非直接陳述。
3. 避免直白：避免角色把感受與動機說破。
4. 權力動態：對話是否反映角色之間的地位、控制、讓步與試探。`;

const BAN_LIST = `禁止清單：破折號濫用、陳腐動作標籤、治療式語言、資訊傾倒、中途反覆呼喚名字、角色直接陳述自己的動機。`;

// ── OLD shipped prompt ──
const OLD = [
  '你是一位專精潛台詞的對話編輯。針對下方小說段落，先在心中依四維度標準與禁止清單評估對話，',
  '然後「只改寫引號內的對話」使其更自然、更具潛台詞、更符合各角色聲音設定，敘述與動作描寫逐字保留。',
  '', RUBRIC, '', BAN_LIST,
  '', '改寫規則：只改寫引號內對話，敘述逐字保留，維持引號樣式，直接輸出完整段落。',
].join('\n');

// ── NEW shipped prompt (mirrors buildSinglePassSystemPrompt) ──
const CLARITY_FLOOR = `最高原則（凌駕一切）：
- 改寫後的每一句對話都必須是「讀者一看就懂」的完整、通順、口語化繁體中文。
- 潛台詞與含蓄是加分項，但絕不可犧牲理解——寧可稍微直白，也不要產生脫離上下文就無法理解的殘缺短句（例如單獨的「不硬打。」這種讓人困惑的片段）。
- 「只改說法，不改意思」：嚴禁改變任何對話的原意、角色意圖或劇情資訊，只能調整措辭、語氣與節奏。`;

const NEW = [
  '你是一位對話潤飾編輯。針對下方小說段落，「只改寫引號內的對話」，讓角色說話更自然、更像真人，敘述與動作描寫逐字保留。',
  '', CLARITY_FLOOR,
  '', '在「看得懂、不改意思」的前提下，再依下列四維度提升品質：', RUBRIC,
  '', BAN_LIST,
  '', '改寫規則：只改寫引號內對話；不得改變原意與劇情資訊；敘述逐字保留；維持引號樣式；直接輸出完整段落。',
].join('\n');

async function run(system, story) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: story }],
      temperature: 0.7, stream: false,
    }),
  });
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? JSON.stringify(json).slice(0, 300);
}

for (const [name, story] of Object.entries(STORIES)) {
  console.log(`\n################ ${name} ################`);
  console.log(`--- ORIGINAL ---\n${story}`);
  console.log(`\n--- OLD prompt ---\n${await run(OLD, story)}`);
  console.log(`\n--- NEW prompt (clarity + meaning-preserve) ---\n${await run(NEW, story)}`);
}
