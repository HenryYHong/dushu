// The English dictionary's rare words (scripts/lang/en/build_rare.py, src/lang/spaced/rareWords.ts): a word the main dictionary
// leaves out is found in the file for its first two letters, as written or as a form of one.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rareCandidates, rareLookup, rareShard } from '../../src/lang/spaced/rareWords';

const DATA = join(__dirname, '../../public/data/en/');
const asked: string[] = [];
vi.stubGlobal('fetch', async (url: string) => {
  asked.push(url);
  const name = url.replace('https://app.test/data/en/', '');
  try {
    const body = readFileSync(join(DATA, name));
    return new Response(body, { status: 200, headers: { 'content-type': 'application/gzip' } });
  } catch { return new Response('', { status: 404 }); }
});
afterEach(() => { asked.length = 0; });

describe('rare words', () => {
  it('finds caviller for cavillers, from the ca file only', async () => {
    expect(await rareLookup('https://app.test/data/en/', 'cavillers')).toEqual({ key: 'caviller', gloss: 'n. 提出令人为难的问题的人' });
    expect(asked).toEqual(['https://app.test/data/en/rare/ca.tsv.gz']);
  });
  it('tries the forms a word may be of, the word first', () => {
    expect(rareCandidates('Cavillers')).toEqual(['cavillers', 'caviller']);
    expect(rareCandidates('cavilled')).toContain('cavil');
    expect(rareCandidates('parodies')).toContain('parody');
    expect(rareCandidates('caviller’s')[0]).toBe('caviller');
  });
  it('files a key by its first two letters, anything else as _', () => {
    expect(rareShard('cavil')).toBe('ca');
    expect(rareShard('a-')).toBe('a_');
    expect(rareShard('x')).toBe('x_');
  });
  it('says nothing for a word no file has, and leaves the main dictionary’s words out of the files', async () => {
    expect(await rareLookup('https://app.test/data/en/', 'qzxqzx')).toBeNull();
    // cavil is in the main dictionary: not repeated here.
    expect(await rareLookup('https://app.test/data/en/', 'cavil')).toBeNull();
  });
});
