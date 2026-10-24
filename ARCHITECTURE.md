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
`@anthropic-ai/sdk` (Node only, in the Claude bridge on the Mac; the browser bundle has no SDK and no key), `hanzi-writer` (stroke order).
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
| `book-words.tsv.gz` | trad, simp, pinyin, defs, optional segmentation count (curated senses for the words the books use most; optional) | ~365 |
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
  The `hsk` trad column is often a rare variant for a single character (时 → 旹, 听 → 听), so `dict.hsk()` falls back to the simplified
  form of a traditional spelling it misses.
  The final 30 rows are HSK words missing from CC-CEDICT. Those rows are NOT in the numbered format
  (they hold tone marks and run-together syllables such as `chènzhe`, `bu4 lìyú`); the loader repairs them with
  `normalizePinyinField`. A cleaner fix is for `build_data.py` to emit numbered pinyin for them.
- `cedict-extra` is repaired by `python3 scripts/build_data.py --repair-extra` (re-cuts mis-split readings, drops dialect-only rows and rows no character can read). The loader resolves "variant of X" and "see X" pointer rows to the target's meaning, and `entriesForReading(entries, syllables, shown, around)` can reorder senses by the neighbors (里 after a number is a distance).
- `book-words` (source `scripts/data/book-words.tsv`, built by `python3 scripts/build_data.py --book-words`, original wording, CC0): CC-CEDICT
  lists the rarer sense of many common words first (行者 "pedestrian", 只見 "to see over and over", 姨娘 "maternal aunt", 罷 "to stop", 后 "empress").
  A row replaces the CC-CEDICT row with the same trad, simp and pinyin (same case first: `Ba1 jie4` the name is not `ba1 jie4` the precepts), or is
  added, and is moved to the front of the list for each of its headwords with `DictEntry.curated = true` (ranking gives it a bonus). The optional fifth
  column raises the segmentation count so a spelling no list has (鴻濛) is cut as one word. `meta.counts.bookWordsLoaded` reports how many rows loaded.
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
  `ctx.after` is the token after `next` (倒了茶 pours, 墙倒了 falls). Context rules added from reading the four books (tests/core/pinyin-rules.test.ts):
  倒 is dào (adverb, pouring, reversing) except after a verb of falling or before 下在地霉 or at the end of a clause (dǎo); 啊 啦 呀 哇 吧 哩 and
  clause-final 罷/罢 are neutral after a word; 猛地 忽地 蓦地 倏地 are dì; 儿 after 斡 篾 撒 帖 蒲 is ér. `RUNNING_TEXT_READINGS` holds the readings that
  differ from CEDICT in running text (穿着, 猛地, 钉钯 pá, 倒把).
  Curated word readings live in `WORD_READINGS` (polyphone.ts, checked against CEDICT by a test). Context rules (must have tests): 了 → le5 except as a full word like 了解/了不起 (those come
  from CEDICT); 的 → de5; 着 → zhe5 (zháo only via words like 着急 — check CEDICT); 得 → de5
  unless followed by a verb in 得到/得出 style words (CEDICT handles most) — keep rules simple
  and explicit; 地 → de5 when prev ends with a reduplicated char (慢慢地) or is a 2+ char
  adverb/adjective (heuristic: prev token length ≥ 2 and next token is not a noun-ish word —
  document whatever heuristic you choose and test it), else dì; 还 → hái, but huán before 了 (还了酒钱; 还了得 stays hái) and
  ending its clause after a word (借了不还); 中了 → zhòng (中了计, 中了举人) unless a particle follows (山寨中了么); 行 → háng
  before 字; 数钱 → shǔ; 背着 → bēi (`WORD_READINGS`; segment.ts cuts the bèi cases: 背着脸, 背着人, 偷背着, 倒背着); 都 → dōu;
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
- Reduplication: AABB and ABAB built from a dictionary word AB (吆吆喝喝, 研究研究) are one token; 一一 stays together (一一应); a 只 after a numeral is
  a measure word, so 只用 after 一 is cut 只|用. 了得 (liǎode) is one token at the end of a clause or after 十分 好生 端的 還 英雄 武藝
  (那還了得, 十分了得) and stays 了|得 elsewhere (聽了得意); 一行 before 字 is cut (一|行|字, a line of writing). Not handled: 着落/上爬 after a
  verb (the dictionary word wins).
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
unchanged as a number (第一, 一月, 十一, 一二三, 唯一, end of phrase). Only digits keep it yī: before the place values 百 千 万 亿 it
changes like before any word (一百 yìbǎi, 一万 yíwàn, 一百一十一 yìbǎi yīshíyī). Also: 一/不 between identical characters are
neutral (看一看, 好不好) unless the character is a measure word (一个一个, 一次一次, 一遍一遍 are yí ge, yí cì, yí biàn), and 一 before a neutral
个/個 is yi2 (一个, 一個 are yí ge); 一两个 is yì liǎng gè (一两银子 stays yī liǎng). Only applied when
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
  CJK CMaps (GB/CNS/B5/HK) are bundled (87 files, 0.8 MB) and precached with the PDF worker, so a PDF imports offline; when they
  could not load and the server does not answer, the error says "PDF import needs a connection the first time. Connect once and try
  again." The TXT heading regex below is a floor: the importer also accepts 節, 卷/部/集 (level 1), diary-style numeral sections, a
  classical section title (學而第一, 勸學篇第一) when the text opens with one or several count up from 第一 (level 2), and more.
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
- Every format, last (`finish()` in `import/index.ts`): paragraphs a file broke mid-sentence are joined (`joinSplitParagraphs`: prose of 40+
  characters ending on a Han character, or 60+ on ，、, runs on into prose of 20+ that starts with one; verse lines, headings and lines set
  out with spaces stay apart; a paragraph that starts with a closing mark ，。、；：！？」』 always joins the one before), small-form marks
  (﹐﹔﹕﹖) and an ASCII , ; : ? ! between Han characters become full-width
  (`normalizePunctuation`), and the book is stamped `importVersion` (`import/version.ts`). A chapter over 60,000 Han characters is cut in
  parts of about 12,000; parts after the first carry `cont: true` and show no title. Sections marked only by bare numerals (一, 二 …) that
  average under 1,500 Han characters stay in one chapter with the numerals as headings (狂人日记). A text kept as one chapter is titled by
  its own first heading when it opens with one (西遊記 第一回 shows its 回目 once). Two or more "title　poet" lines each over a line of
  verse (靜夜思　李白) become level-3 headings inside the chapter, marked after chapters are cut so an anthology stays one chapter.
- Raising `IMPORT_VERSION` re-imports the books the library can fetch again (`ui/library/upgrade.ts`): the Mac's books from the Mac and
  the classics from the site, one at a time once the library has the Mac's list. `store.books.replace` keeps the id, name, notes and
  history and moves the reading place to the same Han character (`core/place.ts`). Sync names an upgraded book with its version
  (`bookKey`: `m<digest>.2`), so a place read in the old chapters never lands in the new ones as it is; each device moves its own place.
  A place known only under an older key (`olderKeys`) is moved by its percent (`moveByPercent`, about a page) and stamped 1 ms older, so
  the same place moved by the text wins over it.

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
- Backup JSON: `{ app: 'dushu', version: 1, exportedAt, settings (the Mac address is not a setting and never appears; an import can never turn Local only off, and a key left by an older version is dropped),
  vocab, known, progress, reviews, lexicon }` — books are not included (they can be big); say so in the UI.

### 4.7 `translate/` — `getTranslator(id, settings, dict)`, `pickTranslator(settings, dict)`
- `chrome`: the built-in on-device Translator API (`self.Translator`, Chrome 138+):
  `Translator.availability({sourceLanguage:'zh', targetLanguage:'en'})` →
  available/downloadable/downloading/unavailable; `Translator.create({...,monitor})` needs a
  user gesture when downloading. Cache the instance. Feature-detect; never throw at import.
