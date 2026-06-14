import { describe, it, expect } from 'vitest';
import { splitNovelText } from '../electron/main/services/NovelImportService';

describe('splitNovelText', () => {
  it('splits by Chinese chapter headings', () => {
    const novel = '第一章 開始\n\n這是第一章的內容。\n更多內容。\n\n第二章 發展\n\n第二章內容在這裡。';
    const result = splitNovelText(novel);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatch(/^第一章 開始/);
    expect(result[1]).toMatch(/^第二章 發展/);
  });

  it('does not treat body text starting with 第N章 as a heading', () => {
    const novel = '第一章 開始\n\n第二章內容在這裡，這是一句正文。\n\n第二章 發展\n\n後續內容。';
    const result = splitNovelText(novel);
    expect(result).toHaveLength(2);
  });

  it('splits by markdown headings', () => {
    const novel = '# 序章\n\n內容一\n\n# 第一章\n\n內容二';
    expect(splitNovelText(novel)).toHaveLength(2);
  });

  it('splits by English chapter headings', () => {
    const novel = 'Chapter 1 The Beginning\n\nSome text.\n\nChapter 2 The End\n\nMore text.';
    expect(splitNovelText(novel)).toHaveLength(2);
  });

  it('chunks heading-less text at blank-line boundaries under the size limit', () => {
    const novel = Array.from({ length: 50 }, (_, i) => `段落${i}，` + '字'.repeat(100)).join('\n\n');
    const result = splitNovelText(novel);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('hard-splits a single oversized line', () => {
    const result = splitNovelText('字'.repeat(7000));
    expect(result.map(s => s.length)).toEqual([2000, 2000, 2000, 1000]);
  });

  it('strips BOM and normalizes CRLF', () => {
    const novel = '﻿第一章 起\r\n\r\n內容\r\n\r\n第二章 承\r\n\r\n內容二';
    const result = splitNovelText(novel);
    expect(result).toHaveLength(2);
    expect(result[0].startsWith('第一章 起')).toBe(true);
    expect(result[0]).not.toContain('\r');
  });

  it('returns empty array for blank input', () => {
    expect(splitNovelText('   \n\n  ')).toHaveLength(0);
  });
});
