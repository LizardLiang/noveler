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
