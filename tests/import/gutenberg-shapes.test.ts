// @vitest-environment jsdom
// Books shaped like the Project Gutenberg books that imported badly (tests/fixtures/import/gutenberg-shapes): each opens on its
// own text, keeps none of Gutenberg's frame, and gets the chapters its marks call for.
import { afterEach, describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { transcriberNoteToEnd } from '../../src/import/epub';
import { setLangForTests } from '../../src/lang/active';
import type { LangId } from '../../src/lang/types';
import type { Block, ImportedBook } from '../../src/types';
import * as shapes from '../fixtures/import/gutenberg-shapes/shapes';
import { asFile, makeEpub, type Files } from './helpers';

afterEach(() => setLangForTests(null));

async function load(lang: LangId, files: Files): Promise<ImportedBook> {
  setLangForTests(lang);
  return importFile(asFile(makeEpub(files), 'book.epub'));
}

const text = (b: Block) => ('text' in b ? b.text : '');
const blocks = (book: ImportedBook) => book.chapters.flatMap((c) => c.blocks);
/** The first block with text. */
const firstText = (book: ImportedBook) => text(blocks(book).find((b) => text(b))!);

/** What every shape must show: none of Gutenberg's frame, and no license chapter. */
function framed(book: ImportedBook) {
  expect(blocks(book).filter((b) => /Project Gutenberg|START OF THE|END OF THE|^Credits:|^Language:/i.test(text(b))).map(text)).toEqual([]);
  expect(book.chapters[book.chapters.length - 1].title).not.toMatch(/LICENSE/);
}

describe('Gutenberg shapes', () => {
  it('Die Verwandlung: a title page in capitals goes', async () => {
    const book = await load('de', shapes.kafka());
    framed(book);
    expect(book.chapters.map((c) => c.title)).toEqual(['I.', 'II.']);
    expect(text(book.chapters[0].blocks[1])).toMatch(/^Am Morgen ging/);
  });

  it('Madame Bovary: the author page and the title page go, and a contents run together is no title', async () => {
    const book = await load('fr', shapes.bovary());
    framed(book);
    expect(book.chapters[0].title).toBe('À Marie-Antoine Exemple');
    expect(firstText(book)).toBe('À');
    expect(blocks(book).some((b) => /PREMIÈRE PARTIE I II/.test(text(b)) || /^Table des matières$/.test(text(b)))).toBe(false);
    expect(book.chapters.map((c) => c.title)).toContain('PREMIÈRE PARTIE');
  });

  it('Dom Casmurro: each chapter keeps its own number', async () => {
    const book = await load('pt', shapes.casmurro());
    framed(book);
    expect(book.chapters[0].blocks[0]).toMatchObject({ t: 'h', text: 'I. Do titulo.' });
    expect(book.chapters[1].blocks[0]).toMatchObject({ t: 'h', text: 'II. Do livro.' });
    expect(book.chapters[1].title).toBe('II. Do livro.');
    // No chapter ends on the next one's number, and the INDICE of links is gone; FIM closes the last chapter.
    for (const c of book.chapters.slice(0, -1)) expect(text(c.blocks[c.blocks.length - 1])).not.toMatch(/^[IVX]+$/);
    expect(book.chapters.map((c) => c.title)).not.toContain('INDICE');
    const last = book.chapters[book.chapters.length - 1];
    expect(last.title).toBe('VI. Tio Cosme.');
    expect(text(last.blocks[last.blocks.length - 1])).toBe('FIM');
  });

  it('Pinocchio: a title page of 19 blocks goes, its picture moves on, the INDICE goes, and long titles stay whole', async () => {
    const book = await load('it', shapes.pinocchio());
    framed(book);
    expect(book.chapters[0].title).toMatch(/^I\. Come andò/);
    expect(book.chapters[0].blocks.map((b) => b.t).slice(0, 3)).toEqual(['h', 'img', 'p']);
    expect(book.chapters.map((c) => c.title)).toContain(shapes.PINOCCHIO_LONG_TITLE);
    expect(book.chapters.map((c) => c.title)).not.toContain('INDICE');
    expect(blocks(book).some((b) => /^(?:INDICE|PROPRIETÀ LETTERARIA|Pag\. \d+)$/.test(text(b)))).toBe(false);
    expect(book.chapters[book.chapters.length - 1].title).toBe('Nota del Trascrittore');
  });

  it('Don Quijote: the contents list in the title-page file goes with the title page', async () => {
    const book = await load('es', shapes.quijote());
    framed(book);
    expect(book.chapters[0].title).toBe('TASA');
    expect(blocks(book).some((b) => /^Que trata de/.test(text(b)) || /^Segunda parte del/.test(text(b)))).toBe(false);
    expect(book.chapters.map((c) => c.title.split('.')[0]).slice(1)).toEqual(['Capítulo primero', 'Capítulo II', 'Capítulo III', 'Capítulo primero', 'Capítulo II', 'Capítulo III']);
  });

  it('Pride and Prejudice: drop caps join their word, captions leave the headings, the lists of links go', async () => {
    const book = await load('en', shapes.pride());
    framed(book);
    const titles = book.chapters.map((c) => c.title);
    expect(titles).toEqual(['PRIDE. and EXEMPLE', 'Chapter I.', 'CHAPTER II.', 'CHAPTER III.']);
    const ch2 = book.chapters[2];
    expect(ch2.blocks[0]).toMatchObject({ t: 'h', text: 'CHAPTER II.' });
    expect(ch2.blocks.find((b) => b.t === 'p')).toMatchObject({ text: expect.stringMatching(/^MR\. BENNET was among/) });
    expect(book.chapters[3].blocks.find((b) => b.t === 'p')).toMatchObject({ text: expect.stringMatching(/^“I HAVE been thinking/) });
    // No letter left as a picture, and the caption is the heading picture's alt.
    expect(blocks(book).filter((b) => b.t === 'img' && /^\s*\p{P}?\p{L}{1,2}\s*$/u.test(b.alt ?? ''))).toEqual([]);
    expect(ch2.blocks[1]).toMatchObject({ t: 'img', alt: 'I hope he will like it.' });
    // The line of links and the list of illustrations are gone; the preface stays.
    expect(blocks(book).some((b) => /^(?:PREFACE\.|List of Illustrations\.|Chapter: I\.|Frontispiece|PAGE)/.test(text(b)))).toBe(false);
    expect(book.chapters[0].blocks.filter((b) => b.t === 'p').length).toBeGreaterThan(3);
  });

  it('吶喊: no header, no license, and no chapter titled by a line cut mid-sentence', async () => {
    for (const frame of [true, false]) {
      const book = await load('zh', shapes.nahan(frame));
      framed(book);
      expect(firstText(book)).toBe('《魯迅︰吶喊》');
      expect(blocks(book).some((b) => /Produced by|Han Huei/.test(text(b)))).toBe(false);
      for (const c of book.chapters) expect(c.title).not.toMatch(/[，、]|S城|^第一回是/);
      // The lines set as h5 are text again: they join the paragraph they were cut from.
      expect(blocks(book).filter((b) => b.t === 'h')).toEqual([]);
    }
  });

  it('西遊記: the 第N回 lines in plain paragraphs over several files make its 100 chapters', async () => {
    const book = await load('zh', shapes.xiyouji());
    framed(book);
    expect(book.chapters).toHaveLength(100);
    expect(book.chapters[0].title).toMatch(/^第一回 /);
    expect(book.chapters[99].title).toMatch(/^第一百回 /);
    expect(book.chapters.every((c) => c.blocks[0].t === 'h' && /^第.+回/.test(text(c.blocks[0])))).toBe(true);
  });

  it('羅生門: one block per indented paragraph, no credit page, the English note after the story', async () => {
    const book = await load('ja', shapes.rashomon());
    framed(book);
    expect(book.chapters).toHaveLength(1);
    const [c] = book.chapters;
    expect(c.title).toBe('雨の門');
    expect(c.blocks[0]).toEqual({ t: 'h', level: 1, text: '雨の門' });
    const story = c.blocks.filter((b) => b.t === 'p').slice(1);
    expect(story).toHaveLength(shapes.RASHOMON_PARAGRAPHS);
    expect(story.filter((b) => text(b).includes('　'))).toEqual([]);
    expect(blocks(book).some((b) => /Produced by|AME NO MON/.test(text(b)))).toBe(false);
    expect(c.blocks.slice(-3).map((b) => b.t)).toEqual(['quote', 'quote', 'quote']);
    expect(text(c.blocks[c.blocks.length - 1])).toMatch(/^This file is encoded/);
  });

  it('leaves a Russian novel that opens on a paragraph in French as it is', () => {
    const c = { title: 'I', blocks: [{ t: 'h', level: 2, text: 'I' }, { t: 'p', text: 'Eh bien, mon prince. Gênes et Lucques ne sont plus que des apanages de la famille.' },
      { t: 'p', text: 'Так говорила в июле 1805 года известная Анна Павловна Шерер, фрейлина и приближенная императрицы.' }] as Block[] };
    expect(transcriberNoteToEnd([c], /\p{Script=Cyrillic}/u)).toEqual([c]);
  });

  it('A First Spanish Reader: the contents goes and the preface that shares its chapter stays', async () => {
    const book = await load('es', shapes.reader());
    framed(book);
    expect(blocks(book).some((b) => text(b).startsWith(shapes.READER_PREFACE))).toBe(true);
    expect(blocks(book).some((b) => /^CONTENTS$/.test(text(b)))).toBe(false);
    expect(book.chapters.map((c) => c.title)).toEqual(['PREFACE', '1. LA ESCUELA', '2. EL DISCÍPULO', '3. LA SALA DE CLASE']);
    expect(book.chapters[0].blocks.filter((b) => /^\d\. /.test(text(b)))).toEqual([]);
  });
});
