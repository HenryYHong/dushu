// About screen: what Dushu does, how to use it, shortcuts, data sources and licenses, coverage. ARCHITECTURE.md 5.6.
import '../../styles/about.css';
import type { DataMeta, MountFn } from '../../types';
import { h, clear } from '../dom';
import { icon } from '../icons';
import { SHORTCUTS, keyCaps } from '../shortcuts';

export { SHORTCUTS };

/** Attributions that meta.json does not list (fetched at runtime or added after the data build). */
export const EXTRA_SOURCES: { name: string; license: string; url: string; use: string }[] = [
  { name: 'Wiktionary (via kaikki.org)', license: 'CC BY-SA 4.0', url: 'https://kaikki.org/', use: 'Readings and definitions for rare characters Unihan has none for.' },
  { name: 'Noto Serif SC and Noto Serif TC', license: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Serif+SC', use: 'The book typeface on devices without a system Song font (iPad, Windows, Android). Simplified and traditional shapes.' },
  { name: 'LXGW WenKai', license: 'SIL Open Font License 1.1', url: 'https://github.com/lxgw/LxgwWenKai', use: 'The Kai (brush) reading typeface.' },
  { name: 'hanzi-writer', license: 'MIT', url: 'https://hanziwriter.org/', use: 'Stroke-order animation.' },
  { name: 'hanzi-writer-data (Make Me a Hanzi)', license: 'Arphic Public License', url: 'https://github.com/chanind/hanzi-writer-data', use: 'Stroke data, fetched when you open a character.' },
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

const HOW_TO: [string, string][] = [
  ['Add a book', 'Import an EPUB, MOBI, AZW3, TXT, PDF, HTML or Markdown file, drop one on the Library page, paste text, or start with a classic.'],
  ['Read with help', 'Choose how much pinyin to see: none, all, only words you have not marked as known, or only words above an HSK level.'],
  ['Look things up', 'Tap a word for pinyin, definitions and a breakdown of its characters. Drag across a sentence for a translation.'],
  ['Keep what you learn', 'Star a word to add it to your flashcards. Mark a word as known and its pinyin stays out of your way.'],
  ['Review', 'Open Review each day. Cards come back after longer and longer gaps as you remember them.'],
];

const PAGES: [string, string][] = [
  ['Pages or scrolling', 'By default a chapter is one long scrolling column. If you prefer turning pages like a printed book, switch the layout to Pages in Settings.'],
  ['Two pages at a time', 'On a wide screen held sideways, such as an iPad in landscape, you see a spread of two pages. In portrait you see one. You can force either one in Settings.'],
  ['Turning', 'Tap the left or right edge of a page, swipe, press the arrow keys or Space. Tap the middle to show or hide the controls. Choose a page flip, a slide or no animation.'],
  ['Where you were', 'Your place is kept by the text, not by the page number, so changing the text size or turning the screen lands you on the same line.'],
];

const NAMES: [string, string][] = [
  ['Why it matters', 'A novel is full of names and made-up terms that no dictionary has: 郭靖, 桃花岛, 降龙十八掌. Left alone they split into single characters with meanings that make no sense.'],
  ['What Dushu does', 'The first time you open a book, Dushu scans it for names, places and terms that keep coming back, and reads them as whole words. This happens on your device and takes a few seconds.'],
  ['You are in charge', 'Tap such a word to see it marked as part of this book. You can fix its pinyin or meaning, mark it as not a word, or add a name Dushu missed from the phrase card.'],
];

const IPAD: [string, string][] = [
  ['Connect privately', 'Use the private HTTPS address shown in Settings, with Tailscale connected on your Mac and iPad under the same account. Keep the Mac awake for private AI and Premium audio. localhost only works on the Mac.'],
  ['Install it', 'Open the private address in Safari, tap Share, then Add to Home Screen. Imported books and downloaded dictionary data work offline. Mac AI and Mac voices still need the connection.'],
  ['Translating sentences', 'Safari and iPadOS have no on-device translator, as Chrome does. On an iPad, sentence translation uses the private model on your Mac while it is reachable. Otherwise it needs a Claude key or MyMemory, both set in Settings.'],
  ['Bring your books', 'Tap Import book in the Library, then Browse to pick a file from the Files app (iCloud Drive, On My iPad, or a download).'],
  ['Move your words', 'Settings has a backup export and import. Export on one device, open the file on the other, and your saved words, progress and settings come along. Books are not in the backup, so import them on each device.'],
];

const HOSTED: [string, string][] = [
  ['Two copies', 'The hosted copy at henryyhong.com/dushu is a plain static website. It has the dictionary and the classics, and it keeps your books, words and progress in your own browser. Nothing you read is sent to that site.'],
  ['Your own Mac', 'If you run Dushu on your own Mac, the hosted copy can use it as a private helper: better sentence translation, Premium Mac voices and books that live on that Mac. This works only for the owner of the Mac, over Tailscale, and only after you connect the device once in Settings.'],
  ['Connecting', 'In Settings on the copy that runs on your Mac, copy the connect link and open it on the device. Or type the Mac address into the Mac field in Settings on the hosted copy. The address is kept in this browser only, never in the website, a backup or a synced setting.'],
  ['Without a Mac', 'Everything else works the same: lookups, reading, flashcards, offline use. Sentence translation then uses your browser\'s own translator where it has one, and otherwise shows the word-by-word gloss.'],
  ['Books from the Mac', 'When a device is connected, books the Mac shares are added to its library in the background the first time, then kept like any other book, even offline. Delete one and it stays deleted; Restore in the Library brings it back.'],
];

const TRANSLATION: [string, string][] = [
  ['Words and characters', 'Pinyin and meanings come from the dictionaries listed below, which are stored in the app and work offline. Machine translation is only used for whole sentences, and the dictionary is still the source of truth for pinyin.'],
  ['Sentences, in order', 'With Automatic, Dushu tries Claude through your Mac first, then a small model that runs on your Mac (Qwen3.5 9B), then your browser\'s on-device translator (Chrome has one, Safari does not), and last the dictionary gloss. The first one that is ready is used, and the translation panel says which.'],
  ['Claude', 'Claude is made by Anthropic. Your Mac sends only the selected sentence and a little nearby context to Anthropic, using a key that stays on the Mac. The key is never in this website, your browser or your backups.'],
  ['Local only', 'Turn on Local only in Settings and every sentence stays on your Mac: Claude is skipped, and no online service is used.'],
  ['MyMemory', 'An optional online service. It is used only if you choose it, and it sends the selected text to MyMemory.'],
  ['A caution', 'A machine translation is a help, not a proof. When a sentence matters, check it against the word cards.'],
];

const fmt = (n: number | undefined) => (typeof n === 'number' ? n.toLocaleString('en-US') : '-');

interface Stat { value: string; label: string; note?: string }

/** The coverage tiles, from meta.json counts (plus the derived keys the loader adds). */
export function coverageStats(meta: Pick<DataMeta, 'counts'>): Stat[] {
  const c = meta.counts;
  const out: Stat[] = [
    { value: fmt(c.unifiedIdeographs), label: 'Chinese characters', note: 'Every Unicode ideograph, including the rare extension blocks' },
    { value: fmt(c.withReading), label: 'with a pinyin reading', note: c.extraLoaded ? `plus ${fmt(c.extraLoaded)} extra entries for rare characters` : undefined },
    { value: fmt(c.withDefinition), label: 'with an English definition' },
    { value: fmt((c.cedict ?? 0) + (c.hskOnly ?? 0) || undefined), label: 'dictionary entries', note: 'CC-CEDICT plus HSK words it lacks' },
    { value: fmt(c.segWords), label: 'words known to the word splitter' },
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
      ? 'The browser has agreed to keep your books and words, even when space runs low.'
      : 'The browser may clear your books and words if space runs low. Adding Dushu to the Home Screen, and asking below, makes that much less likely.';
    btn.hidden = kept;
  };
  btn.addEventListener('click', () => {
    btn.disabled = true;
    void (api.persist?.() ?? Promise.resolve(false)).catch(() => false).then(() => { btn.disabled = false; return refresh(); });
  });
  void refresh();
  return card;
}

const steps = (rows: [string, string][], ordered = true) => h(ordered ? 'ol.ab-steps' : 'ul.ab-steps', null, rows.map(([t, d]) => h('li', null, h('strong', null, t + '. '), d)));

function buildPage(meta: DataMeta | null, loading: boolean): HTMLElement {
  const stats = meta ? coverageStats(meta) : [];
  const sources = meta?.sources ?? [];

  const sourceRows = [
    ...sources.map((s) => ({ ...s, use: USES[s.name] ?? '' })),
    ...EXTRA_SOURCES.filter((e) => !sources.some((s) => s.name === e.name)),
  ];

  return h('div.page.ab-page', null,
    h('div.page-head', null, h('div', null,
      h('h1.page-title', null, 'About Dushu'),
      h('p.page-sub', null, 'Read real Chinese books, and look up any character.'))),

    h('section.ab-section', null,
      h('p.ab-lead', null, 'Dushu (读书, “to read books”) is a reader for learners. Open a real book, and anything you do not know is a click away: pinyin, English meanings, how a word is built from its characters, and a translation of whole sentences.'),
      h('p.ab-p', null, 'It runs entirely in your browser. Your books, saved words and settings stay on this device. The only time text leaves it is when you pick an online translator, and then only the passage you selected.')),

    h('section.ab-section', null,
      h('h2.section-title', null, 'How to use it'),
      steps(HOW_TO)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Reading like a book'),
      steps(PAGES, false)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Names and terms'),
      steps(NAMES, false)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'On an iPad'),
      steps(IPAD),
      h('p.ab-p.ab-gap', null, 'Why this matters: Safari can delete the stored data of a website you only visit, if you do not open it for about a week. A site added to the Home Screen is treated much more kindly. Dushu also asks the browser to protect its data as soon as you add your first book.'),
      storageCard()),

    h('section.ab-section', null,
      h('h2.section-title', null, 'The hosted copy and your Mac'),
      steps(HOSTED, false)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Where translations come from'),
      steps(TRANSLATION, false)),

    h('section.ab-section', null,
      h('h2.section-title', null, 'Every character'),
      h('p.ab-p', null, 'Dushu can look up any Chinese character, not just common ones. Characters without a known reading still open a card with their radical, stroke count, Unicode block and variant forms, and rare characters display in a bundled font instead of an empty box.'),
      stats.length
        ? h('div.ab-stats', null, stats.map((s) => h('div.ab-stat.card', null,
            h('div.ab-stat-value', null, s.value),
            h('div.ab-stat-label', null, s.label),
            s.note ? h('div.ab-stat-note', null, s.note) : null)))
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
      h('p.ab-p', null, 'Dushu stands on open data and open fonts. Words and definitions come from ',
        h('a', { href: 'https://cc-cedict.org/wiki/', target: '_blank', rel: 'noopener' }, 'CC-CEDICT'),
        ', which is shared under the ',
        h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener' }, 'Creative Commons Attribution-ShareAlike 4.0 license'),
        '. Thank you to the CC-CEDICT contributors and to MDBG, who host it. Definitions shown in the app are used and adapted under that license, and the dictionary data in this app stays under it.'),
      sourceRows.length
        ? h('div.ab-table.card', { role: 'table', 'aria-label': 'Data sources' },
            sourceRows.map((s) => h('div.ab-source', { role: 'row' },
              h('div.ab-source-main', { role: 'cell' },
                h('a.ab-source-name', { href: s.url, target: '_blank', rel: 'noopener' }, s.name, icon('external')),
                s.use ? h('div.ab-source-use', null, s.use) : null),
              h('span.chip.ab-source-license', { role: 'cell' }, s.license))))
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
