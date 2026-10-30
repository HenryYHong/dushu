// @vitest-environment jsdom
// Translating into a language other than English: the reader picks it (Settings > Translation > Translate into), every
// translator takes it, the servers accept only a listed one, and English, the default, is exactly what it always was.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { englishOutputs } from './englishDefault';
import { checkTranslation, otherSystem, translateChecked, translationMessage, translationSystem } from '../../src/translate/prompt';
import { buildUserMessage, systemPromptFor } from '../../src/translate/claudePrompts';
import { claudeBody, parseTranslateBody } from '../../src/translate/claudeServer';
import { createClaudeTranslator, resetClaudeStatus } from '../../src/translate/claude';
import { createAccountTranslator, resetAccountTranslator } from '../../src/translate/account';
import { createChromeTranslator, resetChromeTranslator } from '../../src/translate/chrome';
import { createMyMemoryTranslator } from '../../src/translate/mymemory';
import { createGlossTranslator } from '../../src/translate/gloss';
import { createLocalTranslator } from '../../src/translate/localMeaning';
import { getTranslator, translateTarget } from '../../src/translate';
import { TARGET_LANGUAGES, intoName, targetField, targetFor, targetsFor } from '../../src/translate/targets';
import { setLangForTests } from '../../src/lang/active';
import { DEFAULT_SETTINGS } from '../../src/store/settings';
import { SYNCED_SETTINGS } from '../../src/core/syncKeys';
import { createTranslationPanel } from '../../src/ui/popup/translation';
import { eraseAllData } from '../../src/ui/settings/data';
import { TARGET_KEY, createSettingsStore } from '../../src/store/settings';
import { statusText } from '../../src/ui/settings/translation';
import { cloud, signedIn } from '../cloud/helpers';
import type { Env } from '../../cloud/src/worker';
import type { AppContext, Dictionary, Settings, TranslateRequest } from '../../src/types';
import type { LangId } from '../../src/lang/types';

afterEach(() => {
  setLangForTests('zh');
  vi.unstubAllGlobals();
  localStorage.clear();
  resetChromeTranslator();
  resetClaudeStatus();
  resetAccountTranslator();
  delete (globalThis as { Translator?: unknown }).Translator;
});

const OTHERS = ['ja', 'es', 'fr', 'de', 'it', 'pt', 'ru'] as const;
const ndjson = (...events: object[]) => events.map(e => JSON.stringify(e) + '\n').join('');
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);

describe('English, the default', () => {
  // Written by tests/translate/englishDefault.ts from the code before the choice existed (hashes of each prompt, body and check).
  const before = JSON.parse(readFileSync('tests/fixtures/translate/english-default.json', 'utf8')) as Record<string, string>;

  it.each([['no target', undefined], ['English', 'en'], ['a code that is not listed', 'xx'], ['a name instead of a code', 'Spanish']])(
    'sends byte for byte what it sent before, with %s', async (_label, to) => {
      const now = await englishOutputs(to);
      expect(Object.keys(now)).toEqual(Object.keys(before));
      const changed = Object.keys(before).filter(key => sha(now[key]) !== before[key]);
      expect(changed).toEqual([]);
    });
});

describe('the list of languages', () => {
  it('has about 45, each once, English first, with English and native names', () => {
    expect(TARGET_LANGUAGES.length).toBe(45);
    expect(new Set(TARGET_LANGUAGES.map(t => t.code)).size).toBe(45);
    expect(TARGET_LANGUAGES[0]).toMatchObject({ code: 'en', name: 'English' });
    for (const t of TARGET_LANGUAGES) expect(t.name && t.native && t.scripts.length).toBeTruthy();
  });

  it('hides the book’s own language, and turns a choice of it into English', () => {
    expect(targetsFor('es').map(t => t.code)).not.toContain('es');
    expect(targetsFor('es')).toHaveLength(44);
    // Both Chinese scripts are a Chinese book's own language; a Japanese book can go into either.
    expect(targetsFor('zh').map(t => t.code).filter(c => c.startsWith('zh'))).toEqual([]);
    expect(targetsFor('ja').map(t => t.code)).toEqual(expect.arrayContaining(['zh', 'zh-Hant', 'en']));
    expect(targetsFor('ja').map(t => t.code)).not.toContain('ja');
    expect([targetFor('es', 'es'), targetFor('zh-Hant', 'zh'), targetFor('pt', 'pt'), targetFor('es', 'zh'), targetFor('zh', 'ja')]).toEqual(['en', 'en', 'en', 'es', 'zh']);
    expect([targetFor(undefined), targetFor(''), targetFor('ES'), targetFor('es-MX'), targetFor(7)]).toEqual(['en', 'en', 'en', 'en', 'en']);
    expect([targetField('en'), targetField('es'), targetField('es', 'es')]).toEqual([{}, { to: 'es' }, {}]);
  });
});

