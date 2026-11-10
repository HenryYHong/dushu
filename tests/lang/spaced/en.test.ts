// English for Chinese speakers (src/lang/spaced/en.ts, data from scripts/lang/en/build_en.py): Chinese hints and cards, the
// forms of a word found under its dictionary form, contractions and possessives, phrasal verbs, and exam levels.
import { describe, expect, it, vi } from 'vitest';
import { loadLang, lookupIn, tok, words } from './load';

const ALICE = 'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do.';
const DARCY = '“I don’t know what you’re talking about,” said Mr. Darcy, and he went away.';
const POSSESSIVE = 'The children’s books were on the table, and Holmes’s pipe lay beside them.';
const GAVE_UP = 'She gave up the idea at once, because of the rain.';

describe('English', () => {
  it('finds every form under its dictionary form, with Chinese hints', async () => {
    const en = await loadLang('en');
    const keys = words(en, ALICE).map((t) => t.key);
    expect(keys).toEqual(['alice', 'be', 'begin', 'to', 'get', 'very', 'tired', 'of', 'sit', 'by', 'her', 'sister', 'on', 'the', 'bank', 'and', 'of', 'have', 'nothing', 'to', 'do']);
    expect(en.hint(tok(en, ALICE, 'sister'))).toBe('姐妹');
    expect(lookupIn(en, ALICE, 'beginning').form).toBe('present participle');
    expect(lookupIn(en, DARCY, 'went').entries.some((e) => e.head === 'go')).toBe(true);
  });

  it('reads contractions as words, and be in all its forms', async () => {
    const en = await loadLang('en');
    expect(tok(en, DARCY, 'don’t').key).toBe("don't");
    expect(en.hint(tok(en, DARCY, 'don’t'))).toBe('不要');
    expect(tok(en, DARCY, '’re').key).toBe('be');
    expect(tok(en, POSSESSIVE, 'were').key).toBe('be');
    expect(tok(en, DARCY, 'I').name).toBeFalsy();
  });

  it('reads a possessive as its noun, and a name’s as the name', async () => {
    const en = await loadLang('en');
    expect(tok(en, POSSESSIVE, 'children’s').key).toBe('child');
    expect(lookupIn(en, POSSESSIVE, 'children’s').form).toBe('plural possessive');
    expect(tok(en, POSSESSIVE, 'Holmes’s').key).toBe('holmes');
  });

  it('takes a phrasal verb before a noun, and fixed phrases', async () => {
    const en = await loadLang('en');
    expect(en.hint(tok(en, GAVE_UP, 'gave'))).toBe('放弃');
    expect(lookupIn(en, GAVE_UP, 'gave').phrase).toBe('give up');
    expect(en.hint(tok(en, GAVE_UP, 'once'))).toBe('立刻');
    // be + particle is not a phrasal verb: "must be in want of a wife" (Pride and Prejudice) is no 到达.
    const austen = 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.';
    expect(en.hint(tok(en, austen, 'be'))).toBe('是');
  });

  it('says how the word on the page and its dictionary form are pronounced, in IPA', async () => {
    const en = await loadLang('en');
    // ipa.tsv.gz comes after the engine is ready.
    await vi.waitFor(() => expect(lookupIn(en, DARCY, 'went').sound).toBe('/went/'));
    expect(lookupIn(en, DARCY, 'went').entries.find((e) => e.head === 'go')?.sound).toBe('/ɡəʊ/');
    // ECDICT's older notation comes out in the current one: 'kʌlә, θɒ:t, bɒi.
    expect(lookupIn(en, 'The colour of the sky.', 'colour').sound).toBe('/ˈkʌlə/');
    expect(lookupIn(en, 'I thought so.', 'thought').sound).toBe('/θɔːt/');
    expect(lookupIn(en, 'The boy ran.', 'boy').sound).toBe('/bɔɪ/');
    expect(lookupIn(en, 'Where do you live?', 'live').sound).toBe('/lɪv/, /laɪv/');
  });

  it('has the Chinese exam levels', async () => {
    const en = await loadLang('en');
    expect(en.level('apple')).toBe(1);
    expect(en.level('possession')).toBe(2);
    expect(en.levelWords(1).length).toBeGreaterThan(1000);
    expect(en.levelWords(1).slice(0, 3)).toEqual(['the', 'be', 'and']);
  });
});

describe('English in older books', () => {
  const PETER = 'Once upon a time there were four little Rabbits. They lived with their Mother in a sand-bank, underneath the root of a very big fir-tree.';
  it('reads "once upon a time" as one phrase and a hyphened old spelling as the word', async () => {
    const en = await loadLang('en');
    expect(en.hint(tok(en, PETER, 'Once'))).toBe('从前');
    expect(tok(en, PETER, 'sand-bank').key).toBe('sandbank');
    expect(tok(en, 'I will come to-morrow.', 'to-morrow').key).toBe('tomorrow');
  });
});

describe('English sounds', () => {
  const sound = async (text: string, word: string) => lookupIn(await loadLang('en'), text, word).sound ?? '';

  it('says a word spelled two ways both ways, or the way of the form it is read as', async () => {
    // Past-tense read: /red/ is there, never /riːd/ alone.
    expect(await sound('She read the letter yesterday and smiled.', 'read')).toContain('/red/');
    // wound as the past tense of wind: /waʊnd/, and the wind entry shows both of wind's sounds.
    const en = await loadLang('en');
    const wound = lookupIn(en, 'He wound the clock.', 'wound');
    expect(wound.form).toMatch(/past tense/);
    expect(wound.sound).toBe('/waʊnd/');
    expect(wound.entries.find((e) => e.head === 'wind')?.sound).toBe('/wɪnd/, /waɪnd/');
    expect(await sound('We use it every day.', 'use')).toContain('/juːz/');
    expect(await sound('He sat close to the fire.', 'close')).toContain('/kləʊs/');
    expect(await sound('I used a knife.', 'used')).toBe('/juːzd/');
  });

  it('says a capitalized word in mid-sentence as the capitalized word, and both ways at a sentence start', async () => {
    expect(await sound('The Polish soldiers marched.', 'Polish')).toBe('/ˈpəʊlɪʃ/');
    expect(await sound('She will polish the silver.', 'polish')).toBe('/ˈpɒlɪʃ/');
    expect(await sound('Polish the silver now.', 'Polish')).toBe('/ˈpɒlɪʃ/, /ˈpəʊlɪʃ/');
  });

  it('says consider /kənˈsɪdə/', async () => {
    const lu = lookupIn(await loadLang('en'), 'He considered the matter.', 'considered');
    expect(lu.entries.find((e) => e.head === 'consider')?.sound).toBe('/kənˈsɪdə/');
  });

  it('has no sound with a consonant before ŋ, nor one ending on ŋ where the spelling does not', async () => {
    const { readFileSync } = await import('node:fs');
    const { gunzipSync } = await import('node:zlib');
    const { join } = await import('node:path');
    const lines = gunzipSync(readFileSync(join(__dirname, '..', '..', '..', 'public', 'data', 'en', 'ipa.tsv.gz'))).toString('utf8').split('\n');
    const bad: string[] = [];
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      const [word, said] = line.split('\t');
      for (const v of said.split('|')) {
        const end = v.endsWith('ŋ') && !/(?:ngs?|ngue|ngh|on|an|ant|ent|en|in|ain|ein|oin|un|mps)$/.test(word.split('>')[0].toLowerCase());
        if (/[bdfgɡklmpstvzθðʃʒ]ŋ/.test(v) || end) bad.push(`${word} ${v}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
