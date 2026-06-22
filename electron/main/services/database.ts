import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

// sql.js — pure WASM SQLite (no native compilation required)
// Used as fallback when better-sqlite3 cannot be compiled for the target Electron version
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js') as (config?: { locateFile?: (file: string) => string }) => Promise<SqlJsStatic>;

// ---- Type stubs for sql.js ----
interface SqlJsStatic {
  Database: new (data?: ArrayLike<number> | null) => SqlDatabase;
}

interface SqlStatement {
  step(): boolean;
  getAsObject(params?: Record<string, unknown>): Record<string, unknown>;
  bind(params?: unknown[]): void;
  free(): void;
  reset(): void;
}

interface SqlDatabase {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlStatement;
  run(sql: string, params?: unknown[]): void;
  export(): Uint8Array;
  close(): void;
}

// ---- Database wrapper that matches the better-sqlite3 API used by handlers ----
// This provides a synchronous-style API by loading/saving the entire db file on each operation
export class ProjectDatabase {
  private db: SqlDatabase;
  private dbPath: string;
  private dirty = false;
  private inTransaction = false;

  constructor(db: SqlDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.dirty = true;
    if (!this.inTransaction) {
      this.persist();
    }
  }

  prepare(sql: string): ProjectStatement {
    return new ProjectStatement(this.db.prepare(sql), this);
  }

  // Called by statements that mutate data
  markDirty(): void {
    this.dirty = true;
    if (!this.inTransaction) {
      this.persist();
    }
  }

  persist(): void {
    if (!this.dirty) return;
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
    this.dirty = false;
  }

  beginTransaction(): void {
    this.db.run('BEGIN TRANSACTION');
    this.inTransaction = true;
  }

  commitTransaction(): void {
    this.db.run('COMMIT');
    this.inTransaction = false;
    this.persist();
  }

  rollbackTransaction(): void {
    this.db.run('ROLLBACK');
    this.inTransaction = false;
    // The ROLLBACK command restores the in-memory DB to the state before BEGIN TRANSACTION.
    // Mark clean so no partial data is persisted to disk.
    this.dirty = false;
  }

  close(): void {
    this.persist();
    this.db.close();
  }
}

export class ProjectStatement {
  private stmt: SqlStatement;
  private owner: ProjectDatabase;

  constructor(stmt: SqlStatement, owner: ProjectDatabase) {
    this.stmt = stmt;
    this.owner = owner;
  }

  run(...params: unknown[]): void {
    this.stmt.bind(params);
    while (this.stmt.step()) { /* run through */ }
    this.stmt.reset();
    this.owner.markDirty();
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    this.stmt.bind(params);
    if (this.stmt.step()) {
      const row = this.stmt.getAsObject();
      this.stmt.reset();
      return row;
    }
    this.stmt.reset();
    return undefined;
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    this.stmt.bind(params);
    const rows: Record<string, unknown>[] = [];
    while (this.stmt.step()) {
      rows.push(this.stmt.getAsObject());
    }
    this.stmt.reset();
    return rows;
  }

  free(): void {
    this.stmt.free();
  }
}

