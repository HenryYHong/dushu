// The name model (core/nameModel.ts) and how detection uses it (core/lexicon.ts modelNames, ARCHITECTURE.md §4.9 Detection v12):
// the file, the scores against the training script's, the shapes, the guards, and that without the file detection is the rules'
// alone. The texts are invented.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DETECTOR_VERSION, detectTerms, WITHOUT_LIST, WITHOUT_MODEL, type NameSiteRecord } from '../../src/core/lexicon';
import { nameCandidates } from '../../src/core/nameCandidates';
import { loadNameModel, nameShape, parseNameModel, personThreshold, shapeGroup, NAME_FEATURES_VERSION, type NameModel } from '../../src/core/nameModel';
import type { Dictionary } from '../../src/types';
import { DATA_DIR, loadTestDictionary, readDataFile } from '../helpers/data';
import { nameStory } from './nameStory';

let dict: Dictionary;
let model: NameModel;
beforeAll(async () => {
  dict = await loadTestDictionary();
  model = parseNameModel(await readDataFile('name-model.tsv.gz'))!;
});

/** Detection with the model, and every string it was asked about. */
function detect(paragraphs: string[], m: NameModel | null = model) {
  let sites: NameSiteRecord[] = [];
  const found = detectTerms([paragraphs.join('\n')], dict, { nameModel: m, nameSites: (s) => { sites = s; } });
  return { found, sites, took: sites.filter((s) => s.took).map((s) => s.word) };
}