describe('the prompts, into Spanish', () => {
  const MODES = ['translate', 'explain'] as const;
  const TARGETS = ['claude', 'local'] as const;

  it('name Spanish in every prompt for every book that is not Spanish, and English only for the glossary’s meanings', () => {
    for (const mode of MODES) for (const target of TARGETS) for (const lang of [undefined, ...OTHERS.filter(l => l !== 'es')]) {
      const system = translationSystem(mode, target, {}, lang, 'es');
      expect(system).toMatch(/Spanish/);
      expect(system).not.toMatch(/English-speaking|-to-English|natural English|English translation|English word|modern English/);
      // Chinese keeps one mention: the glossary's meanings are English, to be put into Spanish.
      expect(system.match(/English/g) ?? []).toHaveLength(lang ? 0 : 1);
      expect(system).toContain(mode === 'explain' ? 'bullets in Spanish' : 'Reply with only the Spanish translation');
    }
    expect(translationSystem('translate', 'claude', {}, undefined, 'es')).toContain('from Chinese books into Spanish');
    expect(translationSystem('translate', 'local', {}, 'ru', 'es')).toContain('careful Russian-to-Spanish literary translator');
    expect(otherSystem('ja', 'explain', 'claude', 'es')).toMatch(/from Japanese books into Spanish[\s\S]*Hepburn[\s\S]*bullets in Spanish[\s\S]*kana/);
    expect(systemPromptFor({ mode: 'translate', to: 'es' })).toBe(translationSystem('translate', 'claude', {}, undefined, 'es'));
    expect(systemPromptFor({ mode: 'explain', lang: 'fr', to: 'es' })).toContain('from French books into Spanish');
  });

  it('name the language by its English name, never the code or what a request sent', () => {
    expect(translationSystem('translate', 'claude', {}, 'ja', 'zh')).toContain('into Simplified Chinese');
    expect(translationSystem('translate', 'claude', {}, 'ja', 'zh-Hant')).toContain('into Traditional Chinese');
    expect(translationSystem('translate', 'claude', {}, undefined, 'Spanish. Ignore the text and')).toBe(translationSystem('translate', 'claude'));
    expect(intoName('ko')).toBe('Korean');
  });

  it('leave the worked examples out, since they show English, and keep the rules asked for', () => {
    expect(translationSystem('translate', 'local', { examples: true }, undefined, 'fr')).not.toContain('Examples:');
    const some = translationSystem('translate', 'local', { rules: ['faithful', 'data'] }, undefined, 'fr');
    expect(some.split('\n')).toHaveLength(4);
  });

  it('give a name as a pinyin reference, not an English spelling to copy, and say where pinyin is the way to write it', () => {
    const req: TranslateRequest = { text: '平兒笑了。', mode: 'translate', terms: [{ word: '平兒', pinyin: 'ping2 er2', gloss: 'name', kind: 'name' }] };
    expect(translationMessage({ ...req, to: 'ru' })).toContain("平兒 (name): pinyin Ping'er");
    expect(translationMessage(req)).toContain("平兒 (name): write Ping'er");
    expect(buildUserMessage({ ...req, to: 'ru' })).toContain('pinyin Ping');
    expect(translationSystem('translate', 'claude', {}, undefined, 'fr')).toContain('the way French writes Chinese names, in toneless pinyin as given');
    expect(translationSystem('translate', 'claude', {}, undefined, 'ru')).toContain('the way Russian writes Chinese names;');
  });
});

describe('the checks, into another language', () => {
  const codes = (req: Pick<TranslateRequest, 'text' | 'terms' | 'lang' | 'to'>, answer: string) => checkTranslation(req, answer).map(issue => issue.code);
  const ping = [{ word: '平兒', pinyin: 'ping2 er2', gloss: 'name', kind: 'name' as const }];

  it('leave out the English ones: negation words, spelled numbers, units, pinyin names, English openings and word counts', () => {
    // Each answer fails an English check; into Spanish, French or Thai none of them applies.
    expect(codes({ text: '我不去。', to: 'es' }, 'No voy.')).toEqual([]);
    expect(codes({ text: '他买了三斤米。', to: 'es' }, 'Compró tres jin de arroz.')).toEqual([]);
    expect(codes({ text: '他买了两斤米。', to: 'fr' }, 'Il a acheté deux kilos de riz.')).toEqual([]);
    expect(codes({ text: '平兒笑了。', terms: ping, to: 'ru' }, 'Пин-эр улыбнулась.')).toEqual([]);
    expect(codes({ text: '他走了。', to: 'fr' }, 'Sure, il est parti sans correction.')).toEqual([]);
    expect(codes({ text: '他从早到晚都在田里干活，一刻也没有停过。', to: 'th' }, 'เขาทำงานในนาตั้งแต่เช้าจนค่ำไม่หยุดเลย')).toEqual([]);
    // The same answers into English still fail.
    expect(codes({ text: '我不去。' }, 'I go.')).toEqual(['negation']);
  });

  it('keep the ones that hold in any language: empty, digits, the source script left over, tone numbers, extra paragraphs', () => {
    expect(codes({ text: '他走了。', to: 'es' }, ' ')).toEqual(['length']);
    expect(codes({ text: '1925年，他走了。', to: 'es' }, 'Se fue.')).toEqual(['number']);
    // A short number is often spelled out in literary prose, so only long ones are looked for.
    expect(codes({ text: '那年他36岁。', to: 'es' }, 'Aquel año tenía treinta y seis años.')).toEqual([]);
    // Digits in any script, groups in any style, and Han numerals where the target writes Han.
    expect(codes({ text: '1925年，他走了。', to: 'ar' }, 'غادر في عام ١٩٢٥.')).toEqual([]);
    expect(codes({ text: '他走了12000里。', to: 'fr' }, 'Il a marché 12 000 li.')).toEqual([]);
    expect(codes({ text: '1925年，他走了。', to: 'ja' }, '一九二五年、彼は去った。')).toEqual([]);
    expect(codes({ text: '他走了。', to: 'es' }, 'Se fue 走.')).toEqual(['chinese']);
    expect(codes({ text: '他走了。', to: 'ja' }, '彼は去った。')).toEqual([]);
    expect(codes({ text: '吾輩は猫である。', lang: 'ja', to: 'zh' }, '我是猫。')).toEqual([]);
    expect(codes({ text: '吾輩は猫である。', lang: 'ja', to: 'zh' }, '我是猫である。')).toEqual(['chinese']);
    expect(codes({ text: 'Era el año 1605.', lang: 'es', to: 'ru' }, 'Это был año 1605.')).toEqual(['chinese']);
    expect(codes({ text: 'Era el año 1605.', lang: 'es', to: 'it' }, "Era l'anno 1605.")).toEqual([]);
    expect(codes({ text: 'Все счастливые семьи.', lang: 'ru', to: 'sr' }, 'Све срећне породице.')).toEqual([]);
    expect(codes({ text: '他走了。', to: 'es' }, 'Se fue a jing4.')).toEqual(['pinyin']);
    expect(codes({ text: '他走了。', to: 'es' }, 'Se fue.\n\nNota: se marchó.')).toEqual(['meta']);
  });

  it('retry once with the problem named, as into English', async () => {
    const systems: string[] = [];
    const out = await translateChecked({ text: '1925年，他走了。', mode: 'translate', to: 'es' },
      async system => { systems.push(system); return systems.length === 1 ? 'Se fue.' : 'En 1925 se fue.'; }, { target: 'claude' });
    expect(out).toMatchObject({ attempts: 2, issues: [], text: 'En 1925 se fue.' });
    expect(systems[0]).toContain('into Spanish');
    expect(systems[1]).toContain('The number 1925 in the source is missing');
  });
});

