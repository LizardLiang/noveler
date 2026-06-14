import type { ChatCompletionTool } from 'openai/resources/chat/completions.js';
import type { ProjectDatabase } from './database.js';
import type { WorldMemoryService } from './WorldMemoryService.js';

// ============================================================
// WorldMemoryTools — Tool definitions + execution for AI
// to selectively query world memory during story generation.
// ============================================================

export const WORLD_MEMORY_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_world_memory',
      description:
        '查詢世界記憶資料庫，獲取角色詳細資訊、角色關係、或近期事件。在生成故事前，請先查詢與當前劇情相關的角色與事件，以確保故事的一致性。',
      parameters: {
        type: 'object',
        properties: {
          character_names: {
            type: 'array',
            items: { type: 'string' },
            description: '要查詢詳細資料的角色名稱列表',
          },
          include_relationships: {
            type: 'boolean',
            description: '是否包含所查詢角色的關係資料',
          },
          event_count: {
            type: 'number',
            description: '要載入的近期事件數量（0 表示不載入，預設 5）',
          },
        },
        required: ['character_names'],
      },
    },
  },
];

export interface QueryWorldMemoryArgs {
  character_names: string[];
  include_relationships?: boolean;
  event_count?: number;
}

export function executeWorldMemoryQuery(
  worldMemoryService: WorldMemoryService,
  db: ProjectDatabase,
  projectId: string,
  branchId: string,
  args: QueryWorldMemoryArgs,
): string {
  const parts: string[] = [];

  const requestedNames = args.character_names ?? [];
  if (requestedNames.length > 0) {
    parts.push('【角色詳細資料】');
    for (const name of requestedNames) {
      const char = worldMemoryService.findCharacterByName(db, projectId, name);
      if (!char) {
        parts.push(`- ${name}：（未找到此角色）`);
        continue;
      }
      const lines = [`■ ${char.name}（${char.faction || '未知陣營'}，${char.status}）`];
      if (char.aliases.length > 0) lines.push(`  別名：${char.aliases.join('、')}`);
      if (char.appearance) lines.push(`  外觀：${char.appearance}`);
      if (char.personality) lines.push(`  性格：${char.personality}`);
      if (char.background) lines.push(`  背景：${char.background}`);
      if (char.abilities) lines.push(`  能力：${char.abilities}`);
      if (char.voiceStyle) lines.push(`  說話方式：${char.voiceStyle}`);
      const customEntries = Object.entries(char.customFields ?? {});
      for (const [key, val] of customEntries) {
        if (val) lines.push(`  ${key}：${val}`);
      }
      parts.push(lines.join('\n'));
    }
  }

  const includeRels = args.include_relationships !== false;
  if (includeRels && requestedNames.length > 0) {
    const relationships = worldMemoryService.listRelationships(db, projectId, branchId);
    const relevantRels = relationships.filter(r => {
      const nameA = r.characterAName ?? '';
      const nameB = r.characterBName ?? '';
      return requestedNames.some(
        n => n === nameA || n === nameB,
      );
    });
    if (relevantRels.length > 0) {
      parts.push('【角色關係】');
      for (const r of relevantRels) {
        const nameA = r.characterAName ?? r.characterAId;
        const nameB = r.characterBName ?? r.characterBId;
        const affinity = r.affinityScore >= 0 ? `+${r.affinityScore}` : String(r.affinityScore);
        const desc = r.description ? `：${r.description}` : '';
        parts.push(`${nameA} —[${r.relationshipType}]— ${nameB}（好感${affinity}）${desc}`);
      }
    }
  }

  const eventCount = args.event_count ?? 5;
  if (eventCount > 0) {
    const allEvents = worldMemoryService.listEvents(db, projectId, branchId);
    const occurred = allEvents.filter(e => e.status !== 'planned').slice(0, eventCount);
    const planned = allEvents.filter(e => e.status === 'planned');
    if (occurred.length > 0) {
      parts.push('【近期事件（已發生）】');
      for (const e of occurred) {
        const chars = e.participatingCharacters.join('、') || '無';
        parts.push(`- ${e.name}：${e.description}（參與：${chars}）`);
        if (e.impact) parts.push(`  影響：${e.impact}`);
      }
    }
    if (planned.length > 0) {
      parts.push('【劇情規劃（尚未發生，禁止當成已發生）】');
      for (const e of [...planned].reverse()) {
        const chars = e.participatingCharacters.join('、') || '無';
        const when = e.storyTimestamp ? `[${e.storyTimestamp}] ` : '';
        parts.push(`- ${when}${e.name}：${e.description}（涉及：${chars}）`);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : '（世界記憶中無符合條件的資料）';
}

/**
 * Build a directory-only view of world memory for the system prompt.
 * Lists character names/factions/status and event names — just enough
 * for the AI to decide what to query via tools.
 */
export function buildWorldDirectory(
  worldMemoryService: WorldMemoryService,
  db: ProjectDatabase,
  projectId: string,
  branchId: string,
): string {
  const characters = worldMemoryService.listCharacters(db, projectId);
  const events = worldMemoryService.listEvents(db, projectId, branchId);

  if (characters.length === 0 && events.length === 0) return '';

  const parts: string[] = [];

  if (characters.length > 0) {
    parts.push('可查詢角色：');
    for (const c of characters) {
      parts.push(`- ${c.name}（${c.faction || '未知'}，${c.status}）`);
    }
  }

  if (events.length > 0) {
    parts.push('可查詢事件：');
    for (const e of events.slice(0, 15)) {
      const tag = e.status === 'planned' ? '，規劃中／尚未發生' : '';
      parts.push(`- ${e.name}（${e.storyTimestamp || '時間不明'}${tag}）`);
    }
  }

  return parts.join('\n');
}
