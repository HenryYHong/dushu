import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const read = (name: string) => readFileSync(join(root, 'scripts', 'eval', name), 'utf8');
type Passage = { id: string; book: string; find: string; cat: string; split: 'dev' | 'held' };
const passages = JSON.parse(read('passages.json')) as Passage[];
const references = JSON.parse(read('references.json')) as Record<string, { reference: string; checkpoints: string[]; traps: string[] }>;
const legacy = JSON.parse(read('legacy.json')) as { id: string; text: string; context: string; expect: string; require: string; reject?: string }[];
// Loaded by a computed path: the evaluation modules are plain .mjs files with no type declarations.
const load = (name: string) => import(/* @vite-ignore */ join(root, 'scripts', 'eval', name));

describe('evaluation passages', () => {
  it('has about sixty public-domain passages split about 60/40, each found exactly once in its book', () => {
    expect(passages.length).toBeGreaterThanOrEqual(60);
    const held = passages.filter(p => p.split === 'held').length;
    expect(held / passages.length).toBeGreaterThan(0.35);
    expect(held / passages.length).toBeLessThan(0.45);
    expect(new Set(passages.map(p => p.id)).size).toBe(passages.length);
    const index = JSON.parse(readFileSync(join(root, 'public', 'samples', 'index.json'), 'utf8')) as { id: string; file: string }[];
    for (const passage of passages) {
      const entry = index.find(sample => sample.id === passage.book);
      expect(entry, `${passage.id} names a book that ships with the app`).toBeTruthy();
      const text = readFileSync(join(root, 'public', 'samples', entry!.file), 'utf8');
      expect(text.split(passage.find).length - 1, passage.id).toBe(1);
    }
  });
  it('covers every public-domain text the owner will read, with names, vernacular words, idioms and classical lines', () => {
    const books = new Set(passages.map(p => p.book));
    for (const book of ['hongloumeng', 'xiyouji', 'sanguo', 'shuihu', 'kong-yiji', 'guxiang', 'kuangren-riji', 'lunyu-xue-er', 'tang-poems']) expect(books.has(book), book).toBe(true);
    const text = passages.map(p => p.find).join('');
    for (const marker of ['卻說', '恁地', '便了', '只見']) expect(text).toContain(marker);
    expect(passages.some(p => p.cat.startsWith('idiom'))).toBe(true);
    expect(passages.some(p => p.cat.startsWith('classical'))).toBe(true);
  });
  it('keeps both splits in every large book so tuning cannot learn one book', () => {
    for (const book of ['hongloumeng', 'xiyouji', 'sanguo', 'shuihu']) {
      const splits = new Set(passages.filter(p => p.book === book).map(p => p.split));
      expect(splits, book).toEqual(new Set(['dev', 'held']));
    }
  });
  it('has a reviewed answer key for every passage', () => {
    for (const passage of passages) {
      const key = references[passage.id];
      expect(key, passage.id).toBeTruthy();
      expect(key.reference.length).toBeGreaterThan(15);
      expect(key.checkpoints.length).toBeGreaterThanOrEqual(3);
      expect(key.traps.length).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(references).sort()).toEqual(passages.map(p => p.id).sort());
  });
  it('keeps the older fixtures as a separate regression set with valid screens', () => {
    expect(legacy.length).toBe(25);
    for (const fixture of legacy) {
      expect(() => new RegExp(fixture.require, 'i')).not.toThrow();
      const reject = fixture.reject;
      if (reject) expect(() => new RegExp(reject, 'i')).not.toThrow();
    }
  });
  it('takes passages only from books that ship with the app, never from the owner\'s own copies', () => {
    const index = JSON.parse(readFileSync(join(root, 'public', 'samples', 'index.json'), 'utf8')) as { id: string }[];
    const shipped = new Set(index.map(sample => sample.id));
    for (const passage of passages) expect(shipped.has(passage.book), passage.id).toBe(true);
  });
});

describe('judging and scoring', () => {
  it('reads a judgement, ignores unknown error types and derives the verdict from severities', async () => {
    const { parseJudgement } = await load('judge.mjs');
    expect(parseJudgement('{"verdict":"correct","errors":[]}')).toEqual({ verdict: 'correct', errors: [] });
    const minor = parseJudgement('```json\n{"errors":[{"type":"register-fluency","severity":"minor","evidence":"x","why":"y"}]}\n```');
    expect(minor.verdict).toBe('minor');
    const wrong = parseJudgement('{"verdict":"correct","errors":[{"type":"name-mangled","severity":"major","evidence":"Patience","why":"name"},{"type":"made-up","severity":"major"}]}');
    expect(wrong.verdict).toBe('wrong');
    expect(wrong.errors).toHaveLength(1);
    expect(() => parseJudgement('no json here')).toThrow();
  });
  it('screens leftover Chinese and tone numbers and applies the old patterns', async () => {
    const { screens } = await load('judge.mjs');
    expect(screens({ answer: 'He left 走.' }, {})).toEqual(['chinese-left']);
    expect(screens({ answer: 'He went home.' }, { require: 'hotel', reject: 'home' })).toEqual(['legacy-require-missing', 'legacy-reject-hit']);
  });
  it('scores strict and lenient pass rates, error counts by type and latency percentiles', async () => {
    const { score } = await load('run.mjs');
    const item = (split: string, verdict: string, errors: { type: string; severity: string }[], firstMs: number) => ({ split, judge: { verdict, errors }, firstMs, totalMs: firstMs * 2, calls: 1 });
    const s = score([
      item('held', 'correct', [], 500), item('held', 'minor', [{ type: 'register-fluency', severity: 'minor' }], 700),
      item('held', 'wrong', [{ type: 'name-mangled', severity: 'major' }, { type: 'register-fluency', severity: 'minor' }], 900), item('dev', 'correct', [], 100), item('legacy', 'wrong', [], 100),
    ], 'held');
    expect(s).toMatchObject({ n: 3, correct: 1, minor: 1, wrong: 1, majorErrors: 1, minorErrors: 2 });
    expect(s.strict).toBeCloseTo(1 / 3);
    expect(s.lenient).toBeCloseTo(2 / 3);
    expect(s.byType['register-fluency']).toEqual({ major: 0, minor: 2 });
    expect(s.firstP50).toBe(700);
  });
});
