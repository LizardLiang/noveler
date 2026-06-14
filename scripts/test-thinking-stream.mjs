// Standalone test for the thinking-model stream split (mirrors AIProviderService.streamChat).
//
// Streams a story-continuation prompt from an OpenAI-compatible endpoint and
// separates delta.content (the saved STORY) from delta.reasoning_content /
// delta.reasoning (the THINKING channel) — exactly like the app does. Prints
// both live and a summary, so you can see what a given model actually emits.
//
// Usage:
//   node scripts/test-thinking-stream.mjs
//   THINK_MODEL=qwen3 node scripts/test-thinking-stream.mjs
//   THINK_ENDPOINT=http://localhost:8080/api/chat/completions THINK_API_KEY=sk-... node scripts/test-thinking-stream.mjs
//
// Defaults target Ollama directly (no API key needed). Point THINK_ENDPOINT at
// your Open WebUI (http://localhost:8080/api/chat/completions) + THINK_API_KEY
// to test that path instead.

const ENDPOINT = process.env.THINK_ENDPOINT ?? 'http://localhost:11434/v1/chat/completions';
const MODEL = process.env.THINK_MODEL ?? 'gemma4:e4b';
const API_KEY = process.env.THINK_API_KEY ?? '';
const NUM_CTX = Number(process.env.THINK_NUM_CTX ?? 0);

const SYSTEM = '你是一位小說家。根據使用者的提示，直接續寫故事，輸出繁體中文敘事散文。';
// THINK_PAD repeats filler in the system prompt to simulate the app's large
// context (world memory + history). Set e.g. THINK_PAD=3500 to push the prompt
// toward a 4096-token window and see if a thinking model runs out of room for content.
const PAD = Number(process.env.THINK_PAD ?? 0);
const PADDING = PAD > 0 ? '\n\n（背景設定，請忽略）' + '本段為填充用的背景敘述。'.repeat(PAD) : '';
const USER = '續寫：沈無妄靠著石壁，火光在他指尖明滅。雲韻站在洞口，遠處傳來妖獸的低吼。';

function parseSseBlock(block) {
  // Returns the JSON object from a "data: {...}" SSE block, or null.
  for (const line of block.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return null;
    try { return JSON.parse(payload); } catch { return null; }
  }
  return null;
}

// THINK_NATIVE=1 uses Ollama's native /api/chat (NDJSON, message.content +
// message.thinking) instead of the OpenAI endpoint, so options.num_ctx is honored.
const NATIVE = process.env.THINK_NATIVE === '1';

