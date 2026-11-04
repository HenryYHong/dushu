// "Silver gold": what three blind native audits of the held-out corpus said the reader got wrong, as checks a run can score
// (tests/corpus/zh/silver.tsv). Each check names a place (text id, block key, a few characters of context each side) and what
// the auditor expected there: the cut (expect_seg, words joined by "|"), the reading of some characters (expect_py, one
// syllable per character, "_" where it says nothing) and, for a display fix, the characters the page should show
// (expect_text). Every check was wrong when the audits read the corpus; the count that is right now is the measure.
import { readFileSync } from 'node:fs';
import { textHash, type ShownBlock } from './zh-shown';

export interface SilverCheck {
  audit: string;
  id: string;
  genre: string;
  family: string;
  type: string;
  key: string;
  before: string;
  target: string;
  after: string;
  expectSeg: string;
  expectPy: string[];
  expectText: string;
  shownAtAudit: string;
  status: string;
  expectedNote: string;
  /** Stable id of the check (a hash of where it is and what it expects). */
  hash: string;
}

export function readSilver(path: string): SilverCheck[] {
  const lines = readFileSync(path, 'utf8').split('\n');
  const cols = lines[0].replace(/^# /, '').split('\t');
  const at = (name: string) => cols.indexOf(name);
  const out: SilverCheck[] = [];
  for (const line of lines.slice(1)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    const get = (name: string) => c[at(name)] ?? '';
    const check: SilverCheck = {
      audit: get('audit'), id: get('id'), genre: get('genre'), family: get('family'), type: get('type'), key: get('key'),
      before: get('before'), target: get('target'), after: get('after'), expectSeg: get('expect_seg'),
      expectPy: get('expect_py') ? get('expect_py').split(' ') : [], expectText: get('expect_text'), shownAtAudit: get('shown_at_audit'),
      status: get('status'), expectedNote: get('expected_note'), hash: '',
    };
    check.hash = textHash([check.id, check.key, check.before, check.target, check.after, check.expectSeg, check.expectPy.join(' '), check.expectText].join('\u0001'));
    out.push(check);
  }
  return out;
}

/** Where the check's place is now: its block first, then any block of the text; the target itself may have changed. */
function locate(c: SilverCheck, blocks: ShownBlock[]): { block: ShownBlock; at: number } | null {
  const n = c.target.length;
  const exact = (b: ShownBlock) => {
    const i = b.shown.indexOf(c.before + c.target + c.after);
    return i < 0 ? -1 : i + c.before.length;
  };
  const loose = (b: ShownBlock) => {
    for (let i = b.shown.indexOf(c.before); i >= 0; i = b.shown.indexOf(c.before, i + 1)) {
      const at = i + c.before.length;
      if (b.shown.startsWith(c.after, at + n)) return at;
    }
    return -1;
  };
  // the target itself (or the display it expects) with at most two other characters of its context changed, as when a
  // variant nearby is folded (湼 → 涅)
  const near = (b: ShownBlock) => {
    let best = -1;
    let bestMiss = 3;
    const miss = (s: string, at: number) => {
      let m = 0;
      for (let k = 0; k < s.length; k++) if (b.shown[at + k] !== s[k]) m++;
      return m;
    };
    for (const t of c.expectText ? [c.target, c.expectText] : [c.target]) {
      for (let at = b.shown.indexOf(t); at >= 0; at = b.shown.indexOf(t, at + 1)) {
        if (at < c.before.length || at + n + c.after.length > b.shown.length) continue;
        const m = miss(c.before, at - c.before.length) + miss(c.after, at + n);
        if (m < bestMiss) { bestMiss = m; best = at; }
      }
    }
    return best;
  };
  const home = blocks.find((b) => b.key === c.key);
  for (const find of [exact, loose, near]) {
    if (home) { const at = find(home); if (at >= 0) return { block: home, at }; }
    for (const b of blocks) { if (b === home) continue; const at = find(b); if (at >= 0) return { block: b, at }; }
  }
  return null;
}

const syl = (s: string) => s.toLowerCase().replace(/u:/g, 'v').replace(/ü/g, 'v');

export type Verdict = 'right' | 'wrong' | 'lost';

/** Whether the reader's output meets the check now. 'lost': its place is no longer in the text (an import change). */
export function judge(c: SilverCheck, blocks: ShownBlock[]): Verdict {
  const where = locate(c, blocks);
  if (!where) return 'lost';
  const { block, at } = where;
  const end = at + c.target.length;
  const text = block.shown;
  if (c.expectText && text.slice(at, end) !== c.expectText) return 'wrong';
  if (c.expectSeg) {
    const cuts = new Set<number>();
    for (const t of block.tokens) { cuts.add(t.start); cuts.add(t.end); }
    if (!cuts.has(at) || !cuts.has(end)) return 'wrong';
    const want = new Set<number>();
    let p = at;
    for (const w of c.expectSeg.split('|')) { p += w.length; want.add(p); }
    want.delete(end);
    for (let x = at + 1; x < end; x++) if (cuts.has(x) !== want.has(x)) return 'wrong';
  }
  if (c.expectPy.length) {
    // one syllable per character (code point) of the target
    let off = at;
    for (const s of c.expectPy) {
      const ch = String.fromCodePoint(text.codePointAt(off)!);
      if (s !== '_') {
        const tok = block.tokens.find((t) => t.start <= off && off < t.end);
        if (!tok || !tok.pinyin) return 'wrong';
        const got = syl(tok.pinyin[[...text.slice(tok.start, off)].length] ?? '?');
        const want = syl(s);
        // 一 and 不 change tone before other syllables; a dump may write either
        const same = got === want || ((ch === '一' || ch === '不') && got.replace(/\d$/, '') === want.replace(/\d$/, ''));
        if (!same) return 'wrong';
      }
      off += ch.length;
    }
  }
  return 'right';
}

export interface SilverScore {
  total: number;
  right: number;
  lost: number;
  rightHashes: string[];
  byGenre: Record<string, { total: number; right: number }>;
  byFamily: Record<string, { total: number; right: number }>;
}

/** Scores every scored check against the books (id → blocks). */
export function scoreSilver(checks: SilverCheck[], books: Map<string, ShownBlock[]>): { score: SilverScore; verdicts: Map<SilverCheck, Verdict> } {
  const score: SilverScore = { total: 0, right: 0, lost: 0, rightHashes: [], byGenre: {}, byFamily: {} };
  const verdicts = new Map<SilverCheck, Verdict>();
  for (const c of checks) {
    if (c.status !== 'scored') continue;
    const blocks = books.get(c.id);
    const v: Verdict = blocks ? judge(c, blocks) : 'lost';
    verdicts.set(c, v);
    score.total++;
    const g = (score.byGenre[c.genre] ??= { total: 0, right: 0 });
    const f = (score.byFamily[c.family] ??= { total: 0, right: 0 });
    g.total++; f.total++;
    if (v === 'right') { score.right++; g.right++; f.right++; score.rightHashes.push(c.hash); }
    if (v === 'lost') score.lost++;
  }
  score.rightHashes.sort();
  return { score, verdicts };
}
