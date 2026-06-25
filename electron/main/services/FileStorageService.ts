import fs from 'node:fs';
import path from 'node:path';
import type { ParagraphMetadataFile, PromptLog, ParagraphUsageLog, BranchUsageEvents, StandaloneUsageEvent } from '../../shared/types.js';

// Cached story-direction suggestions, invalidated when the branch tip advances.
interface SuggestionsCache {
  tipId: string;
  count: number;
  suggestions: string[];
}

class FileStorageService {
  // Validate a storage path is writable
  validateStoragePath(storagePath: string): { valid: boolean; error?: string } {
    try {
      if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
      }
      // Test write access
      const testFile = path.join(storagePath, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return { valid: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : '路徑無法存取';
      return { valid: false, error: message };
    }
  }

  // Create all project directories
  createProjectDirectories(projectPath: string): void {
    const dirs = [
      projectPath,
      path.join(projectPath, 'story'),
      path.join(projectPath, 'summaries'),
      path.join(projectPath, 'templates'),
      path.join(projectPath, 'autosave'),
    ];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create branch directory
  createBranchDirectory(projectPath: string, branchId: string): void {
    const branchDir = path.join(projectPath, 'story', branchId, 'content');
    fs.mkdirSync(branchDir, { recursive: true });
  }

  // Get paragraph content directory
  getParagraphDir(projectPath: string, branchId: string, paragraphId: string): string {
    return path.join(projectPath, 'story', branchId, 'content', paragraphId);
  }

  // Read paragraph content (specific version)
  readParagraphContent(projectPath: string, branchId: string, paragraphId: string, version: number): string {
    const filePath = path.join(
      this.getParagraphDir(projectPath, branchId, paragraphId),
      `v${version}.md`,
    );
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  // Write paragraph content (creates new version)
  writeParagraphContent(
    projectPath: string,
    branchId: string,
    paragraphId: string,
    version: number,
    content: string,
  ): void {
    const paragraphDir = this.getParagraphDir(projectPath, branchId, paragraphId);
    fs.mkdirSync(paragraphDir, { recursive: true });
    fs.writeFileSync(path.join(paragraphDir, `v${version}.md`), content, 'utf-8');
  }

  // Read paragraph metadata
  readParagraphMetadata(projectPath: string, branchId: string, paragraphId: string): ParagraphMetadataFile | null {
    const filePath = path.join(
      this.getParagraphDir(projectPath, branchId, paragraphId),
      'metadata.json',
    );
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ParagraphMetadataFile;
    } catch {
      return null;
    }
  }

  // Write paragraph metadata
  writeParagraphMetadata(
    projectPath: string,
    branchId: string,
    paragraphId: string,
    metadata: ParagraphMetadataFile,
  ): void {
    const paragraphDir = this.getParagraphDir(projectPath, branchId, paragraphId);
    fs.mkdirSync(paragraphDir, { recursive: true });
    fs.writeFileSync(
      path.join(paragraphDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8',
    );
  }

  // Read the persisted prompt log (messages actually sent to the model) for a
  // paragraph. Returns null when none exists (e.g. paragraphs generated before
  // this feature, or the user-typed paragraphs which have no prompt).
  readPromptLog(projectPath: string, branchId: string, paragraphId: string): PromptLog | null {
    const filePath = path.join(
      this.getParagraphDir(projectPath, branchId, paragraphId),
      'prompt.json',
    );
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PromptLog;
    } catch {
      return null;
    }
  }

  // Write the prompt log for a paragraph, overwriting any prior one (a regenerate
  // replaces it with the prompt that produced the current content).
  writePromptLog(projectPath: string, branchId: string, paragraphId: string, log: PromptLog): void {
    const paragraphDir = this.getParagraphDir(projectPath, branchId, paragraphId);
    fs.mkdirSync(paragraphDir, { recursive: true });
    fs.writeFileSync(
      path.join(paragraphDir, 'prompt.json'),
      JSON.stringify(log, null, 2),
      'utf-8',
    );
  }

  // Read the persisted usage log for a paragraph (§7.4).
  // Returns null when none exists (pre-feature paragraphs or paragraphs without usage).
  readUsageLog(projectPath: string, branchId: string, paragraphId: string): ParagraphUsageLog | null {
    const filePath = path.join(this.getParagraphDir(projectPath, branchId, paragraphId), 'usage.json');
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ParagraphUsageLog;
    } catch {
      return null;
    }
  }

  // Write the usage log for a paragraph, overwriting any prior one (regenerate replaces).
  writeUsageLog(projectPath: string, branchId: string, paragraphId: string, log: ParagraphUsageLog): void {
    const dir = this.getParagraphDir(projectPath, branchId, paragraphId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'usage.json'), JSON.stringify(log, null, 2), 'utf-8');
  }

