import type { WebContents } from 'electron';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { v4 as uuidv4 } from 'uuid';
import type {
  FullStoryJob,
  FullStoryProgressPayload,
  FullStorySection,
  FullStoryStartRequest,
} from '../../shared/types.js';
import { IPC_CHANNELS } from '../../ipc/channels.js';
import {
  ensureFreshOAuthToken,
  getActiveProvider,
  getCustomInstructions,
  getWritingStyleHints,
  getWorldRules,
  extractWorldChanges,
} from '../../ipc/aiHandlers.js';
import { applyWorldChange } from '../../ipc/worldMemoryHandlers.js';
import { getOpenProject, getProjectStoragePath } from '../../ipc/projectHandlers.js';
import { getAIProviderService, extractReasoningTokens, type TokenUsage } from './AIProviderService.js';
import { curlComplete } from './CurlStreamService.js';
import { ollamaChatComplete } from './OllamaNativeService.js';
import { getParagraphService } from './ParagraphService.js';
import { countWords } from './StatsService.js';
import { allocateFullStoryCounts, isWithinFullStoryTolerance } from './FullStoryUtils.js';
import { getWorldMemoryService } from './WorldMemoryService.js';
import { getNarrationEditorSettings, refineNarration } from './NarrationEditorService.js';
import { getDialogueEditorSettings, refineDialogue } from './DialogueEditorService.js';

type Provider = NonNullable<ReturnType<typeof getActiveProvider>>;
type OutlineItem = { title: string; goal: string };

const MIN_TARGET = 1_000;
const MAX_TARGET = 20_000;
const SECTION_TARGET = 2_200;
const MAX_ATTEMPTS = 3;

function parseJsonObject<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!candidate) return null;
  try { return JSON.parse(candidate) as T; } catch { return null; }
}

async function complete(
  provider: Provider,
  messages: ChatCompletionMessageParam[],
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
): Promise<{ text: string; usage: TokenUsage | null }> {
  if (provider.authMethod === 'oauth' && provider.accountId) {
    return curlComplete({
      messages,
      model: provider.defaultModel,
      accessToken: provider.apiKey,
      accountId: provider.accountId,
      signal,
      maxOutputTokens: maxTokens,
    });
  }
  if (provider.isOllama) {
    return ollamaChatComplete({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      messages,
      model: provider.defaultModel,
      temperature,
      maxTokens,
      signal,
    });
  }
  const client = getAIProviderService().getClient();
  if (!client) throw new Error('AI 客戶端未初始化');
  const response = await client.chat.completions.create({
    model: provider.defaultModel,
    messages,
    max_tokens: maxTokens,
    temperature,
  }, { signal });
  const choice = response.choices[0];
  if (choice?.finish_reason === 'length') throw new Error('模型輸出因長度限制而截斷');
  const usage = response.usage;
  return {
    text: choice?.message?.content ?? '',
    usage: usage ? {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      reasoningTokens: extractReasoningTokens(usage),
    } : null,
  };
}

export class FullStoryService {
  private controllers = new Map<string, AbortController>();

  isProjectActive(projectId: string): boolean {
    return this.controllers.has(projectId);
  }

  getStatus(projectId: string): FullStoryJob | null {
    const db = getOpenProject(projectId);
    if (!db) return null;
    const row = db.prepare(
      'SELECT * FROM full_story_jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 1',
    ).get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    if ((row.status === 'planning' || row.status === 'generating') && !this.controllers.has(projectId)) {
      db.prepare("UPDATE full_story_jobs SET status='paused', updated_at=datetime('now') WHERE id=?")
        .run(String(row.id));
      row.status = 'paused';
    }
    return this.rowToJob(row);
  }

