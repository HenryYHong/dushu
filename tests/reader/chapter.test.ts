// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../src/types';
import { createChapterView } from '../../src/ui/reader/chapter';
import { blockText } from '../../src/ui/reader/selection';
import { makeCtx, stubBrowser, tick } from './helpers';

beforeAll(() => stubBrowser());

const chapter: Chapter = {
  title: '第一章',
  blocks: [
    { t: 'h', level: 2, text: '开始' },
    { t: 'p', text: '　　我们在银行门口见面。' },
    { t: 'quote', text: '他说：“你好。”' },
    { t: 'img', asset: 'pic.png', alt: '图' },
    { t: 'hr' },
    { t: 'p', text: 'Hello world' },
    { t: 'p', text: '中国人。' },
  ],
};

async function setup(settings = {}, ch: Chapter = chapter) {
  const { ctx, dict } = await makeCtx({ pinyin: 'all', ...settings });
  const view = createChapterView({ ctx, dict, bookId: 'b', chapter: ch, chapterIndex: 0 });
  document.body.appendChild(view.el);
  return { ctx, dict, view };
}

describe('chapter structure', () => {
  it('adds the chapter title as a heading when the first block does not say it', async () => {
    const { view } = await setup();
    expect(view.synthetic).toBe(1);
    expect(view.blocks[0].block).toEqual({ t: 'h', level: 1, text: '第一章' });
    expect(view.blocks).toHaveLength(chapter.blocks.length + 1);
  });

  it('does not repeat a title the first block already carries', async () => {
    const { view } = await setup({}, { title: '开始', blocks: chapter.blocks });
    expect(view.synthetic).toBe(0);
    expect(view.blocks).toHaveLength(chapter.blocks.length);
  });

  it('shows the book\'s own title heading as the chapter title, whatever level the file gave it', async () => {
    const { view } = await setup({}, { title: '开始', blocks: chapter.blocks });
    expect(view.blocks[0].el.tagName).toBe('H1');
    expect(view.blocks[0].el.classList.contains('rd-h1')).toBe(true);
    // Only for the display: the stored block is untouched.
    expect(chapter.blocks[0]).toEqual({ t: 'h', level: 2, text: '开始' });
  });

  it('gives a later part of a split chapter no title: its text runs on from the part before', async () => {
    const { view } = await setup({}, { title: '第二章 (2)', cont: true, blocks: [{ t: 'p', text: '我们见面。' }] });
    expect(view.synthetic).toBe(0);
    expect(view.blocks.map((b) => b.el.tagName)).toEqual(['P']);
  });

  it('sets a bare section number in the middle', async () => {
    const { view } = await setup({}, { title: '狂人日记', blocks: [{ t: 'p', text: '某君。' }, { t: 'h', level: 3, text: '十二' }, { t: 'h', level: 3, text: '后记' }] });
    expect(view.blocks.map((b) => b.el.classList.contains('rd-h-num'))).toEqual([false, false, true, false]);
  });

  it('creates a shell per block with the right element and classes', async () => {
    const { view } = await setup();
    const tags = view.blocks.map((b) => b.el.tagName.toLowerCase());
    expect(tags).toEqual(['h1', 'h2', 'p', 'blockquote', 'figure', 'hr', 'p', 'p']);
    expect(view.blocks[2].el.classList.contains('rd-noindent')).toBe(true); // starts with a full-width space
    expect(view.blocks[6].el.classList.contains('rd-plain')).toBe(true); // no Han text
    expect(view.blocks.every((b) => b.el.dataset.b === String(b.index))).toBe(true);
    expect(view.blocks.map((b) => b.kind)).toEqual(['text', 'text', 'text', 'text', 'img', 'hr', 'text', 'text']);
  });

  it('renders a few blocks now and the rest in batches', async () => {
    const { view } = await setup();
    view.renderTo(2);
    expect(view.blocks.slice(0, 3).every((b) => b.rendered)).toBe(true);
    expect(view.blocks[3].rendered).toBeNull();
    expect(view.blocks[3].el.childNodes).toHaveLength(0);
    await view.renderRest();
    expect(view.blocks.filter((b) => b.kind === 'text').every((b) => b.rendered)).toBe(true);
  });

  it('keeps block text free of pinyin and of the translate button', async () => {
    const { view } = await setup();
    await view.renderRest();
    expect(view.blocks[2].el.querySelector('.rd-pt-btn')).not.toBeNull();
    expect(blockText(view.blocks[2].el)).toBe('　　我们在银行门口见面。');
    expect(view.blocks[1].el.querySelector('.rd-pt-btn')).toBeNull(); // headings have none
    expect(view.blocks[6].el.querySelector('.rd-pt-btn')).toBeNull(); // no Han text
  });

  it('long chapters render in several slices without blocking', async () => {
    const blocks = Array.from({ length: 400 }, (_, i) => ({ t: 'p' as const, text: `他慢慢地走了过来，对我说了很多话，第${i}段。` }));
    const { view } = await setup({}, { title: '长', blocks });
    view.renderTo(5);
    const doneEarly = view.blocks.filter((b) => b.rendered).length;
    expect(doneEarly).toBeLessThan(20);
    await view.renderRest();
    expect(view.blocks.every((b) => b.rendered)).toBe(true);
  });

  it('maps DOM nodes back to blocks and offsets to tokens', async () => {
    const { view } = await setup();
    await view.renderRest();
    const b = view.blocks[2];
    const ruby = b.el.querySelector('ruby')!;
    expect(view.blockOfNode(ruby.firstChild)).toBe(b);
    expect(view.blockOfNode(document.body)).toBeNull();
    const ti = view.tokenIndexAt(b, 5); // 银行 starts at 5 after the two full-width spaces and 我们在
    expect(b.rendered!.tokens[ti].text).toBe('银行');
    expect(view.tokenIndexAt(b, 0)).toBe(-1); // a space
  });
});

