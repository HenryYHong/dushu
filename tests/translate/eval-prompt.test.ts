import { describe, expect, it } from 'vitest';
import { checkTranslation, contextWindow, correctionNote, isTitleName, nameSpelling, translateChecked, translationMessage, translationSystem, unverifiedDetail } from '../../src/translate/prompt';

const terms = [
  { word: '平兒', pinyin: 'ping2 er2', gloss: 'name (person)', kind: 'name' as const },
  { word: '郭靖', pinyin: 'guo1 jing4', gloss: 'name (person)', kind: 'name' as const },
  { word: '賈母', pinyin: 'jia3 mu3', gloss: 'name (person)', kind: 'name' as const },
  { word: '羯鼓', pinyin: 'jie2 gu3', gloss: 'a type of drum', kind: 'term' as const },
];

describe('name spelling', () => {
  it('writes toneless pinyin, joins given names and adds an apostrophe before a, e or o', () => {
    expect(nameSpelling(terms[0])).toBe("Ping'er");
    expect(nameSpelling(terms[1])).toBe('Guo Jing');
    expect(nameSpelling({ word: '西安', pinyin: 'xi1 an1', kind: 'name' })).toBe("Xi'an");
    expect(nameSpelling({ word: '吕布', pinyin: 'lü3 bu4', kind: 'name' })).toBe('Lu Bu');
  });
  it('treats kinship and title words as titles, which are translated by role', () => {
    for (const word of ['賈母', '鳳姐', '王夫人', '劉姥姥', '唐王']) expect(isTitleName(word)).toBe(true);
    for (const word of ['平兒', '悟空', '郭靖']) expect(isTitleName(word)).toBe(false);
  });
});

describe('prompt construction', () => {
  it('sends only the glossary entries the sentence contains, with the exact name spelling', () => {
    const message = translationMessage({ text: '平兒笑道：「罷了。」', context: '鳳姐道：「你去罷。」平兒笑道：「罷了。」', terms });
    expect(message).toContain("平兒 (name): write Ping'er");
    expect(message).not.toContain('郭靖');
    expect(message).toMatch(/<context>[\s\S]*<\/context>\n<text>\n平兒笑道/);
  });
  it('omits the context when asked or when it is the sentence itself', () => {
    expect(translationMessage({ text: '你好。', context: '你好。' })).toBe('<text>\n你好。\n</text>');
    expect(translationMessage({ text: '你好。', context: '前文。你好。' }, { context: 'none' })).not.toContain('<context>');
  });
  it('stays inside the 4000-character bridge limit on the instructions, even with examples and a correction', () => {
    expect(translationSystem('translate', 'local').length).toBeLessThan(2800);
    const worst = `${translationSystem('translate', 'local', { examples: true })}\n${correctionNote(Array.from({ length: 5 }, () => ({ code: 'name' as const, message: 'The name 平兒 must be written Ping\'er, as the glossary says.' })))}`;
    expect(worst.length).toBeLessThan(4000);
    expect(translationSystem('explain', 'claude')).toContain('bullets');
  });
  it('keeps the window around the selected sentence in a long paragraph', () => {
    const paragraph = `${'甲'.repeat(2000)}目标句。${'乙'.repeat(2000)}`;
    expect(contextWindow(paragraph, '目标句。')).toContain('目标句。');
    expect(contextWindow(paragraph, '目标句。').length).toBe(1400);
  });
});

describe('mechanical checks', () => {
  const check = (text: string, answer: string, t = terms) => checkTranslation({ text, terms: t }, answer).map(issue => issue.code);
  it('passes a faithful answer', () => {
    expect(check('平兒笑道：「我不去。」', `Ping'er said with a smile, "I am not going."`)).toEqual([]);
  });
  it('finds a name that was translated as a word, but not a title', () => {
    expect(check('平兒笑了。', 'Patience smiled.')).toEqual(['name']);
    expect(check('賈母笑了。', 'Grandmother Jia smiled.')).toEqual([]);
  });
  it('finds a lost negation, but not a compound that is not a negation', () => {
    expect(check('我不去。', 'I will go.')).toEqual(['negation']);
    expect(check('不過一碗酒罷了。', 'It was only a bowl of wine.')).toEqual([]);
    expect(check('他並非不想去，只是沒空。', 'He is not unwilling to go, he just has no time.')).toEqual([]);
  });
  it('finds a number that disappeared, and accepts words, ordinals, months and plurals', () => {
    expect(check('他买了三斤米。', 'He bought some rice.')).toContain('number');
    expect(check('他买了三斤米。', 'He bought three jin of rice.')).toEqual([]);
    expect(check('五月十一日，他走了。', 'On May 11, he left.')).toEqual([]);
    expect(check('贞观十三年九月，他走了。', 'In the thirteenth year of Zhenguan, in the ninth month, he left.')).toEqual([]);
    expect(check('他才二十来岁。', 'He is only in his twenties.')).toEqual([]);
    expect(check('买五七斤肉。', 'Buy five or six catties of meat.')).toEqual([]);
  });
  it('does not insist on counts of people or "a" for one', () => {
    expect(check('他们三人一起走了。', 'They left together.')).toEqual([]);
    expect(check('他买了一碗酒。', 'He bought a bowl of wine.')).toEqual([]);
  });
  it('finds a converted unit, leftover Chinese, tone-numbered pinyin and commentary', () => {
    expect(check('他买了两斤米。', 'He bought two kilograms of rice.')).toContain('unit');
    expect(check('他走了。', 'He 走 away.')).toContain('chinese');
    expect(check('他走了。', 'He went to jie2 gu3 again.')).toContain('pinyin');
    expect(check('他走了。', 'Here is the translation: He left.')).toContain('meta');
    expect(check('他走了。', 'He left.\n\nCorrection: He went away.')).toContain('meta');
    expect(check('他走了。', 'He left.\n\nHe went away.')).toContain('meta');
    expect(check('他走了。\n\n她来了。', 'He left.\n\nShe came.')).toEqual([]);
  });
  it('flags an answer far too short or far too long for the source', () => {
    expect(check('他从早到晚都在田里干活，一刻也没有停过。', 'He worked.')).toContain('length');
    expect(check('他从早到晚都在田里干活，一刻也没有停过。', Array(80).fill('word').join(' '))).toContain('length');
  });
  it('describes unresolved issues plainly', () => {
    expect(unverifiedDetail([{ code: 'name', message: '' }, { code: 'name', message: '' }, { code: 'number', message: '' }])).toBe('a name from the book may be missing or misspelled; a number may be missing');
    expect(correctionNote([{ code: 'name', message: 'The name 平兒 must be written Ping\'er.' }])).toContain("- The name 平兒 must be written Ping'er.");
  });
});

