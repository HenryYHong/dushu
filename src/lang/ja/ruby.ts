// Furigana: which part of a word's reading goes over which kanji. Kana in the word must match the reading letter for letter,
// so the reading is cut around the okurigana (食べさせられた → 食|た), and a run of several kanji is split kanji by kanji when
// each kanji's known readings spell the run's reading (日本人 → 日|に 本|ほん 人|じん); when they do not, the run keeps one reading
// over it all (今日 → きょう, 大人 → おとな), which is how jukujikun are printed.
import type { RubyPart } from '../../types';
import { isKanjiCode, readingVariants, toHiragana } from './kana';

/** The readings of a kanji in hiragana (on readings converted, kun readings without the okurigana). */
export type KanjiReadings = (ch: string) => readonly string[];

interface Run { text: string; kanji: boolean }

function runsOf(surface: string): Run[] {
  const out: Run[] = [];
  for (const ch of surface) {
    const k = isKanjiCode(ch.codePointAt(0)!);
    const last = out[out.length - 1];
    if (last && last.kanji === k) last.text += ch;
    else out.push({ text: ch, kanji: k });
  }
  return out;
}

/** Kana compare: katakana in the word matches hiragana in the reading; ー matches any vowel it could stand for. */
function kanaMatch(text: string, reading: string, at: number): boolean {
  const t = toHiragana(text);
  if (at + t.length > reading.length) return false;
  for (let i = 0; i < t.length; i++) {
    const a = t[i];
    const b = reading[at + i];
    if (a === b) continue;
    if (a === 'ー' && 'あいうえお'.includes(b)) continue;
    return false;
  }
  return true;
}

/** Every way to give each kanji run a non-empty slice of the reading while the kana runs match (at most `limit`). */
function assignments(runs: Run[], reading: string, limit = 24): string[][] {
  const out: string[][] = [];
  const cur: string[] = [];
  const walk = (r: number, at: number): void => {
    if (out.length >= limit) return;
    if (r === runs.length) {
      if (at === reading.length) out.push(cur.slice());
      return;
    }
    const run = runs[r];
    if (!run.kanji) {
      if (!kanaMatch(run.text, reading, at)) return;
      cur.push(reading.slice(at, at + run.text.length));
      walk(r + 1, at + run.text.length);
      cur.pop();
      return;
    }
    // Leave at least one letter for each kanji run after this one, and the letters of the kana runs.
    let rest = 0;
    for (let k = r + 1; k < runs.length; k++) rest += runs[k].kanji ? 1 : runs[k].text.length;
    for (let end = at + 1; end <= reading.length - rest; end++) {
      cur.push(reading.slice(at, end));
      walk(r + 1, end);
      cur.pop();
    }
  };
  walk(0, 0);
  return out;
}

const COUNTER_KANA: Record<string, string[]> = { ヶ: ['か', 'が', 'こ'], ヵ: ['か', 'が', 'こ'], ケ: ['か', 'が', 'こ'], '〇': ['れい', 'まる', 'ぜろ'] };

/** Per-kanji readings for a kanji run, scored: 2 for a reading as listed, 1 for a sound change (rendaku, っ, a dropped ち). */
function candidates(ch: string, prev: string | undefined, kr: KanjiReadings): Map<string, number> {
  const out = new Map<string, number>();
  const base = ch === '々' || ch === '〻' ? (prev ? kr(prev) : []) : COUNTER_KANA[ch] ?? kr(ch);
  for (const r of base) {
    if (!r) continue;
    const vs = readingVariants(r);
    for (let i = 0; i < vs.length; i++) if (!out.has(vs[i])) out.set(vs[i], i === 0 && ch !== '々' ? 2 : 1);
    // 日本 にほん, 一体 いったい: on readings ending in ち/つ/く lose it before some sounds.
    if (r.length >= 2 && 'ちつく'.includes(r[r.length - 1])) {
      const cut = r.slice(0, -1);
      if (!out.has(cut)) out.set(cut, 1);
    }
  }
  return out;
}

/** The best per-kanji split of a run's reading, or null when its kanji's readings cannot spell it. */
export function splitRun(run: string, reading: string, kr: KanjiReadings): string[] | null {
  const chars = [...run];
  if (chars.length === 1) return [reading];
  const cands = chars.map((ch, i) => candidates(ch, chars[i - 1], kr));
  let best: string[] | null = null;
  let bestScore = -1;
  const cur: string[] = [];
  let tries = 0;
  const walk = (i: number, at: number, score: number): void => {
    if (++tries > 2000) return;
    if (i === chars.length) {
      if (at === reading.length && score > bestScore) { best = cur.slice(); bestScore = score; }
      return;
    }
    for (const [r, s] of cands[i]) {
      if (!reading.startsWith(r, at)) continue;
      cur.push(r);
      walk(i + 1, at + r.length, score + s);
      cur.pop();
    }
  };
  walk(0, 0, 0);
  return best;
}

function push(out: RubyPart[], text: string, rt?: string): void {
  const last = out[out.length - 1];
  if (!rt && last && !last.rt) last.text += text;
  else out.push(rt ? { text, rt } : { text });
}

/**
 * Furigana pieces for `surface` read as `reading` (hiragana). The pieces cover `surface` exactly; only kanji carry `rt`.
 * When the reading does not fit the kana of the word, the kana that match at either end stay bare and the rest of the word
 * gets the rest of the reading.
 */
export function alignRuby(surface: string, reading: string, kr: KanjiReadings): RubyPart[] {
  const runs = runsOf(surface);
  if (!runs.some((r) => r.kanji)) return [{ text: surface }];
  const hira = toHiragana(reading);
  if (!hira) return [{ text: surface }];
  const options = assignments(runs, hira);
  if (options.length) {
    // Prefer the assignment whose kanji runs the kanji readings explain; ties go to the first (shortest early runs).
    let pick = options[0];
    let pickScore = -1;
    const splits = new Map<string, string[] | null>();
    for (const opt of options) {
      let score = 0;
      runs.forEach((run, i) => {
        if (!run.kanji) return;
        const key = run.text + '\u0000' + opt[i];
        if (!splits.has(key)) splits.set(key, splitRun(run.text, opt[i], kr));
        if (splits.get(key)) score++;
      });
      if (score > pickScore) { pick = opt; pickScore = score; }
    }
    const out: RubyPart[] = [];
    runs.forEach((run, i) => {
      if (!run.kanji) { push(out, run.text); return; }
      const split = splits.get(run.text + '\u0000' + pick[i]) ?? null;
      const chars = [...run.text];
      if (split && split.length === chars.length) chars.forEach((ch, k) => push(out, ch, split[k]));
      else push(out, run.text, pick[i]);
    });
    return out;
  }
  // The reading does not fit: keep matching kana at both ends bare.
  let a = 0;
  let b = 0;
  const s = [...surface];
  while (a < s.length && a < hira.length && !isKanjiCode(s[a].codePointAt(0)!) && toHiragana(s[a]) === hira[a]) a++;
  while (b < s.length - a && b < hira.length - a && !isKanjiCode(s[s.length - 1 - b].codePointAt(0)!) && toHiragana(s[s.length - 1 - b]) === hira[hira.length - 1 - b]) b++;
  const out: RubyPart[] = [];
  if (a) push(out, s.slice(0, a).join(''));
  const mid = s.slice(a, s.length - b).join('');
  const midReading = hira.slice(a, hira.length - b);
  if (mid) push(out, mid, midReading || undefined);
  if (b) push(out, s.slice(s.length - b).join(''));
  return out;
}
