import { afterEach, describe, expect, it } from 'vitest';
import { ankiTsv, dueLabel, excerpt, exportFileName, filterAndSort, foldSearch, matchesQuery, pinyinBase, reviewLine, splitContext, vocabCsv } from '../../src/ui/vocab/model';
import { setLangForTests } from '../../src/lang/active';
import { fakeEngine } from '../lang/app/fakeEngine';
import { SAMPLE, T0, item } from './helpers';

afterEach(() => setLangForTests('zh'));

describe('search', () => {
  it('pinyin base ignores tones, marks and spacing', () => {
    expect(pinyinBase('ni3 hao3')).toBe('ni hao');
    expect(pinyinBase('nǐ hǎo')).toBe('ni hao');
  });
  it('matches by word, either script, pinyin spellings and gloss', () => {
    const lv = SAMPLE[2];
    for (const q of ['绿', '綠', 'lu4', 'lü', 'lv', 'lu se', 'lǜsè', 'lǜ sè', 'green', 'GREEN']) expect(matchesQuery(lv, q), q).toBe(true);
    expect(matchesQuery(lv, 'blue')).toBe(false);
    expect(matchesQuery(SAMPLE[0], 'nihao')).toBe(true);
    expect(matchesQuery(SAMPLE[0], 'ni3 hao3')).toBe(true);
  });
  it('matches the context sentence and book title', () => {
    expect(matchesQuery(SAMPLE[0], '活着')).toBe(true);
    expect(matchesQuery(SAMPLE[0], '他说')).toBe(true);
  });
  it('requires every term', () => {
    expect(matchesQuery(SAMPLE[0], 'hello study')).toBe(false);
    expect(matchesQuery(SAMPLE[0], '  ')).toBe(true);
  });
});

describe('sort', () => {
  const words = (s: ReturnType<typeof filterAndSort>) => s.map((i) => i.simp);
  it('added: newest first', () => expect(words(filterAndSort(SAMPLE, '', 'added'))).toEqual(['爱', '绿色', '学习', '你好']));
  it('due: soonest first, overdue ahead of later', () => {
    expect(words(filterAndSort(SAMPLE, '', 'due')).at(-1)).toBe('绿色');
  });
  it('pinyin: alphabetical ignoring tone', () => expect(words(filterAndSort(SAMPLE, '', 'pinyin'))).toEqual(['爱', '绿色', '你好', '学习']));
  it('does not mutate the input', () => {
    const copy = SAMPLE.slice();
    filterAndSort(SAMPLE, '', 'pinyin');
    expect(SAMPLE).toEqual(copy);
  });
});

describe('due label', () => {
  it('new, due now and later', () => {
    expect(dueLabel(SAMPLE[0], T0)).toEqual({ text: 'New', state: 'new' });
    const reviewed = item('的', 'de5', 'of', { srs: { due: T0 - 1, interval: 2, ease: 2.5, reps: 2, lapses: 0, last: T0 - 86400000 } });
    expect(dueLabel(reviewed, T0)).toEqual({ text: 'Due now', state: 'due' });
    expect(dueLabel(SAMPLE[2], T0)).toEqual({ text: 'Due in 3d', state: 'later' });
  });
});

describe('context', () => {
  it('splits around the first match in either script', () => {
    expect(splitContext('我爱你', ['爱', '愛'])).toEqual({ before: '我', match: '爱', after: '你' });
    expect(splitContext('我愛你', ['爱', '愛'])).toEqual({ before: '我', match: '愛', after: '你' });
    expect(splitContext('我你', ['爱'])).toBeNull();
  });
  it('excerpt keeps short text and trims long text around the word', () => {
    const short = { before: 'a', match: 'b', after: 'c' };
    expect(excerpt(short, 80)).toEqual(short);
    const long = excerpt({ before: '前'.repeat(100), match: '词', after: '后'.repeat(100) }, 20);
    expect([...long.before].length + [...long.after].length).toBeLessThanOrEqual(21 + 2);
    expect(long.before.startsWith('…') && long.after.endsWith('…')).toBe(true);
  });
  it('excerpt gives unused room to the other side and keeps astral characters whole', () => {
    const e = excerpt({ before: '前', match: '词', after: '𠀀'.repeat(50) }, 10);
    expect(e.before).toBe('前');
    expect([...e.after].filter((c) => c === '𠀀')).toHaveLength(8);
  });
});

