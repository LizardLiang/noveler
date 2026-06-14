// 將既有小說文字檔切割為段落，供匯入專案使用

// 章節標題：Markdown 標題、中文「第N章/節/卷/回...」、英文 Chapter N
// 中文標題須為短行且不含句末標點，以免誤判以「第N章」開頭的正文
const CHAPTER_HEADING =
  /^(?:#{1,6}\s+\S.*|\s*第\s*[0-9０-９零〇一二三四五六七八九十百千兩两]{1,8}\s*[章節卷回部集話话][^。，！？；]{0,30}\s*$|\s*(?:Chapter|CHAPTER)\s+\d+.{0,40}$)/;

// 單一段落的最大字元數（無章節標題時依此切割）
const MAX_CHUNK_CHARS = 2000;

// 將小說全文切割為段落：優先以章節標題分段，否則以空行為界打包成適中大小的區塊
export function splitNovelText(raw: string): string[] {
  // 去除 UTF-8 BOM 並統一換行符號
  const noBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const text = noBom.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const headingCount = lines.filter(line => CHAPTER_HEADING.test(line)).length;

  if (headingCount >= 2) {
    return splitByHeadings(lines).flatMap(chapter => chunkText(chapter));
  }
  return chunkText(text);
}

function splitByHeadings(lines: string[]): string[] {
  const chapters: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (CHAPTER_HEADING.test(line) && current.some(l => l.trim().length > 0)) {
      chapters.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.some(l => l.trim().length > 0)) {
    chapters.push(current.join('\n'));
  }
  return chapters;
}

// 以空行為界切成區塊後打包，使每段不超過 MAX_CHUNK_CHARS
function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHUNK_CHARS) return [trimmed];

  const blocks = trimmed
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .flatMap(block => (block.length > MAX_CHUNK_CHARS ? splitOversizedBlock(block) : [block]));

  const chunks: string[] = [];
  let buffer = '';
  for (const block of blocks) {
    if (buffer && buffer.length + block.length + 2 > MAX_CHUNK_CHARS) {
      chunks.push(buffer);
      buffer = block;
    } else {
      buffer = buffer ? `${buffer}\n\n${block}` : block;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

// 區塊本身過大時改以單行為界切割；單行仍過長則強制切斷
function splitOversizedBlock(block: string): string[] {
  const parts: string[] = [];
  let buffer = '';
  for (const line of block.split('\n')) {
    if (buffer && buffer.length + line.length + 1 > MAX_CHUNK_CHARS) {
      parts.push(buffer);
      buffer = line;
    } else {
      buffer = buffer ? `${buffer}\n${line}` : line;
    }
  }
  if (buffer) parts.push(buffer);

  return parts.flatMap(part =>
    part.length > MAX_CHUNK_CHARS
      ? (part.match(new RegExp(`[\\s\\S]{1,${MAX_CHUNK_CHARS}}`, 'g')) ?? [])
      : [part],
  );
}
