// @vitest-environment jsdom
// The word popup's content: compact, one pinyin line, a disclosure for long definition lists, chips for the
// characters, the Translate icon in the header, and the headword in the script of the book.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closePopup, openWordPopup } from '../../src/ui/popup/popup';
import { buildLexicon } from '../../src/core/lexicon';
import type { LexiconEntry } from '../../src/types';
import { anchorRect, makeCtx, stubBrowser } from '../reader/helpers';

beforeAll(() => stubBrowser());
afterEach(() => { closePopup(); document.body.innerHTML = ''; });

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (sel: string) => q(sel)?.textContent ?? '';
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const entry = (word: string, over: Partial<LexiconEntry> = {}): LexiconEntry => ({
  word, pinyin: 'guo1 jing4', gloss: 'name (person)', kind: 'name', count: 10, enabled: true, origin: 'auto', ...over,
});

describe('definitions', () => {
  it('shows pinyin once for a word with one reading', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    expect(all('.pp-py').filter((e) => e.closest('.pp-pyline, .pp-reading-head')).map((e) => e.textContent)).toEqual(['yín háng']);
  });

  it('caps a long list at four senses with a "more" button that shows the rest', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '歷', anchor: anchorRect(), reading: ['li4'] });
    const list = q('.pp-defs')!;
    expect(list.children).toHaveLength(4);
    const more = q('.pp-more-btn')!;
    expect(more.textContent).toMatch(/^\d+ more$/);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    expect(list.children.length).toBeGreaterThan(4);
    expect(q('.pp-more-btn')).toBeNull();
  });

  it('keeps raw CEDICT notation out of the senses', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '奴才', anchor: anchorRect() });
    expect(text('.pp-defs')).not.toMatch(/\bfig\./);
    openWordPopup({ ctx, word: '韩', anchor: anchorRect() });
    expect(text('.pp-defs')).not.toContain('|');
  });
});

describe('order', () => {
  const before = (a: string, b: string) => !!(q(a)!.compareDocumentPosition(q(b)!) & Node.DOCUMENT_POSITION_FOLLOWING);
  it('puts the dictionary meanings before every context tool and note', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '了', prev: '看', next: '。', anchor: anchorRect(), context: { sentence: '他看了。', paragraph: '他看了。' } });
    expect(before('.pp-defs', '.pp-reading-actions')).toBe(true); // the owner wants the meanings right under the word
    expect(before('.pp-defs', '.pp-note')).toBe(true);
    expect(text('.pp-note')).toContain('not a choice of meaning');
    if (q('.pp-context')) expect(before('.pp-defs', '.pp-context')).toBe(true);
  });
  it('says nothing about an AI suggestion before there is one', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), context: { sentence: '他去银行。', paragraph: '他去银行。' } });
    expect(text('.pp-body')).not.toContain('AI suggestion');
  });
});

describe('characters', () => {
  it('are compact chips: glyph, reading, a few words of meaning, never a repeated surname', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '混沌', anchor: anchorRect() });
    const chips = all('.pp-card');
    expect(chips).toHaveLength(2);
    expect(chips[0].querySelector('.pp-card-glyph')!.textContent).toBe('混');
    expect(chips[0].querySelector('.pp-py')!.textContent).toBe('hùn');
    expect(chips[0].querySelector('.pp-card-gloss')!.textContent).toMatch(/mix|confus|muddy/i);
    for (const ch of [...'年官国力何花园武景林本']) {
      openWordPopup({ ctx, word: ch + '子', anchor: anchorRect() });
      for (const g of all('.pp-card-gloss')) expect(g.textContent, ch).not.toMatch(/^surname/i);
    }
  });

  it("show the reading used in this book for a name, not a fresh guess (华筝 huà zhēng, 靖儿 jìng ér)", async () => {
    const { ctx } = await makeCtx();
    const lexicon = buildLexicon([entry('靖儿', { pinyin: 'jing4 er2' }), entry('华筝', { pinyin: 'hua4 zheng1' })]);
    openWordPopup({ ctx, word: '靖儿', anchor: anchorRect(), lexicon, bookId: 'b1' });
    expect(all('.pp-card .pp-py').map((e) => e.textContent)).toEqual(['jìng', 'ér']);
    expect(text('.pp-pyline .pp-py')).toBe("Jìng'ér"); // a name: one word, capitalized, with the apostrophe pinyin asks for
    openWordPopup({ ctx, word: '华筝', anchor: anchorRect(), lexicon, bookId: 'b1' });
    expect(all('.pp-card .pp-py').map((e) => e.textContent)[0]).toBe('huà');
  });
});