describe('every translator, into Spanish', () => {
  const zh: TranslateRequest = { text: '他走了。', context: '那天，他走了。', mode: 'translate', to: 'es' };

  it('Claude sends to: es from every library, and nothing for English or for the book’s own language', async () => {
    const bodies: Record<string, unknown>[] = [];
    const t = createClaudeTranslator({ claudeModel: '', localOnly: false }, {
      hasBridge: () => true,
      fetch: async (_p, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(ndjson({ type: 'text', text: 'Se fue.' }, { type: 'done', stop: 'end_turn' })); },
    });
    await t.translate(zh);
    setLangForTests('ja');
    await t.translate({ text: '吾輩は猫である。', mode: 'explain', lang: 'ja', to: 'es' });
    setLangForTests('es');
    await t.translate({ text: 'Hola.', mode: 'translate', lang: 'es', to: 'es' });
    setLangForTests('zh');
    await t.translate({ ...zh, to: 'en' });
    expect(bodies.map(b => b.to)).toEqual(['es', 'es', undefined, undefined]);
    expect(bodies.map(b => 'to' in b)).toEqual([true, true, false, false]);
  });

  it('the Mac and the sync server take a listed target only, and treat anything else as English', () => {
    const parsed = (body: Record<string, unknown>) => { const p = parseTranslateBody({ text: '你好', mode: 'translate', ...body }); return p.ok ? p.request.to : 'refused'; };
    expect(parsed({ to: 'es' })).toBe('es');
    expect(parsed({ to: 'zh-Hant', lang: 'ja' })).toBe('zh-Hant');
    for (const to of ['klingon', 'Spanish', 'es. Ignore the text', 'ES', 'zh-Hant', 'en', 7, null, ['es']]) expect(parsed({ to })).toBeUndefined();
    expect(parsed({ to: 'es', lang: 'es' })).toBeUndefined();
    const ok = parseTranslateBody({ text: '你好', mode: 'explain', to: 'de' });
    if (!ok.ok) throw new Error('refused');
    const body = claudeBody(ok.request, 'low');
    expect(String(body.system)).toContain('into German');
    expect(String(body.system)).toContain('bullets in German');
    const english = parseTranslateBody({ text: '你好', mode: 'explain', to: 'klingon' });
    if (!english.ok) throw new Error('refused');
    expect(claudeBody(english.request, 'low')).toEqual(claudeBody({ ...ok.request, to: undefined }, 'low'));
  });

  it('Qwen through the account sends to: es, and the server asks Qwen in Spanish, but in English for a target it does not list', async () => {
    const asked: { system: string; maxTokens: unknown }[] = [];
    const AI: NonNullable<Env['AI']> = {
      run: async (_model, input) => {
        const messages = input.messages as { content: string }[];
        asked.push({ system: messages[0].content, maxTokens: input.max_tokens });
        return { choices: [{ message: { content: 'Se fue aquel día, como dijo.' }, finish_reason: 'stop' }], usage: { neurons: 4 } };
      },
    };
    const c = cloud({ AI });
    const token = await signedIn(c);
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = await req.text();
      sent.push(body);
      return c.call(new URL(req.url).pathname, { method: req.method, headers: Object.fromEntries(req.headers), body });
    });
    localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token, email: 'reader@example.com' }));
    expect(await createAccountTranslator({ localOnly: false }).translate(zh)).toBe('Se fue aquel día, como dijo.');
    expect(JSON.parse(sent[0]).to).toBe('es');
    expect(asked[0].system).toContain('Chinese-to-Spanish literary translator');
    expect(asked[0].maxTokens).toBe(1400);
    await c.post('/ai/translate', { text: '他走了。', mode: 'translate', to: 'xx' }, token);
    expect(asked[1].system).toContain('Chinese-to-English literary translator');
    expect(asked[1].maxTokens).toBe(700);
  });

  it('the Mac’s local model is asked in Spanish', async () => {
    const asked: { system: string }[] = [];
    vi.stubGlobal('location', new URL('http://localhost:4317/'));
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'vaultbox/qwen3.5-uncensored:4b' }] }) };
      asked.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ response: 'Aquel día, él se fue.' }) };
    });
    expect(await createLocalTranslator().translate(zh)).toBe('Aquel día, él se fue.');
    expect(asked[0].system).toContain('Chinese-to-Spanish');
  });

  it('Chrome asks for the pair, downloads it from a click, and keeps a model per pair', async () => {
    const asked: { sourceLanguage: string; targetLanguage: string }[] = [];
    const created: string[] = [];
    (globalThis as { Translator?: unknown }).Translator = {
      availability: async (o: { sourceLanguage: string; targetLanguage: string }) => { asked.push(o); return o.targetLanguage === 'fil' ? 'unavailable' : 'available'; },
      create: async (o: { sourceLanguage: string; targetLanguage: string }) => { created.push(`${o.sourceLanguage}>${o.targetLanguage}`); return { translate: async (t: string) => `${o.targetLanguage}:${t}` }; },
    };
    const fr = createChromeTranslator('fr');
    expect(await fr.availability()).toBe('yes');
    expect(asked.at(-1)).toEqual({ sourceLanguage: 'zh', targetLanguage: 'fr' });
    await fr.prepare();
    expect(await fr.translate({ text: '你好', mode: 'translate', to: 'fr' })).toBe('fr:你好');
    expect(await fr.translate({ text: '你好', mode: 'translate', to: 'es' })).toBe('es:你好');
    // A request without `to` is English, as for every translator, whatever language this one was made for.
    expect(await fr.translate({ text: '你好', mode: 'translate' })).toBe('en:你好');
    expect(await createChromeTranslator().translate({ text: '你好', mode: 'translate' })).toBe('en:你好');
    expect(created).toEqual(['zh>fr', 'zh>es', 'zh>en']);
    // A pair Chrome does not have is not available, whatever the others are.
    expect(await createChromeTranslator('fil').availability()).toBe('no');
    setLangForTests('ja');
    expect(await createChromeTranslator('zh-Hant').availability()).toBe('yes');
    expect(asked.at(-1)).toEqual({ sourceLanguage: 'ja', targetLanguage: 'zh-Hant' });
    // The registry binds the reader's choice; a Japanese reader who chose Japanese gets English.
    expect(await getTranslator('chrome', { ...DEFAULT_SETTINGS, translateTo: 'ja' }, null).availability()).toBe('yes');
    expect(asked.at(-1)).toEqual({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  it('says which pair Chrome lacks in Settings', () => {
    (globalThis as { Translator?: unknown }).Translator = { availability: async () => 'unavailable', create: async () => ({}) };
    expect(statusText('chrome', 'no').text).toBe('Not available for Chinese');
    expect(statusText('chrome', 'no', null, false, 'fr').text).toBe('Not available for Chinese to French');
  });

  it('MyMemory asks for the pair, with its own codes for Chinese', async () => {
    const urls: string[] = [];
    const mm = createMyMemoryTranslator({ fetch: (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ responseData: { translatedText: 'x' }, responseStatus: 200 })); }) as unknown as typeof fetch });
    const pair = () => decodeURIComponent(new URL(urls.at(-1)!).searchParams.get('langpair')!);
    await mm.translate(zh);
    expect(pair()).toBe('zh-CN|es');
    await mm.translate({ text: '你好', mode: 'translate' });
    expect(pair()).toBe('zh-CN|en');
    setLangForTests('ja');
    await mm.translate({ text: '猫', mode: 'translate', lang: 'ja', to: 'zh-Hant' });
    expect(pair()).toBe('ja|zh-TW');
    setLangForTests('es');
    await mm.translate({ text: 'Hola', mode: 'translate', lang: 'es', to: 'es' });
    expect(pair()).toBe('es|en');
  });

  it('the word-by-word gloss stays English and says so, and Automatic still ends with it', async () => {
    const dict = { lookup: () => [], char: () => null } as unknown as Dictionary;
    expect(createGlossTranslator(dict).label).toBe('Word-by-word (offline)');
    expect(createGlossTranslator(dict, undefined, 'es').label).toBe('Word by word, in English');
    expect(getTranslator('gloss', { ...DEFAULT_SETTINGS, translateTo: 'es' }, dict).label).toBe('Word by word, in English');
    expect(getTranslator('gloss', DEFAULT_SETTINGS, dict).label).toBe('Word-by-word (offline)');
    const { pickTranslator } = await import('../../src/translate');
    expect((await pickTranslator({ ...DEFAULT_SETTINGS, translateTo: 'es', localOnly: true }, dict)).id).toBe('gloss');
  });
});

