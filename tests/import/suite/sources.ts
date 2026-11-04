// The texts the import suite builds its files from: public-domain books the site already serves (public/samples), read
// at test time, so nothing large is stored for the suite. Sections are [title, paragraphs].
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Section = [title: string, paras: string[]];

const SAMPLES = join(__dirname, '..', '..', '..', 'public', 'samples');

function lines(name: string): string[] {
  return readFileSync(join(SAMPLES, name), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** A collection sample ("第一篇　兔和猫" over each piece): its pieces, titled without the 第N篇 marker, without a byline. */
function pieces(name: string, only?: string[]): Section[] {
  const out: Section[] = [];
  for (const l of lines(name).slice(1)) {
    const m = /^第[一二三四五六七八九十]+篇[\s　]+(.+)$/.exec(l);
    if (m) out.push([m[1], []]);
    else if (out.length && !(out[out.length - 1][1].length === 0 && /^[一-鿿]{2,4}$/.test(l))) out[out.length - 1][1].push(l);
  }
  return only ? out.filter(([t]) => only.includes(t)) : out;
}

/** The title and author the suite's simplified book carries. */
export const HANS_TITLE = '鲁迅散文七篇';
export const HANS_AUTHOR = '鲁迅';

export const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** The seven pieces' own titles (阿长与《山海经》, 兔和猫 …), without a chapter marker. */
export const HANS_NAMES: string[] = [];

/**
 * Simplified: seven pieces by 鲁迅 from 1919 to 1926 (朝花夕拾, three animal stories, 一件小事), as one book of seven chapters
 * titled "第一章　阿长与《山海经》" …. About 13,000 Han characters; one story numbers its parts 一, 二, 三 on lines of their own.
 */
export const HANS: Section[] = [...pieces('zhaohua-xishi.txt'), ...pieces('dongwu-gushi.txt'), ...pieces('xiandai-duanwen.txt', ['一件小事'])].map(([t, ps], i) => {
  HANS_NAMES.push(t);
  return [`第${NUMERALS[i]}章　${t}`, ps];
});

/** The first `n` chapters of 紅樓夢 (traditional), titled "第一回　甄士隱夢幻識通靈　賈雨村風塵懷閨秀" …; all of them by default. */
export function hongloumeng(n = Infinity): Section[] {
  const out: Section[] = [];
  for (const l of lines('hongloumeng.txt').slice(1)) {
    if (/^第[一二三四五六七八九十百零〇]+回/.test(l) && [...l].length < 40 && !l.includes('。')) {
      if (out.length === n) break;
      out.push([l, []]);
    } else if (out.length) out[out.length - 1][1].push(l);
  }
  return out;
}

/** Traditional: the first four chapters of 紅樓夢 (about 24,000 Han). */
export const HANT: Section[] = hongloumeng(4);

/** A short sample as its title line and its other lines (every line a paragraph or a verse). */
export function sampleLines(name: string): { title: string; rest: string[] } {
  const all = lines(name);
  return { title: all[0], rest: all.slice(1) };
}

/** The raw bytes of a sample. */
export const sampleBytes = (name: string): Uint8Array => new Uint8Array(readFileSync(join(SAMPLES, name)));

/** Every paragraph of a book of sections. */
export const flat = (secs: Section[]): string[] => secs.flatMap(([, ps]) => ps);

/** Headings and paragraphs in reading order, the heading of each section made by `head` (null: none). */
export function contentOf(secs: Section[], head: ((i: number, t: string) => string | null) | null = (_i, t) => t): string[] {
  return secs.flatMap(([t, ps], i) => {
    const h = head ? head(i, t) : null;
    return h ? [h, ...ps] : ps;
  });
}

/** A paragraph cut into lines of `width` code points (a hard-wrapped file). */
export function wrap(p: string, width: number): string[] {
  const cps = [...p];
  const out: string[] = [];
  for (let i = 0; i < cps.length; i += width) out.push(cps.slice(i, i + width).join(''));
  return out.length ? out : [''];
}