  start(req: FullStoryStartRequest, sender: WebContents): FullStoryJob {
    const db = getOpenProject(req.projectId);
    const projectPath = getProjectStoragePath(req.projectId);
    if (!db || !projectPath) throw new Error('專案未開啟');
    const prompt = req.prompt.trim();
    if (!prompt) throw new Error('請輸入故事提示');
    if (!Number.isInteger(req.targetCharacterCount) || req.targetCharacterCount < MIN_TARGET || req.targetCharacterCount > MAX_TARGET) {
      throw new Error(`故事字數必須介於 ${MIN_TARGET.toLocaleString()} 與 ${MAX_TARGET.toLocaleString()} 之間`);
    }
    if (this.controllers.has(req.projectId)) throw new Error('此專案已有完整故事正在生成');

    const paragraphService = getParagraphService();
    const branchId = req.branchId || paragraphService.getOrCreateMainBranch(db, projectPath, req.projectId);
    const existing = paragraphService.listParagraphs(db, branchId).filter(p => p.status !== 'detached');
    if (existing.length > 0) throw new Error('只能在空白故事中開始完整故事生成');

    const previous = this.getStatus(req.projectId);
    if (previous && previous.status !== 'completed') throw new Error('此專案已有未完成的完整故事工作');

    const id = uuidv4();
    db.prepare(`INSERT INTO full_story_jobs
      (id, project_id, branch_id, prompt, target_character_count, status, outline_json, current_section, final_character_count)
      VALUES (?, ?, ?, ?, ?, 'planning', '[]', 0, 0)`)
      .run(id, req.projectId, branchId, prompt, req.targetCharacterCount);
    const job = this.getJobById(req.projectId, id)!;
    this.launch(job, sender);
    return job;
  }

  resume(projectId: string, sender: WebContents): FullStoryJob {
    const job = this.getStatus(projectId);
    if (!job || !['paused', 'failed'].includes(job.status)) throw new Error('沒有可恢復的完整故事工作');
    if (this.controllers.has(projectId)) throw new Error('完整故事已在生成中');
    const db = getOpenProject(projectId)!;
    db.prepare("UPDATE full_story_jobs SET status=?, last_error=NULL, updated_at=datetime('now') WHERE id=?")
      .run(job.sections.length ? 'generating' : 'planning', job.id);
    const refreshed = this.getJobById(projectId, job.id)!;
    this.launch(refreshed, sender);
    return refreshed;
  }

  cancel(projectId: string): void {
    this.controllers.get(projectId)?.abort();
  }

  discard(projectId: string): void {
    this.controllers.get(projectId)?.abort();
    const db = getOpenProject(projectId);
    if (!db) throw new Error('專案未開啟');
    const job = this.getStatus(projectId);
    if (!job || job.status === 'completed') throw new Error('沒有可捨棄的未完成工作');
    db.beginTransaction();
    try {
      const firstParagraphId = job.sections.find(section => section.paragraphId)?.paragraphId;
      if (firstParagraphId) {
        getWorldMemoryService().rollbackWorldMemory(db, projectId, job.branchId, firstParagraphId, { inclusive: true });
      }
      for (const section of job.sections) {
        if (section.paragraphId) getParagraphService().deleteParagraph(db, section.paragraphId);
      }
      db.prepare('DELETE FROM full_story_sections WHERE job_id=?').run(job.id);
      db.prepare('DELETE FROM full_story_jobs WHERE id=?').run(job.id);
      db.commitTransaction();
    } catch (error) {
      db.rollbackTransaction();
      throw error;
    }
  }

  private launch(job: FullStoryJob, sender: WebContents): void {
    const controller = new AbortController();
    this.controllers.set(job.projectId, controller);
    void this.run(job.projectId, job.id, sender, controller).finally(() => {
      if (this.controllers.get(job.projectId) === controller) this.controllers.delete(job.projectId);
    });
  }