  // Read branch-level standalone usage events (§7.4).
  // Returns { events: [] } when the file does not exist or is corrupt.
  readUsageEvents(projectPath: string, branchId: string): BranchUsageEvents {
    const filePath = path.join(projectPath, 'summaries', `${branchId}-usage-events.json`);
    if (!fs.existsSync(filePath)) return { events: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BranchUsageEvents;
      return Array.isArray(parsed?.events) ? parsed : { events: [] };
    } catch {
      return { events: [] };
    }
  }

  // Append new standalone usage events to the branch-level usage-events.json (read-modify-write).
  // Single-writer per handler invocation; best-effort (no locking needed).
  // A rolling cap of MAX_USAGE_EVENTS keeps the file from growing without bound:
  // when the combined array exceeds the cap, only the most recent MAX_USAGE_EVENTS
  // entries are retained. This makes load time and memory O(1) rather than O(N).
  static readonly MAX_USAGE_EVENTS = 1000;

  appendUsageEvents(projectPath: string, branchId: string, newEvents: StandaloneUsageEvent[]): void {
    const dir = path.join(projectPath, 'summaries');
    fs.mkdirSync(dir, { recursive: true });
    const current = this.readUsageEvents(projectPath, branchId);
    current.events.push(...newEvents);
    // Rolling cap: keep only the most recent MAX_USAGE_EVENTS entries.
    if (current.events.length > FileStorageService.MAX_USAGE_EVENTS) {
      current.events = current.events.slice(-FileStorageService.MAX_USAGE_EVENTS);
    }
    fs.writeFileSync(path.join(dir, `${branchId}-usage-events.json`), JSON.stringify(current, null, 2), 'utf-8');
  }

  // Read summary for a branch
  readSummary(projectPath: string, branchId: string): string {
    const filePath = path.join(projectPath, 'summaries', `${branchId}-summary.md`);
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  }

  // Write summary
  writeSummary(projectPath: string, branchId: string, content: string): void {
    const summariesDir = path.join(projectPath, 'summaries');
    fs.mkdirSync(summariesDir, { recursive: true });
    fs.writeFileSync(path.join(summariesDir, `${branchId}-summary.md`), content, 'utf-8');
  }

  // Read cached story-direction suggestions for a branch. Returns null when no
  // cache exists or the file is unreadable/corrupt.
  readSuggestionsCache(projectPath: string, branchId: string): SuggestionsCache | null {
    const filePath = path.join(projectPath, 'summaries', `${branchId}-suggestions.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SuggestionsCache;
      if (typeof parsed.tipId !== 'string' || !Array.isArray(parsed.suggestions)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  // Cache story-direction suggestions for a branch, keyed by the branch tip.
  writeSuggestionsCache(projectPath: string, branchId: string, cache: SuggestionsCache): void {
    const summariesDir = path.join(projectPath, 'summaries');
    fs.mkdirSync(summariesDir, { recursive: true });
    fs.writeFileSync(
      path.join(summariesDir, `${branchId}-suggestions.json`),
      JSON.stringify(cache),
      'utf-8',
    );
  }

  // Delete project directory
  deleteProjectDirectory(projectPath: string): void {
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  }

  // Check if project directory exists and has a database
  isValidProject(projectPath: string): boolean {
    return fs.existsSync(path.join(projectPath, 'project.db'));
  }
}

let instance: FileStorageService | null = null;

export function getFileStorageService(): FileStorageService {
  if (!instance) {
    instance = new FileStorageService();
  }
  return instance;
}

export { FileStorageService };
