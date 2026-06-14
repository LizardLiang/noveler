import type { ProjectDatabase } from './database.js';
import { getFileStorageService } from './FileStorageService.js';

export interface CharacterAppearanceStat {
  characterId: string;
  characterName: string;
  paragraphCount: number;
}

export interface DailyWordCount {
  date: string; // YYYY-MM-DD
  wordCount: number;
}

export interface StoryStats {
  totalWordCount: number;
  totalParagraphs: number;
  characterAppearances: CharacterAppearanceStat[];
  dailyTrend: DailyWordCount[];
}

// Count characters in text: each CJK character counts as 1, English words count as 1
export function countWords(text: string): number {
  if (!text) return 0;
  // Use a simple length-based approach for Chinese text
  // Filter punctuation and spaces, count remaining characters
  const stripped = text.replace(/[\s\n\r\t，。！？、；：「」『』【】《》〈〉「」""''…—\-,.!?;:()\[\]{}'"/\\]/g, '');
  return stripped.length > 0 ? stripped.length : 0;
}

class StatsService {
  getStats(
    db: ProjectDatabase,
    projectId: string,
    branchId: string,
    projectPath: string,
  ): StoryStats {
    const fileStorage = getFileStorageService();

    // 1. Get all AI paragraphs in this branch
    const paragraphRows = db.prepare(
      `SELECT id, active_version, created_at FROM paragraph_meta
       WHERE branch_id=? AND type='ai' AND status!='detached'
       ORDER BY position ASC`,
    ).all(branchId) as Array<{ id: string; active_version: number; created_at: string }>;

    // 2. Read content for word counting
    let totalWordCount = 0;
    const paragraphContents = new Map<string, string>();

    for (const row of paragraphRows) {
      try {
        const content = fileStorage.readParagraphContent(
          projectPath,
          branchId,
          row.id,
          row.active_version,
        );
        if (content) {
          paragraphContents.set(row.id, content);
          totalWordCount += countWords(content);
        }
      } catch {
        // File may not exist yet
      }
    }

    const totalParagraphs = paragraphRows.length;

    // 3. Character appearance stats — count how many paragraphs mention each character's name
    const characters = db.prepare(
      `SELECT id, name FROM characters WHERE project_id=?`,
    ).all(projectId) as Array<{ id: string; name: string }>;

    const characterAppearances: CharacterAppearanceStat[] = [];

    for (const char of characters) {
      let count = 0;
      for (const [, content] of paragraphContents) {
        if (content.includes(char.name)) {
          count++;
        }
      }
      if (count > 0) {
        characterAppearances.push({
          characterId: char.id,
          characterName: char.name,
          paragraphCount: count,
        });
      }
    }

    // Sort by appearance count descending
    characterAppearances.sort((a, b) => b.paragraphCount - a.paragraphCount);

    // 4. Daily word count trend — group paragraph creation by date
    const dailyMap = new Map<string, number>();

    for (const row of paragraphRows) {
      const content = paragraphContents.get(row.id);
      if (!content) continue;

      // Extract date portion from created_at (SQLite datetime: YYYY-MM-DD HH:MM:SS)
      const date = row.created_at.slice(0, 10);
      const wc = countWords(content);
      dailyMap.set(date, (dailyMap.get(date) ?? 0) + wc);
    }

    // Build last-7-days trend
    const today = new Date();
    const dailyTrend: DailyWordCount[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      dailyTrend.push({
        date: dateStr,
        wordCount: dailyMap.get(dateStr) ?? 0,
      });
    }

    return {
      totalWordCount,
      totalParagraphs,
      characterAppearances,
      dailyTrend,
    };
  }
}

let instance: StatsService | null = null;

export function getStatsService(): StatsService {
  if (!instance) {
    instance = new StatsService();
  }
  return instance;
}