  private emit(sender: WebContents, payload: FullStoryProgressPayload): void {
    if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.FULL_STORY_PROGRESS, payload);
  }

  private async run(projectId: string, jobId: string, sender: WebContents, controller: AbortController): Promise<void> {
    const db = getOpenProject(projectId);
    const projectPath = getProjectStoragePath(projectId);
    if (!db || !projectPath) return;
    try {
      await ensureFreshOAuthToken();
      const provider = getActiveProvider();
      if (!provider) throw new Error('尚未設定 AI 供應商');
      getAIProviderService().configure(provider);

      let job = this.getJobById(projectId, jobId)!;
      if (job.sections.length === 0) {
        this.emit(sender, { job, phase: 'planning', message: '正在規劃完整故事結構' });
        const outline = await this.createOutline(job, provider, controller.signal);
        this.saveOutline(job, outline);
        job = this.getJobById(projectId, jobId)!;
      }

      db.prepare("UPDATE full_story_jobs SET status='generating', model_used=?, updated_at=datetime('now') WHERE id=?")
        .run(provider.defaultModel, job.id);

      const paragraphService = getParagraphService();
      let acceptedText = '';
      for (const section of job.sections) {
        if (section.status === 'completed' && section.paragraphId) {
          acceptedText += '\n\n' + paragraphService.getParagraphContent(db, projectPath, job.branchId, section.paragraphId);
        }
      }

      for (const section of job.sections) {
        if (section.status === 'completed') continue;
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        job = this.getJobById(projectId, jobId)!;
        this.emit(sender, { job, phase: 'generating', message: `正在生成第 ${section.index + 1} / ${job.sections.length} 節` });
        db.prepare("UPDATE full_story_sections SET status='generating' WHERE job_id=? AND section_index=?")
          .run(job.id, section.index);

        const completedCount = countWords(acceptedText);
        const isFinal = section.index === job.sections.length - 1;
        const target = isFinal ? Math.max(300, job.targetCharacterCount - completedCount) : section.targetCharacterCount;
        const content = await this.generateSizedSection(job, section, acceptedText, target, isFinal, provider, controller.signal, sender);
        const paragraph = paragraphService.createParagraph(db, {
          projectPath,
          projectId,
          branchId: job.branchId,
          type: 'ai',
          content,
          modelUsed: provider.defaultModel,
        });
        const actual = countWords(content);
        db.prepare(`UPDATE full_story_sections
          SET status='completed', paragraph_id=?, actual_character_count=? WHERE job_id=? AND section_index=?`)
          .run(paragraph.id, actual, job.id, section.index);
        db.prepare(`UPDATE full_story_jobs SET current_section=?, final_character_count=?, updated_at=datetime('now') WHERE id=?`)
          .run(section.index + 1, completedCount + actual, job.id);
        acceptedText += '\n\n' + content;
        // Keep the normal continuation pipeline useful after the batch finishes.
        // Extraction is best-effort: prose completion is never discarded because
        // a provider cannot produce the auxiliary JSON.
        try {
          const memory = getWorldMemoryService();
          const knownNames = memory.listCharacters(db, projectId).map(character => character.name);
          const changes = await extractWorldChanges(
            getAIProviderService(), provider, provider.defaultModel, content, knownNames,
          );
          for (const change of changes?.changes ?? []) {
            await applyWorldChange(memory, db, projectId, job.branchId, paragraph.id, {
              type: change.type,
              data: change.data as Record<string, unknown>,
            });
          }
        } catch { /* best effort */ }
        job = this.getJobById(projectId, jobId)!;
        this.emit(sender, {
          job,
          phase: 'generating',
          paragraph: { ...paragraph, type: 'ai', status: 'normal', detectionHistory: [], content },
        });
      }

      job = this.getJobById(projectId, jobId)!;
      this.emit(sender, { job, phase: 'validating', message: '正在驗證故事長度與結局' });
      await this.validateAndRepairFinale(job, provider, projectPath, controller.signal, sender);
      job = this.getJobById(projectId, jobId)!;
      db.prepare("UPDATE full_story_jobs SET status='completed', last_error=NULL, updated_at=datetime('now') WHERE id=?").run(job.id);
      job = this.getJobById(projectId, jobId)!;
      this.emit(sender, { job, phase: 'completed', message: '完整故事已完成' });
    } catch (error) {
      const aborted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
      const message = aborted ? null : (error instanceof Error ? error.message : String(error));
      const status = aborted ? 'paused' : 'failed';
      db.prepare('UPDATE full_story_jobs SET status=?, last_error=?, updated_at=datetime(\'now\') WHERE id=?')
        .run(status, message, jobId);
      db.prepare("UPDATE full_story_sections SET status='pending' WHERE job_id=? AND status='generating'").run(jobId);
      const job = this.getJobById(projectId, jobId);
      if (job) this.emit(sender, { job, phase: aborted ? 'paused' : 'failed', message: message ?? '生成已暫停' });
    }
  }

  private async createOutline(job: FullStoryJob, provider: Provider, signal: AbortSignal): Promise<OutlineItem[]> {
    const sectionCount = Math.max(1, Math.min(10, Math.round(job.targetCharacterCount / SECTION_TARGET)));
    const result = await complete(provider, [
      {
        role: 'system',
        content: `你是小說策劃編輯。規劃一篇有開端、發展、高潮與明確結局的完整繁體中文故事。必須輸出 JSON：{"sections":[{"title":"...","goal":"..."}]}。sections 必須恰好 ${sectionCount} 項；最後一項必須解決核心衝突與主要伏筆，不可用懸念中止。只輸出 JSON。`,
      },
      { role: 'user', content: `故事需求：${job.prompt}\n目標總字數：${job.targetCharacterCount}` },
    ], 1800, 0.4, signal);
    const parsed = parseJsonObject<{ sections?: OutlineItem[] }>(result.text);
    if (parsed?.sections?.length === sectionCount && parsed.sections.every(s => s.title && s.goal)) return parsed.sections;
    return Array.from({ length: sectionCount }, (_, i) => ({
      title: i === sectionCount - 1 ? '結局' : `第 ${i + 1} 節`,
      goal: i === sectionCount - 1
        ? '完成高潮，解決核心衝突與主要伏筆，給出明確而完整的結局。'
        : `推進故事第 ${i + 1} 階段，承接前文並為後續因果發展建立必要條件。`,
    }));
  }

  private saveOutline(job: FullStoryJob, outline: OutlineItem[]): void {
    const db = getOpenProject(job.projectId)!;
    const counts = allocateFullStoryCounts(job.targetCharacterCount, outline.length);
    db.beginTransaction();
    try {
      db.prepare("UPDATE full_story_jobs SET outline_json=?, status='generating', updated_at=datetime('now') WHERE id=?")
        .run(JSON.stringify(outline), job.id);
      outline.forEach((item, index) => {
        db.prepare(`INSERT INTO full_story_sections
          (job_id, section_index, title, goal, target_character_count, status)
          VALUES (?, ?, ?, ?, ?, 'pending')`)
          .run(job.id, index, item.title, item.goal, counts[index]);
      });
      db.commitTransaction();
    } catch (error) {
      db.rollbackTransaction();
      throw error;
    }
  }

  private async generateSizedSection(
    job: FullStoryJob,
    section: FullStorySection,
    acceptedText: string,
    target: number,
    isFinal: boolean,
    provider: Provider,
    signal: AbortSignal,
    sender: WebContents,
  ): Promise<string> {
    const outline = job.sections.map(s => `${s.index + 1}. ${s.title}：${s.goal}`).join('\n');
    const style = getWritingStyleHints(job.projectId);
    const rules = getWorldRules(job.projectId);
    const custom = getCustomInstructions(job.projectId);
    let text = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const correction = attempt > 0
        ? `\n上一次草稿共 ${countWords(text)} 字，不符合本節 ${target} 字（±5%）的要求。請完整重寫並精確調整長度。`
        : '';
      const result = await complete(provider, [
        {
          role: 'system',
          content: `你是繁體中文小說家。只輸出故事正文，不要標題、說明、字數統計或 JSON。這是完整故事的第 ${section.index + 1} 節。正文必須為 ${target} 字，允許誤差 ±5%。不可重述前文。${isFinal ? '這是最後一節：必須完成高潮、解決核心衝突與主要伏筆，寫出明確結局，絕不可停在懸念或預告續篇。' : '本節必須完成指定階段目標，並自然銜接下一節。'}\n${style}\n${custom}\n${rules}`,
        },
        {
          role: 'user',
          content: `故事需求：${job.prompt}\n完整大綱：\n${outline}\n本節目標：${section.goal}\n最近正文：\n${acceptedText.slice(-4_000) || '（尚未開始）'}${correction}`,
        },
      ], Math.min(8_000, Math.ceil(target * 1.8) + 500), 0.8, signal);
      text = result.text.trim();
      const aiService = getAIProviderService();
      const narration = getNarrationEditorSettings(job.projectId, getOpenProject);
      if (narration.enabled) {
        text = (await refineNarration({
          aiService,
          providerConfig: provider,
          model: provider.defaultModel,
          storyText: text,
          mode: narration.mode,
          signal,
        })) ?? text;
      }
      const dialogue = getDialogueEditorSettings(job.projectId, getOpenProject);
      if (dialogue.enabled) {
        const characters = getWorldMemoryService().listCharacters(getOpenProject(job.projectId)!, job.projectId)
          .map(character => ({
            id: character.id,
            name: character.name,
            aliases: character.aliases,
            voiceStyle: character.voiceStyle,
            updatedAt: character.updatedAt,
          }));
        text = (await refineDialogue({
          aiService,
          providerConfig: provider,
          model: provider.defaultModel,
          storyText: text,
          characters,
          mode: dialogue.mode,
          signal,
        })) ?? text;
      }
      text = text.trim();
      if (text && isWithinFullStoryTolerance(countWords(text), target)) return text;
      const refreshed = this.getJobById(job.projectId, job.id)!;
      this.emit(sender, { job: refreshed, phase: 'correcting', message: `正在校正第 ${section.index + 1} 節字數` });
    }
    throw new Error(`第 ${section.index + 1} 節無法在三次嘗試內符合字數要求`);
  }

  private async validateAndRepairFinale(
    job: FullStoryJob,
    provider: Provider,
    projectPath: string,
    signal: AbortSignal,
    sender: WebContents,
  ): Promise<void> {
    const db = getOpenProject(job.projectId)!;
    const paragraphService = getParagraphService();
    const finalSection = job.sections[job.sections.length - 1];
    if (!finalSection?.paragraphId) throw new Error('找不到故事結局段落');

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const refreshed = this.getJobById(job.projectId, job.id)!;
      const contents = refreshed.sections.map(s => s.paragraphId
        ? paragraphService.getParagraphContent(db, projectPath, job.branchId, s.paragraphId)
        : '');
      const total = contents.reduce((sum, value) => sum + countWords(value), 0);
      const validation = await complete(provider, [
        { role: 'system', content: '判斷故事是否真正完結。核心衝突、主要人物弧線與大綱主要伏筆都必須得到解決，且不能停在懸念。只輸出 JSON：{"complete":true,"issues":[]}。' },
        { role: 'user', content: `故事需求：${job.prompt}\n大綱：${JSON.stringify(refreshed.sections.map(s => ({ title: s.title, goal: s.goal })))}\n故事結尾與最近發展：\n${contents.join('\n\n').slice(-6_000)}` },
      ], 500, 0.1, signal);
      const verdict = parseJsonObject<{ complete?: boolean; issues?: string[] }>(validation.text);
      if (isWithinFullStoryTolerance(total, job.targetCharacterCount) && verdict?.complete === true) {
        db.prepare('UPDATE full_story_jobs SET final_character_count=?, updated_at=datetime(\'now\') WHERE id=?').run(total, job.id);
        return;
      }

      if (attempt === MAX_ATTEMPTS - 1) break;
      const prior = contents.slice(0, -1).join('\n\n');
      const finaleTarget = Math.max(300, job.targetCharacterCount - countWords(prior));
      this.emit(sender, { job: refreshed, phase: 'correcting', message: '正在修正結局與總字數' });
      const rewrite = await complete(provider, [
        {
          role: 'system',
          content: `重寫故事最後一節。只輸出正文，長度必須為 ${finaleTarget} 字（±5%）。必須解決核心衝突、人物弧線與主要伏筆，給出明確結局，不可加入續篇懸念。\n${getWritingStyleHints(job.projectId)}\n${getCustomInstructions(job.projectId)}\n${getWorldRules(job.projectId)}`,
        },
        {
          role: 'user',
          content: `故事需求：${job.prompt}\n尚未解決的問題：${(verdict?.issues ?? ['結局不完整或總字數不符']).join('；')}\n前文：\n${prior.slice(-5_000)}\n舊結局：\n${contents.at(-1)}`,
        },
      ], Math.min(8_000, Math.ceil(finaleTarget * 1.8) + 500), 0.6, signal);
      const finalText = rewrite.text.trim();
      if (!isWithinFullStoryTolerance(countWords(finalText), finaleTarget)) continue;
      getWorldMemoryService().rollbackWorldMemory(db, job.projectId, job.branchId, finalSection.paragraphId, { inclusive: true });
      paragraphService.updateParagraphContent(db, projectPath, job.branchId, finalSection.paragraphId, finalText, provider.defaultModel);
      db.prepare('UPDATE full_story_sections SET actual_character_count=? WHERE job_id=? AND section_index=?')
        .run(countWords(finalText), job.id, finalSection.index);
      const paragraph = paragraphService.getParagraph(db, finalSection.paragraphId);
      try {
        const memory = getWorldMemoryService();
        const knownNames = memory.listCharacters(db, job.projectId).map(character => character.name);
        const changes = await extractWorldChanges(getAIProviderService(), provider, provider.defaultModel, finalText, knownNames);
        for (const change of changes?.changes ?? []) {
          await applyWorldChange(memory, db, job.projectId, job.branchId, finalSection.paragraphId, {
            type: change.type,
            data: change.data as Record<string, unknown>,
          });
        }
      } catch { /* best effort */ }
      if (paragraph) this.emit(sender, {
        job: this.getJobById(job.projectId, job.id)!,
        phase: 'correcting',
        paragraph: { ...paragraph, type: 'ai', status: 'normal', detectionHistory: [], content: finalText },
      });
    }
    throw new Error('故事未能同時通過完整結局與總字數驗證');
  }

  private getJobById(projectId: string, jobId: string): FullStoryJob | null {
    const db = getOpenProject(projectId);
    if (!db) return null;
    const row = db.prepare('SELECT * FROM full_story_jobs WHERE id=?').get(jobId) as Record<string, unknown> | undefined;
    return row ? this.rowToJob(row) : null;
  }

  private rowToJob(row: Record<string, unknown>): FullStoryJob {
    const projectId = String(row.project_id);
    const db = getOpenProject(projectId)!;
    const sectionRows = db.prepare('SELECT * FROM full_story_sections WHERE job_id=? ORDER BY section_index')
      .all(String(row.id)) as Record<string, unknown>[];
    return {
      id: String(row.id),
      projectId,
      branchId: String(row.branch_id),
      prompt: String(row.prompt),
      targetCharacterCount: Number(row.target_character_count),
      status: String(row.status) as FullStoryJob['status'],
      currentSection: Number(row.current_section),
      finalCharacterCount: Number(row.final_character_count),
      modelUsed: row.model_used ? String(row.model_used) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      sections: sectionRows.map(section => ({
        index: Number(section.section_index),
        title: String(section.title),
        goal: String(section.goal),
        targetCharacterCount: Number(section.target_character_count),
        actualCharacterCount: Number(section.actual_character_count),
        paragraphId: section.paragraph_id ? String(section.paragraph_id) : null,
        status: String(section.status) as FullStorySection['status'],
      })),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

let instance: FullStoryService | null = null;
export function getFullStoryService(): FullStoryService {
  instance ??= new FullStoryService();
  return instance;
}