describe('live updates', () => {
  it('hides pinyin of known words and brings it back, without re-segmenting', async () => {
    const { ctx, view } = await setup({ pinyin: 'unknown' });
    await view.renderRest();
    const word = view.blocks[2].el.querySelectorAll<HTMLElement>('.rd-w')[2]; // 银行
    expect(word.classList.contains('rd-nopy')).toBe(false);
    const tokensBefore = view.blocks[2].rendered!.tokens;
    await ctx.store.known.add(['银行']);
    view.refreshMarks();
    expect(word.classList.contains('rd-nopy')).toBe(true);
    expect(word.classList.contains('rd-known')).toBe(true);
    expect(view.blocks[2].rendered!.tokens).toBe(tokensBefore);
    await ctx.store.known.remove(['银行']);
    view.refreshMarks();
    expect(word.classList.contains('rd-nopy')).toBe(false);
  });

  it('follows the pinyin mode and the HSK threshold', async () => {
    const { ctx, view } = await setup({ pinyin: 'hsk', hskThreshold: 2 });
    await view.renderRest();
    const visible = () => [...view.el.querySelectorAll('.rd-w:not(.rd-nopy)')].map((w) => [...w.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join(''));
    const atTwo = visible();
    expect(atTwo).not.toContain('银行'); // HSK 2
    ctx.settings.set({ hskThreshold: 1 });
    view.refreshVisibility();
    expect(visible()).toContain('银行');
    ctx.settings.set({ pinyin: 'all' });
    view.refreshVisibility();
    expect(view.el.querySelectorAll('.rd-nopy')).toHaveLength(0);
    ctx.settings.set({ pinyin: 'off' });
    view.refreshVisibility();
    expect(view.el.querySelectorAll('.rd-w:not(.rd-nopy)')).toHaveLength(0);
  });

  it('grades a word in HSK mode by its characters as read here, not by its place on the list', async () => {
    const { ctx, dict, view } = await setup({ pinyin: 'hsk', hskThreshold: 1 }, { title: '说', blocks: [{ t: 'p', text: '他说道：不行，我们去银行，这是行话。' }] });
    // 说道 is on the 7-9 list, but 说 shuō and 道 dào are HSK 1. 行 is xíng at HSK 1 (不行); háng comes only with 银行 (HSK 2),
    // so 行话, which the list leaves out, keeps its pinyin where 不行 does not.
    expect(dict.hsk('说道')?.hsk3).toBe(7);
    expect(dict.hsk('银行')?.hsk3).toBe(2);
    expect(dict.hsk('行话')).toBeNull();
    await view.renderRest();
    const visible = () => [...view.el.querySelectorAll('p .rd-w:not(.rd-nopy)')].map((w) => [...w.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join(''));
    expect(visible()).toEqual(['银行', '行话']);
    ctx.settings.set({ hskThreshold: 2 });
    view.refreshVisibility();
    expect(visible()).toEqual([]);
  });

  it('marks saved words and updates when the vocabulary changes', async () => {
    const { ctx, view } = await setup();
    await view.renderRest();
    expect(view.el.querySelector('.rd-saved')).toBeNull();
    await ctx.store.vocab.put({ id: '银行', simp: '银行', trad: '銀行', pinyin: 'yin2 hang2', gloss: 'bank', addedAt: 1, srs: { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0 } });
    view.refreshMarks();
    expect([...view.el.querySelectorAll('.rd-saved')].map((e) => e.getAttribute('data-s'))).toEqual(['5']);
  });

  it('restyles pinyin in place', async () => {
    const { ctx, view } = await setup();
    await view.renderRest();
    const rt = view.blocks[2].el.querySelector('rt')!;
    expect(rt.textContent).toBe('wǒ');
    ctx.settings.set({ pinyinStyle: 'numbers', toneColors: false });
    view.refreshPinyin();
    expect(view.blocks[2].el.querySelector('rt')).toBe(rt);
    expect(rt.textContent).toBe('wo3');
    expect(rt.className).toBe('');
  });

  it('script conversion redraws from the original text', async () => {
    const { ctx, view } = await setup({}, { title: '国', blocks: [{ t: 'p', text: '我们的国家很大。' }] });
    view.renderTo(5);
    expect(blockText(view.blocks[1].el)).toBe('我们的国家很大。');
    ctx.settings.set({ script: 'traditional' });
    view.reconvert();
    expect(view.blocks[1].rendered).toBeNull();
    view.renderTo(5);
    expect(blockText(view.blocks[1].el)).toBe('我們的國家很大。');
    ctx.settings.set({ script: 'original' });
    view.reconvert();
    view.renderTo(5);
    expect(blockText(view.blocks[1].el)).toBe('我们的国家很大。');
  });
});

describe('highlights', () => {
  it('marks and clears characters by offset range', async () => {
    const { view } = await setup();
    await view.renderRest();
    const b = view.blocks[2];
    view.mark(b, 5, 7, 'rd-active');
    expect([...b.el.querySelectorAll('.rd-active')].map((r) => (r.firstChild as Text).data)).toEqual(['银', '行']);
    view.mark(b, 2, 4, 'rd-sel');
    view.clearMarks('rd-active');
    expect(b.el.querySelectorAll('.rd-active')).toHaveLength(0);
    expect(b.el.querySelectorAll('.rd-sel')).toHaveLength(2);
    view.clearMarks();
    expect(b.el.querySelectorAll('.rd-sel')).toHaveLength(0);
  });
});

describe('paragraph translation', () => {
  it('toggles a translation block under the paragraph', async () => {
    const { view } = await setup();
    await view.renderRest();
    const b = view.blocks[2];
    b.transBtn!.click();
    expect(b.el.nextElementSibling?.classList.contains('rd-trans')).toBe(true);
    expect(b.transBtn!.getAttribute('aria-pressed')).toBe('true');
    await vi.waitFor(() => expect(b.el.nextElementSibling!.textContent).toContain('银行'));
    b.transBtn!.click();
    expect(b.el.nextElementSibling?.classList.contains('rd-trans')).toBe(false);
    expect(b.transBtn!.getAttribute('aria-pressed')).toBe('false');
  });

  it('dispose stops pending batches', async () => {
    const blocks = Array.from({ length: 200 }, () => ({ t: 'p' as const, text: '他慢慢地走了过来，对我说了很多话。' }));
    const { view } = await setup({}, { title: '长', blocks });
    const rest = view.renderRest();
    view.dispose();
    await rest;
    await tick(30);
    expect(view.blocks.some((b) => !b.rendered)).toBe(true);
  });
});

describe('lexicon', () => {
  it('draws the blocks again when the lexicon changes, and only the ones that were drawn', async () => {
    const { view } = await setup();
    view.renderTo(2);
    const before = view.blocks[2].el.querySelector('.rd-w');
    expect(view.blocks[5].rendered).toBeNull();
    const { buildLexicon } = await import('../../src/core/lexicon');
    view.setLexicon(buildLexicon([{ word: '银行', pinyin: 'yin2 hang2', gloss: 'bank', kind: 'term', enabled: true, origin: 'user' }]));
    expect(view.blocks[2].rendered).not.toBeNull();
    expect(view.blocks[2].el.querySelector('.rd-w')).not.toBe(before);
    expect(view.blocks[5].rendered).toBeNull();
    expect(blockText(view.blocks[2].el)).toBe('　　我们在银行门口见面。');
  });
});
