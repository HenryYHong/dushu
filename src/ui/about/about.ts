// About screen: what Dushu does, how to use it, shortcuts, data sources and licenses, coverage. ARCHITECTURE.md 5.6.
import '../../styles/about.css';
import type { DataMeta, MountFn } from '../../types';
import { h, clear } from '../dom';
import { pageTitle } from '../pageHead';
import { icon } from '../icons';
import { SHORTCUTS, keyCaps } from '../shortcuts';
import { connectedMac, isMacOrigin } from '../../core/macBridge';
import { isAccountOwner } from '../../core/cloud';

export { SHORTCUTS };

/** Attributions that meta.json does not list (fetched at runtime or added after the data build). */
export const EXTRA_SOURCES: { name: string; license: string; url: string; use: string }[] = [
  { name: 'Wiktionary (via kaikki.org)', license: 'CC BY-SA 4.0', url: 'https://kaikki.org/', use: 'Readings and definitions for rare characters Unihan has none for.' },
  { name: 'Noto Serif SC and Noto Serif TC', license: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Serif+SC', use: 'The book typeface on devices without a system Song font (iPad, Windows, Android). Simplified and traditional shapes.' },
  { name: 'LXGW WenKai', license: 'SIL Open Font License 1.1', url: 'https://github.com/lxgw/LxgwWenKai', use: 'The Kai (brush) reading typeface.' },
  { name: 'Newsreader', license: 'SIL Open Font License 1.1', url: 'https://github.com/productiontype/Newsreader', use: 'The serif of the screen titles, folios and numbers (a Latin subset).' },
  { name: 'hanzi-writer', license: 'MIT', url: 'https://hanziwriter.org/', use: 'Stroke-order animation.' },
  { name: 'hanzi-writer-data (Make Me a Hanzi)', license: 'Arphic Public License', url: 'https://github.com/chanind/hanzi-writer-data', use: 'Stroke data, fetched when you open a character.' },
  { name: 'Cover paintings and photographs (Wikimedia Commons)', license: 'Public domain', url: 'https://commons.wikimedia.org/', use: 'The covers of the classics: Guo Xi, Early Spring; Ma Yuan, Angler on a Wintry Lake; Sun Wen, the Garden of Grand View; Shang Xi, Guan Yu Captures General Pang De; Zhang Lin, Hua Rong from his Water Margin album; a Qing court painter, Sun Wukong from the Office of Great Peace opera album; an unknown Song painter, Gibbons Playing in a Loquat Tree; Confucius at leisure; and two photographs of Lu Xun.' },
];

/** What each source in meta.json is used for, by name. */
const USES: Record<string, string> = {
  'CC-CEDICT': 'Words, pinyin and English definitions.',
  'Unihan / UCD': 'Readings, definitions, radicals and strokes for single characters, across every Unicode block.',
  'jieba dict.txt.big': 'Word frequencies, which decide how a sentence is split into words.',
  'complete-hsk-vocabulary': 'HSK levels and the HSK words CC-CEDICT lacks.',
  'OpenCC': 'Converting between simplified and traditional characters.',
  'Jigmo fonts (GlyphWiki)': 'Glyphs for rare characters, so nothing shows as an empty box.',
  'Wiktionary (via kaikki.org)': 'Readings and definitions for rare characters Unihan has none for.',
  'hanzi-writer': 'Stroke-order animation.',
  'hanzi-writer-data (Make Me a Hanzi)': 'Stroke data, fetched when you open a character.',
};

const HOW_TO = [
  'Import a book (EPUB, MOBI, AZW3, TXT, PDF, HTML or Markdown), paste some text, or pick a classic in the library.',
  'Choose how much pinyin you want: none, all, only words you haven\'t marked as known, or only words above your HSK level.',
  'Tap a word for its pinyin, meaning and characters. Tap it twice for the whole sentence and its translation. With a mouse you can also drag across a sentence.',
  'Star a word to study it later. Mark a word as known and its pinyin goes away.',
  'Open Review once a day. It brings back the words you starred or looked up, with longer gaps as you remember them.',
];

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
/** Where to find books: free, legal sources, as lines of text and links. */
const FINDING: () => (string | Node)[][] = () => [
  [link('https://zh.wikisource.org/', 'Chinese Wikisource'), ' has thousands of public-domain books, from the classics to Lu Xun. Open a book and tap 下载 (Download) for an EPUB.'],
  [link('https://www.gutenberg.org/browse/languages/zh', 'Project Gutenberg'), ' has about 500 Chinese books as EPUB and plain text.'],
  ['Any EPUB or Kindle book you bought without DRM works too.'],
];

const PAGES = [
  'Books are laid out in pages. If you\'d rather scroll, change Layout in Settings, or under Aa in the reader.',
  'On a wide screen held sideways, like an iPad in landscape, you get two pages side by side.',
  'Swipe anywhere to turn the page, or use the arrow keys or Space. With a mouse you can click the left or right edge. Tap off the words to show or hide the controls.',
  'Pages slide by default. You can pick a page flip, or no animation, in Settings.',
  'Your place is saved by the text, not the page number, so a new text size or turning the screen keeps you on the same line. It stays through updates, and through deleting a book and adding it back.',
];

const NAMES = [
  'Novels are full of names no dictionary has, like 郭靖 or 桃花岛. Left alone they get split into single characters that make no sense.',
  'The first time you open a book, Dushu looks for names and terms that keep coming up and reads them as whole words. It takes a few seconds, on your device.',
  'Tap one to fix its pinyin or meaning, or to say it isn\'t a word. You can also add a name it missed.',
];

const DEVICES = [
  'Open Dushu in Safari, tap Share, then Add to Home Screen, and open it from that icon. It runs full screen and works offline.',
  'To add your own books, tap Import book and pick a file from the Files app.',
  'Safari has no built-in translator. On an iPhone or iPad, sign in and your sentences are translated through your account. Signed out, you get a word-by-word gloss.',
];

const ACCOUNT = [
  'Dushu is invite-only for now. Open the invite link you were sent and make your account with a passkey. You unlock it the way you unlock your device: Face ID, a fingerprint, or your computer\'s password or PIN. You don\'t need a Dushu password or an email. After that, tap Sign in at the top and use your passkey.',
  'On an iPhone, iPad or Mac, your passkey is on your other Apple devices too. On another device, sign in once with your phone (the browser offers it), then add a passkey there in Settings.',
  'Your books, saved words, lookups, bookmarks, reading places and settings follow you to any device you sign in on. A few things that depend on the screen, like one or two pages, stay with each device.',
  'Signed in, books are read aloud in your account\'s voice, up to a daily limit. Otherwise Dushu uses your device\'s own voices.',
  'Only you can see what\'s in your account. You can delete it in Settings, and this device keeps its own copy.',
];

const MAC = [
  'If you run Dushu on your own Mac, the website can use it over Tailscale for Premium voices, a translation model and the books on that Mac. Only the Mac\'s owner can do this.',
  'To connect a device, copy the connect link from Settings on the Mac and open it on the device, or type the Mac\'s address into Settings on the website. The address stays in that browser.',
  'Books the Mac shares are added to the library by themselves and work offline after that. They can\'t be deleted, and if the browser clears them they come back.',
];

/** The Mac section is for the owner: on the Mac's own page, with a Mac connected, or signed in to the owner's account. */
const showMac = () => isMacOrigin() || !!connectedMac() || isAccountOwner();

const TRANSLATION = [
  'Pinyin and meanings come from the dictionaries listed at the bottom. They\'re part of the app and work offline. Machine translation is only used for whole sentences.',
  'On Automatic, Dushu tries Claude first if your account has it, then a model on your Mac if one is connected, then Qwen through your account if you\'re signed in, then the browser\'s own translator (Chrome has one, Safari doesn\'t), and last a word-by-word gloss. The panel says which one answered.',
  'Claude is made by Anthropic. Only the sentence and a little of the text around it is sent, through your account or your Mac. The key never reaches your browser.',
  'Qwen is an open model from Alibaba. Signed in, it translates your sentences for free on Cloudflare, up to a daily limit. Again, only the sentence and a little of the text around it is sent.',
  'Turn on Local only in Settings and nothing is sent to an online translator.',
  'MyMemory is an online translator you can pick in Settings. It\'s never used unless you choose it.',
  'Machine translation can be wrong. If a sentence matters, check it against the word cards.',
];

const fmt = (n: number | undefined) => (typeof n === 'number' ? n.toLocaleString('en-US') : '-');

interface Stat { value: string; label: string; note?: string }

/** The coverage rows, from meta.json counts (plus the derived keys the loader adds). */
export function coverageStats(meta: Pick<DataMeta, 'counts'>): Stat[] {
  const c = meta.counts;
  const out: Stat[] = [
    { value: fmt(c.unifiedIdeographs), label: 'Chinese characters', note: 'every one in Unicode, rare ones included' },
    { value: fmt(c.withReading), label: 'with a pinyin reading', note: c.extraLoaded ? `plus ${fmt(c.extraLoaded)} more for rare characters` : undefined },
    { value: fmt(c.withDefinition), label: 'with an English definition' },
    { value: fmt((c.cedict ?? 0) + (c.hskOnly ?? 0) || undefined), label: 'dictionary entries', note: 'CC-CEDICT plus the HSK words it lacks' },
    { value: fmt(c.segWords), label: 'words the word splitter knows' },
  ];
  return out.filter((s) => s.value !== '-');
}

/** Shows whether the browser has promised to keep this app's data, and lets the person ask. */
function storageCard(): HTMLElement {
  const status = h('p.ab-p', null, '');
  const btn = h('button.btn.btn-sm', { type: 'button' }, 'Ask the browser to keep my data') as HTMLButtonElement;
  const card = h('div.ab-storage.card', null, status, btn);
  const api = navigator.storage;
  if (!api?.persisted) { card.hidden = true; return card; }
  const refresh = async () => {
    let kept = false;
    try { kept = await api.persisted(); } catch { /* ignore */ }
    status.textContent = kept
      ? 'Your browser has agreed to keep your books and words, even when space runs low.'
      : 'Your browser may clear your books and words if space runs low. Adding Dushu to the Home Screen and asking here makes that much less likely.';
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

function buildPage(meta: DataMeta | null, loading: boolean): HTMLElement {
  const stats = meta ? coverageStats(meta) : [];
  const sources = meta?.sources ?? [];

  const sourceRows = [
    ...sources.map((s) => ({ ...s, use: USES[s.name] ?? '' })),
    ...EXTRA_SOURCES.filter((e) => !sources.some((s) => s.name === e.name)),
  ];

  return h('div.page.ab-page', null,
    h('div.page-head', null, h('div', null, pageTitle('about', 'About Dushu'))),

    h('section.ab-section', null,
      h('p.ab-lead', null, 'I made Dushu (读书, “reading books”) to read real Chinese books. Tap a word to see its pinyin and meaning, and tap it twice to translate the whole sentence.'),
      h('p.ab-p', null, 'It runs in your browser. Your books and words stay on this device, and in your account if you sign in, where only you can see them. The only other things that leave the device are a sentence you ask to translate and a passage you ask to hear.')),

    h('section.ab-section', null,
      h('h2.section-title', null, 'How to use it'),
      steps(HOW_TO)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Finding books'),
      h('ul.ab-steps', null, FINDING().map((parts) => h('li', null, ...parts)))),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Reading'),
      steps(PAGES, false)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Names in novels'),
      steps(NAMES, false)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Your account'),
      steps(ACCOUNT, false)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'On a phone or iPad'),
      steps(DEVICES),
      h('p.ab-p.ab-gap', null, 'Safari can delete a website\'s data if you don\'t open it for about a week. Sites on the Home Screen are safe from that. Dushu also asks the browser to keep its data once you add a book, and if you\'re signed in, your books come back from your account anyway.'),
      storageCard()),

    showMac() ? h('section.ab-section', null,
      h('h2.section-title', null, 'Your own Mac'),
      steps(MAC, false)) : null,

    h('section.ab-section', null,
      h('h2.section-title', null, 'Where translations come from'),
      steps(TRANSLATION, false)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Every character'),
      h('p.ab-p', null, 'Dushu can look up any Chinese character, not just common ones. A character with no known reading still shows its radical, stroke count and variants, and rare characters are drawn with a bundled font, so you never get an empty box.'),
      stats.length
        ? h('table.ab-counts', null, h('tbody', null, stats.map((s) => h('tr.ab-count', null,
            h('td.ab-count-value', null, s.value),
            h('td', null, s.label, s.note ? h('span.ab-count-note', null, `, ${s.note}`) : null)))))
        : h('p.muted', null, loading ? 'Loading dictionary details…' : 'Dictionary details are not available right now.'),
      meta?.built ? h('p.ab-fine', null, `Data built ${meta.built.slice(0, 10)}${meta.unicode ? `, Unicode ${meta.unicode}` : ''}.`) : null),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Keyboard shortcuts'),
      h('div.ab-keys', null, SHORTCUTS.map((g) => h('div.ab-keys-group.card', null,
        h('h3.ab-keys-title', null, g.group),
        h('dl.ab-keys-list', null, g.rows.map((r) => h('div.ab-key-row', null,
          h('dt', null, keyCaps(r)),
          h('dd', null, r.what)))))))),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Data sources and licenses'),
      h('p.ab-p', null, 'Words and definitions come from ',
        h('a', { href: 'https://cc-cedict.org/wiki/', target: '_blank', rel: 'noopener' }, 'CC-CEDICT'),
        ', shared under the ',
        h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener' }, 'Creative Commons Attribution-ShareAlike 4.0 license'),
        '. Thanks to its contributors and to MDBG, who host it. The definitions in the app are used and adapted under that license, and the dictionary data stays under it.'),
      sourceRows.length
        ? h('div.ab-table.card', { role: 'table', 'aria-label': 'Data sources' },
            sourceRows.map((s) => h('div.ab-source', { role: 'row' },
              h('div.ab-source-main', { role: 'cell' },
                h('a.ab-source-name', { href: s.url, target: '_blank', rel: 'noopener' }, s.name, icon('external')),
                s.use ? h('div.ab-source-use', null, s.use) : null),
              h('span.ab-source-license', { role: 'cell' }, s.license))))
        : h('p.muted', null, loading ? 'Loading…' : 'The source list is not available right now.')),
  );
}

async function fetchMeta(): Promise<DataMeta | null> {
  try {
    const res = await fetch(new URL('data/meta.json', document.baseURI).href);
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