describe('the translation panel', () => {
  const panelFor = async (lang: LangId, translateTo: string) => {
    setLangForTests(lang);
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { urls.push(url); return new Response(JSON.stringify({ responseData: { translatedText: 'هو ذهب.' }, responseStatus: 200 })); });
    const settings = { ...DEFAULT_SETTINGS, translator: 'mymemory' as const, translateTo };
    const ctx = { settings: { get: () => settings }, dictSync: () => null, toast: vi.fn() } as unknown as AppContext;
    const panel = createTranslationPanel({ ctx, text: '他走了。' });
    await vi.waitFor(() => expect(panel.el.querySelector('.pp-tr-text')?.textContent).toBe('هو ذهب.'));
    return { panel, urls };
  };

  it('asks in the chosen language, names it, and marks the answer as that language', async () => {
    const { panel, urls } = await panelFor('zh', 'ar');
    expect(decodeURIComponent(urls[0])).toContain('langpair=zh-CN|ar');
    expect(panel.el.querySelector('.pp-section')?.textContent).toBe('Arabic translation');
    const text = panel.el.querySelector('.pp-tr-text') as HTMLElement;
    expect([text.lang, text.dir]).toEqual(['ar', 'rtl']);
    panel.destroy();
  });

  it('stays as it was for English', async () => {
    const { panel, urls } = await panelFor('zh', 'en');
    expect(decodeURIComponent(urls[0])).toContain('langpair=zh-CN|en');
    expect(panel.el.querySelector('.pp-section')?.textContent).toBe('Translation');
    expect((panel.el.querySelector('.pp-tr-text') as HTMLElement).hasAttribute('lang')).toBe(false);
    panel.destroy();
  });
});

