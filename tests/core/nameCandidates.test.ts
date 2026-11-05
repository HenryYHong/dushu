// The name check's candidates (core/nameCandidates.ts, ARCHITECTURE.md §4.13): strings a book repeats that the detector turned down
// and that look like names, at most eight, none when nothing is good. The texts are invented.
import { beforeAll, describe, expect, it } from 'vitest';
import { detectTerms } from '../../src/core/lexicon';
import { MAX_NAME_CANDIDATES, nameCandidates } from '../../src/core/nameCandidates';
import type { Dictionary } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { nameStory, STORY_NAMES } from './nameStory';

let dict: Dictionary;
beforeAll(async () => { dict = await loadTestDictionary(); });

/** What the check offers for `paragraphs`, with the detector's names as the reader would have them. */
function offer(paragraphs: string[], taken: string[] = []) {
  const text = paragraphs.join('\n');
  const found = detectTerms([text], dict);
  return { found: found.map((e) => e.word), offered: nameCandidates([text], dict, [...found.map((e) => e.word), ...taken], found) };
}

describe('name candidates', () => {
  it('offers the names the detector turns down, in their shapes, and nothing else', () => {
    const { found, offered } = offer(nameStory());
    const words = offered.map((c) => c.word);
    // Every offer is one of the story's names; every name is offered or found.
    for (const w of words) expect(Object.keys(STORY_NAMES)).toContain(w);
    for (const w of Object.keys(STORY_NAMES)) expect([...words, ...found]).toContain(w);
    // A numbered name and a numbered honorific (the detector never takes a string that opens with a numeral), a nickname, and given
    // names that share a character.
    expect(offered.find((c) => c.word === '七斤')).toMatchObject({ why: 'numbered', kind: 'name', count: 24 });
    expect(offered.find((c) => c.word === '七大人')).toMatchObject({ why: 'numbered', count: 14 });
    expect(offered.find((c) => c.word === '小栓')?.why).toBe('nickname');
    expect(offered.filter((c) => c.why === 'siblings').map((c) => c.word).sort()).toEqual(['觉慧', '觉新', '觉民']);
    // Best first: the most places and the clearest signs lead.
    expect(words[0]).toBe('七斤');
    // Never a piece of a name: 七大 inside 七大人.
    expect(words).not.toContain('七大');
  });

  it('does not offer a numbered title that several people share (宝二爷, 琏二爷: each of them is called 二爷)', () => {
    const shared = offer(nameStory({ 宝玉: 30, 贾琏: 30, 贾芸: 24, 二爷: 14, 宝二爷: 14, 琏二爷: 8, 芸二爷: 4 }));
    expect(shared.found).toEqual(expect.arrayContaining(['宝玉', '贾琏', '贾芸']));
    expect(shared.offered.map((c) => c.word)).not.toContain('二爷');
    // One person called so, after nobody's given name, is offered.
    const one = offer(nameStory({ 宝玉: 30, 贾琏: 30, 二爷: 30 }));
    expect(one.offered.map((c) => c.word)).toContain('二爷');
  });

  it('leaves out what the book has already, and what the reader has answered', () => {
    const { offered } = offer(nameStory(), ['七斤', '觉新']);
    expect(offered.map((c) => c.word)).not.toContain('七斤');
    expect(offered.map((c) => c.word)).not.toContain('觉新');
    expect(offered.map((c) => c.word)).toContain('七大人');
  });

  it('offers nothing for plain text: quantities, things, people described', () => {
    const plain = [
      '他买了一碗面，又买了一碗汤。', '老屋门前有一棵树，老屋后面有一条河。', '小船从桥下过去了。', '一碗面吃完，他又要了一碗。',
      '老船夫坐在船头抽烟。', '老船夫说：“明天要下雨。”', '河水慢慢地流着，天黑了。', '他走了十里路，又走了十里。',
    ];
    const paragraphs = Array.from({ length: 12 }, (_, i) => plain.slice(i % 4).concat(plain.slice(0, i % 4)).join(''));
    expect(offer(paragraphs).offered).toEqual([]);
  });

  it('offers at most eight', () => {
    // Twelve numbered names, each acting ten times.
    const names = Object.fromEntries([...[...'二三四五六八九'].map((n) => `${n}斤`), '七大人', '八大人', '九大人', '五大人', '六大人'].map((w) => [w, 10]));
    const { offered } = offer(nameStory(names));
    expect(offered.length).toBe(MAX_NAME_CANDIDATES);
    for (const c of offered) expect(Object.keys(names)).toContain(c.word);
  });

  it('works on a book in traditional characters', () => {
    const { offered } = offer(nameStory().map((p) => p.replace(/觉/g, '覺').replace(/说/g, '說')));
    expect(offered.map((c) => c.word)).toContain('覺民');
  });
});