describe('header', () => {
  it('has Translate beside Pronounce, Save and Known when there is a sentence', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), context: { sentence: '我们在银行门口见面。' }, onStep: () => {} });
    const labels = all('.pp-head-actions button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Translate sentence');
    expect(labels.indexOf('Translate sentence')).toBeLessThan(labels.indexOf('Save word'));
  });
  it('has no Translate icon without a sentence (opened from the vocabulary list)', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    expect(all('.pp-head-actions button').map((b) => b.getAttribute('aria-label'))).not.toContain('Translate sentence');
  });
  it('leads with the form the book uses and shows the other script small', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '離合', anchor: anchorRect() });
    expect(text('.pp-word')).toBe('離合');
    expect(text('.pp-trad')).toBe('离合');
    closePopup();
    openWordPopup({ ctx, word: '离合', anchor: anchorRect() });
    expect(text('.pp-word')).toBe('离合');
    expect(text('.pp-trad')).toBe('離合');
  });
  it('capitalizes a place and sets its ending apart (Táohuā Dǎo), and leaves a technique lowercase', async () => {
    const { ctx } = await makeCtx();
    const lexicon = buildLexicon([
      entry('桃花岛', { pinyin: 'tao2 hua1 dao3', kind: 'place' }),
      entry('九阴真经', { pinyin: 'jiu3 yin1 zhen1 jing1', kind: 'term' }),
    ]);
    openWordPopup({ ctx, word: '桃花岛', anchor: anchorRect(), lexicon, bookId: 'b1' });
    expect(text('.pp-pyline .pp-py')).toBe('Táohuā Dǎo');
    expect(text('.pp-book .pp-py')).toBe('Táohuā Dǎo');
    closePopup();
    openWordPopup({ ctx, word: '九阴真经', anchor: anchorRect(), lexicon, bookId: 'b1' });
    expect(text('.pp-pyline .pp-py')).toBe('jiǔ yīn zhēn jīng');
  });
});

describe('saving', () => {
  it('saves the same lead sense the popup shows (因: because of, not "old variant of 因")', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '因', anchor: anchorRect() });
    q('.pp-save')!.click();
    await new Promise((r) => setTimeout(r, 50));
    const item = await ctx.store.vocab.get('因');
    expect(item?.gloss).toMatch(/^because of/);
    expect(item?.gloss).not.toMatch(/variant/);
  });
});

describe('script variants belong to the reading on screen', () => {
  it('shows no traditional form for the particle 了, whose 瞭 is only the liǎo "understand" row', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '了', prev: '吃', next: '饭', anchor: anchorRect() });
    expect(text('.pp-pyline .pp-py')).toBe('le');
    expect(q('.pp-trad-note')).toBeNull();
    closePopup();
    openWordPopup({ ctx, word: '了', prev: '不', next: '得', anchor: anchorRect(), reading: ['liao3'] });
    expect(text('.pp-trad-note')).toContain('瞭');
  });
  it('gives 干 the spelling of its reading: gàn is 幹, gān is 乾', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '干', anchor: anchorRect(), reading: ['gan4'] });
    expect(text('.pp-trad-note')).toContain('幹');
    expect(text('.pp-trad-note')).not.toContain('乾');
    closePopup();
    openWordPopup({ ctx, word: '干', anchor: anchorRect(), reading: ['gan1'] });
    expect(text('.pp-trad-note')).toContain('乾');
    expect(text('.pp-trad-note')).not.toContain('幹');
  });
  it('saves the word with the spelling that goes with its reading (了 le is not 瞭)', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '了', prev: '吃', next: '饭', anchor: anchorRect() });
    q('.pp-save')!.click();
    await new Promise((r) => setTimeout(r, 50));
    const item = await ctx.store.vocab.get('了');
    expect(item?.trad).toBe('了');
  });
});

describe('proper nouns of the dictionary', () => {
  it('are capitalized and grouped like the names of a book (Cáo Cāo, Wáng Wéi, Zhūgě Liàng)', async () => {
    const { ctx } = await makeCtx();
    for (const [word, want] of [['曹操', 'Cáo Cāo'], ['王維', 'Wáng Wéi'], ['北京', 'Běijīng'], ['諸葛亮', 'Zhūgě Liàng']] as const) {
      openWordPopup({ ctx, word, anchor: anchorRect() });
      expect(text('.pp-pyline .pp-py'), word).toBe(want);
      closePopup();
    }
  });
  it('leave an ordinary word lowercase, and a common reading of a proper-noun spelling too', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    expect(text('.pp-pyline .pp-py')).toBe('yín háng');
  });
});

describe('里 after a number', () => {
  it('leads with the unit of distance, and after a noun with "inside"', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '里', prev: '二十', next: '屯', anchor: anchorRect() });
    expect(text('.pp-defs li')).toMatch(/li|length|distance/i);
    closePopup();
    openWordPopup({ ctx, word: '里', prev: '家', next: '。', anchor: anchorRect() });
    expect(text('.pp-defs li')).toMatch(/in|inside/i);
  });
});
