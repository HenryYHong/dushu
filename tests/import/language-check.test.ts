// @vitest-environment jsdom
// Which library a book is let into: the whole book's language decides (a learner's edition with a long English introduction
// belongs in the Spanish library), and a file in another script, or in a Western single-byte encoding, hears where it belongs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importFile, importText } from '../../src/import';
import { decodeText } from '../../src/import/encoding';
import { setLangForTests } from '../../src/lang/active';
import { asFile, prose } from './helpers';

afterEach(() => setLangForTests(null));

const EN = [
  'The author of these stories was born in a small town in the south, and he spent most of his short life in poverty.',
  'His friends remembered him as a quiet man who wrote at night and read everything that he could find in the old library.',
  'In this edition the notes at the end of the book explain the harder words, and the vocabulary gives the meaning of each one.',
  'The reader who has studied the language for a year should find that the first legends are easy to follow with a little help.',
];
const ES = [
  'En una casa vieja de la ciudad vivía un caballero que pasaba las noches mirando las estrellas desde la ventana.',
  'Su madre le decía que no era bueno para la salud, pero él no la escuchaba y seguía con sus sueños de siempre.',
  'Una tarde de otoño salió por el camino del río y encontró a una mujer muy hermosa que lloraba junto a las piedras.',
  'Los vecinos del pueblo contaban que en aquel lugar se veían luces por la noche, y nadie quería pasar por allí.',
];
const FR = [
  'Le matin, le jeune homme traversa la place du village et salua le vieux marchand qui ouvrait sa boutique.',
  'Elle regardait la pluie tomber sur le jardin et pensait à la lettre qu’elle n’avait pas encore écrite.',
  'Il y avait dans la maison une odeur de pain chaud et de bois brûlé que personne ne remarquait plus.',
];

/** About `chars` characters of a pool's sentences, as paragraphs. */
function text(pool: string[], chars: number, seed = 0): string {
  const paras: string[] = [];
  let n = 0;
  for (let i = seed; n < chars; i++) {
    const p = [0, 1, 2].map((k) => pool[(i + k) % pool.length]).join(' ');
    paras.push(p);
    n += p.length;
  }
  return paras.join('\n\n');
}

/** A learner's edition: 50,000 characters of English introduction, Spanish stories, an English glossary. */
function learnersEdition(): string {
  const stories = Array.from({ length: 5 }, (_, i) => `Capítulo ${i + 1}\n\n${text(ES, 8000, i)}`).join('\n\n');
  return `Introduction\n\n${text(EN, 50000)}\n\n${stories}\n\nVocabulary\n\n${text(EN, 10000, 2)}`;
}

/** Windows-1252 bytes for text in that encoding's range (curly quotes and dashes included). */
function cp1252(s: string): Uint8Array {
  const extra: Record<string, number> = { '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '—': 0x97, '–': 0x96, '…': 0x85, 'œ': 0x9c };
  return Uint8Array.from([...s].map((c) => extra[c] ?? c.charCodeAt(0)));
}

describe('the language of a whole book', () => {
  it('takes a learner\'s edition with a long English introduction into the Spanish library, and not into the French one', () => {
    setLangForTests('es');
    expect(importText(learnersEdition()).chapters.length).toBeGreaterThan(0);
    setLangForTests('fr');
    expect(() => importText(learnersEdition())).toThrow(/looks like it is in English, and this library is French/);
  });

  it('still refuses a plainly English or French book in the Spanish library', () => {
    setLangForTests('es');
    expect(() => importText(text(EN, 30000))).toThrow(/looks like it is in English, and this library is Spanish/);
    expect(() => importText(text(FR, 30000))).toThrow(/looks like it is in French/);
  });
});

describe('a file in another script', () => {
  it('says where a Chinese or Japanese book belongs in the Spanish library, and an English one in the Chinese library', async () => {
    setLangForTests('es');
    expect(() => importText(prose(600))).toThrow(/looks like it is in Chinese, and this library is Spanish/);
    expect(() => importText('ある日の暮方の事である。一人の下人が、羅生門の下で雨やみを待っていた。広い門の下には、この男のほかに誰もいない。'.repeat(8)))
      .toThrow(/looks like it is in Japanese/);
    setLangForTests('zh');
    await expect(importFile(asFile(new TextEncoder().encode(text(EN, 3000)), 'a.txt'))).rejects.toThrow(/looks like it is in English, and this library is Chinese/);
    // Japanese text passes the Chinese library's own check, as before.
    expect(importText('ある日の暮方の事である。一人の下人が、羅生門の下で雨やみを待っていた。'.repeat(8)).chapters.length).toBe(1);
  });

  it('keeps saying only that there is no text when it cannot tell the language', () => {
    setLangForTests('zh');
    expect(() => importText('Only English here, nothing else to see.')).toThrow(/^No Chinese text found in this file\. This library reads books written in Chinese\.$/);
  });
});

describe('a Western file in the Chinese library', () => {
  const fx = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'import', name));

  it('reads Windows-1252 as what it is, so the library says which language it is in', async () => {
    setLangForTests('zh');
    const english = cp1252(`“It’s late,” she said — and the ‘old’ house was quiet…\n\n${text(EN, 3000)}`);
    expect(decodeText(english).encoding).toBe('windows-1252');
    await expect(importFile(asFile(english, 'en.txt'))).rejects.toThrow(/looks like it is in English/);
    const french = cp1252(`Élise était déjà là, près de la fenêtre, à côté du château.\n\n${text(FR, 3000)}`);
    await expect(importFile(asFile(french, 'fr.txt'))).rejects.toThrow(/looks like it is in French/);
  });

  it('decodes the UTF-16 without a byte-order mark, GB18030 and Big5 files as before', () => {
    setLangForTests('zh');
    expect(decodeText(fx('simplified.utf16le.nobom.txt')).encoding).toBe('utf-16le');
    expect(decodeText(fx('simplified.gb18030.txt')).encoding).toBe('gb18030');
    expect(decodeText(fx('traditional.big5.txt')).encoding).toBe('big5');
    expect(decodeText(fx('traditional.gb18030.txt')).encoding).toBe('gb18030');
    // The same text as UTF-16 big-endian without its byte-order mark.
    const be = fx('simplified.utf16be.bom.txt').subarray(2);
    expect(decodeText(be)).toMatchObject({ encoding: 'utf-16be', text: decodeText(fx('simplified.utf16be.bom.txt')).text });
  });
});
