// A paragraph as the reader shows it (src/ui/reader/shown.ts): the script conversion, and the readings taken from the book's
// own characters when the page shows them converted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inScript, lexiconInScript, originalBeside, segmentShown } from '../../src/ui/reader/shown';
import { buildLexicon } from '../../src/core/lexicon';
import { loadTestDictionary } from '../helpers/data';

const han = (tokens: { kind: string; text: string; pinyin?: string[] }[]) =>
  tokens.filter((t) => t.kind === 'han').map((t) => `${t.text}{${(t.pinyin ?? []).join(' ')}}`);

describe('the script shown', () => {
  it('converts a book written in the other script', async () => {
    const dict = await loadTestDictionary();
    expect(inScript('長江是中國最長的河流', 'simplified', dict, 'traditional')).toBe('长江是中国最长的河流');
    expect(inScript('长江', 'traditional', dict, 'simplified')).toBe('長江');
    expect(inScript('長江', 'original', dict, 'traditional')).toBe('長江');
  });

  it('keeps a book\'s own characters that are standard in the script shown', async () => {
    const dict = await loadTestDictionary();
    // OpenCC reads 乾 as the traditional 干 "dry" and 一坏 as 一坯; in a simplified book they are qián and "once broken".
    expect(dict.toSimplified('乾为天。')).toBe('干为天。');
    expect(inScript('乾为天。', 'simplified', dict, 'simplified')).toBe('乾为天。');
    expect(inScript('东西一坏就扔了。', 'simplified', dict, 'simplified')).toBe('东西一坏就扔了。');
    // A character the dictionary calls a variant of what it becomes is converted all the same (拚命 → 拼命, 沈思 → 沉思).
    expect(inScript('比拚', 'simplified', dict, 'simplified')).toBe('比拼');
    expect(inScript('沈思', 'simplified', dict, 'simplified')).toBe('沉思');
    // The same the other way: 干 "to concern" is traditional too, not only the simplified 幹.
    expect(dict.toTraditional('干我甚事')).toBe('幹我甚事');
    expect(inScript('干我甚事', 'traditional', dict, 'traditional')).toBe('干我甚事');
    // A book in the other script, or of unknown script, is converted as before.
    expect(inScript('乾为天。', 'simplified', dict, 'traditional')).toBe('干为天。');
    expect(inScript('乾为天。', 'simplified', dict)).toBe('干为天。');
  });

  it('keeps 乾 qián in the phrases of the classics, and converts old glyph forms (scripts/data/t2s-extra.tsv)', async () => {
    const dict = await loadTestDictionary();
    expect(dict.toSimplified('孫乾曰：「乾坤倒置。」')).toBe('孙乾曰：「乾坤倒置。」');
    expect(dict.toSimplified('夜觀乾象')).toBe('夜观乾象');
    expect(dict.toSimplified('乾糧')).toBe('干粮');
    expect(dict.toSimplified('偸空躱躱閃閃')).toBe('偷空躲躲闪闪');
    expect(dict.toSimplified('房簷')).toBe('房檐');
  });

  it('converts every row of scripts/data/t2s-extra.tsv as written (public/data/t2s.tsv.gz was rebuilt from it)', async () => {
    const dict = await loadTestDictionary();
    const rows = readFileSync(join(__dirname, '..', '..', 'scripts', 'data', 't2s-extra.tsv'), 'utf8').split('\n')
      .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
    expect(rows.length).toBeGreaterThan(10);
    for (const [from, to] of rows) expect(dict.toSimplified(from)).toBe(to);
  });

  it('converts the book\'s names with the text', async () => {
    const dict = await loadTestDictionary();
    const lex = buildLexicon([{ word: '孫乾', pinyin: 'sun1 qian2', gloss: 'name', kind: 'name', count: 9, enabled: true, origin: 'auto' }]);
    expect(lexiconInScript(lex, 'simplified', dict, 'traditional')!.has('孙乾')).toBe(true);
    expect(lexiconInScript(lex, 'original', dict, 'traditional')).toBe(lex);
  });
});

describe('readings from the book\'s own characters', () => {
  it('lines up the original only character for character', () => {
    expect(originalBeside('国', '國')).toBe('國');
    expect(originalBeside('国', '国')).toBeUndefined();
    expect(originalBeside('a𠀀b', 'a丁b')).toBeUndefined(); // a character that changed plane would shift the offsets
  });

  it('reads 干 as the book wrote it: 乾 gān (dry), 幹 gàn (to do)', async () => {
    const dict = await loadTestDictionary();
    const read = (src: string) => {
      const shown = inScript(src, 'simplified', dict, 'traditional');
      expect(shown).toBe('杯子干了。');
      return han(segmentShown(shown, src, dict)).find((t) => t.startsWith('干{'));
    };
    // The page shows the same text for both; only the book's own character tells them apart.
    expect(read('杯子乾了。')).toBe('干{gan1}');
    expect(read('杯子幹了。')).toBe('干{gan4}');
  });

  it('reads 髮 fà, 隻 zhī and 盡 jìn where the page shows 发 只 尽', async () => {
    const dict = await loadTestDictionary();
    for (const [src, want] of [['披髮仗劍', '发{fa4}'], ['四隻手指', '只{zhi1}'], ['盡數收拾', '尽数{jin4 shu4}']]) {
      const shown = inScript(src, 'simplified', dict, 'traditional');
      expect(han(segmentShown(shown, src, dict))).toContain(want);
    }
  });

  it('cuts the words in the text shown, as before', async () => {
    const dict = await loadTestDictionary();
    const src = '我們在銀行門口見面。';
    const shown = inScript(src, 'simplified', dict, 'traditional');
    expect(segmentShown(shown, src, dict).map((t) => t.text)).toEqual(['我们', '在', '银行', '门口', '见面', '。']);
  });
});