describe('the model file (public/data/name-model.tsv.gz)', () => {
  it('is this code\'s format and features version, small, with priors, title tails and thresholds', () => {
    expect(model).not.toBeNull();
    expect(model.features).toBe(NAME_FEATURES_VERSION);
    expect(statSync(join(DATA_DIR, 'name-model.tsv.gz')).size).toBeLessThan(100_000);
    expect(model.chars.size).toBeGreaterThan(3000);
    // 淑 and 秉 fill given names; 是 never does; 郑 opens one.
    expect(model.chars.get('淑')![1]).toBeGreaterThan(4);
    expect(model.chars.get('是')?.[1] ?? -12).toBeLessThan(-4);
    expect(model.chars.get('郑')![0]).toBeGreaterThan(4);
    for (const t of ['中丞', '监生', '秀才', '知县']) expect(model.tails.has(t)).toBe(true);
    // (Given names that a few people of one book bear are not tails: 蔡天化, 黄天化; 陈希真.)
    for (const t of ['天化', '希真', '建国']) expect(model.tails.has(t)).toBe(false);
    expect(model.threshold.person).toBeGreaterThan(0.5);
    // A numbered name is taken more readily than two characters of no shape.
    expect(personThreshold(model, [...'七大人'])).toBeLessThan(personThreshold(model, [...'宫娥']));
  });

  it('scores the way the training script does (tests/core/fixtures/name-model-check.tsv)', () => {
    const rows = readFileSync(join(__dirname, 'fixtures', 'name-model-check.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      const [feats, ...p] = row.split('\t');
      const got = model.score(feats.split(' '));
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(Number(p[k]), 4);
    }
  });

  it('a file of another format or features version, or none at all, is no model', async () => {
    expect(parseNameModel('# format 2\n!features\t1\n')).toBeNull();
    expect(parseNameModel(`# format 1\n!features\t${NAME_FEATURES_VERSION + 1}\n`)).toBeNull();
    expect(parseNameModel('no header\n')).toBeNull();
    expect(await loadNameModel(async () => { throw new Error('offline'); })).toBeNull();
    expect(WITHOUT_LIST).toBeLessThan(WITHOUT_MODEL);
    expect(WITHOUT_MODEL).toBeLessThan(DETECTOR_VERSION);
  });
});

describe('shapes', () => {
  it('tells the shapes of names apart', () => {
    const shape = (w: string) => nameShape([...w]);
    expect(shape('七大人')).toBe('numhon');
    expect(shape('邹七嫂')).toBe('numhon');
    expect(shape('八爷')).toBe('numhon');
    expect(shape('七斤')).toBe('numjin');
    expect(shape('黄三')).toBe('surnum');
    expect(shape('老五')).toBe('laonum');
    expect(shape('陈老五')).toBe('laonum');
    expect(shape('老栓')).toBe('nick');
    expect(shape('拉希姆')).toBe('translit');
    expect(shape('周秉昆')).toBe('sur');
    expect(shape('白马湖')).toBe('place');
    expect(shape('孝儿')).toBe('er');
    expect(shape('祥子')).toBe('zi');
    expect(shape('附姐')).toBe('kin');
    expect(shape('淑云')).toBe('');
    expect(shapeGroup([...'淑云'])).toBe('-2');
    expect(shapeGroup([...'郑娟'])).toBe('sur2');
  });
});

describe('detection with the model', () => {
  it('takes the repeated names of a story that the rules turn down, read as names', () => {
    const without = detect(nameStory(), null);
    const withModel = detect(nameStory());
    expect(without.took).toEqual([]);
    // 七斤 and 小栓 are taken; the rules find 老栓 and 阿噶利马 themselves.
    expect(withModel.took).toEqual(expect.arrayContaining(['七斤', '小栓']));
    const qijin = withModel.found.find((e) => e.word === '七斤')!;
    expect(qijin).toMatchObject({ kind: 'name', pinyin: 'qi1 jin1', origin: 'auto', gloss: 'name (person)' });
    // Everything the rules found is still there.
    for (const e of without.found) expect(withModel.found.map((x) => x.word)).toContain(e.word);
    // The name check then has fewer to ask about.
    const texts = [nameStory().join('\n')];
    const before = nameCandidates(texts, dict, without.found.map((e) => e.word), without.found).map((c) => c.word);
    const after = nameCandidates(texts, dict, withModel.found.map((e) => e.word), withModel.found).map((c) => c.word);
    expect(before).toContain('七斤');
    expect(after).not.toContain('七斤');
    expect(after.length).toBeLessThan(before.length);
  });

  it('takes a numbered honorific and a surname with a given name that act as people', () => {
    const story = nameStory({ 七大人: 20, 周秉昆: 24, 郑娟: 20, 淑云: 6 });
    const { took, found } = detect(story);
    expect(took).toContain('七大人');
    // (周秉昆 and 郑娟 the rules find or the model takes: either way they are names.)
    for (const w of ['七大人', '周秉昆', '郑娟']) expect(found.find((e) => e.word === w)?.kind).toBe('name');
  });

  it('never takes a title after a surname, a quantity, a counted thing or a numbered title several people share', () => {
    // (王驿丞: a surname and an office the dictionary has; 万美元 a sum; 翁斯 an ounce, after numerals; 二爷 after 宝 and 琏.)
    const junk = nameStory({ 王驿丞: 20, 宝玉: 30, 贾琏: 30, 宝二爷: 14, 琏二爷: 10, 二爷: 14 });
    for (let k = 0; k < 12; k++) junk.push(`这批货值一千万美元，金价是每一翁斯三百元，他又拿出两翁斯来。`);
    const { took, sites } = detect(junk);
    for (const w of ['王驿丞', '万美元', '翁斯', '二爷']) expect(took).not.toContain(w);
    // (A string the rules found is never taken again: the model only adds.)
    expect(sites.filter((s) => s.found && s.took)).toEqual([]);
  });

  it('changes nothing without the model, and nothing when the model takes nothing', () => {
    const text = [nameStory().join('\n')];
    const rules = detectTerms(text, dict).map((e) => e.word).sort();
    expect(detectTerms(text, dict, { nameModel: null }).map((e) => e.word).sort()).toEqual(rules);
    const empty = parseNameModel('# format 1\n!features\t1\n')!;
    expect(detectTerms(text, dict, { nameModel: empty }).map((e) => e.word).sort()).toEqual(rules);
  });
});
