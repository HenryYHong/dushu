// What every translator says and sends when sentences go into English, the default. tests/translate/target.test.ts compares
// it with tests/fixtures/translate/english-default.json, which was written by this same function from the code as it was
// before a reader could pick the translation language: with `to` absent or 'en', Chinese (and every other book language)
// must get the same prompts, request bodies and checks, byte for byte. The fixture keeps, for each key, the first 24 hex
// characters of sha256(JSON.stringify(value)); a deliberate change to the English prompts means writing it again from here.
import { vi } from 'vitest';
import { checkTranslation, otherSystem, translateChecked, translationMessage, translationSystem, unverifiedDetail, type CheckIssue, type RuleKey } from '../../src/translate/prompt';
import { SYSTEM_PROMPTS, buildUserMessage, systemPromptFor } from '../../src/translate/claudePrompts';
import { claudeBody, parseTranslateBody } from '../../src/translate/claudeServer';
import { createClaudeTranslator, resetClaudeStatus } from '../../src/translate/claude';
import { createAccountTranslator, resetAccountTranslator } from '../../src/translate/account';
import { createChromeTranslator, resetChromeTranslator } from '../../src/translate/chrome';
import { createMyMemoryTranslator } from '../../src/translate/mymemory';
import { createLocalTranslator } from '../../src/translate/localMeaning';
import { setLangForTests } from '../../src/lang/active';
import type { LangId } from '../../src/lang/types';
import type { TranslateRequest } from '../../src/types';

type Other = Exclude<LangId, 'zh'>;
const OTHERS: Other[] = ['ja', 'es', 'fr', 'de', 'it', 'pt', 'ru'];

const TERMS: NonNullable<TranslateRequest['terms']> = [
  { word: '平兒', pinyin: 'ping2 er2', gloss: 'name (person)', kind: 'name' },
  { word: '郭靖', pinyin: 'guo1 jing4', gloss: 'name (person)', kind: 'name' },
  { word: '賈母', pinyin: 'jia3 mu3', gloss: 'name (person)', kind: 'name' },
  { word: '羯鼓', pinyin: 'jie2 gu3', gloss: 'a type of drum', kind: 'term' },
  { word: '打草惊蛇', pinyin: 'da3 cao3 jing1 she2', gloss: 'to tip off the enemy', kind: 'idiom' },
];