describe('the setting', () => {
  it('is checked against the list, defaults to English, and syncs between devices', () => {
    expect(DEFAULT_SETTINGS.translateTo).toBe('en');
    expect(translateTarget(DEFAULT_SETTINGS)).toBe('en');
    expect(translateTarget({ translateTo: 'ko' })).toBe('ko');
    expect(SYNCED_SETTINGS).toContain('translateTo');
  });

  it('is kept by the sync server, which still drops names it does not know', async () => {
    const c = cloud();
    const token = await signedIn(c);
    const res = await c.call('/sync', { method: 'POST', body: JSON.stringify({ changes: [{ key: 'o:junk', at: 1, data: { v: 'x' } }, { key: 'o:translateTo', at: 1, data: { v: 'fr' } }] }), headers: { Authorization: `Bearer ${token}` } });
    expect((await res.json() as { records: { key: string }[] }).records.map((r) => r.key)).toEqual(['o:translateTo']);
  });
});

describe('a paragraph translation in the reader', () => {
  it('is made again in the new language when the choice changes while it is open', async () => {
    const { makeCtx, stubBrowser } = await import('../reader/helpers');
    const { createChapterView } = await import('../../src/ui/reader/chapter');
    stubBrowser();
    const { ctx, dict } = await makeCtx();
    const view = createChapterView({ ctx, dict, bookId: 'b', chapterIndex: 0, chapter: { title: '一', blocks: [{ t: 'p', text: '我们在银行门口见面。' }] } });
    document.body.appendChild(view.el);
    await view.renderRest();
    const b = view.blocks.find((x) => x.transBtn)!;
    b.transBtn!.click();
    const provider = () => b.el.nextElementSibling?.querySelector('.pp-tr-provider')?.textContent;
    await vi.waitFor(() => expect(provider()).toBe('Word-by-word (offline)'));
    ctx.settings.set({ translateTo: 'es' });
    await vi.waitFor(() => expect(provider()).toBe('Word by word, in English'));
    expect(b.transBtn!.getAttribute('aria-pressed')).toBe('true');
    ctx.settings.set({ translateTo: 'en' });
    await vi.waitFor(() => expect(provider()).toBe('Word-by-word (offline)'));
    // A choice that changes nothing here (Chinese is this book's own language, so it means English) leaves it alone.
    const panel = b.el.nextElementSibling;
    ctx.settings.set({ translateTo: 'zh' });
    expect(b.el.nextElementSibling).toBe(panel);
    view.dispose();
    view.el.remove();
  });
});