- `claude`: Claude **through the owner's Mac**; the browser holds no key. `src/translate/claude.ts` calls the bridge
  (`scripts/claude-bridge.ts`, a Vite plugin in dev and preview): `POST /api/claude/translate` streams NDJSON events
  (`text`, `done` with token counts, `error`), `GET /api/claude/status` says whether the Mac is reachable, a key is configured,
  and how much was used today (never the key). The Mac reads the key from `~/.config/dushu/anthropic-api-key` (chmod 600, outside
  the repo) at request time and calls Claude with the official `@anthropic-ai/sdk` from Node only. The Mac builds the prompt from
  `src/translate/claudePrompts.ts` (which delegates to `prompt.ts`, the instructions measured in `scripts/eval/report.md`), so
  a browser cannot send its own system prompt; it sends only text, context, mode, model and glossary terms (bounded: 64 KB body,
  8,000 characters of text, 3,000 of context, 30 terms, 4 concurrent requests). Models: `claude-sonnet-5-5` (default, with the
  server-side fallback beta) and `claude-haiku-5-5` (cheaper, no fallback parameter); anything else, Opus included, is a 400.
  `output_config: { effort: 'low' }` (`DUSHU_CLAUDE_EFFORT=medium` to change), no thinking, temperature or prefill. `stop_reason ===
  'refusal'` and every typed SDK error map to a short message that never carries SDK text or the key. A daily spend guard in
  `.dushu-local/claude-usage.json` (mode 600, local day) stops at 3,000 requests or 3M input tokens
  (`DUSHU_CLAUDE_MAX_REQUESTS`, `DUSHU_CLAUDE_MAX_INPUT_TOKENS`); failed calls count too. After an error that will repeat (limit, no key,
  bad key, credit, Mac unreachable) automatic mode skips Claude for 60 s (`claudeReadySync`). **Local only** (`settings.localOnly`)
  makes Claude and MyMemory unavailable and refuse to run even when picked, so every sentence stays on the Mac (Chrome's on-device
  translator is still allowed: it runs on the device that holds the browser).
- `mymemory`: `https://api.mymemory.translated.net/get?q=…&langpair=zh-CN|en` (no email
  param, ever). 500-char chunks. Free tier ~5k chars/day — report quota errors plainly.
- `gloss`: always available, offline: segment + first definition of each word, joined
  "word (pinyin): gloss · …". Used when nothing else is.
- `local`: on the owner's Mac only, call an installed Ollama model over loopback for a sentence
  translation or explanation. Word cards may request a separate contextual suggestion, always
  marked as fallible AI and never substituted for dictionary entries.
- `pickTranslator` with `auto`: Claude via the Mac (skipped under Local only) → evaluated local Qwen3.5 9B → ready Chrome → smaller local model → Chrome download →
  gloss. Claude through the Mac comes first when it is ready and Local only is off. (MyMemory sends text to a third party, so auto never picks it; the user opts in.)
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
temporary files removed after rendering. The client keeps the next two sentences rendering while one plays (with one, a long
sentence after a short one was not ready in time at 2×), asks again after a 429 (a render just cancelled keeps its place until
its process exits), gives each render 5 s plus 60 ms a character (a stalled Mac fails in seconds and the toast offers an
on-device voice), preserves pitch, and cancels fetching/playback on stop. When a sentence ends before the next is ready,
`opts.onWaiting` fires and the strip says Preparing audio… until the next one plays.
Sentences: a sentence keeps the closers after its mark (」』”’）】〉》; not ASCII quotes, which may open the next quote), and a piece
of only punctuation, symbols or spaces joins the piece before it, or is dropped at a paragraph's start (a ○○○ separator): a
voice reads a lone ” by its name. Both the Mac and Web Speech read these pieces.
Word highlighting with Premium voices: Apple's neural voices report word events late (two phrases behind, and the last ones
never), in Safari, Chrome and AVSpeechSynthesizer alike, so those events are ignored and a Web Speech Premium voice highlights
the paragraph. The Mac's renders are timed instead: `speakSequence` sends each sentence's word starts (`opts.wordStarts`, the
reader's Han tokens), and `scripts/speech-marks.swift` reads the sentence twice at once, plain and with an SSML bookmark
before each word. Bookmark times are exact, but bookmarks slow and break up a neural reading (up to a fifth longer on
classical text), so the plain reading is what plays and dynamic time warping of the two readings' log-mel frames carries the
bookmark times over to it (checked against pauses: within 40–90 ms, a little early). The times come back in
`X-Dushu-Marks` ([[offset, ms], ...]) and the client follows `audio.currentTime` every animation frame (a 40 ms timer
without frames), showing a sentence's first word as its audio is asked to play; measured in Chrome and WebKit, the highlight trails
its word by under 90 ms, at 2× too. A render takes about 0.7 s plus a little per character, so a first sentence longer than 24
characters is read as its first clause (a comma at 7–24) and the rest, which renders while the clause plays: speech starts
in about 1.1–1.4 s. In Pages, the reader turns to the word's page when it is past `pager.shownRange()` (a word on the next
page sits beside the spread, so a screen-position test missed it and the page did not turn mid-paragraph). The helper is compiled once per source
version with the Mac's Swift compiler into ~/Library/Caches/Dushu (only when `xcode-select -p` finds the tools, since a
missing compiler opens an install dialog); without it `say` renders and the paragraph is highlighted. The helper gets 3 s plus
30 ms a character; one killed for its time is skipped for three minutes, so sentences do not each wait it out. The reader marks
every shown word that overlaps the reported range.
`speak` cancels anything playing.
`speakSequence` reads chapter blocks in small chunks, reports utterance boundaries for word
highlighting, and supports pause, resume and stop. `getRate` is read at each sentence chunk,
so speed changes need no chapter restart, and `setSpeakingRate` changes the Mac's playing audio at once (the marks follow its
clock). Scroll shows a floating playback strip; Pages keeps the header controls.
The bar's Read button starts at the first word that begins on show: in Pages at or after `pager.anchor()`, in Scroll at or
after the top line's first character (`scrollOffsetAtTop`), which is brought just clear of the bar. Earlier text is on a page
already turned (the voice would turn back to it) or under the bar, and a word start avoids reading half a word.
A chapter run that has ended resets only the reader's controls (`endChapterSpeech`): it may have ended because a word card's
Pronounce took the voice, and stopping the engine again silenced the word. Stop, a new chapter or leaving stops the engine.
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
API responses are no-store and the service worker does not intercept them. Books stay device/browser-specific; saved words,
known words, reading places, looked-up words and bookmarks sync through the Mac (§4.11). New v1 backups include only SHA-256 book-content identities, not the content itself.
Progress, book-specific terms and vocab book context are remapped only to an exact, unambiguous imported copy;
different editions/duplicate copies are not guessed, and older backups remain readable. Import books before the backup.
Mac services require an awake, connected Mac.

**The public copy.** `https://henryyhong.com/dushu/` is a static build (`.github/workflows/pages.yml`; relative base, so it works under `/dushu/`).
It talks to the Mac's bridge only from origin `https://henryyhong.com`, and only for the owner's exact Tailscale identity:
`bridgeRequest()` in `scripts/private-access.ts` requires the private host plus the injected owner headers, and `bridgeCors()` answers the
preflight (including `Access-Control-Allow-Private-Network`; credentials are never allowed, every bridge response has `Vary: Origin`).
CORS covers `/api/claude/`, `/api/local-model/`, `/api/native-voices`, `/api/native-speech`, `/api/local-books`, `/api/private-status` and `/api/sync`;
any other route, and any other origin, is refused. `DUSHU_EXTRA_ORIGINS` (comma separated) adds origins for testing on one machine and may
include localhost. The Mac's tailnet hostname is never in the bundle, the repo or a document (a test fails if it appears); the owner
connects each device once (`src/core/macBridge.ts`: the address lives only in localStorage key `dushu.mac-bridge.v1`, never in Settings or a
backup; `bridgeFetch`, `bridgeUrl`, `hasMacBridge`, event `dushu:bridge`). The CSP in `index.html` is rewritten at build and dev time by
`scripts/bridge-csp.ts` (adds `https://*.ts.net:*`, drops api.anthropic.com).