describe('exports', () => {
  it('anki: header, bold word, bold in sentence, back has pinyin and gloss', () => {
    const lines = ankiTsv([SAMPLE[0]], 'marks').trim().split('\n');
    expect(lines.slice(0, 3)).toEqual(['#separator:tab', '#html:true', '#tags column:3']);
    const [front, back, tag] = lines[3].split('\t');
    expect(front).toContain('<b>你好</b><br>他说：“<b>你好</b>！”');
    expect(back).toBe('nǐ hǎo<br>hello; hi');
    expect(tag).toBe('globereader::chinese');
  });
  it('anki: escapes html and quotes tabs', () => {
    const it = item('a', 'a1', 'x<y> "q"\tz');
    const row = ankiTsv([it], 'numbers').trim().split('\n')[3];
    expect(row).toContain('x&lt;y&gt; "');
    expect(row.split('\t').length).toBe(3 + 0 + 0 + 0 + (row.match(/\t/g)!.length - 2));
  });
  it('csv: BOM, header, quoting, and formula guard', () => {
    const csv = vocabCsv([item('x', 'a1', '=cmd, "hi"')], 'numbers');
    expect(csv.startsWith('﻿word,traditional,pinyin,meaning,sentence,book,added,due\r\n')).toBe(true);
    expect(csv).toContain(`"'=cmd, ""hi"""`);
    expect(csv).toContain('2026-10-01');
  });
});

describe('search in other languages', () => {
  it('ignores case and accents in Latin letters, but keeps й apart from и and the kana voicing marks', () => {
    setLangForTests('de');
    const vorwort = item('Vorwort', '', 'foreword', { id: 'Vorwort' });
    for (const q of ['Vorwort', 'vorwort', 'Vorw', 'VORW', 'foreword']) expect(matchesQuery(vorwort, q), q).toBe(true);
    const boese = item('böse', '', 'evil', { context: { sentence: 'Ach, was muß man oft von bösen Kindern hören!' } });
    expect(matchesQuery(boese, 'bose')).toBe(true);
    expect(matchesQuery(boese, 'muss')).toBe(true);
    expect(matchesQuery(boese, 'ACH')).toBe(true);
    setLangForTests('es');
    expect(matchesQuery(item('también', '', 'also'), 'tambien')).toBe(true);
    expect(matchesQuery(item('también', '', 'also'), 'TAMBIÉN')).toBe(true);
    setLangForTests('ru');
    expect(matchesQuery(item('мой', '', 'my'), 'мои')).toBe(false);
    expect(matchesQuery(item('мой', '', 'my'), 'мой')).toBe(true);
    expect(matchesQuery(item('молоко́', '', 'milk'), 'молоко')).toBe(true);
    expect(matchesQuery(item('ёлка', '', 'fir tree'), 'елка')).toBe(true);
    expect(foldSearch('が', 'ja')).toBe('が');
    expect(foldSearch('Ãé', 'zh')).toBe('ãé');
  });

  it('leaves the Chinese pinyin search as it was', () => {
    const nv = item('女', 'nü3', 'woman');
    for (const q of ['nv', 'nü', 'nu3', 'nǚ', '女']) expect(matchesQuery(nv, q), q).toBe(true);
  });
});

describe('the word in its sentence, other languages', () => {
  it('marks a whole word in any case, never one inside another', () => {
    setLangForTests('es');
    expect(splitContext('Había una vez un hombre.', ['un'])).toEqual({ before: 'Había una vez ', match: 'un', after: ' hombre.' });
    expect(splitContext('La tortuga gigante', ['la'])).toEqual({ before: '', match: 'La', after: ' tortuga gigante' });
    expect(splitContext('Había una vez un hombre.', ['había una vez'])!.match).toBe('Había una vez');
    expect(splitContext('Una vez', ['un'])).toBeNull();
    // Chinese keeps finding the word anywhere.
    setLangForTests('zh');
    expect(splitContext('我爱你', ['爱'])!.match).toBe('爱');
  });

  it('finds an inflected form by the saved word\'s key, with the engine', () => {
    setLangForTests('es', fakeEngine('es'));
    expect(splitContext('Fuimos a la casa.', ['ir'], 'ir')).toEqual({ before: '', match: 'Fuimos', after: ' a la casa.' });
    expect(splitContext('Fuimos a la casa.', ['ir'])).toBeNull();
  });

  it('shortens a long sentence between words, never inside one', () => {
    setLangForTests('es');
    const sentence = 'Pero un día se enfermó, y los médicos le dijeron que solamente yéndose al campo podría curarse de su enfermedad.';
    const parts = splitContext(sentence, ['médicos'])!;
    const e = excerpt(parts, 40);
    const words = new Set(sentence.split(/[\s,.]+/));
    const shown = `${e.before}${e.match}${e.after}`.replace(/…/g, '').split(/[\s,.]+/).filter(Boolean);
    for (const w of shown) expect(words.has(w), w).toBe(true);
    expect(e.before.startsWith('…') && e.after.endsWith('…')).toBe(true);
    expect(e.match).toBe('médicos');
  });
});

