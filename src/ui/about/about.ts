// About screen: what Dushu does, how to use it, shortcuts, data sources and licenses, coverage. ARCHITECTURE.md 5.6.
import '../../styles/about.css';
import type { DataMeta, MountFn } from '../../types';
import { h, clear } from '../dom';
import { pageTitle } from '../pageHead';
import { icon } from '../icons';
import { SHORTCUTS, keyCaps } from '../shortcuts';
import { connectedMac, isMacOrigin } from '../../core/macBridge';
import { isAccountOwner } from '../../core/cloud';
import { activeEngine, isChinese, lang } from '../../lang/active';
import { aidWord, levelScheme } from '../../lang/labels';
import type { LangId } from '../../lang/types';
import { fetchSamples } from '../library/samples';
import { langName, num, tt, ttm, ttn } from '../../i18n';

export { SHORTCUTS };

/** Attributions that meta.json does not list (fetched at runtime or added after the data build). Shown through tt(). */
export const EXTRA_SOURCES: { name: string; license: string; url: string; use: string }[] = [
  { name: 'Wiktionary (via kaikki.org)', license: 'CC BY-SA 4.0', url: 'https://kaikki.org/', use: ttm('Readings and definitions for rare characters Unihan has none for.') },
  { name: 'CPP (Chinese Polyphones with Pinyin, Kakao Brain), from Chinese Wikipedia', license: 'CC BY-SA 4.0', url: 'https://github.com/kakaobrain/g2pM', use: ttm('Sentences the reading model learned from, with public-domain books from Wikisource and readings labeled by hand: it picks the reading of 为 (wéi or wèi), 着 (zháo, zhuó), 长 (zhǎng), 中 (zhòng), 还 (huán), 种, 差, 少, 好, 藏, 数 and a few rarer characters (传 in a title, 相, 刹 …) where the rules fall back to their default.') },
  { name: ttm('Chinese Wikipedia and Wikisource'), license: ttm('CC BY-SA 4.0 (Wikipedia; the books are public domain)'), url: 'https://zh.wikipedia.org/', use: ttm('Word counts read off their text (not copied), so old words such as 制台 and 辕门 read as one word, and old spellings such as 豫备 and 帐房 (from Wiktionary\'s redirects) show the meaning of the word they stand for.') },
  { name: 'Wikidata', license: 'CC0 1.0', url: 'https://www.wikidata.org/', use: ttm('The name list: people, places and organizations with a Chinese Wikipedia article, so a name seen once in a book reads as one word.') },
  { name: ttm('The name model, from Wikidata, Chinese Wikipedia and Wikisource'), license: 'CC BY-SA 4.0', url: 'https://zh.wikipedia.org/', use: ttm('How likely a character is to open, fill or end a name (from the name list), and which strings a book repeats are names, learned from Wikipedia text and public-domain books (read, not copied): 七斤, 四婶 and 周仓 read as one word.') },
  { name: 'Noto Serif SC and Noto Serif TC', license: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Serif+SC', use: ttm('The book typeface on devices without a system Song font (iPad, Windows, Android). Simplified and traditional shapes.') },
  { name: 'LXGW WenKai', license: 'SIL Open Font License 1.1', url: 'https://github.com/lxgw/LxgwWenKai', use: ttm('The Kai (brush) reading typeface.') },
  { name: 'Newsreader', license: 'SIL Open Font License 1.1', url: 'https://github.com/productiontype/Newsreader', use: ttm('The serif of the screen titles, folios and numbers (a Latin subset).') },
  { name: 'hanzi-writer', license: 'MIT', url: 'https://hanziwriter.org/', use: ttm('Stroke-order animation.') },
  { name: 'WHATWG Encoding Standard (index-big5)', license: 'CC BY 4.0', url: 'https://encoding.spec.whatwg.org/', use: ttm('The Hong Kong characters of a Big5 text file (Big5-HKSCS) that a decoder gives as private-use code points.') },
  { name: 'hanzi-writer-data (Make Me a Hanzi)', license: 'Arphic Public License', url: 'https://github.com/chanind/hanzi-writer-data', use: ttm('Stroke data, fetched when you open a character.') },
  { name: ttm('Cover paintings and photographs (Wikimedia Commons)'), license: ttm('Public domain'), url: 'https://commons.wikimedia.org/', use: ttm('The covers of the classics: Guo Xi, Early Spring; Ma Yuan, Angler on a Wintry Lake; Sun Wen, the Garden of Grand View; Shang Xi, Guan Yu Captures General Pang De; Zhang Lin, Hua Rong from his Water Margin album; a Qing court painter, Sun Wukong from the Office of Great Peace opera album; an unknown Song painter, Gibbons Playing in a Loquat Tree; Confucius at leisure; and two photographs of Lu Xun.') },
];

/** What each source in meta.json is used for, by name. Shown through tt(). */
const USES: Record<string, string> = {
  'CC-CEDICT': ttm('Words, pinyin and English definitions.'),
  'Unihan / UCD': ttm('Readings, definitions, radicals and strokes for single characters, across every Unicode block.'),
  'jieba dict.txt.big': ttm('Word frequencies, which decide how a sentence is split into words.'),
  'hsk30 (Ivan Krasilnikov)': ttm('HSK 3.0 levels for each reading of a word, from the official 2021 list (GF0025-2021).'),
  'complete-hsk-vocabulary': ttm('HSK 2.0 levels, word frequency on the HSK list, and the HSK words CC-CEDICT lacks.'),
  'OpenCC': ttm('Converting between simplified and traditional characters.'),
  'Jigmo fonts (GlyphWiki)': ttm('Glyphs for rare characters, so nothing shows as an empty box.'),
  'Wiktionary (via kaikki.org)': ttm('Readings and definitions for rare characters Unihan has none for.'),
  'hanzi-writer': ttm('Stroke-order animation.'),
  'hanzi-writer-data (Make Me a Hanzi)': ttm('Stroke data, fetched when you open a character.'),
};

// The lists below are functions, so each is read in the app's language when the page is drawn.
const HOW_TO = () => [
  tt('Import a book (EPUB, MOBI, AZW3, TXT, PDF, HTML or Markdown), paste some text, or pick a classic in the library.'),
  tt('Choose how much pinyin you want: none, all, only words you haven\'t marked as known, or only words above your HSK level.'),
  tt('Tap a word for its pinyin, meaning and characters. Tap it twice for the whole sentence and its translation. With a mouse you can also drag across a sentence.'),
  tt('Star a word to study it later. Mark a word as known and its pinyin goes away.'),
  tt('Open Review once a day. It brings back the words you starred or looked up, with longer gaps as you remember them.'),
];

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
/** A sentence with links in it, translated whole: each {name} in `text` is the node given for it. */
function withNodes(text: string, nodes: Record<string, Node>): (string | Node)[] {
  return text.split(/(\{\w+\})/).filter(Boolean).map((part) => (/^\{\w+\}$/.test(part) ? nodes[part.slice(1, -1)] ?? part : part));
}
/** Where to find books: free, legal sources, as lines of text and links. */
const FINDING: () => (string | Node)[][] = () => [
  withNodes(tt('{link} has thousands of public-domain books, from the classics to Lu Xun. Open a book and tap 下载 (Download) for an EPUB.'),
    { link: link('https://zh.wikisource.org/', tt('Chinese Wikisource')) }),
  withNodes(tt('{link} has about 500 Chinese books as EPUB and plain text.'), { link: link('https://www.gutenberg.org/browse/languages/zh', 'Project Gutenberg') }),
  [tt('Any EPUB or Kindle book you bought without DRM works too.')],
];

const PAGES = () => [
  tt('Books are laid out in pages. If you\'d rather scroll, change Layout in Settings, or under Aa in the reader.'),
  tt('On a wide screen held sideways, like an iPad in landscape, you get two pages side by side.'),
  tt('Swipe anywhere to turn the page, or use the arrow keys or Space. With a mouse you can click the left or right edge. Tap off the words to show or hide the controls.'),
  tt('Pages slide by default. You can pick a page flip, or no animation, in Settings.'),
  tt('Your place is saved by the text, not the page number, so a new text size or turning the screen keeps you on the same line. It stays through updates, and through deleting a book and adding it back.'),
];

const NAMES = () => [
  tt('Novels are full of names no dictionary has, like 郭靖 or 桃花岛. Left alone they get split into single characters that make no sense.'),
  tt('The first time you open a book, Globereader looks for names and terms that keep coming up and reads them as whole words. It takes a few seconds, on your device.'),
  tt('Tap one to fix its pinyin or meaning, or to say it isn\'t a word. You can also add a name it missed.'),
];

const DEVICES = () => [
  tt('Open Globereader in Safari, tap Share, then Add to Home Screen, and open it from that icon. It runs full screen and works offline.'),
  tt('To add your own books, tap Import book and pick a file from the Files app.'),
  tt('Safari has no built-in translator. On an iPhone or iPad, sign in and your sentences are translated through your account. Signed out, you get a word-by-word gloss.'),
];

const ACCOUNT = () => [
  tt('Globereader is invite-only for now. Open the invite link you were sent and make your account with a passkey. You unlock it the way you unlock your device: Face ID, a fingerprint, or your computer\'s password or PIN. You don\'t need a Globereader password or an email. After that, tap Sign in at the top and use your passkey.'),
  tt('On an iPhone, iPad or Mac, your passkey is on your other Apple devices too. On another device, sign in once with your phone (the browser offers it), then add a passkey there in Settings.'),
  tt('Your books, saved words, lookups, bookmarks, reading places and settings follow you to any device you sign in on. A few things that depend on the screen, like one or two pages, stay with each device.'),
  tt('Signed in, books are read aloud in your account\'s voice, up to a daily limit. Otherwise Globereader uses your device\'s own voices.'),
  tt('Only you can see what\'s in your account. You can delete it in Settings, and this device keeps its own copy.'),
];

const MAC = () => [
  tt('If you run Globereader on your own Mac, the website can use it over Tailscale for Premium voices, a translation model and the books on that Mac. Only the Mac\'s owner can do this.'),
  tt('To connect a device, copy the connect link from Settings on the Mac and open it on the device, or type the Mac\'s address into Settings on the website. The address stays in that browser.'),
  tt('Books the Mac shares are added to the library by themselves and work offline after that. They can\'t be deleted, and if the browser clears them they come back.'),
];

/** The Mac section is for the owner: on the Mac's own page, with a Mac connected, or signed in to the owner's account. */
const showMac = () => isMacOrigin() || !!connectedMac() || isAccountOwner();

/** Where translations come from, for a language other than Chinese: no Mac model (it was measured on Chinese only). */
const otherTranslation = (furigana: boolean): string[] => [
  furigana
    ? tt('Meanings and readings come from the dictionaries listed at the bottom. They\'re part of the app and work offline. Machine translation is only used for whole sentences.')
    : tt('Meanings come from the dictionaries listed at the bottom. They\'re part of the app and work offline. Machine translation is only used for whole sentences.'),
  tt('On Automatic, Globereader tries Claude first if your account has it, then Qwen through your account if you\'re signed in, then the browser\'s own translator (Chrome has one, Safari doesn\'t), and last a word-by-word gloss. The panel says which one answered.'),
  ...TRANSLATION_REST(),
];

const TRANSLATION_REST = () => [
  tt('Claude is made by Anthropic. Only the sentence and a little of the text around it is sent, through your account or your Mac. The key never reaches your browser.'),
  tt('Qwen is an open model from Alibaba. Signed in, it translates your sentences for free on Cloudflare, up to a daily limit. Again, only the sentence and a little of the text around it is sent.'),
  tt('Turn on Local only in Settings and nothing is sent to an online translator.'),
  tt('MyMemory is an online translator you can pick in Settings. It\'s never used unless you choose it.'),
  tt('Machine translation can be wrong. If a sentence matters, check it against the word cards.'),
];

const TRANSLATION = () => [
  tt('Pinyin and meanings come from the dictionaries listed at the bottom. They\'re part of the app and work offline. Machine translation is only used for whole sentences.'),
  tt('On Automatic, Globereader tries Claude first if your account has it, then a model on your Mac if one is connected, then Qwen through your account if you\'re signed in, then the browser\'s own translator (Chrome has one, Safari doesn\'t), and last a word-by-word gloss. The panel says which one answered.'),
  ...TRANSLATION_REST(),
];

const fmt = (n: number | undefined) => (typeof n === 'number' ? num(n) : '-');

interface Stat { value: string; label: string; note?: string }

/** The coverage rows, from meta.json counts (plus the derived keys the loader adds). */
export function coverageStats(meta: Pick<DataMeta, 'counts'>): Stat[] {
  const c = meta.counts;
  const out: Stat[] = [
    { value: fmt(c.unifiedIdeographs), label: tt('Chinese characters'), note: tt('every one in Unicode, rare ones included') },
    { value: fmt(c.withReading), label: tt('with a pinyin reading'), note: c.extraLoaded ? ttn(c.extraLoaded, 'plus {n} more for rare characters', 'plus {n} more for rare characters') : undefined },
    { value: fmt(c.withDefinition), label: tt('with an English definition') },
    { value: fmt((c.cedict ?? 0) + (c.hskOnly ?? 0) || undefined), label: tt('dictionary entries'), note: tt('CC-CEDICT plus the HSK words it lacks') },
    { value: fmt(c.segWords), label: tt('words the word splitter knows') },
  ];
  return out.filter((s) => s.value !== '-');
}

/** Shows whether the browser has promised to keep this app's data, and lets the person ask. */
function storageCard(): HTMLElement {
  const status = h('p.ab-p', null, '');
  const btn = h('button.btn.btn-sm', { type: 'button' }, tt('Ask the browser to keep my data')) as HTMLButtonElement;
  const card = h('div.ab-storage.card', null, status, btn);
  const api = navigator.storage;
  if (!api?.persisted) { card.hidden = true; return card; }
  const refresh = async () => {
    let kept = false;
    try { kept = await api.persisted(); } catch { /* ignore */ }
    status.textContent = kept
      ? tt('Your browser has agreed to keep your books and words, even when space runs low.')
      : tt('Your browser may clear your books and words if space runs low. Adding Globereader to the Home Screen and asking here makes that much less likely.');
    btn.hidden = kept;
  };
  btn.addEventListener('click', () => {
    btn.disabled = true;
    void (api.persist?.() ?? Promise.resolve(false)).catch(() => false).then(() => { btn.disabled = false; return refresh(); });
  });
  void refresh();
  return card;
}

const steps = (rows: string[], ordered = true) => h(ordered ? 'ol.ab-steps' : 'ul.ab-steps', null, rows.map((d) => h('li', null, d)));

/** Free, legal places to find books in each language other than Chinese: the link, its name, and the sentence it opens ({link}). */
const OTHER_FINDING = (): Record<Exclude<LangId, 'zh'>, [string, string, string][]> => ({
  ja: [['https://www.aozora.gr.jp/', 'Aozora Bunko (青空文庫)', tt('{link} has more than 17,000 Japanese books in the public domain, from Natsume Sōseki to Miyazawa Kenji, as text you can download.')]],
  es: [['https://www.gutenberg.org/browse/languages/es', 'Project Gutenberg', tt('{link} has hundreds of Spanish books as EPUB and plain text.')], ['https://es.wikisource.org/', tt('Spanish Wikisource'), tt('{link} has thousands more, many as EPUB.')]],
  fr: [['https://www.gutenberg.org/browse/languages/fr', 'Project Gutenberg', tt('{link} has thousands of French books as EPUB and plain text.')], ['https://fr.wikisource.org/', tt('French Wikisource'), tt('{link} has thousands more, many as EPUB.')]],
  de: [['https://www.gutenberg.org/browse/languages/de', 'Project Gutenberg', tt('{link} has thousands of German books as EPUB and plain text.')], ['https://de.wikisource.org/', tt('German Wikisource'), tt('{link} has more, many as EPUB.')]],
  it: [['https://www.gutenberg.org/browse/languages/it', 'Project Gutenberg', tt('{link} has hundreds of Italian books as EPUB and plain text.')], ['https://www.liberliber.it/', 'Liber Liber', tt('{link} has thousands of Italian books in the public domain.')]],
  pt: [['https://www.gutenberg.org/browse/languages/pt', 'Project Gutenberg', tt('{link} has hundreds of Portuguese books as EPUB and plain text.')], ['https://pt.wikisource.org/', tt('Portuguese Wikisource'), tt('{link} has thousands more.')]],
  ru: [['https://www.gutenberg.org/browse/languages/ru', 'Project Gutenberg', tt('{link} has Russian classics as EPUB and plain text.')], ['https://ru.wikisource.org/', tt('Russian Wikisource'), tt('{link} has thousands of public-domain texts, many as EPUB.')]],
  en: [['https://www.gutenberg.org/', 'Project Gutenberg', tt('{link} has more than 60,000 free books, most of them in English, as EPUB and plain text.')], ['https://standardebooks.org/', 'Standard Ebooks', tt('{link} has carefully made EPUBs of public-domain English books.')]],
});

/** The counts in another language's meta.json, by key, as the page names them (the key in words: kanjiInJmdict, "kanji in jmdict"). */
const COUNT_LABELS: Record<string, string> = {
  entries: ttm('entries'), keys: ttm('keys'), forms: ttm('forms'), rules: ttm('rules'), paradigms: ttm('paradigms'),
  descriptions: ttm('descriptions'), ranked: ttm('ranked'), senses: ttm('senses'), priors: ttm('priors'), levels: ttm('levels'),
  phrases: ttm('phrases'), pronunciations: ttm('pronunciations'), glosses: ttm('glosses'), commonEntries: ttm('common entries'),
  jlptEntries: ttm('jlpt entries'), jlptRows: ttm('jlpt rows'), kanji: ttm('kanji'), kanjiInJmdict: ttm('kanji in jmdict'),
  ipadicWords: ttm('ipadic words'),
};
const countLabel = (k: string) => tt(COUNT_LABELS[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());

/** The About page when the library is another language: the same app, told for that language. */
function buildOtherPage(meta: DataMeta | null, loading: boolean): HTMLElement {
  const L = lang();
  const id = L.id as Exclude<LangId, 'zh'>;
  const furigana = L.aid === 'furigana';
  const engine = activeEngine();
  const counts = engine?.meta.counts ?? meta?.counts ?? {};
  const sources = engine?.meta.sources ?? meta?.sources ?? [];
  const hints = tt('Turn on Hints to see a short {language} meaning over hard words: every word, words you haven\'t marked as known, or words above your level.',
    { language: L.id === 'en' ? langName('zh', 'Chinese') : langName('en', 'English') });
  const how = [
    tt('Import a book (EPUB, MOBI, AZW3, TXT, PDF, HTML or Markdown), paste some text, or pick a classic in the library.'),
    furigana
      ? tt('Choose where furigana show: nowhere, over every word with kanji, over words you haven\'t marked as known, or over words above your JLPT level.')
      : L.stress ? `${hints} ${tt('Stress marks show which vowel to stress.')}` : hints,
    furigana
      ? tt('Tap a word for its meaning, reading and kanji. Globereader looks up the dictionary form, so a verb in any tense finds its entry and says which form it is. Tap twice for the whole sentence and its translation.')
      : tt('Tap a word for its meaning. Globereader looks up the dictionary form, so a verb in any tense finds its entry and says which form it is. Tap twice for the whole sentence and its translation.'),
    furigana
      ? tt('Star a word to study it later. Mark a word as known and its {aid} go away.', { aid: aidWord() })
      : tt('Star a word to study it later. Mark a word as known and its {aid} goes away.', { aid: aidWord() }),
    tt('Open Review once a day. It brings back the words you starred or looked up, with longer gaps as you remember them.'),
  ];
  // The level scheme's own words, then how to mark a level: two whole sentences.
  const levels = `${tt(L.levels.about)} ${levelScheme() === 'JLPT' ? tt('Mark a whole JLPT level as known in Vocabulary.') : tt('Mark a whole level as known in Vocabulary.')}`;
  const statRows = Object.entries(counts).filter(([, v]) => typeof v === 'number' && v > 0).slice(0, 6);
  return h('div.page.ab-page', null,
    h('div.page-head', null, h('div', null, pageTitle('about', tt('About Globereader')))),
    h('section.ab-section', null,
      h('p.ab-lead', null, furigana
        ? tt('Globereader is for reading real books in {language}. Tap a word to see its meaning and reading, and tap it twice to translate the whole sentence.', { language: langName(L.id, L.name) })
        : tt('Globereader is for reading real books in {language}. Tap a word to see its meaning, and tap it twice to translate the whole sentence.', { language: langName(L.id, L.name) })),
      h('p.ab-p', null, tt('It runs in your browser. Your books and words stay on this device, and in your account if you sign in, where only you can see them. The only other things that leave the device are a sentence you ask to translate and a passage you ask to hear.')),
      h('p.ab-p', null, tt('Each language is its own library, with its own books, words and settings, and each syncs with your account on its own. Switch languages in Settings or with the language menu at the top.'))),
    h('section.ab-section', null, h('h2.section-title', null, tt('How to use it')), steps(how)),
    h('section.ab-section', null, h('h2.section-title', null, tt('Levels')), h('p.ab-p', null, levels)),
    h('section.ab-section', null,
      h('h2.section-title', null, tt('Finding books')),
      h('ul.ab-steps', null, ...OTHER_FINDING()[id].map(([href, name, sentence]) => h('li', null, ...withNodes(sentence, { link: link(href, name) }))),
        h('li', null, tt('Any EPUB or Kindle book you bought without DRM works too.')))),
    h('section.ab-section', null, h('h2.section-title', null, tt('Reading')), steps(PAGES(), false)),
    h('section.ab-section', null,
      h('h2.section-title', null, tt('On a phone or iPad')),
      steps(DEVICES()),
      storageCard()),
    h('section.ab-section', null, h('h2.section-title', null, tt('Where translations come from')), steps(otherTranslation(furigana), false)),
    h('section.ab-section', null,
      h('h2.section-title', null, tt('The dictionary')),
      statRows.length
        ? h('table.ab-counts', null, h('tbody', null, statRows.map(([k, v]) => h('tr.ab-count', null,
            h('td.ab-count-value', null, fmt(v)), h('td', null, countLabel(k))))))
        : h('p.muted', null, loading ? tt('Loading dictionary details…') : tt('Dictionary details are not available right now.')),
      engine?.meta.built ? h('p.ab-fine', null, tt('Data built {date}.', { date: engine.meta.built.slice(0, 10) })) : null),
    shortcutsSection(),
    h('section.ab-section', null,
      h('h2.section-title', null, tt('Data sources and licenses')),
      h('p.ab-p', null, tt('The dictionaries are shared under their own licenses, listed here with each one. Their definitions are used and adapted under those licenses, and the dictionary data stays under them. Thanks to everyone who wrote them.')),
      sources.length
        ? h('div.ab-table.card', { role: 'table', 'aria-label': tt('Data sources') },
            [...sources, { name: 'Newsreader', license: 'SIL Open Font License 1.1', url: 'https://github.com/productiontype/Newsreader' }].map((src) => h('div.ab-source', { role: 'row' },
              h('div.ab-source-main', { role: 'cell' }, h('a.ab-source-name', { href: src.url, target: '_blank', rel: 'noopener' }, src.name, icon('external'))),
              h('span.ab-source-license', { role: 'cell' }, licenseLink(src.license)))))
        : h('p.muted', null, loading ? tt('Loading…') : tt('The source list is not available right now.'))),
    coversSection(),
  );
}

/** The licenses the sources name, by how their name starts, with the page that holds each one's terms. */
const LICENSE_URLS: [RegExp, string][] = [
  [/^CC BY-SA 4\.0/, 'https://creativecommons.org/licenses/by-sa/4.0/'],
  [/^CC BY-SA 3\.0/, 'https://creativecommons.org/licenses/by-sa/3.0/'],
  [/^CC BY 4\.0/, 'https://creativecommons.org/licenses/by/4.0/'],
  [/^CC0/, 'https://creativecommons.org/publicdomain/zero/1.0/'],
  [/^Apache-2\.0/, 'https://www.apache.org/licenses/LICENSE-2.0'],
  [/^SIL Open Font License/, 'https://openfontlicense.org/'],
  [/^MIT\b/, 'https://opensource.org/license/mit'],
];

/** A license as a link to its terms when it is one of the known ones (CC BY-SA asks for that), else as text. */
function licenseLink(license: string): Node {
  const url = LICENSE_URLS.find(([re]) => re.test(license))?.[1];
  return url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, license) : document.createTextNode(license);
}

/** The shortcuts, from the same list as the reader's help (ui/shortcuts.ts). */
function shortcutsSection(): HTMLElement {
  return h('section.ab-section', null,
    h('h2.section-title', null, tt('Keyboard shortcuts')),
    h('div.ab-keys', null, SHORTCUTS.map((g) => h('div.ab-keys-group.card', null,
      h('h3.ab-keys-title', null, tt(g.group)),
      h('dl.ab-keys-list', null, g.rows.map((r) => h('div.ab-key-row', null,
        h('dt', null, keyCaps(r)),
        h('dd', null, tt(r.what)))))))));
}

/** Each classic's cover painting, by book: filled in when the language's list of classics has loaded. */
function coversSection(): HTMLElement {
  const list = h('ul.ab-steps');
  const section = h('section.ab-section', { hidden: true },
    h('h2.section-title', null, tt('Covers')),
    h('p.ab-p', null, tt('The classics wear public-domain paintings and drawings.')),
    list);
  void fetchSamples().then((samples) => {
    const credited = samples.filter((s) => s.coverCredit);
    if (!credited.length) return;
    for (const s of credited) list.appendChild(h('li', null, h('span', { lang: lang().tag }, s.title), ': ', s.coverCredit!));
    section.hidden = false;
  });
  return section;
}

function buildPage(meta: DataMeta | null, loading: boolean): HTMLElement {
  if (!isChinese()) return buildOtherPage(meta, loading);
  const stats = meta ? coverageStats(meta) : [];
  const sources = meta?.sources ?? [];

  const sourceRows = [
    ...sources.map((s) => ({ ...s, use: USES[s.name] ?? '' })),
    ...EXTRA_SOURCES.filter((e) => !sources.some((s) => s.name === e.name)),
  ];

  return h('div.page.ab-page', null,
    h('div.page-head', null, h('div', null, pageTitle('about', tt('About Globereader')))),

    h('section.ab-section', null,
      h('p.ab-lead', null, tt('I made Globereader to read real books in other languages. It started with Chinese, as Dushu (读书, “reading books”). Tap a word to see its pinyin and meaning, and tap it twice to translate the whole sentence.')),
      h('p.ab-p', null, tt('It runs in your browser. Your books and words stay on this device, and in your account if you sign in, where only you can see them. The only other things that leave the device are a sentence you ask to translate and a passage you ask to hear.'))),

    h('section.ab-section', null,
      h('h2.section-title', null, tt('How to use it')),
      steps(HOW_TO())),

    h('section.ab-section', null,
      h('h2.section-title', null, tt('Finding books')),
      h('ul.ab-steps', null, FINDING().map((parts) => h('li', null, ...parts)))),

    h('section.ab-section', null,
      h('h2.section-title', null, tt('Reading')),
      steps(PAGES(), false)),

    h('section.ab-section', null,
      h('h2.section-title', null, tt('Names in novels')),
      steps(NAMES(), false)),

    h('section.ab-section', null,
      h('h2.section-title', null, tt('Your account')),
      steps(ACCOUNT(), false)),

    h('section.ab-section', null,
      h('h2.section-title', null, tt('On a phone or iPad')),
      steps(DEVICES()),
      h('p.ab-p.ab-gap', null, tt('Safari can delete a website\'s data if you don\'t open it for about a week. Sites on the Home Screen are safe from that. Globereader also asks the browser to keep its data once you add a book, and if you\'re signed in, your books come back from your account anyway.')),
      storageCard()),

    showMac() ? h('section.ab-section', null,
      h('h2.section-title', null, tt('Your own Mac')),
      steps(MAC(), false)) : null,

    h('section.ab-section', null,
      h('h2.section-title', null, tt('Where translations come from')),
      steps(TRANSLATION(), false)),

    h('section.ab-section', null,
      h('h2.section-title', null, tt('Every character')),
      h('p.ab-p', null, tt('Globereader can look up any Chinese character, not just common ones. A character with no known reading still shows its radical, stroke count and variants, and rare characters are drawn with a bundled font, so you never get an empty box.')),
      stats.length
        ? h('table.ab-counts', null, h('tbody', null, stats.map((s) => h('tr.ab-count', null,
            h('td.ab-count-value', null, s.value),
            h('td', null, s.label, s.note ? h('span.ab-count-note', null, `, ${s.note}`) : null)))))
        : h('p.muted', null, loading ? tt('Loading dictionary details…') : tt('Dictionary details are not available right now.')),
      meta?.built ? h('p.ab-fine', null, meta.unicode
        ? tt('Data built {date}, Unicode {version}.', { date: meta.built.slice(0, 10), version: meta.unicode })
        : tt('Data built {date}.', { date: meta.built.slice(0, 10) })) : null),

    shortcutsSection(),

    h('section.ab-section', null,
      h('h2.section-title', null, tt('Data sources and licenses')),
      h('p.ab-p', null, ...withNodes(tt('Words and definitions come from {cedict}, shared under the {license}. Thanks to its contributors and to MDBG, who host it. The definitions in the app are used and adapted under that license, and the dictionary data stays under it.'), {
        cedict: h('a', { href: 'https://cc-cedict.org/wiki/', target: '_blank', rel: 'noopener' }, 'CC-CEDICT'),
        license: h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener' }, tt('Creative Commons Attribution-ShareAlike 4.0 license')),
      })),
      sourceRows.length
        ? h('div.ab-table.card', { role: 'table', 'aria-label': tt('Data sources') },
            sourceRows.map((s) => h('div.ab-source', { role: 'row' },
              h('div.ab-source-main', { role: 'cell' },
                h('a.ab-source-name', { href: s.url, target: '_blank', rel: 'noopener' }, tt(s.name), icon('external')),
                s.use ? h('div.ab-source-use', null, tt(s.use)) : null),
              h('span.ab-source-license', { role: 'cell' }, tt(s.license)))))
        : h('p.muted', null, loading ? tt('Loading…') : tt('The source list is not available right now.'))),
  );
}

async function fetchMeta(): Promise<DataMeta | null> {
  try {
    const res = await fetch(new URL(isChinese() ? 'data/meta.json' : `data/${lang().id}/meta.json`, document.baseURI).href);
    if (!res.ok) return null;
    const j = JSON.parse(await res.text()) as Partial<DataMeta>;
    return { built: j.built ?? '', unicode: j.unicode ?? '', counts: j.counts ?? {}, sources: j.sources ?? [] };
  } catch {
    return null;
  }
}

export const mount: MountFn = (root, _params, ctx) => {
  let alive = true;
  const host = h('div.ab-host');
  root.appendChild(host);
  const show = (meta: DataMeta | null, loading: boolean) => { clear(host); host.appendChild(buildPage(meta, loading)); };

  const ready = ctx.dictSync()?.meta;
  show(ready?.sources.length ? ready : null, !ready);
  // meta.json first (it is tiny); the loaded dictionary's meta adds the derived counts when it arrives.
  if (!ready?.sources.length) void fetchMeta().then((m) => { if (alive) show(m, false); });
  void ctx.dict().then((d) => { if (alive && d.meta.sources.length) show(d.meta, false); }, () => {});

  return () => { alive = false; };
};