**The owner's books.** `scripts/local-books.ts` serves `~/Downloads/活着.epub` and `~/Downloads/射雕英雄传.epub` in place (never copied; never in the
repo, the build or the public site). `GET /api/local-books` lists `{ id, name, size, sha256 }` (SHA-256 of the file bytes) and the book route
sends `ETag` and `X-Dushu-Digest`. `src/ui/library/macBooks.ts` makes them permanent built-in books of every device that reaches the Mac: the
library adds the missing ones in the background (serialized with Web Locks), marks them with note `mac-book:<sha>`, and requests persistent
storage; after that they live in the device's IndexedDB (offline, kept over reloads and app updates, with progress and names). They are
always there: the library offers no Delete for them, and one that went missing (storage cleared, Delete all data) is added again the next
time the device reaches the Mac. "Add books from Mac" is the manual fallback.
`start-local.mjs` also probes the installed Ollama service, launches it on loopback only if unreachable,
and leaves an unrelated responding service on port 11434 untouched. It never downloads models or changes the account. When iPad access
is set up (`.dushu-local/ipad.json`) it runs `scripts/ipad-access.mjs`: Tailscale `Stopped` → `tailscale up` (re-run with exactly the
non-default flags Tailscale names, so settings stay), the 8443 serve entry missing → served again; `NeedsLogin` or a port serving another
target is only logged. When the Mac's Tailscale name no longer matches ipad.json (it joined another network) or the network has HTTPS
certificates off, that is logged with what to do and nothing is served: `tailscale serve` would otherwise wait for the fix until killed.
The CLI is the app's binary and acts as a command line only when `TERM` is set (without it, as under launchd, it
starts as the app and never returns), so TERM is always set for it.
`--restart` stops the saved server PID, or, when that is stale, the one process listening on 4317, in both cases only after `ps` shows it
is this folder's `vite preview --port 4317`. After a start, the PID saved is the listener's: a start that found the server slow to answer
spawns a second one that loses the port and exits, and saving that one's PID once left restarts doing nothing for two days.
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
  explains them (洪七 inside 洪七公). On 射雕英雄传 this gives 139 entries: 89 names, 29 terms and 21 places (郭靖 4,999, 黄蓉 3,641 …); on 活着 13 (家珍, 凤霞, 有庆, 福贵 …); on the
  traditional 红楼梦 sample 106 (賈母, 黛玉, 王夫人 …). Known misses: names that CEDICT also lists (铁木真, 成吉思汗, 老顽童 are already words,
  so they need nothing), and nicknames such as 靖哥哥.
- Detection v5 (`DETECTOR_VERSION` 5) adds three passes after the n-gram statistics. **Speakers**: a 2–5 character string that opens a clause and is
  followed by a verb of speech (平兒笑道, 麝月便道, 周瑞家的說), is not a dictionary word with corpus counts, is mentioned at least twice as often as it
  speaks, and is not a phrase (a name plus a verb, a string that begins with a function word) becomes a person; pet names in 儿 (平兒, 鳳姐兒) are
  included though jieba cuts them whole, because their 儿 must read ér. A word CEDICT lists but jieba never counted (悟空, 麝月, 雪雁) is accepted
  only as a person and only when it is a main character (20 speaking turns); a manner adverb (朗声) is not. **Siblings**: 悟能 and 悟净 follow 悟空 when
  the first character is used almost only in that name. **Groups**: 江南七怪, 全真七子 (place + numeral + kind of person) are terms. Statistics
  also accept a tightly bound free-standing string with no surname (秋桐), a numeral given name when bound (龙二), and tell a transliterated
  person (赤老温, 合撒儿) from a technique by how often it is addressed or ordered (对 向 问 命 …). A dictionary proper noun keeps its own first sense as
  the gloss. Offices (郡侯, 功曹) are not persons, 亭 and 郡 end a place. Detection yields every 8 ms of work (`detectGen`); `loadLexicon` waits for
  an idle moment and works in 10 ms slices, so no task is longer than a frame. Known misses: 小紅, 长根 (too rare or too common a first character).
- Detection v6 (`DETECTOR_VERSION` 6): a speaker string that makes a word with the verb after it (操大+笑, 替天行+道) does not count, except that
  道 alone does not disqualify a last character (王夫人道). Strings that open with 谓/此/转 or a doubled character are phrases. A final pass
  (`boundaries()`) checks each entry against its neighbors: a name whose usual next character makes a more frequent word with it (大兒|子), or an
  entry whose usual previous character does (拍|馬舞刀), is dropped, as is one that often cuts a dictionary person name (曹|操大, 吳主孫|權) or wraps
  one in a title (先鋒使宋江). A dictionary proper noun that holds a found name (關雲長 around 雲長, 孫悟空 around 悟空) is added with its dictionary
  reading. On the four classics: 11 false entries dropped, 10 real names added, none lost.
- `capitalizePinyin(syllables, kind, word, fold?)` and `pinyinGroups` (exported from `names.ts` and `lexicon.ts`): a name is written Guō Jìng,
  Hán Xiǎoyíng, Ōuyáng Wújì, Lǎo Wántóng; a place Táohuā Dǎo, Guīyún Zhuāng; a term, a user word and zhuyin stay as they are. The word popup and the
  "In this book" card use it (`ui/popup/pinyinText.ts`); ruby over the text stays lowercase.
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

### 4.10 `core/autoKnown.ts` — known words learned from reading (`settings.autoKnown`, off by default)
- The rule: a word that goes by on 10 pages (`AUTO_KNOWN_PAGES`) over at least 2 different local days (`AUTO_KNOWN_DAYS`) without being looked
  up is added with `store.known.add([word], { auto: true })`, so the Unknown pinyin mode stops showing its pinyin. Counts are kept per word in
  the simplified form (`dict.toSimplified`) in the `seen` table (`SeenRow {word, n, days, lastDay}`); a word that becomes known loses its row.
  Words already known and saved words (they are studied with review) are never counted. A learned word never replaces one marked by hand; marking a
  learned word by hand makes it a hand-marked one (`known.isAuto`, `known.autoCount`; the flag is the `auto` field of the `known` row and
  travels in backups as `knownAuto`).
- What counts as a page read: the reader (`ui/reader/learning.ts`) reports what is on screen once a second (`tick(view)`, nothing while the page
  is hidden). In Pages a view is the text of the spread on show (`pager.shownRange()`: from the top of the spread to the top of the next one); in
  Scroll it is each paragraph in the window. Text counts once it has stayed on screen `readingDwell(chars)` = max(3 s, 40 ms per character):
  the whole spread's characters in Pages, the paragraph's in Scroll. Text that leaves the screen starts again from nothing, so flipping through
  pages never adds up. Going back (a lower position than the furthest reached, beyond a third of a screen in Scroll) pauses counting until the
  reader is back; opening a chapter from the contents (`restart()`) counts from there. Each occurrence counts at most once while the book is open.
  One `seen.put` per counted view; writes are queued and never block a page turn; failures are logged and dropped.
- Looking a word up: a word card opened by a tap, click, double-click, the keys or a step in the card resets the word's count and takes a learned
  word off the known list (it comes back only by reading past it again). A hover popup (`lookupTrigger: hover`) and a translated phrase only keep
  their words from counting for the text on screen at the time. With the setting off nothing is counted or taken off.