describe('exports in other languages', () => {
  it('gives each language its own columns', () => {
    setLangForTests('es');
    const es = vocabCsv([item('tortuga', '', 'turtle', { context: { sentence: 'La tortuga gigante', bookTitle: 'Cuentos' } })], 'marks');
    expect(es.split('\r\n')[0]).toBe('\uFEFFword,meaning,sentence,book,added,due');
    expect(es.split('\r\n')[1]).toBe('tortuga,turtle,La tortuga gigante,Cuentos,2026-10-01,2026-10-01');
    setLangForTests('ja');
    const ja = vocabCsv([item('食べる', 'たべる', 'to eat')], 'marks');
    expect(ja.split('\r\n')[0]).toBe('\uFEFFword,reading,meaning,sentence,book,added,due');
    expect(ja.split('\r\n')[1].startsWith('食べる,たべる,to eat,')).toBe(true);
    setLangForTests('zh');
    expect(vocabCsv([SAMPLE[3]], 'marks').split('\r\n')[0]).toBe('\uFEFFword,traditional,pinyin,meaning,sentence,book,added,due');
  });

  it('starts an Anki back on the meaning when there is no reading, and tags the language', () => {
    setLangForTests('es');
    const [, back, tag] = ankiTsv([item('perro', '', 'dog', { context: { sentence: 'Un perro grande.' } })], 'marks').trim().split('\n')[3].split('\t');
    expect(back).toBe('dog');
    expect(tag).toBe('globereader::spanish');
    setLangForTests('ja');
    expect(ankiTsv([item('食べる', 'たべる', 'to eat')], 'marks').trim().split('\n')[3].split('\t')[1]).toBe('たべる<br>to eat');
    // Kana that only repeat the word say nothing.
    expect(ankiTsv([item('なる', 'なる', 'to become')], 'marks').trim().split('\n')[3].split('\t')[1]).toBe('to become');
  });

  it('dates files and rows by this device\'s calendar, not UTC', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      // 8 PM on Nov 9 in California is already Nov 10 in UTC.
      const evening = new Date(2026, 10, 9, 20, 0).getTime();
      expect(new Date(evening).toISOString().slice(0, 10)).toBe('2026-11-10');
      setLangForTests('es');
      expect(exportFileName('vocab', evening)).toBe('globereader-spanish-vocab-2026-11-09.csv');
      expect(exportFileName('anki', evening)).toBe('globereader-spanish-anki-2026-11-09.txt');
      const row = vocabCsv([item('gato', '', 'cat', { addedAt: evening, srs: { due: evening, interval: 0, ease: 2.5, reps: 0, lapses: 0, last: 0 } })], 'marks').split('\r\n')[1];
      expect(row).toBe('gato,cat,,,2026-11-09,2026-11-09');
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });
});

describe('the line under the Vocabulary title', () => {
  it('adds up to the Review button', () => {
    expect(reviewLine(2, 2, 3)).toBe('2 words saved, 2 due. 3 new from words you looked up.');
    expect(reviewLine(3, 0, 2)).toBe('3 words saved, none due. 2 new from words you looked up.');
    expect(reviewLine(0, 0, 3)).toBe('3 new from words you looked up.');
    expect(reviewLine(6, 2, 0)).toBe('6 words saved, 2 due for review');
    expect(reviewLine(1, 0, 0)).toBe('1 word saved, none due for review');
    expect(reviewLine(0, 0, 0)).toBe('');
  });
});
