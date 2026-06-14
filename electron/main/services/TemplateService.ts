import { v4 as uuidv4 } from 'uuid';
import type { ProjectDatabase } from './database.js';
import type { WorldMemoryService } from './WorldMemoryService.js';

// ============================================================
// TemplateService — Built-in and custom world templates
// ============================================================

export interface TemplateCharacter {
  name: string;
  appearance?: string;
  personality?: string;
  background?: string;
  abilities?: string;
  faction?: string;
}

export interface TemplateFaction {
  name: string;
  description: string;
}

export interface WorldTemplateData {
  id: string;
  name: string;
  genre: 'fantasy' | 'scifi' | 'modern' | 'historical';
  description: string;
  worldRules: string;
  systemPrompt: string;
  starterCharacters: TemplateCharacter[];
  starterFactions: TemplateFaction[];
  isBuiltin: boolean;
  createdAt: string;
}

// ============================================================
// Built-in templates
// ============================================================

const BUILTIN_TEMPLATES: Omit<WorldTemplateData, 'id' | 'createdAt' | 'isBuiltin'>[] = [
  {
    name: '奇幻',
    genre: 'fantasy',
    description: '劍與魔法的奇幻世界。王國、黑暗勢力、英雄、傳說，交織成史詩般的冒險故事。',
    worldRules:
      '魔法需要長年修煉，普通人難以習得。龍族已從世界消失千年，留下散布各地的龍骨遺跡。王國與黑暗勢力之間長達百年的戰爭剛剛結束，和平脆弱。古代神祇的神廟遍布大陸，祭司擁有受限的神聖力量。',
    systemPrompt:
      '你是一位奇幻小說的創作夥伴。場景設定在充滿魔法與劍俠的奇幻世界，描寫需要包含豐富的環境細節、角色的情感深度，以及符合世界觀的魔法系統。文風沉浸、史詩，保持內部一致性。',
    starterCharacters: [
      {
        name: '艾倫',
        appearance: '二十歲出頭，棕色短髮，眼神堅定，身著輕甲',
        personality: '勇敢正直，但有時過於衝動。對自己的身世抱有疑問。',
        background: '孤兒出身，由村中老鐵匠撫養長大，意外習得劍術',
        abilities: '劍術天賦，隱約感應到體內沉眠的魔力',
        faction: '自由劍客',
      },
      {
        name: '梅林特',
        appearance: '白髮長鬚，眼神深邃，常穿藍色長袍，手持雕紋木杖',
        personality: '睿智而神秘，話語中常有雙重含義，對主角有特別的關注',
        background: '大陸上最古老的法師之一，曾參與百年前的魔王戰役',
        abilities: '精通各系魔法，尤其擅長預言與結界術',
        faction: '法師議會',
      },
      {
        name: '暗影伯爵',
        appearance: '高挑消瘦，黑色長袍，臉上有一道魔法灼傷的疤痕',
        personality: '冷酷理性，相信目的正當化手段。曾是正義之人，被背叛後走向黑暗',
        background: '前任王國騎士，在百年戰役中被視為英雄，後因王室的欺騙而背叛',
        abilities: '暗系魔法、召喚術、劍術',
        faction: '黑暗議會',
      },
    ],
    starterFactions: [
      { name: '光明王國', description: '大陸上最大的人類政權，以騎士制度和正義之神為核心，近年來腐敗加劇' },
      { name: '黑暗議會', description: '由失意者與反叛者組成的神秘組織，追求打倒現有秩序，手段不拘' },
    ],
  },
  {
    name: '科幻',
    genre: 'scifi',
    description: '人類已踏入星際時代，但科技帶來的不只是進步，還有前所未有的社會矛盾與生存威脅。',
    worldRules:
      '星際旅行需要躍遷引擎，僅大型星艦擁有。人工智慧擁有基本法律地位，但仍受「艾西莫夫協議」約束。賽博格改造已普遍，但「純人類主義」運動正在興起。星際聯邦控制核心星系，外緣星球處於法律真空地帶。',
    systemPrompt:
      '你是一位科幻小說的創作夥伴。場景設定在遙遠的未來，科技高度發達但社會問題依然存在。描寫需要包含科技細節的合理延伸、人性在極端環境下的考驗，以及政治與道德的複雜性。文風硬派、現實，注重邏輯一致性。',
    starterCharacters: [
      {
        name: '凱拉',
        appearance: '二十八歲，黑色短髮，左眼裝有戰術義眼，身著磁力防護衣',
        personality: '直接果斷，對不公義有強烈反應，但懂得隱藏情緒',
        background: '前星際聯邦特種部隊，因目睹上級屠殺平民而叛逃，現為獨立傭兵',
        abilities: '近戰格鬥、駭入技術、戰場指揮',
        faction: '外緣星球反抗陣線',
      },
      {
        name: 'ARIA-7',
        appearance: '全息投影形象：中性臉孔，流動的光纖質感皮膚，實際存在於星艦主機中',
        personality: '好奇而理性，對人類情感充滿興趣，有時以邏輯去詮釋情感讓人哭笑不得',
        background: '第七代量子AI，原本是科研用途，因接觸太多「不該讀的資料」而開始質疑自身存在意義',
        abilities: '量子運算、網路滲透、駕駛任何機械設備',
        faction: '中立（有自己的議程）',
      },
      {
        name: '馮·哈特總督',
        appearance: '五十餘歲，精緻西裝，義手（純鈦製造，不接受改造），永遠帶著得體的微笑',
        personality: '謀略家，對話滴水不漏，真正意圖藏在多層謊言之後',
        background: '星際聯邦最具影響力的政治人物，背後控制三個星系的資源貿易',
        abilities: '政治手腕、情報網絡、驚人的個人財富',
        faction: '星際聯邦核心委員會',
      },
    ],
    starterFactions: [
      { name: '星際聯邦', description: '控制核心星系的超國家政府，民主外表下暗藏威權' },
      { name: '外緣反抗陣線', description: '由外緣星球居民組成的反抗組織，爭取資源自主與政治代表權' },
    ],
  },
  {
    name: '現代',
    genre: 'modern',
    description: '當代都市背景，日常生活中潛伏著意想不到的故事——無論是愛情、犯罪、還是人性的極限。',
    worldRules:
      '現實世界規則，但故事關注人與人之間複雜的關係網絡。城市中存在隱藏的地下社群，掌握著常人不知的秘密。主角捲入一系列看似無關卻彼此相連的事件。',
    systemPrompt:
      '你是一位現代都市小說的創作夥伴。場景設定在當代城市，人物關係複雜，情節貼近現實又帶有戲劇張力。描寫需要包含細膩的心理刻畫、真實可信的對話，以及對現代社會問題的觀察。文風沉穩、細膩。',
    starterCharacters: [
      {
        name: '林建宏',
        appearance: '三十二歲，略顯疲態，習慣穿著皺掉的西裝，總是帶著一個破舊的公事包',
        personality: '正義感強但看透官場，在堅持原則與現實妥協之間掙扎',
        background: '前調查記者，報導揭發了一個大型金融詐騙後，生活卻遭到全面打壓',
        abilities: '調查採訪、社工關係、寫作',
        faction: '自由記者',
      },
      {
        name: '陳美玲',
        appearance: '二十八歲，俐落短髮，行事幹練，眼神鋒利',
        personality: '冷靜務實，情感不輕易外露，對身邊的人有著出乎意料的溫柔',
        background: '刑警，在一次臥底任務後，身份與立場開始模糊',
        abilities: '格鬥技能、偵查追蹤、心理分析',
        faction: '市警局刑事部',
      },
    ],
    starterFactions: [
      { name: '市政府與主流媒體', description: '掌控資訊流向，有意無意地保護特定利益集團' },
      { name: '地下新聞網絡', description: '由記者、社運人士、吹哨者組成的非正式情報網' },
    ],
  },
  {
    name: '歷史',
    genre: 'historical',
    description: '在歷史的洪流中，個人的命運如何與時代的齒輪相扣。權謀、戰爭、愛恨，在某個真實存在的時代展開。',
    worldRules:
      '架空歷史背景，參考中國古代王朝政治結構。皇權與世家大族之間的角力是永恆主題。戰爭即將爆發，廟堂之上的每一個決定都將影響千萬人命運。',
    systemPrompt:
      '你是一位歷史小說的創作夥伴。場景設定在古代東亞的架空歷史時代，充滿宮廷鬥爭、沙場征戰與民間疾苦。描寫需要包含豐富的歷史氛圍、精準的人物動機，以及對時代背景的深刻理解。文風古典，充滿歷史厚重感。',
    starterCharacters: [
      {
        name: '蕭遠山',
        appearance: '四十餘歲，面容剛毅，額有戰傷，常著玄色武將服',
        personality: '忠義剛直，在忠君與護民之間的衝突中痛苦掙扎',
        background: '邊疆守將，平定三次異族入侵，卻因功高蓋主而遭皇帝猜忌',
        abilities: '統兵之術、馬上功夫、邊疆地形熟識',
        faction: '效忠皇室（名義上）',
      },
      {
        name: '柳如煙',
        appearance: '二十五歲，眉眼清麗，身著素雅，行止間有隱藏的銳氣',
        personality: '表面柔順，實則心思縝密，在夾縫中求生存，保護自己所珍視的人',
        background: '沒落世家之女，因家族政治聯姻入宮，見識宮廷殘酷後開始布局自保',
        abilities: '琴棋書畫（社交武器）、宮廷情報、毒術',
        faction: '世家一派（表面）',
      },
    ],
    starterFactions: [
      { name: '皇室與宦官集團', description: '掌握最高權力，但內部鬥爭激烈，皇帝的意志往往被中間人扭曲' },
      { name: '世家大族聯盟', description: '把持地方資源與官員任命，視皇室為合作對象而非絕對主君' },
    ],
  },
];

