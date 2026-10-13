// Which sense leads: never a surname, an abbreviation, a variant pointer or a sound word, and the words the books use
// most lead with the sense the books use (public/data/book-words.tsv.gz). Real dictionary.
import { describe, expect, it } from 'vitest';
import { defWeakness, entriesForReading, rankEntries } from '../../src/core/reading';
import { cleanDefinitionText, leadGloss, plainDefinition, shortGloss } from '../../src/ui/popup/defs';
import { loadTestDictionary } from '../helpers/data';

const dictP = loadTestDictionary();
/** The lead gloss as the popup shows it for `word` with the reading the dictionary would pick. */
async function lead(word: string, syllables?: string[]): Promise<string> {
  const d = await dictP;
  return leadGloss(entriesForReading(d.lookup(word), syllables ?? d.pinyinFor(word), word), word);
}

describe('no weak lead for single characters', () => {
  // The characters the review found leading with a surname, an abbreviation, a variant pointer or a sound word.
  const chars = [...'后冷枪严坐忽从业莫休寿新煮蛇帮劫碗岁当马华贵比明回家年官国力何花园武景林本因韩奴才'];
  for (const ch of chars) {
    it(`${ch} leads with a real meaning`, async () => {
      const g = await lead(ch);
      expect(g, ch).not.toBe('');
      expect(g, ch).not.toMatch(/^(surname|abbr\.|(old |archaic )?variant of|\(onom\.\)|used in|short name|same as)/i);
      expect(g, ch).not.toMatch(/\b(Malaysia|Xinjiang|Guizhou|Belgium|Ming Dynasty|Hui ethnic)\b/);
    });
  }
  it('prefers the common sense where the book does', async () => {
    expect(await lead('后')).toMatch(/^after/);
    expect(await lead('当')).toMatch(/^to be|^to act|^to manage|^when/);
    expect(await lead('回')).toMatch(/^to go back/);
    expect(await lead('年')).toBe('year');
    expect(await lead('因')).toBe('because of; owing to');
    expect(await lead('只', ['zhi1'])).toMatch(/^classifier for birds/);
  });
});

describe('words the books use most', () => {
  const cases: [string, RegExp][] = [
    ['行者', /^Pilgrim/], ['八戒', /^Zhu Bajie/], ['只見', /^\(storytelling\) suddenly/], ['姨娘', /^father's concubine/],
    ['師父', /^master/], ['三藏', /^Tripitaka/], ['鳳姐', /^Wang Xifeng/], ['寶玉', /^Jia Baoyu/], ['離合', /^parting and reunion/],
    ['一番', /^a bout of/], ['心里', /^in one's heart/], ['姑娘', /^girl|^young/], ['站', /^to stand/], ['道', /^to say/],
  ];
  for (const [w, re] of cases) it(`${w}`, async () => expect(await lead(w)).toMatch(re));
  it('罷 as the particle in the book, and as "to stop" when it is 罷了 or 作罷', async () => {
    expect(await lead('罷', ['ba5'])).toMatch(/^\(final particle\)/);
    expect(await lead('罷', ['ba4'])).toMatch(/^to stop/);
  });
  it('花兒 is flowers, not the Gansu folk song', async () => {
    expect(await lead('花兒', ['hua1', 'er2'])).toMatch(/^flower/);
  });
  it('a surname that matches the reading on the page is not replaced by an unrelated sense', async () => {
    expect(await lead('賈', ['jia3'])).toBe('surname Jia'); // 賈政, not "merchant" (gǔ)
    expect(await lead('賈', ['gu3'])).toBe('merchant');
  });
  it('book senses are listed first but the dictionary senses stay behind them', async () => {
    const d = await dictP;
    const defs = d.lookup('道').find((e) => e.pinyin === 'dao4')!.defs;
    expect(defs[0]).toMatch(/^to say/);
    expect(defs.join(' ')).toContain('road; path');
    expect(d.meta.counts.bookWordsLoaded).toBeGreaterThan(100);
  });
  it('a variant spelling no list has still cuts as one word', async () => {
    const d = await dictP;
    expect(d.hasWord('鴻濛')).toBe(true);
    expect(d.freq('鴻濛')).toBeGreaterThan(0);
  });
});

describe('sense ranking', () => {
  it('puts a "(onom.) dong" row behind a real meaning even when its second item reads like one', async () => {
    const d = await dictP;
    const ranked = rankEntries(d.lookup('当'), '当');
    expect(ranked[0].defs[0]).not.toMatch(/onom/);
    expect(defWeakness('(onom.) dong')).toBeGreaterThan(0);
    expect(defWeakness('old variant of 因[yin1]')).toBeGreaterThan(0);
    expect(defWeakness('surname Hou')).toBeGreaterThan(0);
    expect(defWeakness('abbr. for Xinjiang')).toBeGreaterThan(0);
    expect(defWeakness('cause')).toBe(0);
  });
  it('the saved vocab gloss and the card gloss agree on 因', async () => {
    const d = await dictP;
    expect(shortGloss(entriesForReading(d.lookup('因'), ['yin1'], '因'), 120, true)).toMatch(/^because of/);
    expect(shortGloss(d.lookup('因'))).not.toMatch(/variant/);
  });
});

describe('raw CEDICT notation', () => {
  it('drops a bare trad|simp pair and spells out short tags', () => {
    expect(cleanDefinitionText('Han, one of the Seven Hero States 戰國七雄|战国七雄')).toBe('Han, one of the Seven Hero States 战国七雄');
    expect(cleanDefinitionText('fig. flunkey')).toBe('figuratively flunkey');
    expect(cleanDefinitionText('(Tw) pharmacist')).toBe('(Taiwan) pharmacist');
    expect(cleanDefinitionText('(coll.) to chat')).toBe('(colloquial) to chat');
    expect(cleanDefinitionText('lit. to bear fruit')).toBe('literally to bear fruit');
  });
  it('keeps cross-references with pinyin for plainDefinition', () => {
    expect(plainDefinition('variant of 瞭|了[liao3]')).toBe('variant of 了');
    expect(plainDefinition('fig. flunkey')).toBe('figuratively flunkey');
  });
  it('the real entry for 奴才 and 韩 read plainly', async () => {
    const d = await dictP;
    expect(shortGloss(d.lookup('奴才'))).not.toMatch(/\bfig\./);
    expect(shortGloss(d.lookup('韩'))).not.toMatch(/\|/);
  });
});