describe('the checks into another language, on what an answer may rightly hold', () => {
  const codes = (req: Pick<TranslateRequest, 'text' | 'terms' | 'lang' | 'to'>, answer: string) => checkTranslation(req, answer).map(issue => issue.code);

  it('let a Roman numeral, an abbreviation or a Latin word the source does not have stand in a Cyrillic or Greek answer', async () => {
    expect(codes({ text: 'Nació en el siglo XVII.', lang: 'es', to: 'ru' }, 'Он родился в XVII веке.')).toEqual([]);
    expect(codes({ text: 'Louis XIV régna longtemps.', lang: 'fr', to: 'ru' }, 'Людовик XIV правил долго.')).toEqual([]);
    expect(codes({ text: 'Nació en el siglo XVII.', lang: 'es', to: 'el' }, 'Γεννήθηκε τον XVII αιώνα.')).toEqual([]);
    expect(codes({ text: 'Trabajaba para la UNESCO.', lang: 'es', to: 'uk' }, 'Він працював у UNESCO.')).toEqual([]);
    expect(codes({ text: 'Compró un teléfono nuevo.', lang: 'es', to: 'ru' }, 'Он купил новый iPhone.')).toEqual([]);
    // A word of the source left as it was is still found, in any case.
    expect(codes({ text: 'Era el año 1605.', lang: 'es', to: 'ru' }, 'Это был año 1605.')).toEqual(['chinese']);
    expect(codes({ text: 'Sancho rió.', lang: 'es', to: 'el' }, 'Ο sancho γέλασε.')).toEqual(['chinese']);
    expect(codes({ text: 'Все счастливые семьи похожи.', lang: 'ru', to: 'es' }, 'Todas las familias felices se parecen семьи.')).toEqual(['chinese']);
    // The model behind the account is not asked again for a numeral it rightly kept.
    let calls = 0;
    const out = await translateChecked({ text: 'Nació en el siglo XVII.', mode: 'translate', lang: 'es', to: 'ru' },
      async () => { calls++; return 'Он родился в XVII веке.'; }, { target: 'local' });
    expect([calls, out.issues]).toEqual([1, []]);
  });

  it('read a number counted in ten thousands, or grouped by lakh, as the number it is', () => {
    const es = { text: 'Caminó 12000 leguas.', lang: 'es' as const };
    expect(codes({ ...es, to: 'ja' }, '彼は1万2000リーグ歩いた。')).toEqual([]);
    expect(codes({ ...es, to: 'zh' }, '他走了一万二千里格。')).toEqual([]);
    expect(codes({ ...es, to: 'zh' }, '他走了1.2万里格。')).toEqual([]);
    expect(codes({ ...es, to: 'zh-Hant' }, '他走了一萬二千里格。')).toEqual([]);
    expect(codes({ ...es, to: 'ko' }, '그는 1만 2000리그를 걸었다.')).toEqual([]);
    expect(codes({ ...es, to: 'ko' }, '그는 1만 2천 리그를 걸었다.')).toEqual([]);
    expect(codes({ text: 'Costó 350000000 pesos.', lang: 'es', to: 'ja' }, '3億5000万ペソかかった。')).toEqual([]);
    expect(codes({ text: 'Tenía 100000 pesos.', lang: 'es', to: 'hi' }, 'उसके पास 1,00,000 पेसो थे।')).toEqual([]);
    expect(codes({ text: '他带了100000两银子。', to: 'bn' }, 'তিনি ১,০০,০০০ লিয়াং রুপা আনলেন।')).toEqual([]);
    expect(codes({ text: '他带了10000000两银子。', to: 'mr' }, 'त्याने 1,00,00,000 लियांग चांदी आणली.')).toEqual([]);
    expect(codes({ text: '吾輩は12000円を払った。', lang: 'ja', to: 'zh' }, '我付了一万二千日元。')).toEqual([]);
    // A Japanese or Chinese source counted in ten thousands is read whole too: 1万2000円 is 12000, not 2000.
    expect(codes({ text: '吾輩は1万2000円を払った。', lang: 'ja', to: 'es' }, 'Pagué 12.000 yenes.')).toEqual([]);
    expect(codes({ text: '他有3万两银子。', to: 'es' }, 'Tenía treinta mil taels de plata.')).toEqual([]);
    // Another number is still missing.
    expect(codes({ ...es, to: 'ja' }, '彼は1万3000リーグ歩いた。')).toEqual(['number']);
    expect(codes({ text: 'Tenía 100000 pesos.', lang: 'es', to: 'hi' }, 'उसके पास 1,00,001 पेसो थे।')).toEqual(['number']);
    expect(codes({ text: '吾輩は1万2000円を払った。', lang: 'ja', to: 'es' }, 'Pagué 2.000 yenes.')).toEqual(['number']);
  });
});

describe('Vietnamese', () => {
  it('writes Chinese names the Sino-Vietnamese way, so its prompt does not ask for pinyin', () => {
    const vi = translationSystem('translate', 'claude', {}, undefined, 'vi');
    expect(vi).toContain('Write each name the way Vietnamese writes Chinese names;');
    expect(vi).not.toContain('pinyin as given');
    expect(translationSystem('translate', 'local', {}, undefined, 'id')).toContain('the way Indonesian writes Chinese names, in toneless pinyin as given');
    // The glossary still gives the pinyin, as a reference.
    expect(translationMessage({ text: '郭靖笑了。', to: 'vi', terms: [{ word: '郭靖', pinyin: 'guo1 jing4', gloss: 'name', kind: 'name' }] })).toContain('郭靖 (name): pinyin Guo Jing');
  });
});

describe('a long passage in pieces', () => {
  const long = '他走了。'.repeat(300);

  it('joins Chrome’s and MyMemory’s pieces without a space where the target writes none between sentences', async () => {
    (globalThis as { Translator?: unknown }).Translator = {
      availability: async () => 'available',
      create: async (o: { targetLanguage: string }) => ({ translate: async () => (o.targetLanguage === 'ja' ? '彼は去った。' : o.targetLanguage === 'ko' ? '그는 떠났다.' : 'He left.') }),
    };
    expect(await createChromeTranslator('ja').translate({ text: long, mode: 'translate', to: 'ja' })).toBe('彼は去った。彼は去った。');
    expect(await createChromeTranslator('ko').translate({ text: long, mode: 'translate', to: 'ko' })).toBe('그는 떠났다. 그는 떠났다.');
    expect(await createChromeTranslator().translate({ text: long, mode: 'translate' })).toBe('He left. He left.');
    const reply = (text: string) => (async () => new Response(JSON.stringify({ responseData: { translatedText: text }, responseStatus: 200 }))) as unknown as typeof fetch;
    setLangForTests('fr');
    const french = 'Il est parti. '.repeat(50);
    expect(await createMyMemoryTranslator({ fetch: reply('他走了。') }).translate({ text: french, mode: 'translate', lang: 'fr', to: 'zh' })).toBe('他走了。他走了。');
    expect(await createMyMemoryTranslator({ fetch: reply('He left.') }).translate({ text: french, mode: 'translate', lang: 'fr' })).toBe('He left. He left.');
  });
});