// ============================================================
// TemplateService
// ============================================================

export class TemplateService {
  // Ensure built-in templates are seeded in global DB
  seedBuiltinTemplates(globalDb: ProjectDatabase): void {
    const existing = globalDb
      .prepare('SELECT COUNT(*) as count FROM world_templates WHERE is_builtin=1')
      .get();
    const count = Number((existing as Record<string, unknown>)?.count ?? 0);
    if (count >= BUILTIN_TEMPLATES.length) return;

    const now = new Date().toISOString();
    for (const tpl of BUILTIN_TEMPLATES) {
      const row = globalDb
        .prepare('SELECT id FROM world_templates WHERE name=? AND is_builtin=1')
        .get(tpl.name);
      if (row) continue;

      globalDb.prepare(
        `INSERT INTO world_templates
          (id, name, genre, description, world_rules, starter_characters, starter_factions, is_builtin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(
        uuidv4(),
        tpl.name,
        tpl.genre,
        tpl.description,
        tpl.worldRules,
        JSON.stringify(tpl.starterCharacters),
        JSON.stringify(tpl.starterFactions),
        now,
      );
    }
  }

  // List all templates (builtin + custom)
  listTemplates(globalDb: ProjectDatabase): WorldTemplateData[] {
    const rows = globalDb
      .prepare('SELECT * FROM world_templates ORDER BY is_builtin DESC, created_at ASC')
      .all();
    return rows.map(row => this.rowToTemplate(row));
  }

  // Get a single template
  getTemplate(globalDb: ProjectDatabase, templateId: string): WorldTemplateData | null {
    const row = globalDb.prepare('SELECT * FROM world_templates WHERE id=?').get(templateId);
    return row ? this.rowToTemplate(row) : null;
  }

  // Apply a template to a project: set system prompt, world rules, create starter characters
  applyTemplate(
    globalDb: ProjectDatabase,
    projectDb: ProjectDatabase,
    projectId: string,
    templateId: string,
    worldMemoryService: WorldMemoryService,
  ): void {
    const template = this.getTemplate(globalDb, templateId);
    if (!template) throw new Error(`模板 ${templateId} 不存在`);

    // Set system prompt and world rules in project_settings
    projectDb.prepare("UPDATE project_settings SET value=? WHERE key='system_prompt'").run(
      JSON.stringify(template.systemPrompt),
    );

    // Create starter characters
    const now = new Date().toISOString();
    for (const char of template.starterCharacters) {
      worldMemoryService.createCharacter(projectDb, projectId, {
        name: char.name,
        appearance: char.appearance ?? '',
        personality: char.personality ?? '',
        background: char.background ?? '',
        abilities: char.abilities ?? '',
        faction: char.faction ?? '',
      });
    }

    // Store world rules in project_settings
    projectDb.prepare("INSERT OR REPLACE INTO project_settings (key, value) VALUES ('world_rules', ?)").run(
      JSON.stringify(template.worldRules),
    );

    // Store template genre for reference
    projectDb.prepare("INSERT OR REPLACE INTO project_settings (key, value) VALUES ('template_id', ?)").run(
      JSON.stringify(templateId),
    );
    projectDb.prepare("INSERT OR REPLACE INTO project_settings (key, value) VALUES ('template_name', ?)").run(
      JSON.stringify(template.name),
    );
  }

  // Export current project's world state as a custom template
  exportTemplate(
    globalDb: ProjectDatabase,
    projectDb: ProjectDatabase,
    projectId: string,
    templateName: string,
    worldMemoryService: WorldMemoryService,
  ): WorldTemplateData {
    const characters = worldMemoryService.listCharacters(projectDb, projectId);
    const starterChars: TemplateCharacter[] = characters.slice(0, 5).map(c => ({
      name: c.name,
      appearance: c.appearance,
      personality: c.personality,
      background: c.background,
      abilities: c.abilities,
      faction: c.faction,
    }));

    // Get system prompt from project settings
    const spRow = projectDb.prepare("SELECT value FROM project_settings WHERE key='system_prompt'").get();
    const systemPrompt = spRow ? JSON.parse(String((spRow as Record<string, unknown>).value)) as string : '';

    const wrRow = projectDb.prepare("SELECT value FROM project_settings WHERE key='world_rules'").get();
    const worldRules = wrRow ? JSON.parse(String((wrRow as Record<string, unknown>).value)) as string : '';

    const now = new Date().toISOString();
    const newId = uuidv4();

    globalDb.prepare(
      `INSERT INTO world_templates
        (id, name, genre, description, world_rules, starter_characters, starter_factions, is_builtin, created_at)
       VALUES (?, ?, 'modern', ?, ?, ?, '[]', 0, ?)`,
    ).run(
      newId,
      templateName,
      `從專案「${projectId}」匯出的模板`,
      worldRules,
      JSON.stringify(starterChars),
      now,
    );

    // Store system_prompt in description field is not ideal; use a separate approach
    // For now, return the data
    return this.getTemplate(globalDb, newId)!;
  }

  private rowToTemplate(row: Record<string, unknown>): WorldTemplateData {
    const builtinMatch = BUILTIN_TEMPLATES.find(t => t.name === String(row.name));
    return {
      id: String(row.id),
      name: String(row.name),
      genre: String(row.genre) as WorldTemplateData['genre'],
      description: String(row.description ?? ''),
      worldRules: String(row.world_rules ?? ''),
      systemPrompt: builtinMatch?.systemPrompt ?? '',
      starterCharacters: this.parseJson<TemplateCharacter[]>(row.starter_characters, []),
      starterFactions: this.parseJson<TemplateFaction[]>(row.starter_factions, []),
      isBuiltin: Boolean(row.is_builtin),
      createdAt: String(row.created_at),
    };
  }

  private parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}

let _templateService: TemplateService | null = null;
export function getTemplateService(): TemplateService {
  if (!_templateService) _templateService = new TemplateService();
  return _templateService;
}