- UI: a switch in Settings → Pinyin and in the reader's pinyin menu (shown in Unknown mode). The word card's Known button says "Learned from
  reading". The known-words panel on the Words screen shows how many reading marked and has **Clear learned words** (removes only those and
  clears the counts). An added word updates the open page in place (the store's `known` change → `refreshMarks`), never re-segmenting.

### 4.11 Sync through the Mac (`core/sync.ts`, `scripts/sync-bridge.ts`)
Saved words (with their SRS state), known words (with the learned-from-reading mark), the reading place in each book, looked-up words and
bookmarks are the same on every device connected to the Mac. Books, settings, review logs and names are not synced.
- **The Mac** (`scripts/sync-bridge.ts`, route `POST /api/sync`, owner-only through `bridgeRequest`, CORS like the other bridge routes)
  keeps one file, `state.json` in the folder `DUSHU_SYNC_DIR` names (an absolute path; the owner's is `.dushu-local/sync`):
  `{ epoch, version, records: { key: { at, data, rev } } }`. There is no default folder: only `scripts/start-local.mjs` (Dushu.command,
  `npm start`, the login item) sets it, and a server started any other way (`npm run dev`, `npm run preview`, a QA script) answers 503
  `{ off: true }`. A save by another process on the same folder (a new inode) is read before the next merge, never overwritten.
  Keys: `v:<word id>`, `k:<word>`, `p:<book key>`, `l:<day>:<word id>` (a looked-up word), `b:<bookmark id>`; `data: null` is a deletion. A request sends `{ epoch, since, changes: [{ key, at, data }] }`;
  each change wins when its `at` is later (a tie goes to the larger JSON, so every copy agrees; an `at` more than 10 minutes ahead of the
  Mac's clock is clamped). Looked-up words are the exception: two copies of a word's day merge (`mergeLookups` in `core/syncKeys.ts`: the
  larger count, the earliest first and latest last lookup, the words of the copy looked up last), and the device gets the merged copy back
  when it differs from its own; a deletion is still last-writer-wins. `at: 0` means a copy the device never synced: it lands only where the Mac has nothing. The reply holds every
  record with `rev > since` plus the current value of every change that lost, the new `version`, and counts. A different `epoch` (or a
  cursor past the end) gets everything. Writes are atomic; before the first write of a day the previous file is kept as
  `state-YYYY-MM-DD.json` (14 kept); a file that cannot be parsed is set aside, never overwritten. Limits: 8 MB body (a larger one is read
  to the end, then refused with 413), 5,000 changes, 32 KB per record (a larger record is answered like a change that lost).
- **A device** keeps one row per record in the store's `sync` table (`SyncRow`: `at`, `sig` = hash of the record, `dirty` when not yet sent,
  `fresh` for a word saved before it ever synced, `held` for a place in a book the device does not have: sent by the Mac before the book
  arrived, or kept by `store.books.remove`; `#meta` holds `epoch` and the cursor). `store.books.add` (and `update`, when marking a book as
  the Mac's changes its key) lands a held place in the same transaction, so a book deleted and added again opens where it was. These rows live in the same IndexedDB as the data, so a wipe or an eviction clears both: the device looks new and only receives;
  sync never reads "missing" as "deleted" unless the device had agreed on the record before. A run (Web Locks `dushu-sync`, one tab at a time):
  apply held places whose book arrived; compare a snapshot of the store with the rows and mark what changed (stamped now; a place with its
  `updatedAt`; a fresh word with `at: 0`); send up to 1,000 changes per request and apply what comes back (`store.sync.apply`, one
  transaction, heard by screens as a remote change). Places are never deleted by sync, and a held place is sent like any other. A fresh word that meets the Mac's copy keeps the one
  studied more (`srs.last`), or itself when it was saved after the Mac's deletion, and is sent again stamped to win.
- **Book keys** (`bookKey`): `m<file digest>` for the Mac's books, `s<id>` for the classics, else `b<hash of chapter count, Han count and
  chapter titles>` (the same import of the same file matches; a rename does not change it). Saved words and looked-up words travel with
  `context.bookId` as the book key and are mapped back to the local id. A bookmark keeps its book's key (`Bookmark.bookKey`, set when it is
  made, or by the first sync for older ones), travels as `book`, and is moved onto the local book whenever that book is here (it arrived, or
  was deleted and added again); deleting a book keeps its bookmarks and sends nothing. A device always takes the Mac's copy of a looked-up word
  (the store merges it with its own row in `store.sync.apply`) and sends again what only it had.
- **When**: at start, 1.5 s after a change to words, known words, lookups or bookmarks, 5 s after a place is saved, on every screen change, when the page is hidden (keepalive when small) or
  shown again, when the connected Mac changes, when back online, and every 45 s while visible. The reader waits up to 1.5 s for a sync
  before it reads the saved place (`syncBeforeOpen`), never saves a place that did not move (so opening a book on a stale device cannot
  overwrite a newer place), and when another device's place arrives for the open book it offers "Go there" (`dushu:remote-progress`).
- **Settings** → Your Mac and iPad → Sync: a switch (localStorage `dushu.sync.off.v1`), Sync now, and the status. Delete all data turns
  sync off on that device, so the Mac's copy stays there until it is turned on again. The memory fallback never syncs.

## 5. UI

### 5.1 Shell (`main.ts`, done)
Routes: `#/` library · `#/read/<bookId>?ch=<n>` reader · `#/vocab` · `#/review` ·
`#/settings` · `#/about`. Each screen module exports `mount: MountFn` and returns a cleanup.
The reader hides the nav (`body[data-route=read]`) and draws its own top bar.
On a route change the old screen's cleanup runs before `body[data-route]` changes, so the reader saves its place under its own
layout (with the nav back in the flow it measured a line early on every visit). A screen that finishes mounting after the route
moved on is cleaned up at once and never replaces the current screen's cleanup.
`ctx.dict()` is a cached promise; `ctx.dictSync()` is non-null once loaded. A failed download is not cached: the next use tries
again, and the toast says "Could not download the dictionary. Check your connection; Dushu will try again."

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
- **Shell** (`host.ts`): the card (`.pp-pop`) is a labelled `role=dialog` with `tabindex=-1`; focus moves into it on open and returns to the word (or
  `restoreFocus()`) on close unless the user already moved it. It does not clip, so a 10 px caret (`data-side`, `--pp-caret`) can point at the word;
  the scrolling is done by `.pp-scroll` inside it, and a scroll inside the popup never triggers a placement (it used to reset `scrollTop`). The
  Prev/Next/Shorter/Longer control is a sticky footer with a fade while there is more to scroll. Placement (`position.ts`): under 640 px a bottom sheet
  capped at 45% of the screen; wider, a floating card at the word with its caret under it, below the word or above when there is no room. On a touch
  screen (an iPad) it is a small bubble (at most 360 px wide and 340 px tall, the rest scrolls inside) and the page never moves for it; the
  reader's `onSheetTop` lift only applies to a phone sheet now. Safe-area insets are honored
  (not verifiable in headless WebKit). Definitions show four senses per reading and a "N more" button; the characters are 40 px chips.
- **Phrase popup**: the selected text with pinyin (12 px per character, even grid), speak, Copy, translation from
  `pickTranslator` (shows provider name, streaming text, error states, "Explain" button for
  Claude or a local model, "Try another provider" menu), and the word-by-word breakdown (each row clickable →
  word popup). Save phrase is not needed. With no translator reachable (Safari and iPadOS have no on-device one; no Claude key) the Translation block is one
  quiet line with a Settings link and the word list is the content (`hasWordList`); the translation text is an `aria-live=polite` region that is `aria-busy`
  while it streams. Chrome's Translator uses `zh-Hant` as the source for a traditional passage when that model is ready, else `zh`.
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
  width, theme), progress %. The bar is opaque paper with no backdrop blur in both layouts (scrolled text ghosted through a
  translucent one in WebKit). The pinyin button is a 拼 seal (`span.rd-seal`, set in `--font-serif`, aria-hidden) followed by the mode
  label: a solid seal while pinyin shows, an outline (朱文) when it is off. Its accessible name stays `Pinyin: <mode>`. On a phone the label
  is set smaller; at 360 px and below only the HSK level stays beside the seal (`span.rd-pill-pre` holds the "HSK " that hides).
- The page itself (`.rd-article` in Scroll, `.rd-stage` in Pages) is framed on focus only when Tab brought focus there: `reader.ts` sets
  `data-tabbed` on focusin after a Tab key, so a word card closed with Esc hands focus back without a frame.
- Render the current chapter only. Paragraph → tokens → one element per han token:
  `<span class="rd-w" data-s=start data-e=end data-i=token>` containing `<ruby class="rd-c" data-o=offset>` per character with
  `<rt class="tone-n"><span class="rd-rtx">pinyin</span></rt>` (the text sits in a span because Safari ignores positioning on `rt`; tone class
  only when toneColors; `rt.textContent` is unchanged). `ruby` is `display: inline` in the reader. Full-width punctuation is wrapped in
  `span.rd-pu.rd-pu-o` (opening) or `.rd-pu-c` (closing) so the grid can give it half a cell. The half cell assumes the ink at the left of
  the box (closing marks), as simplified fonts draw them; traditional fonts center ，。、：； (the Taiwan convention), so in a traditional
  book the marks use the simplified stack of the same family (`--rd-pu-font`, set in `reader.ts`). A chapter's first heading is shown as
  the chapter title (`rd-h1`) whatever level the file gave it; headings break at their spaces (`word-break: keep-all`, plus `nowrap` on each
  character for Safari, which ignores keep-all between elements), so a 回目 couplet wraps between its halves. Safari has no fallback break
  inside a half that is wider than the column, so in a column under 12em of the heading (`@container rd-h`) it breaks between words
  instead (Chrome breaks inside the half through overflow-wrap); a bare section number (`rd-h-num`) is centered. Each `rt` is `aria-hidden` and each word is `role=button`
  with `aria-label="word, pinyin"`, so a screen reader says the word once and a double tap looks it up. In the Pages layout the `rt` nodes are
  left out until `view.ensurePinyin(block)` (`lazyPinyin`): the pinyin hangs out of the flow, so pagination does not depend on it, and only the
  pages near the reader carry it (about a third of the DOM). Characters from Ext B and later get `rd-rare` (a touch smaller, to even the line
  color). A paragraph over 3,000 characters is cut into pieces after a sentence end (`splitLongText`); progress still uses stored block numbers
  (`view.toStored` / `view.fromStored`). A paragraph that cannot be segmented is drawn as plain text, not allowed to take the chapter down. The phrase popup's text uses the same spans
  but `popup.css` still styles it as native ruby. Toggling pinyin mode / style / tone colors /
  known words must not re-segment: keep tokens per block in memory and update classes or rt text.
  Pinyin visibility via classes (`.rd-py-off`, `.rd-known`), `rt` must not be selectable and must
  not leak into copied/selected text. Script conversion re-renders the chapter.
- HSK mode (`pinyinVisible` in `render.ts`, levels from `core/hskLevel.ts`) hides a word's pinyin when the reader can say it at the
  chosen level. Pinyin is for saying a word, so a word takes its hardest character's level, with the token's reading in context
  (说道 is 7 on the list but 1 this way; names and words the list leaves out, like 一个, 放在, are graded the same way). A character's
  level is the lowest level of the listed words it is read the same way in: same syllable and tone, or a neutral tone in the text (a
  character learned only in a neutral tone, like 楚 in 清楚, does not teach its full tone), so a reading only one word has comes at
  that word's level (银行 háng). A listed word read with a neutral tone keeps its list level, since which syllable goes neutral is the
  word's (本事 běnshi), and a listed word falls back on its list level whenever a character has none. A listed word teaches only its usual reading
  (`dict.pinyinFor`; 便宜 piányi says nothing of 宜 yí), and a bare character its neutral readings as well (地 de). A glyph variant
  with no reading of its own and a Unihan simplified form t2s leaves alone (偸 → 偷, 著 → 着) read as the character they write; a
  t2s fold into a character that never has the token's reading (乾 qián → 干) lends no level. It never shows more pinyin than the list
  alone. The index is built once per dictionary (about 30 ms) and levels are memoized per word and reading. The pinyin menu shows the
  share of the chapter's words that still carry pinyin in the Unknown and HSK modes.
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
- Saved words get one continuous vermilion stroke under the whole word (`--saved`, an absolutely placed `::before` on each character
  cell, ends pulled in so neighbors stay apart; never inside the chapter title, which carries its own short red rule). It moves no text.
  Known words lose their pinyin in Unknown mode. Only headings are balanced (`text-wrap: balance`); short prose paragraphs fill like any other.
- Paragraph translate (settings.paragraphTranslate): a small translate icon appears in the
  margin on hover; click → translation block under the paragraph (toggle). Scroll layout only: Pages hides the margin buttons and has no
  in-flow translation block (select a sentence instead). The Aa menu leaves the switch out on a touch screen: it only shows the hover
  button, and a double tap translates either way.
- Keys: ←/→ or PageUp/PageDown at chapter edges = prev/next chapter, `p` cycles pinyin mode,
  `[`/`]` font size, Esc closes popups, `?` shows the shortcut sheet (`openShortcuts` with the Reading and In a word card groups, titled).
- Keyboard word cursor (Switch Control, VoiceOver, a Bluetooth keyboard on an iPad): Enter puts a cursor (real focus, class `rd-cursor`) on the first
  word of the page; ←/→ move by word and ↑/↓ by line, across page turns; Enter or Space opens the card; Esc closes the card (focus returns to the word),
  then ends the cursor. PageUp/PageDown still turn pages. The page itself (`.rd-stage` or the Scroll article) has `tabindex=0` and a label.
- Touch: on a touch screen a second tap within 380 ms and 48 px (screen coordinates) of the first opens the sentence of the FIRST tap's word as a phrase popup (translation), whatever is under the finger by then: it is a capture-phase click listener (`onDoubleTap` in reader.ts), because the first tap's card or the lifted page can be under the second tap, and the Pages lift of a bottom sheet is held back 400 ms (`LIFT_HOLD_MS`) so the word stays put for it. Names found by the first-open scan wait while a word card is open and apply when it is closed. Pages turns the page
  from a tap on the blank margin in the outer strips of the spread (`edgeWidth`: about 16% of a spread, 20% of one page, 56 px at least). A tap on
  the text never turns: a word opens its card wherever it is, and the rest of a text line (`.rd-b`: punctuation, the gap between lines) shows or hides
  the bar, so reaching for a word near the edge no longer turns the page. A mouse click on a word always looks it up. The first time a book is opened on a device a hint says so, and points to
  the 拼 button (drawn as the seal) for pinyin on every word, unknown words or above an HSK level (`dushu.reader-hint.v1` in localStorage,
  dismissed by the first tap).
- A chapter that cannot be loaded or drawn shows "Could not display this chapter" with Previous, Next, Open chapter list and (the first time) Try
  again; keys still turn chapters; the saved place is not overwritten. Failures are counted per chapter in localStorage (`dushu.chapter-failures`):
  after two, opening the book shows the error and the chapter list instead of trying that chapter again.
- Words tab (`ui/reader/wordsTab.ts`, counting in `core/chapterWords.ts`): the chapter drawer's middle tab (press W) lists the words of the
  current chapter, segmented like the reader (same dictionary and lexicon; the book's names and terms are left out, they have their own tab),
  one row per simplified form with its count, its most common reading in the chapter, a short gloss, its HSK band, and the sentence it first
  comes up in. A summary gives the share of word occurrences known and the number of new words (and of those that come up 3+ times). New/All
  and Most often/In order chips, a filter (word, pinyin with or without tones, gloss), and arrows to look at another chapter's words without
  turning the page. A row opens the word card with that sentence as context; its star saves the word (`popup/saveWord.ts`, the same card the
  word popup makes, with the chapter) and its check marks it known. Rows stay in place when saved or known, so a slip is one tap to undo; the
  list is filtered again only when the chips or the filter change. The reader caches the counts per chapter until the lexicon changes. Counting
  runs in slices of 6,000 characters with a pause between them (about 0.15 s for a 40,000-character chapter). The end of a chapter links
  to it: a "Words in this chapter" button in Scroll; in Pages a quiet button on the blank page after an odd chapter, "Words in this chapter"
  in the right page's footer when the chapter fills its spread, and "Words" beside the way on in one-page mode (`onChapterWords`).
- Dialogs: the chapter drawer is a modal `role=dialog` (focus goes to the current chapter, Tab stays inside, Esc and close return focus to the opener;
  its list is windowed, so 2,000 chapters draw about 30 rows); the Aa and pinyin menus are labeled dialogs that take focus and give it back. Under
  640 px (a phone) they are bottom sheets (grabber, Done, at most 60% of the height, so the top of the page stays in view); on an iPad or a
  computer, a bubble under the button. The Full screen row always says what applies: a switch, "On" in a Home Screen app, or how to add one.
- Everything the chrome shows from the book (bar titles, running heads, chapter list, names, the end-of-chapter button) goes through the same
  script conversion as the text (`text()` in reader.ts, `opts.text` in the pager and the drawer).
- `#/read/<id>?ch=<n>`: `n` is the 0-based chapter index, matching `Progress.chapter` and `VocabItem.context.chapter`.
  The reader does not rewrite the hash, so a reload restores the saved position. The library links without `?ch=`.
  Shortcuts live in `ui/shortcuts.ts`, shared by the reader's `?` sheet and the About page.
- Progress: save `{chapter, block, offset?, percent}` (debounced on scroll; on every page turn in Pages); restore on open (scroll the
  block into view, or open the page that holds the offset). Scroll also saves the offset of the first line under the bar, so a reload comes back to
  the line, not the paragraph. A link with `?ch=n` opens that chapter at its start; a plain book link restores the saved place. A saved
  `{block 0, offset 0}` is the top of the chapter, so the chapter title stays in view. Update `lastOpenedAt`. Chapter end: "Next chapter" button (Scroll), or the
  next page flows into the next chapter (Pages).
- Keeping the place in Scroll (`keepPlace`): a change that reflows the text (text size, spacing, script, names) keeps the first character of
  the line under the bar at the same height, not just its paragraph. A script change empties the drawn blocks (`reconvert`), so the place is
  measured first and the blocks down to it are drawn again before anything measures the page. A layout switch reads the place
  (`currentPlace`) and saves it before `applyLayout` gives the text the other layout's size.
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
Grid of book cards (cover image or a generated cover; author; progress bar; "Continue" on the most recent). Generated covers come in two
families drawn in CSS (`cover.ts`, `library.css`): **classic**, a thread-bound book (线装书) with a paper title slip (题签), four-hole stitching
on the right-hand spine and silk corner caps (the title set down the slip for up to eight CJK characters, across a horizontal slip for longer
or Latin titles: `classicLayout`), and **modern**, a cloth hardcover with the title set across in the book serif, a hairline rule, the author
on its own line and a band at the foot. Both are dyed from a short list of book cloths (`coverDye`). `era.ts` `bookEra()` picks the family: the
bundled classics by sample id (title and author when the id is lost), then classic for an author field with a dynasty marker (〔清〕, [明], 唐·,
清 …) or a classical author in either script, modern for everything else. The card's "…" menu (beside the title, never on the cover) has
Cover: Automatic / Classic / Modern, kept per browser in `dushu.cover-style.v1` (`coverStyle.ts`). Once any word is marked known, each card
also says "You know N% of its words" ("<1%" when some but under 1%) (`ui/library/bookShare.ts`, `core/bookWords.ts`): six chapters spread over the book, the first 4,000
characters of each, counted like the Words tab (names left out), share of occurrences known. Samples are counted one book at a time in the
background a moment after the library opens and kept per device (`dushu.book-words.v1`, keyed by chapter count, size and the number of names),
so the share follows known-word changes without reading the book again.
Title/author search normalizes simplified/traditional text; the grid can be sorted by recently read,
title or date added. Filtering never changes stored books and has a clear empty-result state.
Import: button + drag-and-drop anywhere on the page + "Paste text" dialog. Progress UI during
import; errors as clear toasts. Pasted text with no title of its own is saved as "Pasted text", the name its card showed. A file whose
import reproduces a book already here (same chapter count, size and chapter titles, as `bookKey` names a file-added book) is not added
again: a toast says it is already in the library and offers Open (the Mac's own books are always added; `macCopyOf` covers a pick of the
Mac's file). A progress row past the start of a long book shows at least 1%, never "Not started". Card menu: rename, delete (confirm), cover (Automatic, Classic, Modern). "Start with a classic"
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

- Looked up (`ui/vocab/lookups.ts`, `practice.ts`; store table `lookups`, keyPath [day, id], DB_VERSION 4): `lookup.ts` openWord calls
  `logLookup` (`ui/popup/lookupLog.ts`) after the card opens, in a timeout, so a lookup never waits on it; stepping with Prev/Next passes
  `log: false`. One row per simplified headword per local day (count, first, last, reading as read, gloss, sentence, book). The
  Vocabulary screen has Saved | Looked up tabs (`dushu.vocab.tab`); Looked up groups by day, newest first, each day with Practice, plus
  "Practice the last 7 days" (one row per word). Practice is a run of its own (Again puts the word at the end, Got it moves on) and
  never touches the SRS schedule; its star saves to the flashcards. Synced through the Mac (§4.11).
- Bookmarks (store table `bookmarks`; reader top-bar button and `B`; drawer tab): stored like a reading place (chapter, stored block,
  offset) plus the first 28 characters as a label. The button is pressed when a bookmark lies on the spread on screen (Pages,
  `pager.shownRange()`) or in a block in view (Scroll), checked on every progress update. Synced through the Mac (§4.11).
- Full screen (`ui/fullscreen.ts`, Aa menu row and `F`): the Fullscreen API with WebKit-prefixed fallbacks; where the browser has
  none (an iPhone) and the app is not a Home Screen app, the row says how to add it to the Home Screen.

### 5.6 Settings and About
Settings: every `Settings` field grouped (Reading, Pinyin, Lookup, Translation, Speech, Data),
live preview sentence rendered with the reader's renderer if exported, otherwise simple ruby.
Translation: provider select with live availability status per provider, a Claude model select (Sonnet 5.5, Haiku 5.5), a "Local only"
switch, a live status block (Mac reachable, key configured on the Mac, usage today and the limits) with "Check again" and "Test Claude";
there is no key field, the key lives only on the Mac. "Your Mac and iPad": the connection state; on the private site a one-time hand-off
link (Copy, Share) that opens Settings on the public copy with the Mac's address in the URL fragment, and on the public copy a Mac address
field with Connect and Disconnect plus a confirm card for `#/settings?connect=<url>` (the address is stripped from the URL). Chrome on-device
"Download model" button when availability is `download`. Data: backup export/import, delete all
data (confirm). Layout, Pages shown and Page turn are in Settings and in the reader's Aa menu; rows that only apply to one layout are hidden in the
other (Pages shown and Page turn in Scroll, the page width in Pages) and Settings says "Applies to the Pages layout". How the pinyin looks (style, tone
colors, tone changes) is in the reader's pinyin menu; the Aa menu has Text, Page and Reading sections. Settings lists its sections at the left on a wide
screen, the one being read marked with a vermilion ribbon (the first at the top of the page, the last at the bottom). About: what the app is, data sources + licenses from `meta.json` (CC-CEDICT
CC BY-SA attribution is required; Noto Serif SC/TC and LXGW WenKai are OFL 1.1), coverage counts, keyboard shortcuts, what can be imported
(EPUB, MOBI and AZW3 without DRM, TXT, PDF, HTML, Markdown), reading like a book, names and terms, iPad, and a storage card (is the data
protected from eviction, with an ask button; `navigator.storage.persist()` is requested once after the first import, or at boot when books exist).

### 5.7 Pages layout (Apple Books style) and the even pinyin grid
- `settings.layout`: `scroll` (default) or `pages`. `settings.spread`: `auto` shows two pages side by side
  when the reading area is wide and landscape (iPad landscape, laptop), one page otherwise; `single`/`double`
  force it. `settings.pageTurn`: `flip` (default — the turning leaf rotates around the spine with a soft
  shadow, like a book), `slide`, or `none`.
- Pagination: lay the chapter out in CSS multi-column inside a fixed-height page area (100dvh minus the
  reading chrome); one column per page, a spread shows two with a spine gutter. The column is a whole number of grid cells wide and centered.
  Page header (chapter title, small) and footer per page, Apple Books style, quiet: the folio sits on the outer edge of each page, and "n pages
  left in chapter" only on the right page (or the single page). The blank right page after an odd chapter carries a small end mark and a button
  "Next: <chapter title>" (one-page mode puts that button in the footer of the last page; the last chapter says the book is finished).
- Turning: tap or click the outer strips of the spread = next/previous (see the touch rules in 5.3); swipe with the page following the
  finger; ←/→, Space/Shift+Space, PageUp/PageDown; a trackpad swipe or the mouse wheel. A click in the middle toggles the chrome.
  A trackpad swipe turns one spread, its coasting included (`ui/reader/wheelTurns.ts`). One swipe is told from the next by speed, from the
  events' own time stamps over about 64 ms (events with one time stamp count as one): deltas jump when the fingers lift (the events space
  out) and when a busy page gets several folded into one, while the speed holds. A new swipe is a pause of 160 ms (unless the event carries
  the movement the swipe would have made in it: a busy page), a delta the other way, or the swipe speeding up again after it slowed below
  60% of its top speed or stopped dead (fingers landing on a coasting swipe). A wheel that reports lines or pages (Firefox) turns a page per
  notch. Every turn plays its whole animation: one asked for while a page is still turning (fast scrolling, quick taps or clicks, a held
  key) waits for it and then plays; only the latest waits, so turns come no faster than the animation and stop when the reader stops (three
  quick clicks under a flip are two turns). A finger landing mid-turn does not stop it: a tap waits like a key press, and only a swipe takes
  hold of the page, ending the running turn where it was going once the finger moves. While a page turns, a tap or click is judged against
  the page it goes to, as that page will rest (`tapOnText`: a hit test with the destination put in place): on text (inside `.rd-b`) it does
  nothing at all, neither a turn nor a word card, since the reader may be reaching for a word on the page coming in; on the blank margin of
  an outer strip it waits to turn; in the middle it shows the bar. The turning text itself takes no taps (they go to the stage), so words
  are looked up on a page at rest. A finger on the page, a relayout or a new chapter drops the waiting turn. Read-aloud going on to the next spread turns it the same way, animated and waiting for a running turn; a jump
  further than one spread is shown at once (`reveal`, which goes by the block the reader marks as being read).
  Under prefers-reduced-motion the old pages cross-fade out (about 180 ms) instead of flipping or cutting.
  Chapter edges flow into the next/previous chapter (the next chapter's first pages, and a short previous chapter, are ready in idle time).
  A key, a tap or a swipe toward a chapter that is not ready yet gets it ready and then turns to it, animated.
- Position: progress keeps the first block on the current page; resizing, rotating, changing font size or
  pinyin re-paginates and lands on the page that contains that block. 60 fps turns (transform/opacity only).
- **Even pinyin grid (both layouts):** when a paragraph shows pinyin, every Han character occupies the same
  cell width: padding on both sides of the character (`--rd-pad`) with `white-space: nowrap` on the character box (letter-spacing would
  split the box at line ends and push pinyin off center), cell width `--rd-cell` and pinyin size `--rd-rt` set from the measured width of a
  typical syllable (the 85th percentile of all of them, canvas-measured in the pinyin font; `ui/reader/grid.ts`): the cell is about 1.25em at
  reading sizes, the pinyin 10.5 px at least (12 px for zhuyin, in a bopomofo font), 16 px at most. The few longer syllables (zhuāng, shuāng,
  chuáng) are squeezed horizontally by the stylesheet (`--rd-w` on their `rd-rtx`, down to 72%) so two neighbors never touch. A paragraph is
  indented exactly two cells (`--rd-indent`); without the grid it is 2em. The rt holds
  `span.rd-rtx`, which the stylesheet centers over its character; it never pushes characters apart. Full-width marks (`span.rd-pu`) take half a
  cell: a closing mark hugs the character before it, an opening one the character after, and the empty half of a mark hangs over its neighbor.
  Tone colors tint the pinyin (`rt.tone-N` is 74% tone color, 26% text color: at least 4.5:1 in all three themes, checked by a test).
  The active word, a selected phrase and the word being read aloud are one band that includes the pinyin row (`::after`), punctuation in
  a phrase included. Characters whose pinyin is
  hidden (known words in Unknown mode) keep the same cell so the column stays even. With pinyin off,
  normal CJK spacing. Selection/offset mapping must not change.
- Progress in Pages is `{block, offset}` (§4.6). Neighbor chapters are laid out ahead of time. Page numbers restart in each chapter and the
  footer counts pages within the chapter (no book-wide page number). Tap zones: the outer strips turn (touch: only on the blank margin, never over text), a tap in the middle
  toggles the bar and looks words up, and a tap that only closes a popup does not turn the page. The bar tucks away on the first turn; the mouse at the top
  edge brings it back. Swipes follow the finger and are ignored while text is selected. Flip rotates the leaf around the spine in 3D (one- and
  two-page modes); only transform and opacity animate.
- iPad/Safari: 100dvh + safe-area insets, no hover-only affordances, native long-press selection opens the
  phrase popup, `-webkit-user-select: none` on rt, works as a home-screen web app (standalone: `apple-mobile-web-app-capable`, status bar
  style `default`, apple-touch-icon and a manifest with 192/512 and maskable PNG icons, `viewport-fit=cover`).
  **Verified only in WebKit at iPad size (Playwright), not on a real iPad**: home-screen mode, native selection handles, the real keyboard, offline
  and the update toast on iOS. `.rd-stage` uses `touch-action: pan-y pinch-zoom` (it was `none`, which also blocked pinch zoom); horizontal swipes are
  still ours. Whether long-press selection, dragging its handles and Look Up still behave on a device is untested: if they do not, put `none` back.
- Performance (progressive pagination, `ui/reader/pager.ts`). Laying out a whole chapter in one multi-column container took 0.7 to 2 s for 34,000
  characters and 112,000 DOM nodes (about 2 GB of renderer memory with its neighbors laid out as well), and the cost of each slice of a growing
  container grows with what is already laid out. So: every block starts hidden (`rd-wait`, `display: none`); the pager reveals, renders and measures
  them in slices of a few hundred characters (timed to about 14 ms each) and reads which page each block landed on. The first spread is up after
  about 3 spreads are measured. Pages are then measured only a few spreads ahead of the reader (a chapter under 16,000 characters is finished in
  the background, so its count is exact); a longer one keeps an estimate ("About 40 pages left in chapter", `data-exact="false"`) until the reader
  gets near the end, presses End, or opens a saved place far in; those waits take bigger bites and show "Setting the pages…". A change of font
  size, spacing, script or names calls `pager.freeze()` first: the place is kept and the text is taken out of the layout (`rd-measuring`, page
  hidden), then measured again from the place the reader is at. Turns are built ahead (idle time, one face at a time) into hidden hosts
  (`.rd-turn[data-idle]`), so a turn starts by revealing them; the pictures of a finished turn are taken apart a second later. Measured with
  `scripts/qa-reader.mjs` and the scratch scripts of the 2026-10-13 pass, Chrome headless on this Mac, production build, a 34,000-character
  chapter: first spread 70 to 170 ms warm (360 ms with the dictionary cold), 300 to 700 ms at 4x CPU throttle, 15,700 DOM nodes instead of 112,000
  (about 90 MB of JS heap); a font step shows the repaginated page again in about 320 ms (1.2 s at 4x); the longest frame during a flip is 33 to
  50 ms (130 to 220 ms at 4x; it was 100 to 450 ms and 0.9 to 1.8 s). A 20,000-character chapter of 射雕英雄传 opens in about 220 ms. In headless
  WebKit at iPad Pro size (software compositing, a desktop CPU): first spread about 560 ms warm, a font step about 530 ms, flip frames about 20 ms
  with the leaf on screen within 50 to 75 ms. In the 1.4 s after a tap the longest frame is 93 to 120 ms landscape, 92 to 142 ms portrait and 64 to 101 ms on an iPhone
  profile (2 to 7 frames over 50 ms; it was 96 to 136, 115 to 208 and 76 to 105 ms with 4 to 8 such frames: the old 200 ms stall was the turn pictures being copied and laid
  out in one go). The first of those frames is the turn starting; the rest is background work. The turn pictures are now built a few blocks at a time (`buildFaceSteps`, a pause
  after about 12 ms), 300 ms after the page settles. What is left, 50 to 90 ms a few times in the second after a turn, is the browser laying the whole column strip out again
  after the pump draws the pinyin of the neighboring spreads and the pictures are added: it is layout, not script (the pump's own slices take 0 to 30 ms), and drawing that
  pinyin one block at a time made it more frames, not cheaper ones. Real iPad GPU and CPU numbers are not measured.

### 5.8 Shell, fonts, PWA
- Page heads: `ui/pageHead.ts` `pageTitle(screen, english)` builds each screen's one `h1`: the Chinese name first (书架 生词 复习 设置 关于,
  `span.page-title-zh[lang=zh-Hans][aria-hidden=true]`), then the English title, which is what a screen reader announces.
- Interface fonts: Newsreader (OFL 1.1, `public/fonts/newsreader-roman.woff2` with the optical-size axis and `newsreader-italic.woff2`,
  wght 400 to 500, Latin-1 plus typographic punctuation, 118 KB together, `Newsreader-OFL.txt` beside them) is declared in `injectFonts()`
  with a matching `unicode-range` and `font-display: swap`, and precached by `sw.js` (`UI_FONTS`). It sets only the app's own English
  (`--font-display`): screen titles, italic subtitles, folios, numbers. It has no ǎ ǐ ǒ ǔ ǖ ǘ ǚ ǜ, so pinyin, Chinese, book titles and
  dictionary text never use it; definitions and translations use `--font-book` (Iowan Old Style, Palatino, Georgia: all have the tone letters).
- Fonts: Noto Serif SC and TC (400, 700) and LXGW WenKai (regular) from the installed packages, woff2 slices only (a vite plugin strips the woff
  fallbacks from their CSS; `dist/assets` holds about 500 slices). The 527 KB of `@font-face` CSS lives in `src/fonts.ts`, a separate chunk
  `main.ts` imports after the first render, with `font-display: swap`. `tokens.css` has the stacks `--font-serif`, `-serif-hant`, `-sans`,
  `-sans-hant`, `-kai`, `-kai-hant` (Songti first on a Mac) and a Jigmo last resort; the plain ones switch to the Hant ones under `:lang(zh-Hant|zh-TW|zh-HK)`.
- Service worker (`public/sw.js`; build id, data version and precache list are filled in by `serviceWorker()` in vite.config.ts): three caches.
  `dushu-app-<build>` (index.html network first, `assets/` cache first, the PDF worker and CMaps included; replaced on every build, but a hashed
  file the previous build stored is copied from its cache instead of downloaded), `dushu-static-<data version>` (`data/`, `samples/`,
  the two Newsreader files; survives app updates; the data version hashes the bytes of `data/`, `samples/` and `fonts/`, so a release that
  changes only a classic still reaches installed apps) and `dushu-fonts-v1` (the woff2 slices, cached on first use, never cleared by app or data updates). It does not call `skipWaiting` at install; it handles a
  `SKIP_WAITING` message. `main.ts` shows a persistent "A new version of Dushu is ready. Reload" toast when a worker is waiting, and checks for updates
  when the page becomes visible. Every cache lookup passes `ignoreVary` (a static host's `Vary: Origin` otherwise hides cached module chunks from `import()`), and only an HTML response is ever stored as the app shell. `qa-shell.mjs` with `QA_ONLY=offline` stops a preview server and reloads every screen from the cache. HTTPS is required for install and offline on an iPad (README, "Read on your iPad"); the private Serve endpoint provides it without a public deployment.
- Safe areas: `#screen` and the reader use `env(safe-area-inset-*)` and `dvh`. Coarse pointers get 44 px buttons (Apple's minimum target), 40 px icon buttons and fields, and 16 px inputs.



## 6. Styling rules

- Use the tokens in `styles/tokens.css` and components in `styles/base.css`. No raw hex colors
  in screen stylesheets except inside `color-mix()` with tokens.
- **Every class you define starts with your prefix**: reader `rd-`, popup `pp-`, library `lib-`,
  settings `set-`, about `ab-`, vocab `voc-`, review `rev-`. Shared: `.btn .card .chip .input
  .select .textarea .icon .icon-btn .page .page-head .page-title .page-sub .section-title
  .muted .empty .kbd .zh .tone-1…5 .modal`. Import your stylesheet from your screen module.
- Look ("Colophon", with a crisp chrome): a finely printed Chinese-English edition. Warm paper (light, a deeper bamboo sepia) or a warm
  near-black ink page (`#131210`, the book text dimmed to `--reader-text`). The type decorates: Newsreader for the app's English titles,
  wide-set Songti for Chinese names, hairline rules (`--rule`) instead of boxes where the rule is typography (page heads, lists).
  Vermilion is the reader's brush and nothing else: the seal (`--accent-fill`, a deeper lacquer red with silk text at night), your place in
  a book (progress, Continue reading, the current chapter's ribbon), saved words, and the current Settings section. Everything else is ink.
  The chrome around the page (menus, sheets, the word card, dialogs, toasts) sits on `--elev`, a slightly cooler sheet than the paper, edged
  by alpha rings and layered shadows made from the ink (`--ring`, `--shadow-s`, `--shadow`, `--shadow-pop`), and opens on a spring
  (`--ease-pop`, `--ease-sheet`: `linear()` springs with a cubic-bezier fallback, a 1 ms cut under reduced motion; never on page turns).
  Desktop menus are frosted (`--glass` with a blur, solid without one); sheets, the word card and anything in Pages are solid.
  One control system in `base.css`: a tonal track with a raised paper segment (`.rd-seg`, `.set-seg`, drawer tabs, Words chips, the word
  card's step bar), a pill switch (on is inked with a check, so the state never rests on position alone), sliders inked up to the thumb.
  Hover washes sit inside `@media (hover: hover)`. Italic only on English the app writes, never on an element that can hold Chinese.
  Respect light/sepia/dark themes (test all four, system dark too). Must work at 390 px wide.
- Icons: `icon(name)` from `ui/icons.ts`. No emoji in the UI.
- The reading grid (the reading fonts and sizes, the cell, every `--rd-*` variable, `--font-pinyin`) is not styled from outside it, and
  nothing sets `font-feature-settings` on `body` (it inherits into `rt` and moves the pinyin).

## 7. Testing and QA

- Public build checks: `node scripts/check-public.mjs --source|--build` scans for emails, tailnet hostnames, `sk-ant` keys, EPUB files and
  10-character Han windows from the owner's EPUBs (prints file, line and rule only); `scripts/serve-subpath.mjs` serves a build under `/dushu/`
  like GitHub Pages; `scripts/qa-public.mjs` checks the manifest, icons, service worker scope and offline reload on that subpath;
  `scripts/qa-popup.mjs` checks word and phrase popups at iPad and iPhone size (WebKit): the footer is reachable by scrolling to the bottom,
  controls are 44 px.
- `npm run typecheck` clean, `npm test` green, `npm run build` succeeds — before reporting done.
- Unit tests live in `tests/<area>/`. Use the real data files (loader in
  `tests/helpers/data.ts`, owned by core: `loadTestDictionary()` caches one instance per worker).
  `tests/reader/layoutFake.ts` gives jsdom a layout that follows `--rd-size` (Scroll column with a real scroll position, Pages by
  character), for tests of where the place lands; `tests/shell/bootApp.ts` boots the real `main.ts` router on it.
- Browser QA is headless only (`scripts/qa.mjs`, puppeteer-core + system Chrome,
  `headless: true`). **Never open visible windows, never run `open`, never bring an app to the
  foreground** — the owner is working on this machine.
- Never copy copyrighted books into the repo. `~/Downloads/活着.epub` may be read in place for tests.
- Sample books in `public/samples/` must be public domain in the US (published before 1931,
  or classical texts) and record their source URL.

- `node scripts/qa.mjs [url|-] <outDir> <scenario>` starts its own `vite --port 5190 --strictPort` when no URL is given (`-`), or uses
  the server a URL names (for the build: `npm run build` + `vite preview` on a scratch port; never 4317, the owner's). Every QA script
  gives a server it starts an empty mkdtemp `DUSHU_SYNC_DIR` (removed at the end) and switches sync off in the browser (`SYNC_OFF`, kept
  over `localStorage.clear()`) for a server it did not start (`QA_BASE`, `QA_URL`, a URL, the private address). Scenarios: smoke, read (Scroll layout), epub (QA_EPUB, default
  ~/Downloads/活着.epub; Scroll), vocab, rare, themes (includes WCAG contrast), mobile (390 px), **pages** (two-page spread at 1440x900, turning by key and
  tap, chapter flow, position kept over a reload, a portrait window), **lexicon** (QA_SHEDIAO, default ~/Downloads/射雕英雄传.epub, skipped if
  missing: import through the file input, wait for detection, 郭靖 and 黄蓉 render as single words with name pinyin, the In this book card, Not a
  word and Undo, Edit, the Names & terms tab, persistence over a reload, Pages), **mobi** (the Gutenberg fixtures in tests/fixtures/import), offline
  (production only). `read` and `epub` seed `layout: 'scroll'` because they assert scroll offsets and the Next chapter button.
- `scripts/qa-reader.mjs` (Scroll and Pages, popups, grid measurements, big chapters; `QA_BASE=…` uses a running server) and `scripts/qa-ipad.mjs`
  (WebKit at iPad Pro 11 landscape/portrait, iPad Mini, iPhone 13: layout, taps, swipes, selection, rotation, flip, and the names card) run against the
  dev server. `qa-shell.mjs` checks the shell and PWA (and, with `QA_ONLY=offline QA_DIST=<scratch build> QA_PREVIEW_PORT=<port>`, the service worker with the server stopped), `qa-vocab.mjs` the vocab screens. None of them print book text.
- `public/sw.js` is the service worker (registered in production builds only). The build fills in its build id,
  data version and precache list (`serviceWorker()` plugin in vite.config.ts). index.html is network first,
  `assets/` cache first, `data/` `fonts/` `samples/` cache first in a cache that survives app updates.

## 8. Licenses
CC-CEDICT (CC BY-SA 4.0, attribution required in About), Unihan (Unicode License v3), jieba
(MIT), complete-hsk-vocabulary (MIT), OpenCC (Apache-2.0), Jigmo (CC0), Wiktionary via kaikki
(CC BY-SA), hanzi-writer (MIT) + hanzi-writer-data (Arphic Public License, fetched at runtime),
Newsreader (SIL OFL 1.1, no Reserved Font Name; `public/fonts/Newsreader-OFL.txt`).
