// What the reader teaches a language engine a book's names from (src/ui/reader/bookStart.ts), fed to the real Spanish
// engine as the reader feeds it: Platero y yo, opened at its first chapter, where Platero only ever starts a sentence.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bookStartText, chapterText, startChapters, START_CAP, START_CHARS } from '../../src/ui/reader/bookStart';
import { setLangForTests } from '../../src/lang/active';
import { importText } from '../../src/import';
import type { Chapter } from '../../src/types';
import { loadLang, tok } from '../lang/spaced/load';

afterAll(() => setLangForTests('zh'));

async function platero(): Promise<Chapter[]> {
  setLangForTests('es');
  const md = await readFile(join(__dirname, '..', '..', 'public', 'samples', 'es', 'platero-y-yo.md'), 'utf8');
  return importText(md, 'Platero y yo', 'Juan Ramón Jiménez', true).chapters;
}

const FIRST = 'Platero es pequeño, peludo, suave; tan blando por fuera, que se diría todo de algodón, que no lleva huesos.';

describe('which chapters a book begins with', () => {
  it('reads the chapter opened, the first three, then a spread, each once', () => {
    expect(startChapters(1, 0)).toEqual([0]);
    expect(startChapters(4, 2)).toEqual([2, 0, 1, 3]);
    const many = startChapters(100, 30);
    expect(many.slice(0, 4)).toEqual([30, 0, 1, 2]);
    expect(new Set(many).size).toBe(many.length);
    expect(many.length).toBeGreaterThan(6); // the spread reaches the back of the book
    expect(Math.max(...many)).toBeGreaterThan(80);
  });

  it('takes the chapter opened whole and a slice of the others, within the cap', async () => {
    const long = (n: number): Chapter => ({ title: `c${n}`, blocks: [{ t: 'p', text: `${'palabra '.repeat(2000)}fin${n}` }] });
    const text = await bookStartText(40, 5, async (i) => long(i));
    expect(text).toContain('fin5'); // the opened chapter, whole
    expect(text).not.toContain('fin0'); // the others, only their first START_CHARS
    expect(text.length).toBeLessThanOrEqual(chapterText(long(5)).length + START_CAP + 40);
    expect(chapterText(long(1), START_CHARS)).toHaveLength(START_CHARS);
  });

  it('leaves out a chapter that cannot be read', async () => {
    const text = await bookStartText(3, 0, async (i) => {
      if (i === 1) throw new Error('broken');
      return { title: '', blocks: [{ t: 'p', text: `capítulo ${i}` }] };
    });
    expect(text).toBe('capítulo 0\ncapítulo 2');
  });
});

describe('Platero y yo opened at chapter I', () => {
  it('reads Platero as the donkey on the first page, not "silversmith"', async () => {
    const chapters = await platero();
    const opened = chapters.findIndex((c) => c.blocks.some((b) => 'text' in b && b.text.startsWith('Platero es pequeño')));
    expect(opened).toBeGreaterThanOrEqual(0);
    const eng = await loadLang('es');
    // What the reader used to give it: the opened chapter alone, where Platero only starts sentences.
    eng.beginBook?.(chapterText(chapters[opened]));
    expect(tok(eng, FIRST, 'Platero').name).toBeFalsy();
    eng.beginBook?.(await bookStartText(chapters.length, opened, async (i) => chapters[i]));
    const t = tok(eng, FIRST, 'Platero');
    expect(t.name).toBe(true);
    expect(eng.hint(t)).toBeUndefined();
    eng.beginBook?.();
  });

  it('still reads the words that start its sentences as words', async () => {
    const chapters = await platero();
    const eng = await loadLang('es');
    eng.beginBook?.(await bookStartText(chapters.length, 0, async (i) => chapters[i]));
    const starts: [string, string][] = [
      ['Una cosa enorme y tibia avanza, de pronto, como una proa viva, sobre mi hombro...', 'Una'],
      ['Era la comida de los niños.', 'Era'],
      ['Este cae sobre una rama, se va y la deja temblando.', 'Este'],
      ['Y quedan, allá lejos, por las altas eras, unos agudos gritos.', 'Y'],
    ];
    for (const [sentence, word] of starts) expect(tok(eng, sentence, word).name, word).toBeFalsy();
    eng.beginBook?.();
  });
});
