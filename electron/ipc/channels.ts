export const IPC_CHANNELS = {
  // 視窗控制
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',

  // 專案管理
  PROJECT_CREATE: 'project:create',
  PROJECT_OPEN: 'project:open',
  PROJECT_DELETE: 'project:delete',
  PROJECT_LIST: 'project:list',
  PROJECT_GET_RECENT: 'project:getRecent',
  PROJECT_SELECT_PATH: 'project:selectPath',
  PROJECT_SELECT_NOVEL_FILE: 'project:selectNovelFile',
  PROJECT_IMPORT_NOVEL: 'project:importNovel',

  // AI 生成
  AI_GENERATE: 'ai:generate',
  AI_CANCEL: 'ai:cancel',
  AI_TEST_CONNECTION: 'ai:testConnection',
  AI_GET_MODELS: 'ai:getModels',

  // AI 串流推送（主程序 → 渲染程序）
  STREAM_CHUNK: 'stream:chunk',
  STREAM_COMPLETE: 'stream:complete',
  STREAM_ERROR: 'stream:error',

  // 段落管理
  PARAGRAPH_LIST: 'paragraph:list',
  PARAGRAPH_GET_CONTENT: 'paragraph:getContent',
  PARAGRAPH_DELETE: 'paragraph:delete',
  PARAGRAPH_REGENERATE: 'paragraph:regenerate',
  PARAGRAPH_SWITCH_VERSION: 'paragraph:switchVersion',
  PARAGRAPH_ROLLBACK: 'paragraph:rollback',
  PARAGRAPH_GET_LINKED_WORLD_MEMORY: 'paragraph:getLinkedWorldMemory',

  // 世界記憶
  WORLD_MEMORY_GET_CHARACTERS: 'worldMemory:getCharacters',
  WORLD_MEMORY_CREATE_CHARACTER: 'worldMemory:createCharacter',
  WORLD_MEMORY_UPDATE_CHARACTER: 'worldMemory:updateCharacter',
  WORLD_MEMORY_DELETE_CHARACTER: 'worldMemory:deleteCharacter',
  WORLD_MEMORY_DELETE_ALL_CHARACTERS: 'worldMemory:deleteAllCharacters',

  WORLD_MEMORY_GET_RELATIONSHIPS: 'worldMemory:getRelationships',
  WORLD_MEMORY_CREATE_RELATIONSHIP: 'worldMemory:createRelationship',
  WORLD_MEMORY_UPDATE_RELATIONSHIP: 'worldMemory:updateRelationship',
  WORLD_MEMORY_DELETE_RELATIONSHIP: 'worldMemory:deleteRelationship',
  WORLD_MEMORY_DELETE_ALL_RELATIONSHIPS: 'worldMemory:deleteAllRelationships',

  WORLD_MEMORY_GET_EVENTS: 'worldMemory:getEvents',
  WORLD_MEMORY_CREATE_EVENT: 'worldMemory:createEvent',
  WORLD_MEMORY_UPDATE_EVENT: 'worldMemory:updateEvent',
  WORLD_MEMORY_DELETE_EVENT: 'worldMemory:deleteEvent',
  WORLD_MEMORY_DELETE_ALL_EVENTS: 'worldMemory:deleteAllEvents',

  WORLD_MEMORY_IMPORT_CHARACTERS: 'worldMemory:importCharacters',
  WORLD_MEMORY_IMPORT_CHARACTERS_TEXT: 'worldMemory:importCharactersText',

  WORLD_MEMORY_IMPORT_RELATIONSHIPS: 'worldMemory:importRelationships',
  WORLD_MEMORY_IMPORT_RELATIONSHIPS_TEXT: 'worldMemory:importRelationshipsText',

  WORLD_MEMORY_IMPORT_EVENTS: 'worldMemory:importEvents',
  WORLD_MEMORY_IMPORT_EVENTS_TEXT: 'worldMemory:importEventsText',

  // 世界記憶變更通知（主程序 → 渲染程序）— 例如劇情自動推進後刷新事件清單
  WORLD_MEMORY_EVENTS_CHANGED: 'worldMemory:eventsChanged',

  // 分支管理
  BRANCH_CREATE: 'branch:create',
  BRANCH_SWITCH: 'branch:switch',
  BRANCH_DELETE: 'branch:delete',
  BRANCH_RENAME: 'branch:rename',
  BRANCH_SET_MAIN: 'branch:setMain',
  BRANCH_GET_TREE: 'branch:getTree',

  // 設定
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_PROVIDERS: 'settings:getProviders',
  SETTINGS_SAVE_PROVIDER: 'settings:saveProvider',
  SETTINGS_DELETE_PROVIDER: 'settings:deleteProvider',
  SETTINGS_SET_ACTIVE_PROVIDER: 'settings:setActiveProvider',

  // 自動儲存
  AUTOSAVE_TRIGGER: 'autosave:trigger',
  AUTOSAVE_RECOVERY_CHECK: 'autosave:recoveryCheck',
  AUTOSAVE_RECOVERY_RESTORE: 'autosave:recoveryRestore',
  AUTOSAVE_RECOVERY_DISCARD: 'autosave:recoveryDiscard',

  // 搜尋
  SEARCH_CHARACTERS: 'search:characters',
  SEARCH_EVENTS: 'search:events',
  SEARCH_FULLTEXT: 'search:fulltext',

  // 模板
  TEMPLATE_LIST: 'template:list',
  TEMPLATE_APPLY: 'template:apply',
  TEMPLATE_EXPORT: 'template:export',

  // 專案設定
  PROJECT_GET_SETTING: 'project:getSetting',
  PROJECT_SET_SETTING: 'project:setSetting',

  // 統計
  STATS_GET: 'stats:get',

  // 故事建議
  AI_SUGGESTIONS: 'ai:suggestions',

  // 上下文預算
  CONTEXT_BUDGET_GET: 'contextBudget:get',

  // OAuth
  OAUTH_REQUEST_CODE: 'oauth:requestCode',
  OAUTH_POLL: 'oauth:poll',
  OAUTH_CANCEL: 'oauth:cancel',
  OAUTH_STATUS: 'oauth:status',
  OAUTH_REVOKE: 'oauth:revoke',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
