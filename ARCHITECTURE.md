# Dushu 读书 — architecture

A local web app for reading real Chinese books. Import an EPUB, TXT or PDF (or paste text).
Every word can be looked up: tap or double-click a word for pinyin, definitions and
character breakdown; drag across a phrase or sentence for pinyin plus a translation.
Pinyin over the text can be off, on for everything, or on only for words you don't know yet.
Words you save become flashcards.

**It must handle every Chinese character.** Data covers all 101,997 Unicode 18 ideographs:
CC-CEDICT for words, Unihan for single characters (any block, Ext A–J), a Wiktionary
supplement for rare characters, and the Jigmo fonts (CC0) as a last-resort glyph source, so
no character renders as tofu and no character is un-look-up-able.

## 1. Principles

- Offline-first. Books, vocab and settings live in IndexedDB/localStorage on the device.
  Only translation can reach the network, and only when the user picks such a provider.
- The dictionary is the source of truth for pinyin. Machine translation is a convenience on top.
- Never block reading: the library renders before the dictionary finishes parsing; the reader
  shows a spinner for at most the parse time (~0.5 s).
- Every text the app shows the user (labels, errors, toasts, README) uses American spelling,
  plain language, no emoji in UI chrome.

## 2. Stack and layout

Vite 6 + TypeScript 5.9 strict, vanilla DOM (no framework), Vitest 3. Node is 20.15 on this
Mac, so Vite must stay ≤ 6. Dependencies: `fflate` (zip/gzip), `pdfjs-dist@4` (PDF text),
`@anthropic-ai/sdk` (optional Claude translation, user's own key), `hanzi-writer` (stroke order).
Dev: `fake-indexeddb`, `jsdom`, `puppeteer-core` (headless Chrome QA), `playwright` (WebKit iPad QA, installed in the
isolated folder `.cache/qa-webkit`, not in package.json). Fonts ship from `@fontsource/noto-serif-sc`, `@fontsource/noto-serif-tc`
and `lxgw-wenkai-webfont` (SIL OFL 1.1).

```
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit (must be clean)
npm test             # vitest run (tests/**/*.test.ts)
npm run build        # typecheck + vite build → dist/
npm run data         # python3 scripts/build_data.py (rebuild public/data from .cache/raw)
npm run icons        # scripts/make-icons.mjs: apple-touch-icon, icon-192/512, maskable 512 into public/icons
npm run ipad         # owner-only private HTTPS via connected Tailscale; tracked production server only
node scripts/qa.mjs  # headless Chrome scenarios (see §7)
```

```
src/
  types.ts            shared contracts — every module imports from here
  main.ts             shell: fonts, theme, nav, hash router, toasts, AppContext   [owner: lead]
  styles/tokens.css   design tokens (colors, fonts, spacing, tone colors)        [owner: lead]
  styles/base.css     shared components (.btn, .card, .chip, .input, .page …)   [owner: lead]
  ui/dom.ts ui/icons.ts  h() helper, inline SVG icons                           [owner: lead]
  fonts.ts            lazy chunk: @font-face for Noto Serif SC/TC and LXGW WenKai (woff2 slices only)
  core/   dict.ts segment.ts pinyin.ts text.ts convert.ts lexicon.ts names.ts … [owner: core]
  core/srs.ts  store/  (index.ts, db.ts, settings.ts, backup …)                 [owner: store]
  import/ index.ts epub.ts txt.ts pdf.ts html.ts encoding.ts chapters.ts       [owner: import]
  translate/ index.ts chrome.ts claude.ts mymemory.ts gloss.ts  speech/tts.ts  [owner: translate]
  ui/reader/  ui/popup/  styles/reader.css styles/popup.css                    [owner: reader]
  ui/library/ ui/settings/ ui/about/  styles/library.css settings.css about.css [owner: shell-screens]
  ui/vocab/ ui/review/  styles/vocab.css review.css                            [owner: vocab]
tests/<area>/*.test.ts
scripts/build_data.py  scripts/build_rare_chars.py  scripts/fetch_samples.py  scripts/make-icons.mjs
scripts/qa.mjs  scripts/qa-reader.mjs  scripts/qa-ipad.mjs (WebKit)  scripts/qa-shell.mjs  scripts/qa-vocab.mjs
public/data/*.tsv.gz  public/fonts/Jigmo*.woff2  public/samples/
```

Files marked STUB in their first line are placeholders with the final signatures; the owner
replaces them. Do not edit files you do not own. If a contract in `src/types.ts` is wrong,
say so in your final report instead of changing it unilaterally (the lead merges contract
changes). Adding optional members is fine if you also update this document.

## 3. Data files (`public/data/`, built by `scripts/build_data.py`)

All are gzipped UTF-8 TSV. Lines starting with `# ` are comments (license, column names).
Fetch them and decompress with `DecompressionStream('gzip')` in the browser, `zlib.gunzipSync`
in Node tests. Real files are present; tests should use them (they load in ~0.3 s).

| file | columns | rows |
|---|---|---|
| `cedict.tsv.gz` | trad, simp, pinyin, defs | 125,292 |
| `chars.tsv.gz` | char, readings, definition, strokes, rs, simp, trad, variants, compatOf | 102,999 |
| `chars-extra.tsv.gz` | char, readings, definition (Wiktionary supplement; may be absent) | 5,132 |
| `cedict-extra.tsv.gz` | same columns as `cedict` (Wiktionary words CC-CEDICT lacks; optional) | see file |
| `words.tsv.gz` | word, count | 287,084 |
| `hsk.tsv.gz` | simp, trad, hsk3, hsk2, rank | 11,470 |
| `t2s.tsv.gz` / `s2t.tsv.gz` | from, to (OpenCC phrases + chars, first candidate) | 3.5k / 42k |
| `radicals.tsv.gz` | num, radicalChar, unifiedChar | 246 |
| `meta.json` | build date, Unicode version, counts, sources + licenses | |

Details:
- `cedict` pinyin is numbered, space-separated, `ü` (never `u:`/`v`), tone 5 = neutral,
  proper nouns capitalized ("Bei3 jing1"); non-syllable tokens (digits, Latin letters, `·`, `,`)
  appear as-is. Syllable count usually equals the code-point count; when it does not, fall back
  to per-character readings for alignment. Multiple rows can share a headword (one per reading).
  The final 30 rows are HSK words missing from CC-CEDICT. Those rows are NOT in the numbered format
  (they hold tone marks and run-together syllables such as `chènzhe`, `bu4 lìyú`); the loader repairs them with
  `normalizePinyinField`. A cleaner fix is for `build_data.py` to emit numbered pinyin for them.
- `chars` readings are tone-marked (`hǎo`), comma-separated, most customary first (kMandarin
  first). `rs` is kRSUnicode `85.5` = radical 85, 5 residual strokes (`120'.3` = simplified
  radical form). simp/trad/variants columns are strings of chars (no separator).
  Every unified ideograph has a row even if every other column is empty — 44,362 have a
  Mandarin reading, 23,310 a definition.
- `chars-extra`: a row's readings or definition column is empty when only the other was added, so fill per field,
  not per row (909 rows add a reading, 4,911 add a definition). `chars.tsv` has 102,999 rows including non-ideographs
  (Kangxi radicals), of which 101,997 are ideographs. (made by `scripts/build_rare_chars.py` from Wiktionary via kaikki.org,
  CC BY-SA): readings tone-marked comma-separated, definition `; `-joined. Use only to fill
  gaps (a char with no Unihan readings/definition); report `source: 'wiktionary'`.
- `words` = segmentation vocabulary: every CEDICT/HSK headword in both scripts and every
  Unihan char, with jieba `dict.txt.big` counts. Header comment `# total=<sum>`. Some jieba-only compounds
  (很多, 山上) are absent; `cedict-extra` and the loader's alias tables cover part of that gap.
- `cedict-extra`: appended after CEDICT, skipping repeated readings; its words enter the segmentation vocabulary
  with count 0.
- Characters with no reading anywhere: show radical, strokes, block, variants (and the
  variants' readings, `source: 'variant'`), plus external links. Never show an empty popup.

## 4. Module contracts

### 4.1 `core/dict.ts` — `loadDictionary(baseUrl, opts?) → Promise<Dictionary>`
- Loads all data files in parallel, parses on the main thread in chunks (yield to the event
  loop every ~20k lines) and reports `onProgress`. `opts.fetchText(name)` overrides fetching
  (Node tests pass a gunzip-from-disk loader). Missing optional files (`chars-extra`) are fine.
- Data details the loader guarantees: `loadDictionary` calls `fetchText` with names including the extension
  (`cedict.tsv.gz`, `chars-extra.tsv.gz`, `cedict-extra.tsv.gz`, `meta.json`) and expects decompressed text;
  `onProgress(done, 100)` is monotone and ends at (100, 100). `Dictionary.freq()` is a segmentation weight, not
  the raw jieba count (CEDICT-only proper nouns like 花都 are cut to a quarter at load; words with count 0 are scored
  at `-ln(total) - 4`). `wordsAt` indexes only headwords of 2–30 code points (longer proverbs still work with
  `lookup`). `meta.counts` gains derived keys (`wordTotal`, `charsLoaded`, `extraLoaded`, `wordsExtraLoaded`,
  `tradAliases`). The OpenCC tables hold first-candidate conversions only, so ambiguous characters (发, 干, 里, 后)
  can convert wrongly; the loader adds identity phrases and 2,312 aliases to limit that.
- `lookup(word)`: exact headword in either script, entries in file order, deduplicated.
  `CharInfo.source` is one of unihan, wiktionary, variant, cedict (〇 only), none.
  Normalizes first: CJK compatibility ideographs → unified (`compatOf`), Kangxi/supplement
  radicals (U+2E80–2FDF) → unified char (NFKC per char). Never NFKC whole strings (it would turn
  full-width punctuation into ASCII).
- `char(ch)`: info for any Han code point (astral planes included — iterate by code point,
  never by UTF-16 unit). `block` from a code-point range table covering URO, Ext A–J,
  compatibility, compatibility supplement, radicals.
- `pinyinFor(word, ctx)`: if the word has CEDICT entries pick the best reading (see below)
  and align syllables to code points; else per char: the char's default reading. Default
  reading of a single char: the first Unihan `readings` value that matches one of its CEDICT
  readings (tone-insensitive compare on the base), else the first CEDICT entry, else Unihan.
  `pinyinFor` returns lowercase numbered syllables ('' for non-Han and for characters with no reading from Unihan,
  the supplement or a simplified/traditional counterpart); `ctx.prev/next` are neighboring token texts of any kind.
  Curated word readings live in `WORD_READINGS` (polyphone.ts, checked against CEDICT by a test). Context rules (must have tests): 了 → le5 except as a full word like 了解/了不起 (those come
  from CEDICT); 的 → de5; 着 → zhe5 (zháo only via words like 着急 — check CEDICT); 得 → de5
  unless followed by a verb in 得到/得出 style words (CEDICT handles most) — keep rules simple
  and explicit; 地 → de5 when prev ends with a reduplicated char (慢慢地) or is a 2+ char
  adverb/adjective (heuristic: prev token length ≥ 2 and next token is not a noun-ish word —
  document whatever heuristic you choose and test it), else dì; 还 → hái; 都 → dōu;
  行/长/重/为/得/觉/分/便/传/少/好/种/中/看/相/应/空 → standalone defaults from Unihan order.
  For multi-reading multi-char words (e.g. 银行 has one reading, 长大 one; 好好 several) prefer
  the entry whose defs are not "variant of"/"old variant"/surname-only, then the most common.
- `wordsAt(text, i)`: all headwords starting at i (max headword length from the data), longest
  first; always includes the single code point if Han (surrogate pairs = one char).
- `toSimplified`/`toTraditional`: OpenCC longest-match over phrases then chars.

### 4.2 `core/segment.ts` — `segment(text, dict) → Token[]`
- Tokens cover the paragraph exactly (concatenated `text` === input; `start`/`end` are UTF-16
  offsets). Kinds: `han` (runs of Han code points, segmented), `latin`, `num` (ASCII or
  full-width digits, Chinese numerals stay Han), `punct` (CJK + ASCII punctuation, each char its
  own token), `space`, `other`.
- Han runs: jieba-style max-probability path over the DAG of `wordsAt` candidates with
  log(count+1) − log(total) scores (unseen single chars get count 0 → still valid). Ties favor
  fewer tokens. Each han token gets `pinyin` from `dict.pinyinFor(word, {prev, next})`.
- Traditional text segments exactly as well as simplified (both scripts are in `words`).
- Performance: 10,000 Han chars in < 60 ms on this Mac (test it).
- Tests on real sentences, e.g. 我们在银行门口见面。 → 我们|在|银行|门口|见面|。;
  他慢慢地走了过来。 (地 → de, 了 → le); 長江是中國最長的河流。 (traditional);
  𠀀 / 𪚥 / 𰻞 single astral chars → one token each with readings where Unihan has them.

### 4.3 `core/pinyin.ts`
`toneOf`, `numberedToMarked` (tone mark placement: a/e first, then o in "ou", else last vowel;
ü; `r5` → `r`; keep capitalization), `markedToNumbered`, `numberedToZhuyin` (full table,
tone marks ˊˇˋ˙), `formatSyllable(s, style)`, `formatPinyin(numbered, style)`,
`applySandhi(tokens)`: 不 before a 4th tone → bu2; 一 → yi2 before 4th, yi4 before 1/2/3,
unchanged as a number (第一, 一月, 十一, 一二三, 唯一, end of phrase). Also: 一/不 between identical characters are
neutral (看一看, 好不好), and 一 before a neutral 个 is yi2 (一个 is yí ge). Only applied when
settings.sandhi is on (the caller decides).

### 4.4 `core/text.ts` — exact signatures are in the stub file.

### 4.5 `import/` — `importFile(file, {onProgress}) → ImportedBook`, `importText(text, title, author)`
- **EPUB 2/3** (fflate unzip): container.xml → OPF → spine order; titles from nav.xhtml or
  toc.ncx (map spine items to TOC labels; untitled items use their first heading or "Section n").
  XHTML → `Block[]`: p/div text → `p` (split on `<br>` runs into separate paragraphs only when
  the book uses `<br>` as paragraph breaks), h1–h6 → `h`, blockquote → `quote`, img/svg image →
  `img` with the image stored in `assets`, hr → `hr`. Drop `rt`/`rp` (source ruby), scripts,
  styles, footnote backlink markers. Collapse whitespace but keep full-width spaces (U+3000)
  at paragraph starts trimmed. Cover from OPF metadata or the first image. Title/author from
  OPF dc:title/dc:creator (strip site junk like "ePUBw.COM" from creator lists).
  Must open `~/Downloads/活着.epub` correctly (test reads it from that path if it exists and
  skips otherwise — never copy that copyrighted file into the repo).
- **MOBI / AZW / AZW3 / PRC without DRM** (`import/mobi.ts`, `mobiIndex.ts`, `mobiText.ts`): PalmDB container, MOBI header and EXTH
  (title 503, author 100, cover 201, KF8 pointer 121), PalmDOC LZ77 and HUFF/CDIC text, trailing-entry stripping, UTF-8 and
  cp1252-declared text (a wrong declaration is auto-detected). The KF8 half is used when present (standalone AZW3, or the half after
  the BOUNDARY record of a combined file): FDST flows and the SKEL/FRAG indexes rebuild each XHTML file, images are found by
  `kindle:embed` base32 references. Chapters come from the NCX index (anchors in the text), else from headings, else from size.
  `format` is `'azw3'` for standalone KF8 and for combined files named .azw3/.azw, else `'mobi'`. Kindle files are recognized by their
  PalmDB magic whatever the extension. DRM (types 1 and 2, in either half) gives "This Kindle book is protected by DRM ...";
  Topaz, KFX and truncated files give a plain ImportError. Verified on public-domain Gutenberg files
  (`tests/fixtures/import/daodejing.gutenberg.{mobi,azw3}`); HUFF/CDIC and combined MOBI 6 + KF8 only against the test writer
  (`tests/import/mobiWriter.ts`). Single spaces between two CJK characters are removed in Kindle paragraphs only.
- **TXT from download sites**: `import/boilerplate.ts` drops URL lines, "本书由…整理", "更多精彩…", "txt下载", "手机阅读", navigation bars and any
  line repeated more than 9 times across the book, never headings; full-width digits in headings (第１回) and a colon after the marker
  are normalized. The same filter runs over EPUB and HTML paragraphs. Author strings are cleaned (原著：, 著：, [清], （明）, trailing 著).
  `ACCEPT` in `import/index.ts` and its copy in `ui/library/importer.ts` must stay identical (a test of the library checks the input).
- Importers throw `ImportError` (messages are written for the user; the UI shows `err.message`) for empty input,
  unsupported types (djvu, doc, docx, rtf, KFX, Topaz), DRM, scanned or password-protected PDFs and files with no
  Chinese. HTML and Markdown report `format: 'html'` / `'md'`. TOC fragments: chapters are cut at the anchor
  blocks a TOC points to; generated contents pages are dropped; chapters over 30k Han characters are split by
  headings, else into 12k pieces. `<br>` handling is decided per document (hard-wrapped lines are joined). PDF
  CJK CMaps (GB/CNS/B5/HK) are bundled (about 87 files, 1.2 MB, fetched only when needed). The TXT heading
  regex below is a floor: the importer also accepts 節, 卷/部/集 (level 1), diary-style numeral sections and more.
- **TXT**: detect encoding — BOMs (UTF-8/16LE/16BE), else try UTF-8 fatal; else score
  GB18030 vs Big5 vs UTF-16 decodes by the share of common CJK chars (top-3000 by frequency)
  and pick the best. Normalize CRLF. Paragraphs = non-empty lines (also split on blank lines
  if the file uses hard-wrapped lines — detect: many lines ~same length not ending in
  punctuation → join wrapped lines). Chapters: lines matching
  `^\s*(第[0-9〇零一二三四五六七八九十百千两]+[章回节卷集部篇幕]|序[章言]?|楔子|引子|前言|后记|後記|尾声|尾聲|番外|Chapter\s+\d+)`
  (short lines only). If no markers, split into sections of ~4,000 Han chars at paragraph
  boundaries titled "Part n". First non-empty line may be the title if short.
- **PDF** (pdfjs-dist 4, worker via `?url` import): text items → lines by y, paragraphs by
  gaps/indent; chapters by the same heading regex; scanned PDFs (no text layer) → throw an
  Error with a clear message ("This PDF has no text layer (it is scanned images)…").
- **HTML/Markdown**: same block extraction as EPUB XHTML / simple line rules.
- Sets `script` with `detectScript`. Rejects files that contain almost no Han text with a clear error.

### 4.6 `store/` — `openStore(name) → Store`, `store/settings.ts`, `core/srs.ts`
- IndexedDB `dushu` (v2) stores: `books` (BookMeta), `chapters` (key `[bookId, index]`),
  `assets` (key `[bookId, name]` → Blob), `progress` (bookId), `vocab` (id), `known` (word),
  `reviews` (autoIncrement), `lexicon` (key `[scope, word]`) and `lexiconScopes` (key `scope` → `{detectedAt, version}`). v2 only adds the
  last two; the upgrade creates missing stores and keeps every v1 row. `DB_VERSION` is in `store/db.ts`. `known` rows are `{word}`, `chapters` rows `{bookId,index,chapter}`, `assets` rows `{bookId,name,blob}`. `known`/`vocab` keys are kept in memory for sync `has()`.
  The store has no dictionary: main.ts calls `store.setNormalizer(dict.toSimplified)` once
  the dictionary loads. Keep a second in-memory set of normalized keys (rebuilt when the
  normalizer arrives); `has(word)` is true if the raw word or `normalize(word)` is in either set.
  VocabItem already carries simp + trad.
- `Store.backend` is `'idb'` or `'memory'` (memory fallback loses data on reload; main.ts and Settings warn).
  `openStore` throws on a newer on-disk version; main.ts shows that message. `Store.wipe()` empties every table.
  `Store.importBackup(json)` returns a `BackupReport` and never applies settings: the caller does
  `settings.set(report.settings)`. Backup merge: a vocab item's stamp is max(srs.last, addedAt) and the newer wins;
  progress compares `updatedAt`; known words are unioned; reviews dedupe by itemId|at|grade; version > 1 is rejected.
- `books.list()` sorts by `lastOpenedAt ?? addedAt`; the reader calls `books.update(id, {lastOpenedAt})`.
  `progress.set` does not touch it. `BookMeta.chapterTitles` is filled by `books.add`.
- `Progress` has an optional `offset`: in Pages a page often starts mid-paragraph, so progress is `{block, offset}` (UTF-16 offset inside the
  block) and a reload lands on the same page. Scroll ignores it. Backups keep it.
- `lexicon.{get, putDetected, upsert, remove, detected}` take a scope (a book id, or `'*'` for the user's words in every book). `putDetected(scope,
  rows, version)` replaces the scope's automatic rows, keeps every row the user wrote and every disabled row (so a rejected word does not come
  back), and records the detector version; `detected(scope, minVersion)` is true when a scan at least that new ran. `books.remove` deletes the
  book's lexicon rows and scope record. The backup gains a `lexicon` array of user-origin and disabled rows (`{scope, word, pinyin, gloss, kind,
  count?, enabled, origin}`); the import adds rows that are not there yet and skips damaged ones. Backup `version` stays 1: the key is optional.
- Assets are stored as `{bookId, name, data: ArrayBuffer, type}`, not as Blobs (a Blob written to IndexedDB made WebKit hang forever in an ephemeral
  Playwright context; the same engine path serves Safari private windows). `assetUrl` still reads old rows that hold a `blob`.
- `books.add` computes `charCount` and `chapterOffsets`, saves chapters/assets in one
  transaction, returns the meta. `remove` deletes everything for the book.
- SRS: SM-2 variant. New card: learning steps 1 min → 10 min → graduate 1 day (Good) /
  4 days (Easy); Again resets to step 1 and counts a lapse (on a review card it also lowers ease by 0.2, floor 1.3,
  and relearns on 1 m then 10 m); the learning step is inferred from interval 0 and due - last (no extra field);
  review intervals are hard = max(i+1, round(i·1.2)), good = max(hard+1, round(i·ease)), easy = max(good+1,
  round(i·ease·1.3)), capped at 36,500 days; ease floor 1.3, Hard ×1.2 and
  ease −0.15, Easy ×ease×1.3 and ease +0.15. Deterministic (no randomness/fuzz) for testing.
- Settings: key `dushu.settings.v1` in localStorage; unknown keys dropped, invalid values
  clamped (fontSize/scrollFontSize 14–44, lineHeight 1.4–3, pageWidth 480–1200, hskThreshold 1–7).
  Text size is saved per layout: Pages uses `fontSize` (22 px default), Scroll uses
  `scrollFontSize` (28 px default, also used when older settings lack the field).
- Backup JSON: `{ app: 'dushu', version: 1, exportedAt, settings (minus claudeApiKey),
  vocab, known, progress, reviews, lexicon }` — books are not included (they can be big); say so in the UI.

### 4.7 `translate/` — `getTranslator(id, settings, dict)`, `pickTranslator(settings, dict)`
- `chrome`: the built-in on-device Translator API (`self.Translator`, Chrome 138+):
  `Translator.availability({sourceLanguage:'zh', targetLanguage:'en'})` →
  available/downloadable/downloading/unavailable; `Translator.create({...,monitor})` needs a
  user gesture when downloading. Cache the instance. Feature-detect; never throw at import.
- `claude`: `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true` and the user's key
  (settings.claudeApiKey; stored only in localStorage). Default model `claude-opus-5-5`
  (settings.claudeModel; offer claude-sonnet-5-5 and claude-haiku-5-5 in Settings). Request:
  `client.beta.messages.stream({ model, max_tokens: 2000, betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default', output_config: { effort: 'low' }, system, messages })` — no `thinking`
  param, no temperature, no prefill. Stream text deltas to `onDelta`. Check
  `stop_reason === 'refusal'` and surface a short message. System prompt: translate Chinese
  for an English-speaking learner reading a book; `translate` mode returns only the natural
  English; `explain` mode returns the translation, then 2–6 short bullets on words, grammar
  patterns and idioms in the selection. Pass `context` (the paragraph) as reference only.
  Map SDK errors (401 bad key, 429, network) to short user messages.
- `mymemory`: `https://api.mymemory.translated.net/get?q=…&langpair=zh-CN|en` (no email
  param, ever). 500-char chunks. Free tier ~5k chars/day — report quota errors plainly.
- `gloss`: always available, offline: segment + first definition of each word, joined
  "word (pinyin): gloss · …". Used when nothing else is.
- `local`: on the owner's Mac only, call an installed Ollama model over loopback for a sentence
  translation or explanation. Word cards may request a separate contextual suggestion, always
  marked as fallible AI and never substituted for dictionary entries.
- `pickTranslator` with `auto`: evaluated local Qwen3.5 9B → ready Chrome → smaller local model → Chrome download → claude if key →
  gloss. (MyMemory sends text to a third party, so auto never picks it; the user opts in.)
  The Translator API's availability values are available/downloadable/downloading/unavailable; chrome.ts maps them to
  yes/download/no. In the `download` state only a click can start the download: the UI casts to `ChromeTranslator`
  and calls `prepare(onProgress)` inside its click handler. In that state the phrase popup also shows the offline
  gloss so it is never empty. Claude and the local model can produce explain-style notes. `listTranslators(settings, dict)` and
  `TRANSLATOR_IDS` are exported for the Settings screen. Abort errors are `DOMException` named AbortError: ignore them.

Translation glossary records carry optional `kind: name|term|idiom`; name readings are not confused with rare object descriptions.
The local translator performs at most one corrective retry for narrowly detected wine-shop/hotel sense contradictions and
raw tone-numbered pinyin in an ordinary dictionary term. These checked chunks are buffered until accepted; repeated contradictions
are withheld with an error. No global semantic validation is claimed, and Explain can still show pronunciation/sense-comparison notes.
Word cards place Translate sentence beside Read from here above long dictionary details, with 44px coarse-pointer targets.

### 4.8 `speech/tts.ts`
Web Speech API plus private Premium macOS playback (`scripts/native-speech.ts`).
Prefer installed Premium/Enhanced zh-CN voices for simplified text, zh-TW for traditional;
otherwise prefer Tingting / Meijia / Sinji over novelty voices. settings.ttsVoice overrides.
Native voices use `/api/native-voices` and `/api/native-speech`: same-origin authenticated requests only,
validated installed voice names, bounded text, subprocess timeout, at most two active renderers,
temporary files removed after rendering. The client prefetches one sentence, preserves pitch,
and cancels fetching/playback on stop. Native audio has paragraph highlighting, not invented word timestamps.
`speak` cancels anything playing.
`speakSequence` reads chapter blocks in small chunks, reports utterance boundaries for word
highlighting, and supports pause, resume and stop. `getRate` is read at each sentence chunk,
so speed changes need no chapter restart. Scroll shows a floating playback strip; Pages keeps the header controls.
Reader word and selected-passage popups offer **Read from here**. The lookup supplies a block and UTF-16 source
offset; chapter speech slices only its first block and translates boundary events back to the original offsets.
It continues through the chapter, reveals the chosen offset in Pages, and safely replaces previous playback.
Dictionary drill-down views without a source anchor do not offer a misleading chapter-start control.
On iPadOS, an audio element is primed synchronously inside the initiating gesture and reused across sentences.
Mac-generated voices are labeled “your Mac”, never “on-device” on the iPad. Local device voices remain available offline.

### 4.8.1 Private iPad bridge
`scripts/setup-ipad.mjs` resolves the connected Tailscale Mac's own DNS name and login, saves owner-only configuration
in ignored `.dushu-local/ipad.json`, restarts only a validated tracked Dushu PID, and configures Serve HTTPS 8443.
It never enables public Funnel, changes router forwarding, binds the app to LAN, or bypasses certificates.
`scripts/private-access.ts` gates all routes on loopback socket source and either localhost or the exact configured
host plus Tailscale Serve's injected owner identity. Origin and cross-site checks also protect API requests.
Serve removes spoofed identity headers; direct remote requests cannot reach the loopback backend.
`scripts/local-model.ts` exposes only filtered tags and bounded generation, a supported model allowlist, fixed inference
limits, two active generations, timeouts and disconnect cancellation. It never exposes Ollama model management.
The browser requests its own origin, not iPad localhost:11434. Books are exact opt-in owner files, not a Downloads browser.
API responses are no-store and the service worker does not intercept them. Library storage remains device/browser-specific;
backup transfer is manual, not automatic sync. New v1 backups include only SHA-256 book-content identities, not the content itself.
Progress, book-specific terms and vocab book context are remapped only to an exact, unambiguous imported copy;
different editions/duplicate copies are not guessed, and older backups remain readable. Import books before the backup.
Mac services require an awake, connected Mac.
`start-local.mjs` also probes the installed Ollama service, launches it on loopback only if unreachable,
and leaves an unrelated responding service on port 11434 untouched. It never downloads models or changes VPN/account settings.
Offline speech discards cached Mac voices and chooses an available device voice; discovery expires after 30 seconds
and temporary failures are not permanently cached. Mid-render connection errors explain recovery, rather than exposing a raw fetch error.

### 4.9 `core/lexicon.ts` — book names and terms (`detectTerms`, `buildLexicon`, `loadLexicon`)
Real novels are full of words no dictionary has: character names (郭靖, 黄蓉, 洪七公, 王熙凤, 福贵, 家珍),
places (桃花岛), martial-arts and period terms (降龙十八掌, 九阴真经). Without help they split into single
characters, each with a misleading gloss. The lexicon fixes that per book. What the code does today:
- `detectTerms(chapterTexts, dict)` (also `detectGen` / `detectTermsAsync`, which yield to the event loop): new-word discovery over the whole
  book. Han n-grams of 2–6 code points that never cross punctuation and occur at least max(6, chars/150k) times; counts level by level (a
  gram is counted only when both halves are frequent). Each candidate gets binding (`bind`: the larger share of either part's occurrences that
  sit inside this string, minimum over splits), pointwise mutual information, left/right neighbor entropy (a dominant 《》 bracket counts as
  complete), and the share of occurrences followed by a verb of speech (说道笑叫问答…). `known` says whether the dictionary has it
  (`entry` = CEDICT/HSK headword in either script, `jieba`, `none`). Detection runs about 0.4 s for 920k characters.
- `judgeCandidate(c, dict, minCount)` is the precision gate and decides the kind. Never accepted: anything the dictionary has, strings that start
  or end with a function character, end in a verb of direction or speech, end in a numeral (微微一), or start with a measure phrase (一条,
  几句话) unless the string is a title. Accepted as **term**: ends in 经掌法拳指功阵甲爪剑刀棍鞭诀谱录 (3+ characters, 九阴真经, 打狗棒法), or is bracketed
  on both sides in the text, or a tightly bound string (bind ≥ 0.9, seen ≥ 3× the minimum) with no sign of what it is ("name or term in this
  book"). **place**: 3+ characters ending in 岛山庄寺城府村镇峰谷关江河湖海岭洞殿堡宫楼阁庙塔桥坡寨营州县国 or 派帮教门会宗, and 2-character …国.
  **name**: a common surname (`names.ts`, simplified forms; the text is folded first) plus 1–2 given characters (3-character names need
  bind ≥ 0.45 or a speaker; 2-character ones must be seen speaking or be tightly bound), a compound surname plus 1–2, a surname-led string
  with a title (程大小姐, 柯大侠), a title (…大师/上人/长老/庄主/岛主/帮主…), a nickname (老/小 + 2 characters), or a name without a Chinese surname
  (哲别, 瑛姑, 札木合) that speaks. Names must not contain 给带向让从跟对把被为以于得地. Fragments are dropped when a longer accepted string
  explains them (洪七 inside 洪七公). On 射雕英雄传 this gives 157 entries (郭靖 4,999, 黄蓉 3,641 …); on 活着 13 (家珍, 凤霞, 有庆, 福贵 …); on the
  traditional 红楼梦 sample 106 (賈母, 黛玉, 王夫人 …). Known misses: names that CEDICT also lists (铁木真, 成吉思汗, 老顽童 are already words,
  so they need nothing), and nicknames such as 靖哥哥.
- `pinyinOf(word, kind, dict)`: one numbered syllable per code point from the dictionary's default reading, with surname readings for a
  surname-led name (单 shàn, 曾 zēng, 解 xiè, 区 ōu, 仇 qiú, 华 huà, 任 rén, 尉迟 yùchí, 万俟 mòqí, 欧阳 ōuyáng …; tables in `names.ts`),
  儿/处/乐 as in names (蓉儿 ér, 丘处机 chǔ), and a doubled last character neutral (哥哥). Glosses: "name (person)", "place or group name",
  "name or term in this book".
- `buildLexicon(rows)` holds enabled rows only (`has`, `get`, `entries`, `maxLen` in code points); `mergeLexicon(userRows, bookRows)` lets the
  book's row win over the user's `'*'` row; `parseEntryPinyin(input, word)` reads "guo1 jing4", "guō jìng" or "guōjìng" back to numbered pinyin
  with exactly one syllable per character (null otherwise).
- `segment(text, dict, lexicon?)`: enabled lexicon words are extra candidates in the DAG at every position (2…`maxLen` code points), scored as
  a very frequent word (`LEXICON_WEIGHT` 14 nats, or the dictionary's own score if higher), so a name beats the split into 郭|靖. A token that
  is a lexicon word gets the entry's pinyin when it has one syllable per character; `inDict` stays false. With no lexicon or an empty one the
  result is identical to before.
- `loadLexicon(ctx, bookId, onUpdate)`: returns `'*'` rows + the book's rows at once. If the scope was never scanned (or by an older
  `DETECTOR_VERSION`), detection runs in the background over the stored chapters (idle slices, one run per book), is saved with
  `store.lexicon.putDetected`, and `onUpdate(newLexicon)` fires so the reader can re-render. A user row or a disabled row is never overwritten.
  First open of a 920k-character book: names appear about 1.5 s after the chapter in headless Chrome and about 2 s in WebKit. While the first scan
  runs the reader holds back laying out the neighbor chapters (`pager.holdNeighbors`, `isDetecting`): doing both made the scan take 15 s in WebKit,
  and the neighbors would have been thrown away when the names arrived.
- Reader: `createChapterView({lexicon})` and `setLexicon(lex)`; when the reader's script setting converts the text, the lexicon's words are
  converted too (`shownLexicon()` in chapter.ts). The reader re-segments and keeps the position when the lexicon changes (background
  detection, an edit, "Not a word"). The contents drawer has a "Names & terms" tab (press N) with a switch per row.
- Popups: a word that is a lexicon entry (looked up in either script) gets an "In this book" card first in the word popup (`ui/popup/bookCard.ts`):
  kind chip (Person, Place, Term, Your word), count, the entry's pinyin and meaning, **Edit** (pinyin with tone numbers or marks, meaning; saved
  as a user row in the book's scope) and **Not a word** (a disabled user row in the book's scope, popup closes, toast with Undo). The header
  reading comes from the entry. The phrase popup offers **Add as a word…** for a 2–8 character Han-only selection that is not already an entry
  (also offered in the word popup under "not in the dictionary as a word"): pinyin prefilled from what is shown, optional meaning, "This book"
  or "All books" (`'*'`). The phrase popup segments with the lexicon, so a name is one row in the word-by-word list. Edits call
  `onLexiconChange` and the reader reloads the lexicon.

## 5. UI

### 5.1 Shell (`main.ts`, done)
Routes: `#/` library · `#/read/<bookId>?ch=<n>` reader · `#/vocab` · `#/review` ·
`#/settings` · `#/about`. Each screen module exports `mount: MountFn` and returns a cleanup.
The reader hides the nav (`body[data-route=read]`) and draws its own top bar.
`ctx.dict()` is a cached promise; `ctx.dictSync()` is non-null once loaded.

### 5.2 Popups (`ui/popup/popup.ts`, signatures in the stub)
One popup at a time (opening one closes the other). Positioned near the anchor, flips
above/below, clamps to the viewport, becomes a bottom sheet under 640 px width. Closes on Esc,
outside click, route change. Keyboard: ←/→ = `onStep`, Shift+←/→ = `onResize`, S = save,
K = known, P = play audio.
- **Word popup**: headword large (simplified; traditional alongside if different), pinyin in
  the user's style + tone colors, speak button, HSK chip, Save (star) and Known (check)
  toggles, then every reading's definitions (classifiers "CL:個|个[ge4]" rendered as a
  "measure word: 个 gè" line; cross-references like 瞭|了[liao3] rendered as clickable links that
  re-open the popup on that word), then a character breakdown for multi-char words (each char:
  big glyph, pinyin, first gloss, radical + strokes; click to drill in; a Back button returns),
  then for single chars: radical, strokes, variants (clickable), Unicode code point and block,
  stroke-order animation via hanzi-writer (data fetched from jsdelivr on demand; hide quietly if
  unavailable), and links (MDBG, Wiktionary, zdic 汉典). If the word is not in CEDICT, say which
  source the info came from. Footer: "Translate sentence" (opens the phrase popup for
  `context.sentence`).
- **Phrase popup**: the selected text with pinyin, speak, Copy, translation from
  `pickTranslator` (shows provider name, streaming text, error states, "Explain" button for
  Claude or a local model, "Try another provider" menu), and the word-by-word breakdown (each row clickable →
  word popup). Save phrase is not needed.
  Loading requests can be stopped or switched; the completed plain answer is retained while an explanation
  is generated and can be restored immediately. Translation results have a separate Copy action.

- **Names and terms** (§4.9): both options also take `lexicon`, `bookId` and `onLexiconChange`. With them the word popup leads with the
  "In this book" card and the phrase popup offers "Add as a word…". Without a `bookId` (the vocab screen) neither appears.
- **Closing**: Esc, a mouse press outside, or a tap outside. Safari reports the click after a touch tap as `pointerType: 'mouse'`, so the host
  remembers a touch `pointerdown` for one second and still closes on that click.

`WordPopupOptions` and `PhrasePopupOptions` also take optional `getAnchor?: () => DOMRect | null` (the popup follows
its word while the page scrolls), `keepAnchorVisible?: boolean` (scroll so a bottom sheet does not cover the word)
and `onBack?: () => void` (shows a Back button). The vocab screen needs none of them.

### 5.3 Reader (`ui/reader/`)
- Top bar: back to library, book title + chapter title, chapter menu (TOC drawer),
  pinyin mode quick toggle (Off / All / Unknown / HSK), Aa menu (font size, family, line height,
  width, theme), progress %.
- Render the current chapter only. Paragraph → tokens → one element per han token:
  `<span class="rd-w" data-s=start data-e=end data-i=token>` containing `<ruby class="rd-c" data-o=offset>` per character with
  `<rt class="tone-n"><span class="rd-rtx">pinyin</span></rt>` (the text sits in a span because Safari ignores positioning on `rt`; tone class
  only when toneColors; `rt.textContent` is unchanged). `ruby` is `display: inline` in the reader. Full-width punctuation is wrapped in
  `span.rd-pu.rd-pu-o` (opening) or `.rd-pu-c` (closing) so it takes a grid cell. The phrase popup's text uses the same spans
  but `popup.css` still styles it as native ruby. Toggling pinyin mode / style / tone colors /
  known words must not re-segment: keep tokens per block in memory and update classes or rt text.
  Pinyin visibility via classes (`.rd-py-off`, `.rd-known`), `rt` must not be selectable and must
  not leak into copied/selected text. Script conversion re-renders the chapter.
- Large chapters: render blocks in batches (first screenful synchronously, the rest in idle
  callbacks), keep scrolling smooth with 20k+ chars.
- Interactions: click (or hover if settings.lookupTrigger = hover, with 250 ms delay) on a han
  token → highlight it and open the word popup with `prev/next`, context sentence, book info,
  `onStep` (move to adjacent han token), `onResize` (grow/shrink: re-select the longest dictionary
  word starting at the same offset with one more/less char, or merge with the next token).
  Double-click behaves the same (and clears the native selection). Drag-select across text
  (mouse up with a non-collapsed selection containing Han) → map the DOM range to block
  offsets via the token spans (never use Selection.toString — it would include rt), highlight
  it, open the phrase popup. Mobile: tap = click; long-press selection works the same way.
- Saved words get a subtle underline (`--saved`); known words lose their pinyin in Unknown mode.
- Paragraph translate (settings.paragraphTranslate): a small translate icon appears in the
  margin on hover; click → translation block under the paragraph (toggle). Scroll layout only: Pages hides the margin buttons and has no
  in-flow translation block (select a sentence instead).
- Keys: ←/→ or PageUp/PageDown at chapter edges = prev/next chapter, `p` cycles pinyin mode,
  `[`/`]` font size, Esc closes popups, `?` shows a shortcut sheet.
- `#/read/<id>?ch=<n>`: `n` is the 0-based chapter index, matching `Progress.chapter` and `VocabItem.context.chapter`.
  The reader does not rewrite the hash, so a reload restores the saved position. The library links without `?ch=`.
  Shortcuts live in `ui/shortcuts.ts`, shared by the reader's `?` sheet and the About page.
- Progress: save `{chapter, block, offset?, percent}` (debounced on scroll; on every page turn in Pages); restore on open (scroll the
  block into view, or open the page that holds the offset). Update `lastOpenedAt`. Chapter end: "Next chapter" button (Scroll), or the
  next page flows into the next chapter (Pages).
- Script and fonts: the article's `lang` is `zh-Hant` or `zh-Hans` from the script setting (original = the book's script). `--rd-font` is set
  to the matching stack (`--font-serif`, `--font-sans`, `--font-kai`, and the `-hant` variants for traditional) because a `var()` set on the
  container resolves there, so the `:lang(zh-Hant)` override in tokens.css never reaches the text by itself. Line height is raised to at
  least 1.9 whenever pinyin can show.
- Lexicon: see §4.9. The reader loads it on open, passes it to the chapter view, lookups and both popups, and reloads it on `onLexiconChange`.
- Images: `store.books.assetUrl`. Headings use the reading font, larger.
- Typography: settings font family/size/lineHeight/pageWidth; text-justify off; CJK
  punctuation via `font-feature-settings: "halt"` off; paragraphs indented 2em (Chinese convention)
  unless they start with full-width spaces.

### 5.4 Library (`ui/library/`)
Samples are stored with `format: 'sample'`, `sourceName: 'sample:<id>'` and the index note plus source URL.
`public/samples/index.json` entries carry id, title, author, script, file, level, blurb, source, note and optional
`group` (the four classical novels are grouped), chapters and chars.
Grid of book cards (cover image or a generated cover: title in large serif on a tinted
background derived from the title hash; author; progress bar; "Continue" on the most recent).
Title/author search normalizes simplified/traditional text; the grid can be sorted by recently read,
title or date added. Filtering never changes stored books and has a clear empty-result state.
Import: button + drag-and-drop anywhere on the page + "Paste text" dialog. Progress UI during
import; errors as clear toasts. Card menu: rename, delete (confirm). "Start with a classic"
section listing `public/samples/index.json` (title, author, level hint, blurb) → one click adds
and opens it. Empty state explains what the app does in two sentences.

### 5.5 Vocab and review (`ui/vocab/`, `ui/review/`)
- Vocab: searchable/sortable table (word, pinyin, gloss, context sentence with the word bold,
  book, added date, due), click a row → word popup (reuse `openWordPopup`), remove, export
  (Anki TSV: front = word + sentence, back = pinyin + gloss; CSV; JSON backup via store),
  import backup. Known-words panel: count, "Mark HSK 1…n as known" bulk action
  (`dict.hskWords(n)`), clear known.
- Review: due cards (SRS). Front: the word big + the context sentence with the word
  highlighted (pinyin hidden). Space/click = reveal pinyin, gloss, speak. Grades Again/Hard/
  Good/Easy (keys 1–4) with the next interval shown on each button. Session summary at the end.
  Empty state when nothing is due (next due time).

### 5.6 Settings and About
Settings: every `Settings` field grouped (Reading, Pinyin, Lookup, Translation, Speech, Data),
live preview sentence rendered with the reader's renderer if exported, otherwise simple ruby.
Translation: provider select with live availability status per provider, Claude key field
(password input, "stored only in this browser", Test button), model select; Chrome on-device
"Download model" button when availability is `download`. Data: backup export/import, delete all
data (confirm). Layout, Pages shown and Page turn are in Settings and in the reader's Aa menu (the last two dim when the layout is Scroll but stay
clickable). About: what the app is, data sources + licenses from `meta.json` (CC-CEDICT
CC BY-SA attribution is required; Noto Serif SC/TC and LXGW WenKai are OFL 1.1), coverage counts, keyboard shortcuts, what can be imported
(EPUB, MOBI and AZW3 without DRM, TXT, PDF, HTML, Markdown), reading like a book, names and terms, iPad, and a storage card (is the data
protected from eviction, with an ask button; `navigator.storage.persist()` is requested once after the first import, or at boot when books exist).

### 5.7 Pages layout (Apple Books style) and the even pinyin grid
- `settings.layout`: `scroll` (default) or `pages`. `settings.spread`: `auto` shows two pages side by side
  when the reading area is wide and landscape (iPad landscape, laptop), one page otherwise; `single`/`double`
  force it. `settings.pageTurn`: `flip` (default — the turning leaf rotates around the spine with a soft
  shadow, like a book), `slide`, or `none`.
- Pagination: lay the chapter out in CSS multi-column inside a fixed-height page area (100dvh minus the
  reading chrome); one column per page, a spread shows two with a spine gutter. Page header (chapter title,
  small) and footer (page number, "n pages left in chapter") per page, Apple Books style, quiet.
- Turning: tap or click the outer third of a page = next/previous; swipe with the page following the
  finger; ←/→, Space/Shift+Space, PageUp/PageDown; horizontal trackpad scroll (debounced). A tap on a Han
  word still looks it up; the tap zones apply to taps elsewhere. A tap in the middle toggles the chrome.
  Chapter edges flow into the next/previous chapter (pre-paginate the neighbor so the turn is instant).
- Position: progress keeps the first block on the current page; resizing, rotating, changing font size or
  pinyin re-paginates and lands on the page that contains that block. 60 fps turns (transform/opacity only).
- **Even pinyin grid (both layouts):** when a paragraph shows pinyin, every Han character occupies the same
  cell width: padding on both sides of the character (`--rd-pad`) with `white-space: nowrap` on the character box (letter-spacing would
  split the box at line ends and push pinyin off center), cell width `--rd-cell` (1.3–1.5em) and pinyin size `--rd-rt` chosen from the
  measured width of the longest syllables at that size (zhuāng, shuāng, chuáng; `ui/reader/grid.ts`, minimum pinyin 9.5 px). The rt holds
  `span.rd-rtx`, which the stylesheet centers over its character; it never pushes characters apart. Full-width punctuation (`span.rd-pu`)
  gets a cell too. Characters whose pinyin is
  hidden (known words in Unknown mode) keep the same cell so the column stays even. With pinyin off,
  normal CJK spacing. Selection/offset mapping must not change.
- Progress in Pages is `{block, offset}` (§4.6). Neighbor chapters are laid out ahead of time. Page numbers restart in each chapter and the
  footer counts pages within the chapter (no book-wide page number). Tap zones: the outer third turns, a tap in the middle toggles the bar, a word
  tap still looks the word up, and a tap that only closes a popup does not turn the page. The bar tucks away on the first turn; the mouse at the top
  edge brings it back. Swipes follow the finger and are ignored while text is selected. Flip rotates the leaf around the spine in 3D (one- and
  two-page modes); only transform and opacity animate.
- iPad/Safari: 100dvh + safe-area insets, no hover-only affordances, native long-press selection opens the
  phrase popup, `-webkit-user-select: none` on rt, works as a home-screen web app (standalone: `apple-mobile-web-app-capable`, status bar
  style `default`, apple-touch-icon and a manifest with 192/512 and maskable PNG icons, `viewport-fit=cover`).
  **Verified only in WebKit at iPad size (Playwright), not on a real iPad**: home-screen mode, native selection handles, the real keyboard, offline
  and the update toast on iOS.
- Performance: a 22,000-character chapter opens in about 1–2.4 s and re-paginates in about 1 s after a font change (synchronous layout);
  neighbor chapters lay out in one block when preparing. Splitting very long chapters into sub-layouts is the fix if a slower iPad stutters.

### 5.8 Shell, fonts, PWA
- Fonts: Noto Serif SC and TC (400, 700) and LXGW WenKai (regular) from the installed packages, woff2 slices only (a vite plugin strips the woff
  fallbacks from their CSS; `dist/assets` holds about 500 slices). The 527 KB of `@font-face` CSS lives in `src/fonts.ts`, a separate chunk
  `main.ts` imports after the first render, with `font-display: swap`. `tokens.css` has the stacks `--font-serif`, `-serif-hant`, `-sans`,
  `-sans-hant`, `-kai`, `-kai-hant` (Songti first on a Mac) and a Jigmo last resort; the plain ones switch to the Hant ones under `:lang(zh-Hant|zh-TW|zh-HK)`.
- Service worker (`public/sw.js`; build id, data version and precache list are filled in by `serviceWorker()` in vite.config.ts): three caches.
  `dushu-app-<build>` (index.html network first, `assets/` cache first; replaced on every build), `dushu-static-<data version>` (`data/`, `samples/`,
  survives app updates) and `dushu-fonts-v1` (the woff2 slices, cached on first use, never cleared by app or data updates). It does not call `skipWaiting` at install; it handles a
  `SKIP_WAITING` message. `main.ts` shows a persistent "A new version of Dushu is ready. Reload" toast when a worker is waiting, and checks for updates
  when the page becomes visible. HTTPS is required for install and offline on an iPad (README, "Read on your iPad"); the private Serve endpoint provides it without a public deployment.
- Safe areas: `#screen` and the reader use `env(safe-area-inset-*)` and `dvh`. Coarse pointers get 40 px touch targets and 16 px inputs.



## 6. Styling rules

- Use the tokens in `styles/tokens.css` and components in `styles/base.css`. No raw hex colors
  in screen stylesheets except inside `color-mix()` with tokens.
- **Every class you define starts with your prefix**: reader `rd-`, popup `pp-`, library `lib-`,
  settings `set-`, about `ab-`, vocab `voc-`, review `rev-`. Shared: `.btn .card .chip .input
  .select .textarea .icon .icon-btn .page .page-head .page-title .page-sub .section-title
  .muted .empty .kbd .zh .tone-1…5 .modal`. Import your stylesheet from your screen module.
- Look: calm, paper-like, generous whitespace, one accent color (cinnabar) used sparingly.
  Reading column centered; UI chrome quiet. Popups are cards with `--shadow`, 12–16 px radius.
  Respect light/sepia/dark themes (test all three). Must work at 390 px wide.
- Icons: `icon(name)` from `ui/icons.ts`. No emoji in the UI.

## 7. Testing and QA

- `npm run typecheck` clean, `npm test` green, `npm run build` succeeds — before reporting done.
- Unit tests live in `tests/<area>/`. Use the real data files (loader in
  `tests/helpers/data.ts`, owned by core: `loadTestDictionary()` caches one instance per worker).
- Browser QA is headless only (`scripts/qa.mjs`, puppeteer-core + system Chrome,
  `headless: true`). **Never open visible windows, never run `open`, never bring an app to the
  foreground** — the owner is working on this machine.
- Never copy copyrighted books into the repo. `~/Downloads/活着.epub` may be read in place for tests.
- Sample books in `public/samples/` must be public domain in the US (published before 1931,
  or classical texts) and record their source URL.

- `node scripts/qa.mjs <url> <outDir> <scenario>` runs against `npx vite --port 5190 --strictPort` and against
  `npm run build` + `npx vite preview --port 4317 --strictPort`. Scenarios: smoke, read (Scroll layout), epub (QA_EPUB, default
  ~/Downloads/活着.epub; Scroll), vocab, rare, themes (includes WCAG contrast), mobile (390 px), **pages** (two-page spread at 1440x900, turning by key and
  tap, chapter flow, position kept over a reload, a portrait window), **lexicon** (QA_SHEDIAO, default ~/Downloads/射雕英雄传.epub, skipped if
  missing: import through the file input, wait for detection, 郭靖 and 黄蓉 render as single words with name pinyin, the In this book card, Not a
  word and Undo, Edit, the Names & terms tab, persistence over a reload, Pages), **mobi** (the Gutenberg fixtures in tests/fixtures/import), offline
  (production only). `read` and `epub` seed `layout: 'scroll'` because they assert scroll offsets and the Next chapter button.
- `scripts/qa-reader.mjs` (Scroll and Pages, popups, grid measurements, big chapters; `QA_BASE=…` uses a running server) and `scripts/qa-ipad.mjs`
  (WebKit at iPad Pro 11 landscape/portrait, iPad Mini, iPhone 13: layout, taps, swipes, selection, rotation, flip, and the names card) run against the
  dev server. `qa-shell.mjs` checks the shell and PWA, `qa-vocab.mjs` the vocab screens. None of them print book text.
- `public/sw.js` is the service worker (registered in production builds only). The build fills in its build id,
  data version and precache list (`serviceWorker()` plugin in vite.config.ts). index.html is network first,
  `assets/` cache first, `data/` `fonts/` `samples/` cache first in a cache that survives app updates.

## 8. Licenses
CC-CEDICT (CC BY-SA 4.0, attribution required in About), Unihan (Unicode License v3), jieba
(MIT), complete-hsk-vocabulary (MIT), OpenCC (Apache-2.0), Jigmo (CC0), Wiktionary via kaikki
(CC BY-SA), hanzi-writer (MIT) + hanzi-writer-data (Arphic Public License, fetched at runtime).