async function mainNative() {
  const nativeBase = ENDPOINT.replace(/\/v1\/chat\/completions$/, '').replace(/\/chat\/completions$/, '');
  const url = `${nativeBase}/api/chat`;
  console.log(`▶ NATIVE   : ${url}`);
  console.log(`▶ model    : ${MODEL}`);
  console.log(`▶ num_ctx  : ${NUM_CTX || '(default)'}`);
  console.log('─'.repeat(60));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM + PADDING }, { role: 'user', content: USER }],
      think: true,
      stream: true,
      options: { temperature: 0.9, ...(NUM_CTX ? { num_ctx: NUM_CTX } : {}) },
    }),
  });
  if (!res.ok || !res.body) { console.error(`✗ HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }

  let storyChars = 0, thinkingChars = 0, lines = 0, done = null, prompt = 0, evalCount = 0, lastChannel = null;
  let buffer = '';
  const emit = (ch, t) => { if (ch !== lastChannel) { process.stdout.write(`\n\n[${ch === 'story' ? 'STORY' : 'THINKING'}] `); lastChannel = ch; } process.stdout.write(t); };
  const decoder = new TextDecoder();
  for await (const part of res.body) {
    buffer += decoder.decode(part, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      lines++;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      const m = obj.message ?? {};
      if (m.content) { storyChars += m.content.length; emit('story', m.content); }
      if (m.thinking) { thinkingChars += m.thinking.length; emit('thinking', m.thinking); }
      if (obj.done) { done = obj.done_reason ?? 'done'; prompt = obj.prompt_eval_count ?? prompt; evalCount = obj.eval_count ?? evalCount; }
    }
  }
  console.log('\n' + '─'.repeat(60));
  console.log('SUMMARY (native /api/chat)');
  console.log(`  lines         : ${lines}`);
  console.log(`  STORY chars   : ${storyChars}  (message.content)`);
  console.log(`  THINKING chars: ${thinkingChars}  (message.thinking)`);
  console.log(`  done_reason   : ${done}`);
  console.log(`  prompt_eval   : ${prompt}   eval_count: ${evalCount}   total: ${prompt + evalCount}`);
  console.log('─'.repeat(60));
  console.log(storyChars > 0 ? '✓ Story content produced (context window sufficient).' : '✗ No content — still truncated.');
}

async function main() {
  if (NATIVE) return mainNative();
  console.log(`▶ endpoint : ${ENDPOINT}`);
  console.log(`▶ model    : ${MODEL}`);
  console.log(`▶ api key  : ${API_KEY ? '(set)' : '(none)'}`);
  console.log('─'.repeat(60));

  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM + PADDING }, { role: 'user', content: USER }],
        temperature: 0.9,
        stream: true,
        stream_options: { include_usage: true },
        // Probe whether the endpoint honors a larger context window. THINK_NUM_CTX
        // sets both the top-level and options.num_ctx forms (Ollama native uses options).
        ...(NUM_CTX ? { num_ctx: NUM_CTX, options: { num_ctx: NUM_CTX } } : {}),
      }),
    });
  } catch (err) {
    console.error(`✗ request failed: ${err.message}`);
    console.error('  Is the server running and reachable at THINK_ENDPOINT?');
    process.exit(1);
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    console.error(`✗ HTTP ${res.status}: ${text.slice(0, 400)}`);
    process.exit(1);
  }

  let storyChars = 0;
  let thinkingChars = 0;
  let chunks = 0;
  let finish = null;
  let usage = null;
  let buffer = '';
  let lastChannel = null; // 'story' | 'thinking' — for readable interleaving

  const emit = (channel, text) => {
    if (channel !== lastChannel) {
      process.stdout.write(`\n\n[${channel === 'story' ? 'STORY' : 'THINKING'}] `);
      lastChannel = channel;
    }
    process.stdout.write(text);
  };

  const decoder = new TextDecoder();
  for await (const part of res.body) {
    buffer += decoder.decode(part, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const obj = parseSseBlock(block);
      if (!obj) continue;
      chunks++;
      const choice = obj.choices?.[0];
      finish = choice?.finish_reason ?? finish;
      const delta = choice?.delta ?? {};
      const content = delta.content ?? '';
      if (content) {
        storyChars += content.length;
        emit('story', content);
      } else {
        const reasoning = delta.reasoning_content ?? delta.reasoning ?? '';
        if (reasoning) {
          thinkingChars += reasoning.length;
          emit('thinking', reasoning);
        }
      }
      if (obj.usage) usage = obj.usage;
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log('SUMMARY');
  console.log(`  chunks        : ${chunks}`);
  console.log(`  STORY chars   : ${storyChars}  (delta.content → saved paragraph)`);
  console.log(`  THINKING chars: ${thinkingChars}  (delta.reasoning_content → thinking box)`);
  console.log(`  finish_reason : ${finish}`);
  console.log(`  usage         : ${usage ? JSON.stringify(usage) : '(none)'}`);
  console.log('─'.repeat(60));

  if (storyChars === 0 && thinkingChars > 0) {
    console.log('⚠ Model emitted ONLY reasoning, no content. The story would be EMPTY,');
    console.log('  with everything in the thinking box (e.g. Gemma — ollama#15288).');
    console.log('  Use a model that returns content (gpt-5.5, qwen3, llama3.1, mistral).');
  } else if (storyChars > 0 && thinkingChars > 0) {
    console.log('✓ Proper thinking model: thinking goes to the box, content is the story.');
  } else if (storyChars > 0) {
    console.log('✓ Non-thinking model: all output is story content (no separate thinking).');
  } else {
    console.log('✗ No content and no reasoning — nothing streamed. Check model/endpoint.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