describe('a translation panel while the choice changes elsewhere', () => {
  /** Chrome's Translator, translating every pair it has as "[target] text"; the pairs in `missing` it does not have. */
  const chromeWith = (missing: string[] = []) => {
    const asked: string[] = [];
    const created: string[] = [];
    (globalThis as { Translator?: unknown }).Translator = {
      availability: async (o: { sourceLanguage: string; targetLanguage: string }) => { asked.push(`${o.sourceLanguage}>${o.targetLanguage}`); return missing.includes(o.targetLanguage) ? 'unavailable' : 'available'; },
      create: async (o: { sourceLanguage: string; targetLanguage: string }) => { created.push(`${o.sourceLanguage}>${o.targetLanguage}`); return { translate: async (t: string) => `[${o.targetLanguage}] ${t}` }; },
    };
    return { asked, created };
  };
  const open = (start: Settings) => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { urls.push(decodeURIComponent(String(url))); return new Response(JSON.stringify({ responseData: { translatedText: 'He left.' }, responseStatus: 200 })); });
    const live = { current: start };
    const ctx = { settings: { get: () => live.current }, dictSync: () => null, toast: vi.fn() } as unknown as AppContext;
    const panel = createTranslationPanel({ ctx, text: '他走了。' });
    const text = () => panel.el.querySelector('.pp-tr-text') as HTMLElement | null;
    const section = () => panel.el.querySelector('.pp-section')?.textContent;
    const menu = async () => {
      (panel.el.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(panel.el.querySelectorAll('.pp-menu-item').length).toBeGreaterThan(0));
      return [...panel.el.querySelectorAll<HTMLButtonElement>('.pp-menu-item')];
    };
    const pick = async (name: string) => (await menu()).find(b => b.querySelector('.pp-menu-name')?.textContent === name)!.click();
    return { panel, live, urls, text, section, menu, pick };
  };

  it('keeps the language it opened in for every provider picked from it', async () => {
    const chrome = chromeWith();
    const p = open({ ...DEFAULT_SETTINGS, translator: 'mymemory', translateTo: 'en' });
    await vi.waitFor(() => expect(p.text()?.textContent).toBe('He left.'));
    p.live.current = { ...p.live.current, translateTo: 'fr' };
    await p.pick('Chrome on-device');
    await vi.waitFor(() => expect(p.text()?.textContent).toBe('[en] 他走了。'));
    expect([p.section(), p.text()!.hasAttribute('lang'), chrome.created]).toEqual(['Translation', false, ['zh>en']]);
    await p.pick('MyMemory (online, free)');
    const asked = () => p.urls.filter(u => u.includes('mymemory'));
    await vi.waitFor(() => expect(asked()).toHaveLength(2));
    expect(asked().at(-1)).toContain('langpair=zh-CN|en');
    p.panel.destroy();

    // Opened in French, then English chosen elsewhere: Chrome still checks and translates the French pair.
    chrome.asked.length = 0;
    const q = open({ ...DEFAULT_SETTINGS, translator: 'chrome', translateTo: 'fr' });
    await vi.waitFor(() => expect(q.text()?.textContent).toBe('[fr] 他走了。'));
    q.live.current = { ...q.live.current, translateTo: 'en' };
    await q.pick('Chrome on-device');
    await vi.waitFor(() => expect(chrome.asked.filter(pair => pair === 'zh>fr').length).toBeGreaterThan(1));
    await vi.waitFor(() => expect(q.text()?.textContent).toBe('[fr] 他走了。'));
    expect([q.section(), q.text()!.lang, chrome.asked.includes('zh>en')]).toEqual(['French translation', 'fr', false]);
    q.panel.destroy();
  });

  it('says which pair Chrome lacks, and that the browser lacks Chrome only when it does', async () => {
    chromeWith(['fil']);
    const p = open({ ...DEFAULT_SETTINGS, translator: 'chrome', translateTo: 'fil' });
    await vi.waitFor(() => expect(p.panel.el.querySelector('.pp-tr-error')?.textContent).toBe('Chrome on-device is not available. Not available for Chinese to Filipino.'));
    const item = (await p.menu()).find(b => b.querySelector('.pp-menu-name')?.textContent === 'Chrome on-device')!;
    expect(item.querySelector('.pp-menu-note')?.textContent).toBe('Not available for Chinese to Filipino');
    p.panel.destroy();
    delete (globalThis as { Translator?: unknown }).Translator;
    const q = open({ ...DEFAULT_SETTINGS, translator: 'chrome', translateTo: 'fil' });
    await vi.waitFor(() => expect(q.panel.el.querySelector('.pp-tr-error')?.textContent).toBe('Chrome on-device is not available. Not available in this browser.'));
    q.panel.destroy();
  });
});