/** Requests the prompts and checks are built from: Chinese with names, terms, context and numbers, and each other language. */
const REQUESTS: TranslateRequest[] = [
  { text: '平兒笑道：「我不去。」', context: '鳳姐道：「你去罷。」平兒笑道：「我不去。」', terms: TERMS, mode: 'translate' },
  { text: '郭靖打草惊蛇，買了三斤羯鼓。', context: '郭靖打草惊蛇，買了三斤羯鼓。', terms: TERMS, mode: 'explain' },
  { text: '他在酒店买了一碗温酒。', context: '那日他在酒店买了一碗温酒，坐了半日。', mode: 'translate' },
  { text: '你好。', mode: 'translate' },
  { text: 'En un lugar de la Mancha vivía un hidalgo.', context: 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, vivía un hidalgo.', mode: 'translate', lang: 'es' },
  { text: '吾輩は猫である。名前はまだ無い。', mode: 'explain', lang: 'ja' },
  { text: 'Все счастливые семьи похожи друг на друга.', mode: 'translate', lang: 'ru' },
];

/** Answers the checks read: right ones, and ones with each kind of problem they look for. */
const CHECKS: { req: Pick<TranslateRequest, 'text' | 'terms' | 'lang'>; answer: string; mode?: 'translate' | 'explain' }[] = [
  ...[
    ['平兒笑道：「我不去。」', `Ping'er said with a smile, "I am not going."`], ['平兒笑了。', 'Patience smiled.'], ['賈母笑了。', 'Grandmother Jia smiled.'],
    ['我不去。', 'I will go.'], ['不過一碗酒罷了。', 'It was only a bowl of wine.'], ['你别走。', 'You go.'],
    ['他买了三斤米。', 'He bought some rice.'], ['他买了三斤米。', 'He bought three jin of rice.'], ['五月十一日，他走了。', 'On May 11, he left.'],
    ['贞观十三年九月，他走了。', 'In the thirteenth year of Zhenguan, in the ninth month, he left.'], ['买五七斤肉。', 'Buy five or six catties of meat.'],
    ['他买了两斤米。', 'He bought two kilograms of rice.'], ['他走了。', 'He 走 away.'], ['他走了。', 'He went to jie2 gu3 again.'],
    ['他走了。', 'Here is the translation: He left.'], ['他走了。', 'He left.\n\nCorrection: He went away.'], ['他走了。', 'He left.\n\nHe went away.'],
    ['他走了。\n\n她来了。', 'He left.\n\nShe came.'], ['他从早到晚都在田里干活，一刻也没有停过。', 'He worked.'],
    ['他从早到晚都在田里干活，一刻也没有停过。', Array(80).fill('word').join(' ')], ['1925年，他走了。', 'In 1925 he left.'], ['1925年，他走了。', 'He left.'],
    ['他走了。', ''], ['他走了。', 'Il est parti.'], ['他走了。', 'Он ушёл.'],
  ].map(([text, answer]) => ({ req: { text, terms: TERMS }, answer })),
  { req: { text: '平兒笑道：「我不去。」', terms: TERMS }, answer: 'Patience said.\n\n- 平兒 (Píng\'ér) is a name.', mode: 'explain' },
  { req: { text: '不思議な話だ。', lang: 'ja' }, answer: 'A strange story.' },
  { req: { text: '不思議な話だ。', lang: 'ja' }, answer: 'A 不思議 story.' },
  { req: { text: 'Все счастливые семьи похожи друг на друга.', lang: 'ru' }, answer: 'All happy families are alike.' },
  { req: { text: 'Все счастливые семьи похожи друг на друга.', lang: 'ru' }, answer: 'All счастливые families are alike.' },
  { req: { text: 'Era el año 1605.', lang: 'es' }, answer: 'Here is the translation: It was 1605.' },
  { req: { text: 'Era el año 1605.', lang: 'es' }, answer: 'It was the year.' },
  { req: { text: 'Era el año 1605.', lang: 'es' }, answer: '' },
];

const ndjson = (...events: object[]) => events.map(e => JSON.stringify(e) + '\n').join('');
const issueText = (issues: CheckIssue[]) => issues.map(issue => `${issue.code}: ${issue.message}`);

/**
 * Everything the default sends, as plain data. `to` is passed wherever a translation language can be given; undefined is how
 * every caller asked before the choice existed.
 */
export async function englishOutputs(to?: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const withTo = <T extends object>(r: T): T => (to === undefined ? r : { ...r, to });
  try {
    // ---- instructions
    for (const mode of ['translate', 'explain'] as const) for (const target of ['claude', 'local'] as const) {
      out[`system ${mode} ${target} zh`] = translationSystem(mode, target, {}, undefined, to);
      out[`system ${mode} ${target} zh examples`] = translationSystem(mode, target, { examples: true }, undefined, to);
      out[`system ${mode} ${target} zh some rules`] = translationSystem(mode, target, { rules: ['faithful', 'names', 'data'] as RuleKey[] }, undefined, to);
      for (const lang of OTHERS) {
        out[`system ${mode} ${target} ${lang}`] = translationSystem(mode, target, {}, lang, to);
        out[`other ${mode} ${target} ${lang}`] = otherSystem(lang, mode, target, to);
      }
    }
    out['SYSTEM_PROMPTS'] = SYSTEM_PROMPTS;
    for (const lang of [undefined, ...OTHERS]) for (const mode of ['translate', 'explain'] as const) {
      out[`systemPromptFor ${mode} ${lang ?? 'zh'}`] = systemPromptFor(withTo({ mode, ...(lang ? { lang } : {}) }));
    }
    // ---- messages
    REQUESTS.forEach((req, i) => {
      out[`message ${i}`] = translationMessage(withTo(req));
      out[`message ${i} no spelling`] = translationMessage(withTo(req), { spelling: false, context: 'previous' });
      out[`user message ${i}`] = buildUserMessage(withTo(req));
    });
    // ---- checks
    CHECKS.forEach(({ req, answer, mode }, i) => { out[`check ${i}`] = issueText(checkTranslation(withTo(req), answer, mode)); });
    out['unverified'] = [unverifiedDetail([{ code: 'chinese', message: '' }, { code: 'number', message: '' }]), unverifiedDetail([{ code: 'chinese', message: '' }], 'es')];
    // ---- generate, check, correct
    for (const target of ['claude', 'local'] as const) for (const [i, req] of REQUESTS.entries()) {
      const calls: [string, string][] = [];
      const answers = ['Patience said, "I will go." 走', `Ping'er said, "I will not go."`];
      const result = await translateChecked(withTo(req), async (system, message) => { calls.push([system, message]); return answers[calls.length - 1] ?? ''; }, { target });
      out[`checked ${target} ${i}`] = { calls, result };
    }
    // ---- the servers: what they accept and what they ask Claude
    const bodies: Record<string, unknown>[] = [
      { text: '平兒笑道：「我不去。」', context: '鳳姐道：「你去罷。」平兒笑道：「我不去。」', mode: 'translate', terms: TERMS },
      { text: '你好', mode: 'explain', model: 'claude-haiku-5-5' },
      { text: 'Hola, amigo.', mode: 'translate', lang: 'es' },
      { text: '吾輩は猫である。', mode: 'explain', lang: 'ja', context: '吾輩は猫である。名前はまだ無い。' },
    ];
    bodies.forEach((body, i) => {
      const parsed = parseTranslateBody(withTo(body));
      out[`parsed ${i}`] = parsed;
      if (parsed.ok) out[`claude body ${i}`] = claudeBody(parsed.request, 'low');
    });
    // ---- the clients: what each sends
    for (const lang of ['zh', 'es', 'ja'] as LangId[]) {
      setLangForTests(lang);
      const req = withTo(lang === 'zh' ? REQUESTS[0] : lang === 'es' ? REQUESTS[4] : REQUESTS[5]);
      // Claude, through the Mac.
      resetClaudeStatus();
      const sent: string[] = [];
      const claude = createClaudeTranslator({ claudeModel: '', localOnly: false }, {
        hasBridge: () => true,
        fetch: async (_path, init) => { sent.push(String(init?.body)); return new Response(ndjson({ type: 'text', text: 'Hi' }, { type: 'done', stop: 'end_turn' })); },
      });
      await claude.translate(req);
      out[`claude request ${lang}`] = sent;
      // Qwen, through the account.
      resetAccountTranslator();
      localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
      localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't', email: 'reader@example.com' }));
      const account: string[] = [];
      vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => { account.push(String(init?.body)); return new Response(JSON.stringify({ text: 'Hi' }), { status: 200 }); });
      await createAccountTranslator({ localOnly: false }).translate(req);
      out[`account request ${lang}`] = account;
      vi.unstubAllGlobals();
      localStorage.clear();
      // Chrome on the device.
      resetChromeTranslator();
      const created: unknown[] = [];
      const asked: unknown[] = [];
      (globalThis as { Translator?: unknown }).Translator = {
        availability: async (o: unknown) => { asked.push(o); return 'available'; },
        create: async (o: Record<string, unknown>) => { const { monitor: _m, ...rest } = o; void _m; created.push(rest); return { translate: async (t: string) => `EN:${t}` }; },
      };
      const chrome = createChromeTranslator();
      out[`chrome ${lang}`] = { availability: await chrome.availability(), text: await chrome.translate(req), asked, created };
      delete (globalThis as { Translator?: unknown }).Translator;
      resetChromeTranslator();
      // MyMemory.
      const urls: string[] = [];
      await createMyMemoryTranslator({ fetch: (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ responseData: { translatedText: 'Hi' }, responseStatus: 200 })); }) as unknown as typeof fetch }).translate(req);
      out[`mymemory ${lang}`] = urls;
      // The Mac's local model.
      const generated: unknown[] = [];
      vi.stubGlobal('location', new URL('http://localhost:4317/'));
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'vaultbox/qwen3.5-uncensored:4b' }] }) };
        generated.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => ({ response: 'Hi there, how are you today, friend.' }) };
      });
      await createLocalTranslator().translate(req).catch((e: Error) => generated.push(`error: ${e.message}`));
      out[`local ${lang}`] = generated;
      vi.unstubAllGlobals();
    }
  } finally {
    setLangForTests('zh');
    vi.unstubAllGlobals();
  }
  return JSON.parse(JSON.stringify(out));
}
