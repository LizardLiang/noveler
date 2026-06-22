import fs from 'node:fs';
import path from 'node:path';
import type { ParagraphMetadataFile } from '../../shared/types.js';

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