// ============================================================
// 專案資料庫 Schema DDL
// ============================================================
const PROJECT_DB_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS branches (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    parent_branch_id TEXT,
    fork_paragraph_id TEXT,
    name            TEXT NOT NULL DEFAULT '主線',
    is_main         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_branches_project ON branches(project_id);

CREATE TABLE IF NOT EXISTS characters (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    aliases         TEXT DEFAULT '[]',
    appearance      TEXT DEFAULT '',
    personality     TEXT DEFAULT '',
    background      TEXT DEFAULT '',
    abilities       TEXT DEFAULT '',
    faction         TEXT DEFAULT '',
    voice_style     TEXT DEFAULT '',
    custom_fields   TEXT DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'active',
    source_paragraph_id TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);
CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(project_id, name);

CREATE TABLE IF NOT EXISTS relationships (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    branch_id       TEXT NOT NULL,
    character_a_id  TEXT NOT NULL,
    character_b_id  TEXT NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'acquaintance',
    affinity_score  INTEGER NOT NULL DEFAULT 0,
    description     TEXT DEFAULT '',
    shared_events   TEXT DEFAULT '[]',
    source_paragraph_id TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_relationships_branch ON relationships(branch_id);
CREATE INDEX IF NOT EXISTS idx_relationships_characters ON relationships(character_a_id, character_b_id);

CREATE TABLE IF NOT EXISTS events (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    branch_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    story_timestamp TEXT DEFAULT '',
    impact          TEXT DEFAULT '',
    participating_characters TEXT DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'occurred',
    source          TEXT NOT NULL DEFAULT 'author',
    paragraph_id    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_branch ON events(branch_id);
CREATE INDEX IF NOT EXISTS idx_events_paragraph ON events(paragraph_id);

CREATE TABLE IF NOT EXISTS paragraph_meta (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    branch_id       TEXT NOT NULL,
    type            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'normal',
    position        INTEGER NOT NULL,
    active_version  INTEGER NOT NULL DEFAULT 1,
    total_versions  INTEGER NOT NULL DEFAULT 1,
    model_used      TEXT,
    token_count     INTEGER DEFAULT 0,
    detection_history TEXT DEFAULT '[]',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_paragraph_meta_branch ON paragraph_meta(branch_id, position);

CREATE TABLE IF NOT EXISTS detection_records (
    id              TEXT PRIMARY KEY,
    paragraph_id    TEXT NOT NULL,
    change_type     TEXT NOT NULL,
    change_data     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    target_id       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_detection_records_paragraph ON detection_records(paragraph_id);

CREATE TABLE IF NOT EXISTS world_memory_changelog (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    branch_id       TEXT NOT NULL,
    paragraph_id    TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    change_type     TEXT NOT NULL,
    previous_data   TEXT,
    applied_data    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wm_changelog_paragraph ON world_memory_changelog(paragraph_id);
CREATE INDEX IF NOT EXISTS idx_wm_changelog_branch ON world_memory_changelog(branch_id);

CREATE TABLE IF NOT EXISTS project_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL
);

INSERT OR IGNORE INTO project_settings (key, value) VALUES
    ('system_prompt', '""'),
    ('writing_style', '{"perspective":"third_person","tone":"neutral","detail_level":"moderate"}'),
    ('context_budget', '{"system":10,"worldMemory":20,"storyHistory":60,"userInput":10}'),
    ('auto_detect_enabled', 'true');
`;

// ============================================================
// 全域設定資料庫 Schema DDL
// ============================================================
const GLOBAL_DB_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_providers (
    id              TEXT PRIMARY KEY,
    provider_type   TEXT NOT NULL,
    auth_method     TEXT NOT NULL DEFAULT 'api_key',
    api_key_encrypted TEXT NOT NULL,
    base_url        TEXT NOT NULL,
    default_model   TEXT NOT NULL DEFAULT '',
    is_active       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS world_templates (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    genre           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    world_rules     TEXT DEFAULT '',
    starter_characters TEXT DEFAULT '[]',
    starter_factions TEXT DEFAULT '[]',
    is_builtin      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ============================================================
// DatabaseService — 管理 SQLite 資料庫連線 (sql.js WASM)
// ============================================================

let sqlJs: SqlJsStatic | null = null;
let globalDb: ProjectDatabase | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (sqlJs) return sqlJs;

  // Locate the wasm file next to the sql.js entry point
  const sqlJsPath = require.resolve('sql.js');
  const wasmPath = path.join(path.dirname(sqlJsPath), 'sql-wasm.wasm');

  sqlJs = await initSqlJs({
    locateFile: () => wasmPath,
  });
  return sqlJs;
}

function migrateGlobalDatabase(db: ProjectDatabase): void {
  try {
    const cols = db.prepare(
      "SELECT name FROM pragma_table_info('ai_providers') WHERE name='auth_method'",
    ).all();
    if (cols.length === 0) {
      db.exec("ALTER TABLE ai_providers ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'api_key'");
    }
  } catch {
    // Table may not exist yet (first run) — schema DDL will create it with the column
  }
}

export async function openGlobalDatabase(userDataPath: string): Promise<ProjectDatabase> {
  if (globalDb) return globalDb;

  const engine = await getSqlJs();
  const dbPath = path.join(userDataPath, 'providers.db');

  let data: Buffer | null = null;
  if (fs.existsSync(dbPath)) {
    data = fs.readFileSync(dbPath);
  }

  const db = new engine.Database(data ? new Uint8Array(data) : null);
  globalDb = new ProjectDatabase(db, dbPath);
  globalDb.exec(GLOBAL_DB_SCHEMA);
  migrateGlobalDatabase(globalDb);
  return globalDb;
}

export function getGlobalDatabase(): ProjectDatabase {
  if (!globalDb) {
    throw new Error('全域資料庫尚未初始化');
  }
  return globalDb;
}

export async function openProjectDatabase(projectPath: string): Promise<ProjectDatabase> {
  const engine = await getSqlJs();
  const dbPath = path.join(projectPath, 'project.db');

  let data: Buffer | null = null;
  if (fs.existsSync(dbPath)) {
    data = fs.readFileSync(dbPath);
  }

  const db = new engine.Database(data ? new Uint8Array(data) : null);
  const projectDb = new ProjectDatabase(db, dbPath);
  projectDb.exec(PROJECT_DB_SCHEMA);
  migrateProjectDatabase(projectDb);
  return projectDb;
}

function migrateProjectDatabase(db: ProjectDatabase): void {
  try {
    const cols = db.prepare(
      "SELECT name FROM pragma_table_info('characters') WHERE name='voice_style'",
    ).all();
    if (cols.length === 0) {
      db.exec("ALTER TABLE characters ADD COLUMN voice_style TEXT DEFAULT ''");
    }
  } catch {
    // Table may not exist yet (first run) — schema DDL creates it with the column
  }

  try {
    const eventStatusCols = db.prepare(
      "SELECT name FROM pragma_table_info('events') WHERE name='status'",
    ).all();
    if (eventStatusCols.length === 0) {
      db.exec("ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'occurred'");
    }
  } catch {
    // Table may not exist yet (first run) — schema DDL creates it with the column
  }

  try {
    const sourceCols = db.prepare(
      "SELECT name FROM pragma_table_info('events') WHERE name='source'",
    ).all();
    if (sourceCols.length === 0) {
      db.exec("ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'author'");
    }
  } catch {
    // Table may not exist yet (first run) — schema DDL creates it with the column
  }
}

export function createProjectDirectory(projectPath: string): void {
  fs.mkdirSync(projectPath, { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'story'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'summaries'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'templates'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'autosave'), { recursive: true });
}

export function closeGlobalDatabase(): void {
  if (globalDb) {
    globalDb.close();
    globalDb = null;
  }
}
