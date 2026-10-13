import { describe, expect, it } from 'vitest';
import {
  codePointLabel, groupByReading, orderGroups, parseDefinition, plainDefinition, sameReading, shortGloss, splitClassifiers,
} from '../../src/ui/popup/defs';
import { loadTestDictionary } from '../helpers/data';

describe('parseDefinition', () => {
  it('turns trad|simp[pinyin] into a cross-reference', () => {
    const parts = parseDefinition('variant of 瞭|了[liao3]');
    expect(parts).toEqual([
      { t: 'text', s: 'variant of ' },
      { t: 'ref', simp: '了', trad: '瞭', pinyin: 'liao3' },
    ]);
  });

  it('handles a reference without a traditional form and keeps surrounding text', () => {
    const parts = parseDefinition('used in 自個兒|自个儿[zi4 ge3 r5]; see also 个[ge4]');
    const refs = parts.filter((p) => p.t === 'ref');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ simp: '自个儿', trad: '自個兒', pinyin: 'zi4 ge3 r5' });
    expect(refs[1]).toMatchObject({ simp: '个', trad: '个' });
    expect(parts.map((p) => (p.t === 'text' ? p.s : p.simp)).join('')).toBe('used in 自个儿; see also 个');
  });

  it('finds astral-plane headwords', () => {
    const parts = parseDefinition('used in 𰻝𰻝面[biang2 biang2 mian4]');
    expect(parts.find((p) => p.t === 'ref')).toMatchObject({ simp: '𰻝𰻝面' });
  });

  it('leaves plain text alone', () => {
    expect(parseDefinition('to finish')).toEqual([{ t: 'text', s: 'to finish' }]);
    expect(parseDefinition('(math.) [a]')).toEqual([{ t: 'text', s: '(math.) [a]' }]);
  });
});

describe('classifiers', () => {
  it('pulls CL: lines out of the definition list', () => {
    const { rest, classifiers } = splitClassifiers(['bank', 'CL:家[jia1],個|个[ge4]']);
    expect(rest).toEqual(['bank']);
    expect(classifiers).toEqual([
      { simp: '家', trad: '家', pinyin: 'jia1' },
      { simp: '个', trad: '個', pinyin: 'ge4' },
    ]);
  });

  it('reads the real dictionary entry for 银行', async () => {
    const dict = await loadTestDictionary();
    const { rest, classifiers } = splitClassifiers(dict.lookup('银行')[0].defs);
    expect(rest).toContain('bank');
    expect(classifiers.map((c) => c.simp)).toEqual(['家', '个']);
  });
});

describe('plain text and glosses', () => {
  it('drops pinyin brackets and CL notes', () => {
    expect(plainDefinition('inn; old-style hotel (CL:家[jia1])')).toBe('inn; old-style hotel');
    expect(plainDefinition('see 瞭|了[liao3]')).toBe('see 了');
  });

  it('builds a short gloss without variant-of noise', async () => {
    const dict = await loadTestDictionary();
    const gloss = shortGloss(dict.lookup('了'));
    expect(gloss).toContain('completed action marker');
    expect(gloss).not.toMatch(/variant of/);
    expect(gloss.length).toBeLessThanOrEqual(120);
  });
});

describe('readings', () => {
  it('groups rows by pinyin and keeps file order', async () => {
    const dict = await loadTestDictionary();
    const groups = groupByReading(dict.lookup('了'));
    expect(groups.map((g) => g.pinyin)).toEqual(['le5', 'liao3', 'liao4']);
    expect(groups[1].defs.length).toBeGreaterThan(2); // 了 and 瞭 rows merged
  });

  it('puts the in-sentence reading first', async () => {
    const dict = await loadTestDictionary();
    const groups = groupByReading(dict.lookup('了'));
    const ordered = orderGroups(groups, ['liao3']);
    expect(ordered.matched).toBe(true);
    expect(ordered.groups[0].pinyin).toBe('liao3');
    expect(ordered.groups).toHaveLength(groups.length);
  });

  it('compares readings ignoring case and spacing', () => {
    expect(sameReading('Bei3 jing1', ['bei3', 'jing1'])).toBe(true);
    expect(sameReading('lu:4', ['lü4'])).toBe(true);
    expect(sameReading('ni3 hao3', ['ni3'])).toBe(false);
  });

  it('formats code points', () => {
    expect(codePointLabel('𠀀')).toBe('U+20000');
    expect(codePointLabel('好')).toBe('U+597D');
  });
});
