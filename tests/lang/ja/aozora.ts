// Aozora Bunko texts (public domain) as test material: paragraphs of plain text, and the publisher's furigana as gold readings.
// Ruby is written 漢字《かんじ》 (the kanji run before 《) or ｜base《reading》; ［＃…］ are typesetting notes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Paragraph {
  text: string;
  /** The publisher's readings: text[start, end) is read `reading`. */
  ruby: { start: number; end: number; reading: string }[];
}

const KANJI_RUN = /[々〆ヶ一-鿿㐀-䶿豈-﫿]/;

export function parseAozora(raw: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const line of raw.split('\n')) {
    const src = line.replace(/［＃[^］]*］/g, '');
    let text = '';
    const ruby: Paragraph['ruby'] = [];
    let mark = -1; // where a ｜ put the start of the next ruby base
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '｜') { mark = text.length; continue; }
      if (c === '《') {
        const close = src.indexOf('》', i);
        const reading = src.slice(i + 1, close);
        let start = mark;
        if (start < 0) {
          start = text.length;
          while (start > 0 && KANJI_RUN.test(text[start - 1])) start--;
        }
        if (start < text.length) ruby.push({ start, end: text.length, reading });
        mark = -1;
        i = close;
        continue;
      }
      text += c;
    }
    const trimmed = text.replace(/^[\s　]+/, '');
    const shift = text.length - trimmed.length;
    if (!trimmed.trim()) continue;
    out.push({ text: trimmed, ruby: ruby.map((r) => ({ start: r.start - shift, end: r.end - shift, reading: r.reading })) });
  }
  return out;
}

export function readFixture(name: 'rashomon' | 'chumon' | 'bocchan'): Paragraph[] {
  return parseAozora(readFileSync(join(__dirname, 'fixtures', `${name}.txt`), 'utf8'));
}
