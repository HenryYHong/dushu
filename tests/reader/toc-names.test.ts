// @vitest-environment jsdom
// The chapter drawer's Names & terms tab: names written as the word card writes them, and what the empty list says.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookMeta, LexiconEntry } from '../../src/types';
import { createToc } from '../../src/ui/reader/toc';
import { makeCtx, stubBrowser } from './helpers';

beforeAll(() => stubBrowser());
afterEach(() => { document.body.innerHTML = ''; });

const entry = (word: string, pinyin: string, kind: LexiconEntry['kind']): LexiconEntry =>
  ({ word, pinyin, gloss: '', kind, count: 1, enabled: true, origin: 'auto' });

async function drawer(load: () => Promise<LexiconEntry[]>) {
  const { ctx } = await makeCtx();
  const book = { id: 'names-tab', title: '书', author: '', format: 'paste', script: 'traditional', addedAt: 0, chapterCount: 1, charCount: 1, chapterOffsets: [], chapterTitles: ['第一回'] } as BookMeta;
  const toc = createToc(ctx, book, () => {}, { load, onWord: () => {}, onToggle: async () => {} });
  return toc;
}

const pinyinOf = (word: string) => [...document.querySelectorAll('.rd-names .rd-name')]
  .find((r) => r.querySelector('.rd-name-word')?.textContent === word)?.querySelector('.rd-name-py')?.textContent;

describe('Names & terms tab', () => {
  it('writes a name as the word card does: the surname apart, the given name as one word', async () => {
    const toc = await drawer(async () => [
      entry('夏侯惇', 'xia4 hou2 dun1', 'name'), entry('諸葛亮', 'zhu1 ge3 liang4', 'name'), entry('玄德', 'xuan2 de2', 'name'),
      entry('桃花島', 'tao2 hua1 dao3', 'place'), entry('九陰真經', 'jiu3 yin1 zhen1 jing1', 'term'),
    ]);
    toc.open(0, 'names');
    await vi.waitFor(() => expect(pinyinOf('夏侯惇')).toBeTruthy());
    expect(pinyinOf('夏侯惇')).toBe('Xiàhóu Dūn');
    expect(pinyinOf('諸葛亮')).toBe('Zhūgě Liàng'); // a traditional compound surname is folded before the lookup
    expect(pinyinOf('玄德')).toBe('Xuándé');
    expect(pinyinOf('桃花島')).toBe('Táohuā Dǎo');
    expect(pinyinOf('九陰真經')).toBe('jiǔ yīn zhēn jīng');
    // The filter matches the pinyin as written.
    const filter = document.querySelector<HTMLInputElement>('.rd-toc-filter[placeholder="Filter names and terms"]')!;
    filter.value = 'xiàhóu';
    filter.dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('.rd-names .rd-name-word')].map((e) => e.textContent)).toEqual(['夏侯惇']);
    toc.dispose();
  });

  it('says the book has no names once it has been read and none were found, not that a scan is still to come', async () => {
    let release!: (rows: LexiconEntry[]) => void;
    const toc = await drawer(() => new Promise((r) => { release = r; }));
    toc.open(0, 'names');
    const none = () => document.querySelector('.rd-names .rd-toc-none')?.textContent ?? '';
    expect(none()).toBe('Loading names and terms…'); // nothing is known yet, so it claims nothing
    release([]);
    await vi.waitFor(() => expect(none()).toBe('No names or terms were found in this book.'));
    toc.dispose();
  });
});
