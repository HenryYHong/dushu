import { describe, expect, it } from 'vitest';
import { loadTestDictionary } from '../helpers/data';
import { entriesForReading } from '../../src/core/reading';
import { segment } from '../../src/core/segment';
import { glossText } from '../../src/translate/gloss';

describe('entriesForReading', () => {
  it('prefers ordinary same-reading entries while preserving every proper-name sense and source order', async () => {
    const d = await loadTestDictionary();
    const all = d.lookup('波'); const original = [...all];
    const out = entriesForReading(all, ['bo1']);
    expect(out[0].defs.join(' ')).toContain('wave');
    expect(out).toHaveLength(all.length);
    expect(out.flatMap(entry => entry.defs).join(' ')).toContain('Poland');
    expect(all).toEqual(original);
  });
  it('keeps proper-name-only entries and does not let lexical preference override a different spoken reading', async () => {
    const d = await loadTestDictionary();
    expect(entriesForReading(d.lookup('波兰'), ['bo1', 'lan2'])[0].defs.join(' ')).toContain('Poland');
    expect(entriesForReading(d.lookup('说'), ['shui4'])[0].pinyin).toBe('shui4');
  });
  it('leads with the entry for the reading on screen', async () => {
    const d = await loadTestDictionary();
    expect(entriesForReading(d.lookup('说'), ['shuo1'])[0].pinyin).toBe('shuo1');
    expect(entriesForReading(d.lookup('说'), ['shui4'])[0].pinyin).toBe('shui4');
    expect(entriesForReading(d.lookup('了'), ['liao3'])[0].pinyin).toBe('liao3');
    expect(entriesForReading(d.lookup('好'), ['hao4'])[0].pinyin).toBe('hao4');
  });

  it('matches a sandhi-changed syllable by its base, and keeps every entry', async () => {
    const d = await loadTestDictionary();
    const all = d.lookup('不');
    const out = entriesForReading(all, ['bu2']);
    expect(out[0].pinyin.replace(/\d/g, '')).toBe('bu');
    expect(out).toHaveLength(all.length);
  });

  it('leaves the order alone when nothing matches or there is no reading', async () => {
    const d = await loadTestDictionary();
    const all = d.lookup('说');
    // The entries keep their order (a card may still reorder the lines inside one entry).
    const order = (list: typeof all) => list.map((e) => `${e.trad}|${e.simp}|${e.pinyin}`);
    expect(order(entriesForReading(all, []))).toEqual(order(all));
    expect(order(entriesForReading(all, ['xyz9']))).toEqual(order(all));
  });
});

describe('gloss matches the pinyin it sits beside', () => {
  it('说 in running text is "to speak", not "to persuade"', async () => {
    const d = await loadTestDictionary();
    const said = segment('他说', d).find((t) => t.text === '说')!;
    expect(said.pinyin).toEqual(['shuo1']);
    const g = glossText('他说', d);
    expect(g).toMatch(/说[^·]*shuō[^·]*speak|说[^·]*speak/);
    expect(g).not.toMatch(/persuade/);
  });
  it('a note on how a word is also said (colloquial pr. [nei4], Taiwan pr. [han4]) does not lead the gloss', async () => {
    const d = await loadTestDictionary();
    // Preconditions: CEDICT still ends the first meaning of 那 and 和 with such a note.
    expect(d.lookup('那').find((e) => e.pinyin === 'na4')?.defs[0]).toMatch(/\(colloquial pr\. \[nei4\]\)$/);
    expect(d.lookup('和').flatMap((e) => e.defs)).toContain('(joining two nouns) and; together with; with (Taiwan pr. [han4])');
    const na = entriesForReading(d.lookup('那'), ['na4'])[0];
    expect(na.defs[0]).toBe('(specifier) that; the; those');
    expect(na.defs.at(-1)).toBe('colloquial pr. [nei4]'); // kept, at the end
    const g = glossText('那人和他', d);
    expect(g).toContain('那 (nà): (specifier) that; the; those ·');
    expect(g).toContain('和 (hé): (joining two nouns) and; together with; with ·');
    expect(g).not.toMatch(/pr\. \[/);
  });
});
