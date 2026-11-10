// @vitest-environment jsdom
// Chinese verse on the page (src/ui/reader/verse.ts): the lines of a poem have no paragraph indent and break only between
// their clauses, found when the chapter is drawn; a short prose line that happens to look like one stays prose.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Block, Chapter } from '../../src/types';
import { createChapterView } from '../../src/ui/reader/chapter';
import { blockText } from '../../src/ui/reader/selection';
import { verseLines } from '../../src/ui/reader/verse';
import { importText } from '../../src/import';
import { makeCtx, stubBrowser } from './helpers';

beforeAll(() => stubBrowser());

const p = (text: string): Block => ({ t: 'p', text });

describe('which paragraphs are verse', () => {
  it('a line under a poem title, and the line after it', () => {
    expect(verseLines([{ t: 'h', level: 3, text: '靜夜思　李白' }, p('床前明月光，疑是地上霜。'), p('舉頭望明月，低頭思故鄉。')]))
      .toEqual([false, true, true]);
  });
  it('a lone couplet under a title an older import left as a paragraph', () => {
    expect(verseLines([p('靜夜思　李白'), p('床前明月光，疑是地上霜。'), p('那天晚上，我们在银行门口见了面，说了很久的话才回家。')]))
      .toEqual([false, true, false]);
  });
  it('a run of two or more lines with no title over them', () => {
    expect(verseLines([p('白日依山盡，黃河入海流。'), p('欲窮千里目，更上一層樓。')])).toEqual([true, true]);
  });
  it('not one short prose line that reads like a line of verse', () => {
    expect(verseLines([
      { t: 'h', level: 2, text: '第一章' }, p('他笑了，我也笑了。'), p('那天晚上，我们在银行门口见了面，说了很久的话才回家。'),
    ])).toEqual([false, false, false]);
  });
});

describe('verse in the reader', () => {
  it('sets the lines of 唐诗八首 as verse, each clause kept whole', async () => {
    const txt = await readFile(join(__dirname, '..', '..', 'public', 'samples', 'tang-poems.txt'), 'utf8');
    const book = importText(txt, '唐诗八首');
    const chapter: Chapter = book.chapters[0];
    const { ctx, dict } = await makeCtx({ pinyin: 'all' });
    const view = createChapterView({ ctx, dict, bookId: 'b', chapter, chapterIndex: 0 });
    document.body.appendChild(view.el);
    view.renderTo(view.blocks.length - 1);
    const lines = view.blocks.filter((b) => b.el.classList.contains('rd-verse'));
    expect(lines.length).toBeGreaterThanOrEqual(16); // eight poems of four lines, typed as couplets or lines
    for (const b of lines) {
      const clauses = [...b.el.querySelectorAll('.rd-clause')].map((e) => blockText(e));
      expect(clauses.length).toBeGreaterThanOrEqual(2);
      expect(clauses.join('')).toBe(blockText(b.el));
      expect(clauses.every((c) => /[，、；：。！？]$/.test(c))).toBe(true);
    }
    // The titles are headings, not verse.
    expect(view.blocks.some((b) => b.el.matches('h3') && b.el.classList.contains('rd-verse'))).toBe(false);
  });

  it('leaves a prose chapter alone', async () => {
    const { ctx, dict } = await makeCtx({ pinyin: 'all' });
    const view = createChapterView({ ctx, dict, bookId: 'b', chapterIndex: 0, chapter: {
      title: '第一章', blocks: [p('他笑了，我也笑了。'), p('那天晚上，我们在银行门口见了面，说了很久的话才回家。')],
    } });
    document.body.appendChild(view.el);
    view.renderTo(view.blocks.length - 1);
    expect(view.el.querySelector('.rd-verse, .rd-clause')).toBeNull();
  });
});