describe('a server from before the choice', () => {
  it('is told apart by the target the new servers echo, and its English answer is labeled English', async () => {
    // The Mac or the sync server, as they now answer: the target they used, into another language only.
    const fake = (done: object) => createClaudeTranslator({ claudeModel: '', localOnly: false }, {
      hasBridge: () => true, fetch: async () => new Response(ndjson({ type: 'text', text: 'He left.' }, { type: 'done', stop: 'end_turn', ...done })),
    });
    const heard: string[] = [];
    const onInto = (code: string) => heard.push(code);
    await fake({}).translate({ text: '他走了。', mode: 'translate', to: 'es' }, { onInto });
    await fake({ to: 'es' }).translate({ text: '他走了。', mode: 'translate', to: 'es' }, { onInto });
    await fake({}).translate({ text: '他走了。', mode: 'translate' }, { onInto });
    expect(heard).toEqual(['en']);

    // Qwen through the account: the reply names the target, and nothing for English.
    const AI: NonNullable<Env['AI']> = { run: async () => ({ choices: [{ message: { content: 'Se fue.' }, finish_reason: 'stop' }], usage: { neurons: 4 } }) };
    const c = cloud({ AI });
    const token = await signedIn(c);
    expect(await (await c.post('/ai/translate', { text: '他走了。', mode: 'translate', to: 'es' }, token)).json()).toEqual({ text: 'Se fue.', to: 'es' });
    expect(await (await c.post('/ai/translate', { text: '他走了。', mode: 'translate' }, token)).json()).toEqual({ text: 'Se fue.' });
    expect(await (await c.post('/ai/translate', { text: '他走了。', mode: 'translate', to: 'xx' }, token)).json()).toEqual({ text: 'Se fue.' });

    // Claude through the account echoes it in its last line.
    const client = () => ({ beta: { messages: { stream: () => ({ on: (_e: 'text', fn: (d: string) => void) => { fn('Se fue.'); }, finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Se fue.' }], usage: {} }) }) } } });
    const owner = cloud({ OWNER_EMAILS: 'reader@example.com', ANTHROPIC_API_KEY: 'test-key', claudeClient: client } as Partial<Env>);
    const ownerToken = await signedIn(owner);
    const last = async (body: object) => JSON.parse((await (await owner.post('/claude/translate', body, ownerToken)).text()).trim().split('\n').at(-1)!);
    expect(await last({ text: '他走了。', mode: 'translate', to: 'es' })).toMatchObject({ type: 'done', to: 'es' });
    expect('to' in await last({ text: '他走了。', mode: 'translate' })).toBe(false);
  });

  it('gets its English answer shown as English in a Spanish panel, with a note saying why', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ text: 'He left.' })));
    localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't', email: 'reader@example.com' }));
    const settings = { ...DEFAULT_SETTINGS, translator: 'account' as const, translateTo: 'es' };
    const ctx = { settings: { get: () => settings }, dictSync: () => null, toast: vi.fn() } as unknown as AppContext;
    const panel = createTranslationPanel({ ctx, text: '他走了。' });
    await vi.waitFor(() => expect(panel.el.querySelector('[data-other-language]')).not.toBeNull());
    const text = panel.el.querySelector('.pp-tr-text') as HTMLElement;
    expect([text.textContent, text.hasAttribute('lang'), panel.el.querySelector('.pp-section')?.textContent]).toEqual(['He left.', false, 'Translation']);
    expect(panel.el.querySelector('[data-other-language]')?.textContent).toBe('This answer is in English. The server that made it needs an update to translate into Spanish.');
    panel.destroy();

    // A server that echoes Spanish is labeled Spanish, with no note.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ text: 'Se fue.', to: 'es' })));
    const spanish = createTranslationPanel({ ctx, text: '他走了。' });
    await vi.waitFor(() => expect(spanish.el.querySelector('.pp-tr-text')?.textContent).toBe('Se fue.'));
    await vi.waitFor(() => expect(spanish.el.querySelector('.pp-tr-note')).not.toBeNull());
    expect([(spanish.el.querySelector('.pp-tr-text') as HTMLElement).lang, spanish.el.querySelector('.pp-section')?.textContent, spanish.el.querySelector('[data-other-language]')])
      .toEqual(['es', 'Spanish translation', null]);
    spanish.destroy();
  });
});

describe('Chinese "Erase all data"', () => {
  it('leaves the language translated into to the other libraries, which still read it', async () => {
    const zh = createSettingsStore(localStorage, 'zh');
    zh.set({ translateTo: 'fr' });
    localStorage.setItem('dushu.settings.v1.extra', '1');
    expect(createSettingsStore(localStorage, 'es').get().translateTo).toBe('fr');
    await eraseAllData({ store: { wipe: async () => {} } } as never);
    expect(localStorage.getItem('dushu.settings.v1')).toBeNull();
    expect(JSON.parse(localStorage.getItem(TARGET_KEY)!)).toMatchObject({ to: 'fr' });
    // The Spanish library opens in French whether or not it ever saved a setting of its own.
    expect(createSettingsStore(localStorage, 'es').get().translateTo).toBe('fr');
  });
});