describe('generate, check, correct', () => {
  const request = { text: '平兒笑道：「我不去。」', terms, mode: 'translate' as const };
  it('returns the first answer when the checks pass, with one call', async () => {
    const seen: string[] = [];
    const out = await translateChecked(request, async (_system, message) => { seen.push(message); return `Ping'er said, "I will not go."`; }, { target: 'claude' });
    expect(out).toMatchObject({ attempts: 1, issues: [] });
    expect(seen).toHaveLength(1);
  });
  it('asks once for a correction, shows the problem to the model and keeps the better answer', async () => {
    const systems: string[] = [];
    const out = await translateChecked(request, async system => {
      systems.push(system);
      return systems.length === 1 ? 'Patience said, "I will not go."' : `Ping'er said, "I will not go."`;
    }, { target: 'claude' });
    expect(out.attempts).toBe(2);
    expect(out.issues).toEqual([]);
    expect(out.text).toContain("Ping'er");
    expect(systems[1]).toContain(`must be written Ping'er`);
  });
  it('never trades a first answer for a worse retry, and reports what remains', async () => {
    const answers = ['Patience said, "I will not go."', 'Patience said, "I will go." 走'];
    let n = 0;
    const out = await translateChecked(request, async () => answers[n++], { target: 'claude' });
    expect(out.attempts).toBe(2);
    expect(out.text).toBe(answers[0]);
    expect(out.issues.map(issue => issue.code)).toEqual(['name']);
  });
  it('labels but does not retry a name, negation or number problem from the small local model', async () => {
    let calls = 0;
    const out = await translateChecked(request, async () => { calls++; return 'Patience said, "I will go."'; }, { target: 'local' });
    expect(calls).toBe(1);
    expect(out.issues.map(issue => issue.code).sort()).toEqual(['name', 'negation']);
    let again = 0;
    const meta = await translateChecked(request, async () => (again++ ? `Ping'er said, "I will not go."` : `Here is the translation: Ping'er said, "I will not go."`), { target: 'local' });
    expect(again).toBe(2);
    expect(meta.issues).toEqual([]);
  });
  it('does not check or retry an explanation', async () => {
    let calls = 0;
    await translateChecked({ ...request, mode: 'explain' }, async () => { calls++; return 'Patience'; }, { target: 'claude' });
    expect(calls).toBe(1);
  });
  it('stops before a retry when the request was canceled', async () => {
    const ctl = new AbortController();
    await expect(translateChecked(request, async () => { ctl.abort(); return 'Patience said no.'; }, { target: 'claude', signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('offline gloss and sense hints', () => {
  it('lets the paragraph settle 酒店 in the offline gloss, and leaves it alone without evidence', async () => {
    const { glossText } = await import('../../src/translate/gloss');
    const { wordSenseHint } = await import('../../src/translate/contextSense');
    const { loadTestDictionary } = await import('../helpers/data');
    const dict = await loadTestDictionary();
    const tavern = '镇上的酒店只卖酒和下酒菜。他走进酒店，买了一碗温酒，站在柜台前喝完就走了。';
    expect(wordSenseHint('他走进酒店，买了一碗温酒。', tavern)?.kind).toBe('tavern');
    expect(wordSenseHint('他在酒店订了一间客房。', '他在酒店订了一间客房，打算住三晚。')?.kind).toBe('lodging');
    expect(wordSenseHint('他走进酒店。', '他走进酒店。')).toBeNull();
    expect(glossText('他走进酒店。', dict, undefined, tavern)).toContain('wine shop or tavern');
    expect(glossText('他走进酒店。', dict)).not.toContain('wine shop or tavern');
  });
});
