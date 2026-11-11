# LinguPengu (formerly Dushu 读书): architecture

The app is shown as LinguPengu. Internal names (storage keys, the `dushu-sync` Worker, the X-Dushu-* headers, `app: 'dushu'` in files) keep the old name so saved data, sync and the Mac bridge go on working.

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
| `book-words.tsv.gz` | trad, simp, pinyin, defs, optional segmentation count (curated senses for the words the books use most; optional) | ~430 |
| `reading-model.tsv.gz` | `!` settings rows (features version, default threshold, `threshold:<char>` for a character's own), then char, readings, biases, one `feature weights` column per feature (the reading model, §4.1; CC BY-SA, made by `scripts/train_reading_model.py`; optional, loaded after the dictionary) | 39 characters, 138 KB |
| `words.tsv.gz` | word, count | 287,084 |
| `corpus-words.tsv.gz` | `# format 1`; word, count (a count read off free text for a dictionary word jieba never counted), or trad, simp, pinyin, defs, count (a word no dictionary has); made by `scripts/build_corpus_words.py`, CC BY-SA; optional | 313 counts, 189 words, 7 KB |
| `hsk.tsv.gz` | simp, trad, hsk3 (easiest reading), hsk2, rank, readings, same-word readings, of | 11,694 |
| `hsk-LICENSES.txt` | the MIT notices of the two HSK sources (plain text, shipped with the data) | |
| `t2s.tsv.gz` / `s2t.tsv.gz` | from, to (OpenCC phrases + chars, first candidate; t2s starts with the hand-written rows of `scripts/data/t2s-extra.tsv`, rebuilt with `--t2s-extra`) | 3.6k / 42k |
| `radicals.tsv.gz` | num, radicalChar, unifiedChar | 246 |
| `names.tsv.gz` | name, kind (`p` person, `l` place, `o` organization, `t` other); the name list from Wikidata, fetched only for name detection (§4.9), not precached | 580,161 |
| `name-model.tsv.gz` | `!` settings rows (features version, `threshold:person`, `threshold:place`, `threshold:person:<shape group>`, bias), `=` rows (a character's priors), `~` rows (title tails), then feature, weight for none, person, place (the name model, §4.9 Detection v12; CC BY-SA, made by `scripts/train_name_model.py`; optional, fetched with the name list, not precached) | 347 features, 4,578 characters, 5,137 tails; 42 KB |
| `meta.json` | build date, Unicode version, counts, sources + licenses | |

Details:
- `cedict` pinyin is numbered, space-separated, `ü` (never `u:`/`v`), tone 5 = neutral,
  proper nouns capitalized ("Bei3 jing1"); non-syllable tokens (digits, Latin letters, `·`, `,`)
  appear as-is. Syllable count usually equals the code-point count; when it does not, fall back
  to per-character readings for alignment. Multiple rows can share a headword (one per reading).
  The final 30 rows are HSK words missing from CC-CEDICT. Those rows are NOT in the numbered format
  (they hold tone marks and run-together syllables such as `chènzhe`, `bu4 lìyú`); the loader repairs them with
  `normalizePinyinField`. A cleaner fix is for `build_data.py` to emit numbered pinyin for them.
- `hsk` (built by `python3 scripts/build_data.py --hsk`): HSK 3.0 levels for each reading of a word, from the official 2021 list
  (GF0025-2021) as transcribed with its pinyin by ivankra/hsk30 (MIT, pinned commit, sha256 checked); HSK 2.0 level, rank and trad from
  complete-hsk-vocabulary (MIT). Column 6 lists the list's readings as numbered syllables `=level`, joined by `;`, lowest first
  (行: `xing2=1;hang2=3`); "7-9" is 7. Column 3 is the lowest of them, so old code (which reads columns 1 to 5) sees the levels it saw
  before. Column 7 holds same-word readings, the listed word read another way, at its level: the CC-CEDICT readings the transcriber
  matched an entry to where they differ from the list's pinyin (血 `xue4=3` beside the list's xiě), and the hand table
  `scripts/data/hsk-same-word.tsv` (word, reading in books, list reading, why; CC0; the build stops if a row names a word or reading the
  list lacks). Column 8 is set on a derived row, which stands for a listed form the books spell otherwise: a listed X儿 read with a
  final r gives X (一下 for 一下儿), and a CC-CEDICT word whose definitions are only a "variant of T[py]" pointer, T listed in that
  reading, gives that spelling (好象 for 好像; not "old variant of": 马头 is "horse's head"). Derived rows never enter the segmentation
  vocabulary, and variant spellings stay out of `hskWords`. Affix rows give the affix and its example (第 and 第二), optional parts both
  forms (有些, 有一些). A row with only 5 columns (a cached old file) grades the word, not its readings.
  The trad column is often a rare variant for a single character (时 → 旹, 听 → 听), so `dict.hsk()` falls back to the simplified
  form of a traditional spelling it misses.
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
- `corpus-words` (built by `python3 -I scripts/build_corpus_words.py --text DIR --work DIR`; its Node half, `scripts/corpus-words.ts`,
  reads the text with the app's own dictionary and segmenter): the offline corpus is about 350 million Han characters of Chinese
  Wikipedia (2023-11 dump, a fixed 64% of articles, cleaned; the held-out and sealed test articles and the articles about the
  owner's books left out) and 31 million of public-domain books from Wikisource (Ming and Qing novels, prose of 1895-1930, classical
  texts; none of the held-out or sealed works). It is outside the repository and only counts are kept. Every paragraph is cut
  (dictionary only, no lexicon); for each dictionary word of 2 to 4 characters that jieba never counted, the build takes the places
  where today's cut has a boundary at both its edges, weights them per kind of text (Wikipedia 0.4, novels 0.3, 1895-1930 prose
  0.15, classical 0.15, each as a share of its own tokens, scaled to jieba's counts by the median ratio over words jieba counts
  often) and computes PMI over the word's parts. Shortlisted: weighted count 20 or more, PMI 4 or more (6 when a part is one of
  the 150 commonest single characters), mostly cut apart today, a single character among the parts, no 儿 at the end, not only
  slang, a proper noun only when the books use it 20 times, it names no town or city and its parts are not two of the 500
  commonest single characters (比干 is 比 + 干 in a modern book). The reading the word would show must be its parts' (a sandhi or
  wrong tone in a Wiktionary row stays out) unless `scripts/data/corpus-words-review.tsv` (hand review, CC0) keeps it (仆射 púyè, 精舍
  jīngshè); the same file drops the words whose card or cut is wrong (郭嘉 "variant of 国家", 州牧 in 豫州牧). A word's count is just
  enough to win where it stands free: min(its weighted count, max(6, 8 times the count at which it beats the split into its
  parts)), with one book's share capped at twice the next book's (a name in one novel does not make a count); a longer dictionary
  word jieba never counted that holds one of these words (车骑将军, 中常侍) gets a count over it so it stays whole. An archaic word the
  books use two times in three inside longer words (常侍 in 中常侍, 散骑常侍, 十常侍) is counted only through them: alone it is more often two
  words (常|侍, always attends). The review file's `yield` rows name a dictionary word a counted word gives way to where they
  overlap (按|剑柄, not 按剑|柄; 披|衣甲; 肝胆|裂): the build keeps the count under what that takes, with a fifth to spare. The new words
  (`scripts/data/corpus-words-new.tsv`) are old and other spellings that Wiktionary redirects to a dictionary word (豫备 预备, 帐房 账房,
  精采 精彩, 嘱付 嘱咐, 部份 部分), written as a "variant of" row so the card shows the meaning of the word they stand for, read like it
  unless their own characters say otherwise (胡梯 hútī); spellings that one conversion row fixes for every word (衞 卫, 荳 豆, 祇 只) are
  left to the t2s table; a few rows have meanings written for Dushu where Wiktionary has none or another sense (杏黄, 散骑常侍; 骁雄 is
  valiant, not 枭雄; 帐房 is also a tent). `--steps diff` cuts the corpus with and without the file and lists, per word, the places
  where the change crosses other words; a word that does so more than one time in ten wrongly is dropped in the review file.
- `cedict-extra`: appended after CEDICT, skipping repeated readings; its words enter the segmentation vocabulary
  with count 0.
- `names` (built by `node scripts/build-gazetteer.mjs [--fetch]`; the build half is `scripts/gazetteer.run.ts`, run inside Vitest so
  it uses the app's dictionary): labels and aliases in zh, zh-hans, zh-hant, zh-cn and zh-tw of the Wikidata items with a
  zh.wikipedia article that are people (humans, fictional and legendary people, gods), places (anything under geographic
  location, geographical feature, architectural structure, administrative or political entity, settlement, historical country),
  organizations, or a dynasty, a people, a war, a battle or a period (`t`; stars and the Chinese constellations, 角木蛟, are `t`
  too). `--fetch` asks a SPARQL endpoint (default QLever's copy of Wikidata; query.wikidata.org works with `--endpoint`) one query
  per class and per language and band of sitelink counts, pausing between queries and honoring Retry-After, into
  `$DUSHU_RAW/wikidata/` (raw ≈ 90 MB). Each name is folded to simplified one character at a time (`toSimplified` of the
  character, the way detection folds a book) and gets the kind of its best-known item. Kept: 2 to 7 Han characters of the BMP
  (8 would do, but an 8-character name can repeat a run of a private book, which `check-public --source` refuses). Left out: any
  string the dictionary has (CC-CEDICT, cedict-extra, a jieba count), an item whose English label is lower case (a concept the
  class tree files under organizations: animism, urban planning), an alias of a person with fewer than 3 sitelinks (courtesy names
  of the hardly known: 冲霄, 悦之), two characters with fewer than 3 sitelinks, a person's two-character alias, a place's unless it
  has 10, an edge in `EDGE_STOP` or 的了着过 inside, 字 or 号 first, a numeral and a measure word (一粒米, 上一站), one character three
  times (哒哒哒), and four characters or more made of dictionary words end to end (北京市|第一|中学). No readings: Wikidata has
  P1721 on 11 such items; detection reads a listed name with its own rules. The file starts with `# format 1` (core/gazetteer.ts
  refuses another number), 8.7 MB, 2.76 MB gzipped. Sorted by kind, then name.
- `name-model` (built by `scripts/train_name_model.py texts|priors|sites|train`, from a folder of text kept outside the repository:
  zh.wikisource books first published in 1930 or earlier and Chinese Wikipedia, CC BY-SA 4.0; never the held-out corpus, the
  samples, the sealed set or the owner's books). Character priors, log-odds × 2 against how often the character runs in that text
  (floor -12): `sur` how often it opens a person's name in `names.tsv.gz` as a surname, `giv` how often it stands in a given name,
  `tra` in a foreign name (three characters or more, nearly all `TRANSLIT_CHARS`), `pla` at the end of a place's or an
  organization's name. Title tails: pairs that follow six or more different strong surnames (`sur` ≥ 5) in that text, twelve of
  them or about evenly (four surnames' worth), and are a given name of at most one person in the list (中丞, 监生, 秀才, 大喜; not
  天化 or 希真, which a few people of one book bear). The weights are a softmax regression, rounded to 2 decimals.
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
  the raw jieba count (CEDICT-only proper nouns like 花都 are cut to a quarter at load; `segmentFreq` gives a word jieba never counted
  its count from `corpus-words.tsv.gz` when the file has one, else the floor, `UNSEEN_FLOOR`, and `freq` stays jieba's for the rules; words with count 0 are scored
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
  `ctx.after` is the token after `next` (倒了茶 pours, 墙倒了 falls). `ctx.line`/`ctx.at` (the paragraph's tokens and this word's index) let
  a one-character token look further along its clause, and `ctx.orig` (the word as the book spells it, same length) lets the rules see 為 著 盡
  where the page shows 为 着 尽; all three are optional and segment.ts passes them (§4.2). Context rules added from reading the four books (tests/core/pinyin-rules.test.ts):
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
  A second native review of every book (tests/core/review-fixes.test.ts) narrowed the rules that reached too far: 为 + a number
  is wéi only when the clause ends on the number or a measured quantity comes before it (价格为每斤三块钱), not before what is done
  for someone (为两位客人买酒); the 所 of a 为 inside the clause is that 为's; 為 in a paragraph of the old vernacular (two kinds
  of 的 著 呢 么 们 这 那 …) is "for, because" before a longer clause; 子 after a verb of giving, keeping or losing a son, the hour
  and Daoist or Japanese names stays zǐ; 必得 + what is won is dé, + a longer clause děi; 干 is gān for dried, drained, sworn kin
  and 不干…事; 一将 is jiāng only when a verb of handling follows (一将信交出去); 那里 after 在 去 从 … is "there"; 罢 after a
  request (快说罢, 你们吃罢) stays the particle; 教 before 把, 人 + verb and in courtesies (闻教, 聆教) is jiào.
  A third review (tests/core/review3-fixes.test.ts) added: 教 is jiāo before the one taught + a skill or a subject (教他一套剑法,
  教她轻功, 教孩子们唱, 教你三天), in 教我的 (what someone taught), 教来教去, 怎么教都教不会, 教两遍, 教好书, at the end of a question after
  a modal (去教呢, 让我教吧) and in 不教徒弟。, but not when the skill is then lost (教我功夫尽废) or the deed is done (教石勇骑了马);
  当 is dàng in 把X当Y (unless a verb or 在 至 与 comes between: 把武松押至当厅), 当一回事, 当…用/看待/崇拜, 当了 + money (pawned),
  上了他的当 and 拿来当果子, and stays dāng for "when" (…时), "should" (亦当恩养) and 当著; 应 is yìng at the end of a clause (叫他不应,
  首尾皆应, 外应矣), before 之 弦 诏 口 准 劫 差 候 佛 武举, in 正应其谶 果应其言 上应天星 应在今夜, and before the one answered at the end of
  a clause (你敢应我么); 将 is jiàng at the end of a clause (斩关杀将，, 双枪将」, 智勇之将也; not 共相将 or 再将！ or before 《),
  in 将星 将佐 将吏 将卒 and after 番 川 蛮 羌 辽 心腹 为主.
  A fourth review (tests/core/review4-fixes.test.ts) narrowed what the second pass widened and added the commonest misses. 為 in the old
  books is wèi when what is done for the person follows them (吾为君赦之, 为大夫远涉路途, 力为大圣冒罪奏闻, `FOR_PERSON`; not 为君难, 为天下笑,
  为大王有), after a 是 inside the clause (又是为宝玉了; 是为灵帝 opening a clause stays wéi) and in 却为谁; wéi before an office that closes the
  clause (为军前参谋, `OFFICE_LAST`), after 权 出 送 现 旧 原, in 为先 为头领, 为人心/为人生, 为…何官 and the passive 为四个人扛着. 著 written so is
  zháo after 撞 遇 碰 (ran into) and, with 着 too, after 烧 碰 摸 at a clause end behind 把 被 让 能 (把衣角烧着; 炉火烧着， stays zhe); 尽著 is
  jìn before a clause end or troops (车仗尽著，). 那里 is nǎli across a clause boundary (the look back for 在 从 到 stops at punctuation and
  skips a 在 with its own place word: 在家里那里知道), in 那里话, before a potential complement (那里睡得著), after 不知 (not 不知那里的,
  not when the clause asks 怎样), and, where the book writes 那裏, in 是那里来的 and in a question with no other question word
  (长老那里来的？; not after 我 你 他 们 家 这: 我那里还有…？). 降 is xiáng after 便 遂 即 收 自然 岂可 … and before 之 矣 也 即 人 or 了 with the one subdued, jiàng before 阶 心 圣 御 一道 and after
  神人. 难 after 有 at a clause end is nàn; 哄 is hǒng before 那 这 将 出 过 and after 把 (hōng after 都 一齐 众); 术赤 zhú; 系 is jì before
  住 上 着 在 一条 (not after 皆 各 从小); 人家 after a 的 phrase is a household; 种的 is zhòng (planted) unless a kind or seed is meant
  (Ｕ种的, 买种的, 种的退化); 长 after 华里 公里 or a number + 里 is cháng; 精神 after 有 很 起 鼓起 抖擞起 is jīngshen unless a noun follows
  (精神上的, 有精神的 without 很 挺 before it); 地铺 草铺 下铺 上下铺 are pù; 斗 after a number is dǒu except 和他一斗, 斗它一斗; and one-offs (一将守关, 羞恶, 恶之,
  东西两角门, 无相, 宝相送, 教祖, 赚漏, 挨到五更, 必得是, 得了手, 二斗, 放大率, 干喝, 比…差, 明公差矣, 阙, 日识, 不著月日, 间亦, 吓，, 折本,
  着了慌, 很高兴地，, 先生传, 当…看待, 道千乘之国).
  A fifth pass (tests/core/review5-fixes.test.ts) put back what an independent review found worse than before the earlier passes and
  fixed the readings a full read of a modern novel found wrong. 為 (and 爲) in the old books is wèi again before what is done for someone
  named after it (为母报雠, 为刘备画策, 为曹氏作说客, 为二姐担心: `FOR_DEED`, a deed the cut left in two characters counting as one; not
  after 之, not 此为上计 or 金作马), for a cause (`CAUSE_NEXT`: 为见, 为有, 为事 + more, 为 + V + 了; 盖为 正为 今为 非为 + a clause that
  does not end on a role, 原为 + a deed), in requests (烦为转奏, 乞为明示), 各为其主, 为…之故, 为底, 为人为彻, the reasons
  counted (一为…，二为…) and the beneficiary that ends a clause (为宝玉, 为朝廷); it stays wéi for 疑为, 有为, 以备为无义人 and 为…之事
  outside the vernacular. 干 is gān for 不干 + someone + (之)事/之故, 干连, 干与国政, and an edition's 一幹人 幹紅; gàn for work (干不动,
  干惯, 直干到, 有活干, 多干), gān for what is not dry yet (…没干。) and 干坐着. 削 is xuē in 削铁如泥, 削腮, 尖削, 削削, 削峰, 如削。, 日削 and
  削了…官职 further on; 尽 is jǐn in 尽让 尽够 尽可 先尽 (even written 盡) and 别尽著; 差 is chāi when someone named in quotes is sent
  (先差『…』) and after 吏 点 蒙 委 科, chā in 无差; 将 is jiàng in 勇将 神将 猛将 and 第二路上将; 紮 is zhā before 驻 立 两 + 营寨 and
  in 收紮 紮脚; 赚 is zhuàn before 不 and money past quotes; 子 is zǐ in a surname + 子 + a courtesy name and 风流子; 相 is xiāng in 拜相送
  and 内相 + a verb; 垛 is duǒ in 箭垛 垛楼 垛叠; 背 is bèi in 背了兄长, 莫背了, 背在身后 (the hands), bēi in 背回家 and 我来背，; 也得 还得 就得 +
  what is attained (`ATTAINED`: 相逢 成佛 耳根清净) is dé, 又得 is děi before a deed and dé before what is got; 乾 is qián in 乾宫 乾上兑下
  and 王道乾; 应名 is yīng (CEDICT's yīngmíng); 就那里 is nà. From the modern novel: 一通 tòng after V了, 转 (了) 一 圈 zhuàn, 着 zháo
  after 伤 吓 累 碰 踩 找 … behind a 别 没 怕 不能, 倒 dǎo in 倒大霉 and after 按 踢 砍 …, dào when poured (把…倒在, 给她倒，), 地 de after
  哄 汗 and a phrase cut into single characters before 说 走 …, dì after 挨着, 场 cháng before rain, an illness, a dream after any number
  or 这 那, 长 cháng with adverbs between it and a time (日子 还 长着呢) and zhǎng in 长不好 长多少肉, 猫腰 máo, 待这么久 待得太久 再待一天
  dāi, 挑 tiāo after 担子 and tiǎo after a pole, 人家 rénjiā after 有些 所有 有没有 这些, 精神 jīngshen after 格外 十分 and 得来, 地道
  dìdao after 很 真 得, 一晃 yī huàng after a body unless a leap follows, 背篼 bēidōu (`RUNNING_TEXT_READINGS`), and one-offs (酸曲, 扇火,
  撒些盐, 划燃, 还回过头, 缝缝, 散了, 闷得慌, 褪到, 露着 lòu, 剥下 bāo, 冲着…喊).
  A sixth pass (tests/core/review6-fixes.test.ts) put back what a review of the fifth found worse and fixed the commonest misses of a
  second full read. 为今之计 and 宁为 are wéi, and so are 为人 (conduct, also after 但), 为恶 为善 and 为 after 显示 描述 定义; the 号 of a
  ship's name in quotes is not "styled as". In the old books 为 is wèi before the one spoken to or planned for (为将军言, 为孤图之), for
  a feeling or a gain (之忿 之利 之仇), in 正为…之事也 and before a clause that says what someone is (为甄宝玉又是晚一辈). 子 is zǐ for the
  classical son after 兄 如 诤 假 厥 哺 麟 俊, a lone 为 我 立 and a verb in 见 (父见子), and in 子书 子贵. 教 is jiào for a teaching after 其
  吾 at a clause end; 背 bèi after 依次 逐字 一字一句 …; 得 dé after 许 准 容 (not) + the one who gets to, děi in 又得 + people who wait
  on it; 仆 pū after 跌 颠 前 僵; 强 qiáng after a lone surname (a given name the lexicon missed); 什 shí between transliteration
  characters; 着 zhe in 还睡着 正睡着; 种 zhòng before so many 亩 垧 棵; 了 liǎo in 就算了事 就算了大事. `WORD_READINGS` adds 麦场 màicháng,
  长脸 chángliǎn (a book-words row) and 当天 dàngtiān.
  Rules for text Dushu was never tuned on (plan item 4, tests/core/polyphone-unseen.test.ts, invented sentences; each passed the corpus
  and tuned-book diffs and the CPP check). The rules may ask the dictionary through the context: `verb(w)` (2 when every sense of the
  word says "to …", 1 when some do; a verb + complement CEDICT lacks, 划出, counts as one), `word(w)` and `noun(w)` (a classifier
  note or a proper name). 为 written 为 (modern books): wèi when a verb follows what it is done for (为大熊猫提供, 为维基新闻撰稿, a
  verb before 的 too: 为客人准备的点心) or 而 or 的事 ends the clause; wéi when a noun phrase with no verb ends the clause (it ends on
  a 的 phrase's head, a quotation, a title, a number's unit or a noun) and a verb of naming or judging (宣布为, 诊断为) or a noun
  subject comes right before (原型为一座石桥, 中秋节（秋夕）为法定假期; not a pronoun, an adverb of "for" or a name the dictionary
  lacks), and before ： (评语为：). 以 改 称 列 较 … 为 look back past a quotation, a number, a Latin name or a 、 list (以“…”为题,
  以3310型手机为原型, 较去年的1200吨为多); digits after 为 are what something is unless what is done for it follows (而是为250公里/小时
  的列车提供服务); more verbs of becoming (定性 归纳 变更 改制 形容 成长 化身 …) and quantities (时速 体长 可能性, words in 费 额 价 值 率).
  得 dé after an adverb of the old books (遂得 始得 何得 暂得 皆得, not 皆得在/归), after a verb of getting before an amount (筹得30万美元,
  录得超过200毫米), in 得了 + a count after 一共 只 各 …, after a word of ought or never before what is got (该得什么罪, 何曾得一个闲,
  想得一点好兆头), before an illness that ends the clause after someone (露沙得极重的热病), in 并得依法 (may) and 得蒙; děi after
  到底 and opening a clause of the vernacular before 有 (得有人去看着). 地 de before a comma after a word of manner (分明地，坚决地，;
  `MANNER`) and in 出奇地; dì after a verb that makes a place (移居地 登陆地, `PLACE_OF`). 卷 juàn next to its number (卷四 as a heading,
  《因话录》卷4说, 第三卷, 10卷) and after a numeral in characters only before a written work (三卷天书, 几卷…的经; 一卷银子 juǎn). 场
  chǎng after 一 when what it counts is a game, a show, a meeting or a campaign (`EVENT`), unless weather or trouble comes first. 长
  zhǎng in 越长越大 (not after a time: 日子越长越难熬), in "older by" (比我长一辈, 长三岁) and before 回 著 男. 东西 dōngxī before 城墙
  轴线 两侧 … and before 与 南北. 中 zhòng before 举人 进士 状元 秀才 …, in 中过学, 得中, N投N中 and a clause-opening 中了. 还 huán before
  a person + 个 (还你个公道) and before 礼 (还过了礼). 甚 shén after 因 为 and ending a clause after 做 作 干 说 等 … (做甚？). 和 huó before
  好 匀 成 + dough or mud (和好的面团, also the word 和好). 儿 ér after two or more transliteration characters, one of them rare in
  Chinese words and none doubled (珀拉儿, 诺孜贝儿; 布里儿, 巴巴儿 stay erhua). 蒙 Měng beside 汉 藏 元 回 满 and in 中蒙边境; 藏 zàng
  after 蒙 汉 满 回.
  Old spellings (core/bookStyle.ts): `detectOldSpellings(chapterTexts)` reports, per book, 底 written for 的 (sure when 我底 你底 他们底 +
  a word, not 底下 底细 …, come at least 5 times and at least a fifth as often as 我的 …) and 那 written for 哪 (sure when at least 5
  questions ask with a 那 word and nothing else, and the book writes 哪里 哪个 … at most a third as often); `chooseOldSpellings(report,
  choice)` lets the reader's choice win; `withOldSpellings(lexicon, s)` spreads the lexicon with `spellings`, which segment() passes to
  `pinyinFor` as `ctx.spellings`. With `di`, a lone 底 between a word and what it has, or ending a clause after a phrase, is de (她底眼睛,
  躺着底，); the noun stays before 下 里 的 …, in a word, after a run of transliteration characters (婆多瓦底) and in a bottom that does
  something (滩底呜咽). With `na`, `asksWithNa` makes 那 那里 那个 那些 那位 那种 nǎ in a question with no other word that asks
  (你家在那里？, 你是那寺里和尚？, 差那两个去？) and opening a rhetorical one (那里还会有…。, 那有这样的道理！, 那一个不…？, 那得齐全。);
  they stay nà after someone (我那里, 在三姑娘那里), in a yes-no question (also 那里不有人来了？, and after 莫不 敢是 莫非 难道), after a verb
  that takes them (把那个碗, 将那匹大马…吃了？), when another 那 word asks (那秃驴在那里？), as 那么 那时 那是, before a title (那管营,
  那知府), in "this one … that one" (这个…，那个…), after 兀那 or 不看见, in 是那 + a deed + 的 (你是那闹天宫的孙悟空？) and in 那得 + a
  verb of depending (那得让他, nà děi; 得 is děi there in any book, 那得多少钱). When the reader turns 那 for 哪 off (`naAsWritten`), 那
  is nà everywhere, also where the rules for the old novels read 那里 nǎ (我们打那里走？). The eval path (scripts/eval/zh-shown.ts) applies
  what detection is sure of; the reader stores the report and the choice (core/fixes.ts, ui/reader/oldSpellings.ts).
  Reading model (core/readingModel.ts, plan item 7). `polyphoneRule(ctx)` tells a rule's case from the rule's own default: a rule
  returns `usual(r)` where none of its cases matched (相 传 率 宿, and the last fallback of 为 得 着 长 应 将 中 还 种 便 处 差 少 当 降 难 好
  数 量 调 重 行 都 觉 教 干 分 只 发 薄), and a character with no rule, or a rule that says nothing (藏 盛 挑 冲 转 散 系 塞 背), counts the
  same. There, for a one-character token, pinyinFor asks the model it was handed (`setReadingModel`; main.ts loads
  `data/reading-model.tsv.gz` after the dictionary, so a page drawn before it arrives has the rules' readings, and without the file
  the rules alone read everything). It is a logistic regression per character over `siteFeatures` (version 2): the tokens and
  characters up to three places on each side, the neighbors' length and verb and noun strength, how far the clause runs each way
  and its last token; every token to either end of the clause, past quotes and numbers (`A:` `B:`, which reach 为 … 所 and 以 …
  为); the rules' reading (`u:`); how many kinds of vernacular (的 着 了 呢 …) and classical (之 乎 者 也 …) tokens lie within 30
  tokens (`rv:` `rc:`); the paragraph's script as the book writes it (`sc:`, which segment() works out once per paragraph when the
  model first asks); and the character's reading in a dictionary word with its neighbor where the cut went elsewhere (`p-:`
  `p+:`). It changes a reading only to another of the character's own (its own CC-CEDICT rows and Unihan, as shown and as
  written), only for the characters the file lists, never for particles and interjections (`NOT_FOR_MODEL`: 了 得 地 的 …; 着 is not
  among them, so where its rule falls back to zhe the model may read zháo or zhuó), and only at the character's threshold
  (`threshold:数`, else the file's), which may be higher for changing it to one of its readings (`threshold:为:wei2`).
  `ReadingChooser.observe` shows the training tools every one-character place with the rules' reading and whether a case decided
  it. `scripts/train_reading_model.py` reads every place of the trained characters through the app
  (`scripts/eval/zh-reading-sites.run.ts`, a stand-in model that records `siteFeatures`) and trains on: CPP's train and dev splits
  (`.cache/raw/cpp`; Wikipedia, the right readings; never test), weight 0.5; silver labels, what a rule's own case read (never its
  default), weight 0.3 and at most 6,000 per reading of a character, in public/samples, in 22 public-domain books from Wikisource
  (1.07 million Han characters of 1920s fiction and essays and Qing and Ming novels, `scripts/data/reading-model-books.tsv`, fetched
  at pinned revisions into `.cache/raw/reading-books` by `scripts/fetch_reading_books.py`) and in 98 more (19 million Han characters
  of Ming and Qing novels, late-Qing and 1920s prose and classical texts, all first published in 1930 or earlier, read from the
  zh.wikisource dump of 2026-10-01 by the offline corpus build of 2026-11-05 into `.cache/raw/reading-books-2`; listed with each
  text's sha256 in `scripts/data/reading-model-books-2.tsv`, their pages and revisions in `reading-model-books-2-pages.tsv.gz`; of
  these only the rule-decided and hand-labeled places are kept in memory; none of the books is in the corpus or the sealed set);
  and the hand labels of `tests/corpus/zh/readings-calibration.tsv`, weight 10, less a third (by a hash of the place) kept for
  evaluation only. They are 7,953 places, 2,540 of them from the round of 2026-11-05 (below), and before
  those the first model's 734, the second's 1,469 and 3,210 of 2026-11, labeled by a native reader where the rules fell back to their default in the 98 books (2,484) and the held-out corpus (726), of 得 着 长 种 好 难 量 中
  还 差 当 应 将 处 少 降 调 重 行 便 都 觉 教 干 背 盛 挑 冲 转 散 发 分 数 只 系 塞 传 薄 藏 为: first where a model trained on the earlier
  labels would change the reading (at random among those places) and at random among the rest, then more of the places it would
  change with some confidence for the characters near the bar (`--candidates` writes such a list). The samples' defaults count
  for nothing although six reviews checked them: they hold the very misreadings the hand labels fix (遇着 zhe, 当兵，为钱 wéi).
  `--cached` reuses the last run's site files (reading all of them takes about 30 minutes; training alone about 30 seconds).
  A character's threshold is where its out-of-fold changes on the training hand labels do the most good, a right change counting
  1 and a wrong one 9 (`WRONG_COST`: what a threshold adds must be right 90% of the time; demanding every change right, as before,
  put most thresholds at the top of the grid once there were thousands of labels). It is kept only where, on the held-out third,
  it changes at least 5 readings (3 for 藏 and 数, enabled under that earlier bar: `KEPT`), at least 90% of them rightly, and gets
  more right than the rules (`ENABLED` in the script pins the outcome; `--decide` decides again, `--report` prints the table);
  then every change it makes in the held-out corpus and the tuned books is judged. On the held-out third (rules right / model
  right of the places where the model may speak, held-out changes right, threshold): 着 35/50 of 75, 15 of 15 (0.95); 长 31/45 of
  61, 14 of 14 (0.8); 中 36/47 of 66, 11 of 11 (0.95); 还 36/43 of 54, 7 of 7 (0.95); 种 37/43 of 63, 6 of 6 (0.95); 差 17/25 of 38,
  8 of 8 (0.9); 少 38/46 of 60, 9 of 10 (0.95); 好 48/62 of 79, 15 of 16 (0.9); 藏 28/34 of 41, 6 of 6 (0.85); 数 32/36 of 46, 4 of 4
  (0.7). 得 passed (38 of 41 changes right, 83 of 107 places against the rules' 46) but read the complement de as dé in modern
  novels (most of its 182 changes in the tuned books: 高兴得 + a verb, 痛得 + what follows), which the held-out third, mostly old
  books, holds few of; it stayed in `NOT_FOR_MODEL` until the round below. 都 passed once (dū for a capital and in Mongol names, 33 of 35 changes in the
  corpus and the tuned books right) but with the sites read again changed only 4 held-out places; 薄 (12 of 14), 当 (17 of 22),
  应, 量, 难, 降, 调, 重, 冲, 盛, 塞, 挑 and the rest changed too few or too wrongly. 为 retrained read wéi as wèi in modern novels
  (慈悲为怀 and the like, 40 places in the tuned books, all wrong) and was right at 5 of 24 new held-out places against the shipped
  model's 16, so the shipped model of 为 was carried unchanged (`scripts/data/reading-model-carried.tsv`, `CARRIED`, thresholds 0.8
  and 0.9 to wéi) until the round below. The first model's 24 rare characters (传 杓 相 刹 艮 率 藉 圜 裨 脯 茆 什 奔 宿 隽 苕 茄 杈 颉 槛 镝 仔 姥 畜) are trained as
  before, on CPP alone with the version 1 features and threshold 0.7, so what its review checked stays; they passed together (37
  of 37 held-out changes right). A rule case now takes 魂不着体 不着边际 不着痕迹 (zhuó after a lone 不) from 着's model, which read
  them zháo. Fairly measured (the new model fit on the training two-thirds, the shipped one as it is), the held-out labels where
  the model may speak are right at 1,166 of 1,623 places against the shipped model's 1,084 and the rules' 1,003 (the 2026-11
  labels alone: 730 of 1,071 against 672 and 653). Against 91fcabc the reader changes 50 readings of the held-out corpus (all
  right) and 29 of the tuned books (28 right: a 着 that is zhuó, "uncolored"), every one judged, 78 of 79; the silver checks go
  from 447 to 451 of 1,129; CPP strict stays at 93.33 (one-character 84.88); the file is 79 KB gzipped (265 KB, 35 characters,
  15,495 features), loaded after the dictionary as before. Where a review of every change found the first model wrong, a rule
  case speaks first (出煤率最高: a rate that is high or low is lǜ; 刹裤子 shā; 东奔西突 bēn; 什头 shén;
  谈吐隽雅 juàn; 胡茄 jiā; 木杈 chā; 为 + someone + 高兴 活着 自豪 牺牲 … is wèi, the feelings and lives of `FOR_DEED`; 藏|宝塔 cáng; a
  rate before an adverb, 返修率都在下降, lǜ). A native review of every change then found seven wrong; rule cases now speak first there
  (从长商议 and 夜复渐长 cháng, 还坐于 hái before a verb of posture, 头顶着 zhe after a verb of carrying, 善中取计 zhōng before 取 选),
  and 率 changes to shuài at 0.55 (every place of the tuned books the model leaned to shuài below 0.7 was shuài: 王浚率水兵).
  The round of 2026-11-05 followed a blind measurement of unseen text (13.4 errors per 1,000 Han characters, readings the largest
  share: 得 dé, 为, 长 zhǎng, 那 for 哪, 祇 for 只, classical senses). 2,540 more places were hand-labeled, of 得 为 那 长 将 好 还 教 舍
  着 强 给 应 祇 弄 监, where the rules fell back to their default in the texts above (most in the second set of books), 60% where a
  model trained on the earlier labels would change the reading and 40% at random, each labeled without seeing the app's reading
  (230 places labeled twice agreed every time); 那 舍 强 祇 给 监 弄 joined `COMMON`. On the held-out third: 为 is retrained, no longer
  carried (127 of 173 places, 72 of 72 changes, against the carried model's 126; 0.65, and 0.85 to wéi); 得 leaves `NOT_FOR_MODEL` at
  0.99 (169 of 268 places against the rules' 106, 63 of 63 changes; at 0.95, 36 of its 239 judged changes, most in the tuned books,
  read the complement after an adjective as dé: 痛得 乱得 + 象); 将 (0.6, 37 of 37), 祇 (0.95, 15 of 15: zhǐ where old books write
  it for 只) and 给 (0.85, 5 of 5: jǐ, to supply) are new; 着 moves to 0.85 (36 of 40), 长 to 0.85 (26 of 26), 还 to 0.9 (33 of 34).
  那 (2 of 3), 教 and 舍 (3 of 3, under the bar of 5), 监 (4 of 5), 强, 弄 and 应 did not pass; 恶 切 铺 never reach the model (a
  rule case always decides them). Every reading that changes against 84a1f5f in the held-out corpus, the last blind set and the
  tuned books (257 places) was judged blind, the two readings shown in random order: 238 better, 13 worse, 4 neither (děi,
  which the model did not offer), 2 not judged; in the public texts 132 better and 1 worse. The file is 138 KB gzipped (455 KB,
  39 characters, 27,239 features). Bump
  `READING_FEATURES_VERSION` with any change to the features (a file of another version is not used); retrain after a change to the rules or the dictionary (the word counts of other data files move the cuts
  the features see). tests/core/readingModel.test.ts checks the TypeScript's features and scores against the script's
  (tests/core/fixtures/reading-model-check.tsv, from the invented sentences of scripts/data/reading-model-check.txt), the list of
  characters the file speaks for, the per-character and per-reading thresholds, a reading of each newly enabled character and
  that a missing file leaves every reading to the rules.
  For multi-reading multi-char words (e.g. 银行 has one reading, 长大 one; 好好 several) prefer
  the entry whose defs are not "variant of"/"old variant"/surname-only, then the most common.
- `wordsAt(text, i)`: all headwords starting at i (max headword length from the data), longest
  first; always includes the single code point if Han (surrogate pairs = one char).
- `toSimplified`/`toTraditional`: OpenCC longest-match over phrases then chars. The first row for a key wins, so the rows of
  `scripts/data/t2s-extra.tsv` come first: 乾 phrases that are qián (乾坤 乾元 乾象 孫乾 …, which OpenCC's first candidate made 干坤 孙干)
  and old glyph forms OpenCC leaves alone (偸 緖 躱 値 簷 愼 吿 鬬).
- `hsk(word, pinyin?)`: `HskInfo` (`hsk3`, `hsk2`, `rank`, `of`, `elsewhere`) or null. Found under the word, the trad column, then its
  `toSimplified` form; a book's 事儿 read with a final r is the listed 事 (not 头儿 哥儿 人儿, words of their own: `HSK_OWN_ER_WORDS`).
  Without a reading (or one that is not one syllable per character, or with an old 5-column row) `hsk3` is the word's easiest
  reading, as before. With one, `hsk3` is the lowest level among the list's and same-word readings that `compareReading` (`core/hskMatch.ts`)
  finds the same (one tone each; 一 and 不 in any tone), else among those that differ only in a neutral tone, unless CC-CEDICT spells both
  readings as words of their own (东西 dōngxī "east and west" is not the list's dōngxi; 说道 shuōdào, 人家 rénjiā likewise). When none
  matches, `hsk3` is missing and, for a word found under its own simplified form, `elsewhere` lists the list's readings (教 jiào:
  jiāo 1). Through the trad column or t2s there is no hint (著 zhù, 乾 qián). `hskReadings(n)`: every reading of the list's own forms up
  to level n, and their same-word readings that are another reading rather than another neutral tone (血 xuè, not 老婆 lǎopó): the
  pinyin mode's per-character table (§5.3). `hskWords(n)`: the list's forms and their 儿-less spellings at their easiest reading, by
  level then rank ("Mark HSK 1…n as known"; known words are kept by word, so a known 行 is known as háng too).

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
  (那還了得, 十分了得) and stays 了|得 elsewhere (聽了得意); 一行 before 字 is cut (一|行|字, a line of writing). Not handled: 着落 after a
  verb (the dictionary word wins).
- Context rules from a native reading of every Chinese book (`contextScore` in segment.ts, one test each in `tests/core/segment.test.ts`;
  a rule takes 12 nats from a word where its neighbors show the text means its parts): a measure word goes with the numeral or
  demonstrative before it (两个|人, 三年|前, 几口|水, 那头|羊; `AFTER_NUMERAL_CUT`); 的话 is 的 + 话 "words" unless it closes a conditional
  clause (如果…的话，, 不去的话，); 才能 before a verb is 才 + 能; 马上 after 在/于/骑 is "on horseback"; 赶将来 is 赶 + 将 + 来; 着 after a verb is
  the particle (挥着手, 闭着眼); 回过头 is not 过头 "overdo"; a speaker before 道： keeps 道 "said" (众僧|道：, 低声|道：); 把 + 手/头/门/酒 is 把 marking
  the object; 地上/地点/地面 after a reduplication or idiom is the particle 地; a table of words that the old novels never mean in context
  (`CUT_IN_CONTEXT`, `UNLIKELY_WORDS`: 去取, 先令, 回见, 他杀了, 二人大惊, the jieba fragments 是从 我会 般地). A number in characters is one token
  (三十六, 一百零八, 二十多; not the tael in 五十两 nor 千 of 千米). Unseen dictionary nouns in 子 that the corpus barely saw (簪子, 会子) and a
  few unseen words that read wrongly as their characters (二爸, 除过, 巷道, 怎的; at a clause's start also 是以, 在下, 好在, 要不) beat the
  split into their characters.
- Numbers in characters: two digits in a row only as an estimate (三四十, 三五千, 五七百, 三二十) or the multiplication rhyme
  (七七四十九); a number never starts with 零, and the 一 after a round number goes with the measure word after it (三五千|一行).
  The second review added cuts for words whose halves belong to their neighbors (村口|才, 心头|发闷, 即使|用, 点火|烧, 作|保山,
  大|官人, 天台|上, 口水|滴), 人大 is cut only before 大X words (二人大惊) and kept as the congress, 个人 stays "personal" after
  是/有 before 的 or a noun it qualifies, and a lexicon name that both neighbors claim (青|海民|歌) is not boosted.
  The fourth review: 是以 + 他 她 这 opening a clause stays "therefore" unless the clause says "by" (为, 方式, 形式); 人大 after 的 is cut;
  长枪|声 (not 枪声 after 长); 的话 needs a comma to be "if" after 有 没有 是 …, and 要说…的话， is "if"; 对于…来说 keeps 来说; 要不来晚了
  keeps 要不 "otherwise"; 才能 + 不 + a verb is 才 + 能; 使 + 将来的 is the future; a multiplication rhyme (三六十八, 二五一十) is one
  number; and `CUT_IN_CONTEXT` cuts modern words the older books never mean (纵马来迎, 回头见他, 关上门, 往火里加, 由内向外, 和田家, 几口才,
  能耐饥, 问及时, 大海里, 不大会, 自称心, 些微云, 人生活, 扭转头来往, 四大步, 三十分开, 物外长年, 下首相陪, 节用而爱人, 不好犯上, 以礼节之).
  `book-words.tsv` gives counts to old words the corpus never saw (刺配, 军州, 押司, 柳枝, 杨柳枝, 科斗, 发见, 道台, 彷佛) and to a few names
  (张翼德, 鲁镇, 咸亨, 张果老), and 明公 is in `UNSEEN_BUT_MEANT`.
  马上 is 马 + 上 "on horseback" (`onHorseback`) after a horse (一匹马上, 青騣马上), before what only a rider does in the old novels
  (欠身 施礼 撚弓 心惊 惯使 坐著 …) or a rider (马上两人, 马上一员骁将, 马上骑着两个人), after a column place (当先 为首 上首 …), and when a
  clause ends on it after a word (两匹马上，, 绑在了马上。); 她马上就到, 马上！ and 我马上。 stay "at once".
- The native read of a modern novel (tests in `tests/core/segment-read.test.ts`, invented sentences): the emphatic 可 inside a
  clause is cut from 可不 / 可不是 / 可好 (老猫可不爱吃, 这花猫可不是我养的, 这回可好了), while a reply or exclamation opening the
  sentence and a rhetorical question keep 可不 / 可不是; 来说 来看 来时 来往 after a directional verb (踱过来说, 侧过身来看, 跑出来时)
  are cut; X来X去 is one token only when a dictionary lists it, else nothing crosses it; 走时 过时 after a verb are V + 时; 还不快,
  就算了 / 就算是 "that counts as", 往后 "backwards" before a movement or a place, 两头 before an animal, 七个多月, 头羊 after a verb
  or 多, 那张嘴, 点着头 吸着烟 还睡着, 手提着, 月光照, 一心想, 等于是, 睁眼看, 人种 人命 after 一个, the comparative 大 (大多了,
  大四五岁), 能干 + the work, 哈|哈腰 (AAB of a verb-object word), and a table of one-off pairs. A jieba fragment in 里/上 (房里, 背上)
  or 心里 gives up the character before when that character makes a common word with its first one (产房|里, 手心|里), unless the
  character already ends a word or a lexicon name. A foreign name written with a middle dot joins the transliteration characters on
  each side (杰西卡·莫兰). 分上 is joined after 看/瞧/于 ("for the sake of"). `book-words.tsv` gives the literal sense first to 不想
  要说 来看 来说 好些 要死 说好 穿过 一来 and counts to dictionary words the corpus never saw (村口 做声 麦田 窝棚 晒场 这一来 …).
- The sixth pass (tests/core/review6-fixes.test.ts): a numeral and its measure word that the dictionary lists only as another word
  are cut where the measure is meant: 一口 before a pot, a well, a coffin, a blade or a pig (`KOU_THINGS`; 一口答应 stays), 一手 before
  what one hand does (`ONE_HAND_DOES`; 一手造成 stays), 一家 before a shop or a firm (`JIA_FIRMS`), 一面 before a mirror, a flag or a gong,
  一轮 before a sun or a moon, 几点 before drops and dots or after 零星 (几点回来？ stays), and 两头 before an animal up to three characters
  on (`ANIMAL_SOON`). 就让 is always 就 + 让; 眼泪汪汪 is 眼泪 + 汪汪 (not after 两眼); 怕人 before a verb is 怕 + 人; 也好 before 叫 让 使 教 is
  也 + 好; 来时 after a directional verb and its object is cut (掏出钱来时); 老是 "always" and 年月 "these times" (not before 日) are
  joined though the corpus never counted them, 老是 not after a surname or 大 黑 (高老是); 方桌 and 供桌 are words; 当天 after a sun or a
  moon is 当 + 天. Narrowed: 月白 is the colour only before a cloth, a garment, 色 素 的 or after 件 穿 着 上 (天清月白 is 月 + 白); 过时 after 而
  is cut only after a motion; 吊死 after 上 is kept when 在 于 从 到 came before (在房梁上吊死); 可不枉 in a question is 可 + 不 + 枉; 人才
  stays before 出众 荟萃 虽 齐 and after 识 得 般; 怪道 before a colon is 怪 + 道; 云游僧道： keeps 僧道; 他娘的 after 是 at a clause end is
  his mother's; 就算了事 is 就 + 算 + 了事.
- Cutting rules for unseen text (plan item 6, tests in `tests/core/segment-cuts.test.ts`, invented sentences): a number in digits
  before the run counts like a numeral, so 1978|年|前, 10|日|间, 2001|年|关校 and 3|个|人 (年头 only before a number, 年间 only after
  digits); two neighboring digits before a measure word are one rough number (两三|月, 八九|天, 三两|天; not 十有八九, nor inside
  五二三项目); a fraction is one number (二十四分之一, 百分之三点五, 十分之八九; 十分之好 and 千分之七十|一样 stay); 东至 is 东 + 至
  except before 县; a word for a kind of person in 人 takes 们 (女人|们, 老妇人|们; not 这时|人们, 让人们, 背景下|人们); a place
  word in 里/外 gives its first character to a common word before it (山村|里, 大门|外, 小屋|里; not 中外 格外 心里, 城内|城外);
  人大 after a place name stays (中國|人大|網); a word the page writes with 著 has its 着 spelling's rules (跟随|著). A word the
  corpus never saw loses its floor where its neighbors take it (`floorBelongsToNeighbors` and `unseenScore`): a verb and its object
  in 子 (割|稻子), a verb of motion before 中 里 (到|庭中), 过 after a verb before a thing (尿|过|床), 所 before a verb (如公|所言),
  the adverb 倒 (倒|弄得), 相 before a verb (一掌|相攻), 亦即 before a verb, a deed's measure after a digit (一|步走, 一|手扶起), 上
  下 after 朝 or a noun that takes them (朝|上|礼拜, 车上|绑), a preposition before a counted word (在|户外). A town that is only a
  town gets the floor where it fills an item of a 、 list (新竹、草屯、嘉义). 阿 or 小 + one capital letter, and a lexicon word that
  runs on into Latin letters, are one token (阿Q, 小D, 阿Quei), and a ·-name stops at a lexicon word on its side. 们 does not make a
  plural after 何 莫 不 + 怪 (何怪|人们); 上边 is not taken from 楼上 before 街 屋 房 … (楼上|边街); a rule that cuts before a character
  does not hold where that character opens a lexicon word (今天|子君); after a town, a village, an island or a hill of the lexicon, 上
  is its side (白杨镇|上|学得), and in a book that writes 底 for 的 a verb + 底 is cut before a noun (所见|底|山水).
- Traditional text segments exactly as well as simplified (both scripts are in `words`).
- `segment(text, dict, lexicon?, ruby?, orig?)`: `orig` is the paragraph as the book spells it when `text` is its conversion to the
  other script character for character (same UTF-16 offsets; `ui/reader/shown.ts` `originalBeside` checks). Words are cut in `text`;
  `pinyinFor` gets `{prev, next, after, line, at, orig}` (`line`/`at`: the paragraph's token texts and this token's index), so the
  reading rules see 為 乾 盡 髮 where a simplified page shows 为 干 尽 发. With a lexicon it also gets `named`, the kind of a token of
  the paragraph that the lexicon holds (asked in simplified): a place or term of the book before 为 is a subject, and any of its
  names ending the clause after 为 a noun, so 钱唐郡为杭州 and 队长为王磊） stay wéi when the name list joins the name (a person
  before 为 still is not: 王小林为大家做饭).
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
- EPUB/HTML set out one printed line per `<p>` (blank `<p>`s between paragraphs, a book typed in from print): when at least 20 lines
  fill one width and most of them are prose (a mark inside the line), a line that fills the width runs on into the next `<p>`
  (`detectLineWrapWidth`, `wrapsOn` in chapters.ts; IMPORT_VERSION 3). A line longer than the width, an indented line, a heading, a
  rule, site junk or a blank `<p>` ends the paragraph, and so does a sentence end at the end of the line followed by an opening
  quotation mark (a new speaker, where the typist left out the blank) and a short line without a mark that the document sets out
  three times or more (its scene break); verse set one line per `<p>` stays as it is. Decided per document, so a short last file of such
  a book stays as it is, and a paragraph a file boundary cuts stays cut.
- Damaged and odd files (plan item 1, new imports only: the owner's eight books and the 105 classics import the same with them, so
  IMPORT_VERSION stayed 3):
  - **UTF-8 with bad bytes** (`decodeText`): when at least 99.9% of the non-ASCII characters decode, or at least 90% and the result reads
    better than every legacy candidate, the file is UTF-8 read non-fatally. A line whose bad bytes read cleanly as GB18030 (a line pasted
    in from a GBK file) is read so; other bad bytes show as U+FFFD; a character cut off at the very end is left out. The count comes back
    as `Decoded.unreadable`, and TXT, HTML, Markdown and EPUB put "N characters could not be read and show as �." in
    `ImportedBook.warnings` (not stored), which the library shows as a notice beside "Added" (`ui/library/importer.ts`).
  - **Radicals from Mac PDFs** (`import/radicals.ts`, data by `scripts/build_radicals.py`): a PDF printed on a Mac names many glyphs by
    Kangxi or CJK radicals (⼀ for 一). PDF text items map the one-way radicals and the vertical punctuation forms (︐ ﹃ …) at once
    (`pdfCharacters`), so lines and headings read right; `finish()` maps every radical in running text (beside a character, a mark or a
    radical) one character at a time, never NFKC on strings. The two-way ones (⼜ is 口 in Songti SC, 又 elsewhere; ⼲ 广, ⾶ 飘, ⺴ 网 in
    Heiti) follow what the book shows of its font (又 left alone means ⼜ is 口; 口 or ⼝ present means ⼜ is 又), else the dictionary
    words they make with their neighbours. Narrow spaces inside a justified line (narrower than half an em) are dropped; a heading's
    wide space stays. A paragraph running from one column into the next is joined, as across a page.
  - **Headings**: 【第N章】 (and [ ] 〔 〕), a "正文 " or Markdown "## " before the marker (both dropped from the title), sections
    numbered and titled on their own line (一、序, 1. 序, （三）风波: three or more counting up from one, a title of at most 20
    characters that is not a sentence, at least 20 Han between two of them and 200 on average; the longer run wins over bare numerals),
    and two or more "## " lines in a text file. An EPUB with one content file and at most one contents entry (a converter's book,
    the entry often "正文") gets its chapters from its text the same way (`chaptersByTextHeadings`).
  - **Ads**: `cutAdTail` cuts "（更多精彩请访问 www…）" and 求月票/求推荐/求收藏/求订阅/求打赏 off the end of a line of the story
    instead of dropping the line (`storyPart` for TXT lines, `storyText` for paragraphs of every format); a line of such calls alone is
    junk.
  - **Hard wraps**: a TXT cut at exactly its width (`wrapsExactly`: nearly every long line is exactly that long) runs a line on only when it
    is that long; in a text that does not indent its paragraphs, a line that ends a sentence followed by an opening quotation mark starts
    a paragraph. An EPUB `<br>` line that starts with the full-width indent starts a paragraph.
  - **Big5-HKSCS**: a decoder that keeps the old Big5 user-defined area (Node's, some others) gives Hong Kong's characters as private-use
    code points; `withHongKongCharacters` maps them back for TXT, HTML and EPUB files decoded as Big5 (`import/hkscs.ts`, 5,054
    characters, a lazy 18 KB chunk; made by `scripts/build-hkscs.mjs` from the WHATWG Encoding Standard's index-big5, CC BY 4.0).
  - **Ciphertext EPUB without `encryption.xml`**: when at least half the content files do not open with "<" and hold control bytes
    (`looksEncrypted`), the DRM message is thrown.
  - **Scanned PDF with a line of text per page** (a library's stamp, a page number): when under 10 Han per page are left after the
    repeated lines go, and most of up to five sparse pages (under 50 characters) paint an image, the scanned-PDF message is thrown.
  - Tests: `tests/import/suite.test.ts` builds 80 kinds of file (encodings, heading styles, wraps, site junk, EPUB layouts, Kindle, Mac
    PDFs, DRM) from public/samples in the test and checks the text each must give; kinds still short of it say what (`gap`).
    `tests/import/plan-fixes.test.ts` checks each fix on its own.
- IMPORT_VERSION 4: Project Gutenberg books and others like them are cut differently. Printed title pages (any case, up to 16
  lines, a year in brackets or an imprint, an author page before them), credit-only pages, contents lists made of links, contents
  pages in plain lines and contents labels run together are dropped; drop-cap letters join their word and captions leave headings;
  Gutenberg's header, footer and their leftovers go; its plain-text Chinese conversions are cut at their 第N回 lines or by size; a
  `<p>` of indented lines is split at the indents; a chapter's number set before its heading joins it.
- Raising `IMPORT_VERSION` re-imports the books the library can fetch again (`ui/library/upgrade.ts`): the Mac's books from the Mac (a
  device that cannot reach the Mac takes the file the Mac put in the sync account, `accountFileOf` in core/cloudBooks.ts) and
  the classics from the site, one at a time once the library has the Mac's list (a file from the account that does not import is not
  downloaded again for a day). `store.books.replace` keeps the id, name, notes, history and a cover given by `setCover` (the Mac's
  picture, a classic's painting). When the new chapters are the same as the stored ones it leaves the place and the bookmarks as they
  are; otherwise it moves them to the same Han character (`core/place.ts`), and a bookmark that moved takes the book's new key (one
  still at the same block and offset keeps its key, so a device with the old chapters still shows it). Cover picks
  (`ui/library/coverStyle.ts`) and the Mac's pictures in the account (`scripts/account-books.ts`) stay under the key they were made
  under (`olderKeys`); a device shows the picture put in the account last. Sync names an upgraded book with its version
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
  vocab, known, progress, reviews, lexicon, bookmarks?, lookups? }` — books are not included (they can be big); say so in the UI.
  Bookmarks carry their book's sync key, so one restored before its book comes back lands on the book when it is added; reading
  activity is not in it. The file is named `lingupengu-<language>-backup-<local date>.json`; the JSON still says `app: 'dushu'`.

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
- `account`: Qwen3 30B through the sync account (`src/translate/account.ts`, `POST /ai/translate`), for anyone signed in. Free: see
  the Workers AI note under the sync account. Local only turns it off; a 429 or a missing model makes automatic mode skip it for 10 minutes.
- `mymemory`: `https://api.mymemory.translated.net/get?q=…&langpair=zh-CN|en` (no email
  param, ever). 500-char chunks. Free tier ~5k chars/day — report quota errors plainly.
- `gloss`: always available, offline: segment + first definition of each word, joined
  "word (pinyin): gloss · …". Used when nothing else is.
- `local`: on the owner's Mac only, call an installed Ollama model over loopback for a sentence
  translation or explanation. Word cards may request a separate contextual suggestion, always
  marked as fallible AI and never substituted for dictionary entries.
- `pickTranslator` with `auto`: Claude (skipped under Local only) → evaluated local Qwen3.5 9B → Qwen through the account (signed in, not
  Local only) → ready Chrome → smaller local model → Chrome download → gloss. Claude through the Mac comes first when it is ready and Local only is off. (MyMemory sends text to a third party, so auto never picks it; the user opts in.)
  The Translator API's availability values are available/downloadable/downloading/unavailable; chrome.ts maps them to
  yes/download/no. In the `download` state only a click can start the download: the UI casts to `ChromeTranslator`
  and calls `prepare(onProgress)` inside its click handler. In that state the phrase popup also shows the offline
  gloss so it is never empty. Claude and the local model can produce explain-style notes. `listTranslators(settings, dict)` and
  `TRANSLATOR_IDS` are exported for the Settings screen. Abort errors are `DOMException` named AbortError: ignore them.

**The language translated into** is the reader's choice (Settings > Translation > Translate into, `settings.translateTo`, English by
default). `translate/targets.ts` lists the 45 languages (code, English and native names, scripts) and is the one allowlist the browser,
the Mac bridge and the Worker share: `TranslateRequest.to` carries a listed code, absent for English, so a request into English, its
prompt and its checks are byte for byte what they were before (`tests/fixtures/translate/english-default.json`). A code that is not
listed, or is the book's own language (`zh`/`zh-Hant` for a Chinese book, `es` for a Spanish one), means English, and the list in
Settings hides the book's own language. The prompts name the target by its English name ("into Spanish", answers and Explain bullets
in Spanish); Chrome asks for the pair (one model per pair, `zh>fr`); MyMemory's langpair ends in it (`zh-CN|zh-TW` for Chinese); the
gloss stays English and is labeled "Word by word, in English". Into another language `checkTranslation` runs only the checks that
hold in any language (an empty answer, numbers of three or more digits in any script's digits and grouping, or counted in ten
thousands where the target counts that way, the source's script left over where the target writes another one, for an alphabet a word
the source has and not one in capitals such as a Roman numeral, tone-numbered pinyin, extra paragraphs), not the English ones. Each library has its own settings, but this
one is mirrored to `dushu.translate-to.v1` (`{to, at}`, `at` when it was chosen), which every library reads when it opens, so it
follows the reader, and which Chinese "Erase all data" leaves for the other libraries. It also syncs (`o:translateTo`), stamped with
`at` (`SettingsStore.chosenAt`): only the Chinese library syncs, and it may notice a choice made in another library days later, when
a newer one from another device must still win. Older devices ignore the name; an older hub drops it without echoing it, and a device
keeps any `o:` record a hub did not echo unsent until a hub keeps it. Servers echo the target they used (`claudeServer.ts targetEcho`):
an answer with no echo to a request that sent `to` came from a server older than the choice and is labeled as English. Into a
Latin-script language Chinese names are pinyin, except Vietnamese, which reads them the Sino-Vietnamese way (`pinyinNames: false`).

**A word card's meanings in the reader's language** (`translate/meanings.ts`, `ui/popup/meanings.ts`). The dictionaries explain words in
English (CC-CEDICT, JMdict, Wiktionary), or in Chinese in the English library (ECDICT, `dictionaryLanguage`). When the reader's language
(the sentences' target, `targetFor(settings.translateTo, lang)`) is another one, each sense line the card shows gets a machine
translation of its glosses on top, `span.pp-def-tl` with the target's `lang` (and `dir` for a right-to-left one), and the dictionary's
own words stay in the line as `span.pp-def-src`, set small and muted under it, cross-references still links: the original is the
authority, since a one-word gloss can be put into the wrong sense. A line under the meanings (`.pp-mt`) says "Machine translation into
French by Chrome on-device. The dictionary's English is under each meaning", or carries the button, the progress or the error with Try
again. The part of speech, the notes in parentheses, levels, gender, readings and the headword are never sent; only the glosses. The
pair is the dictionary's language into the reader's (en>fr for a French reader of Spanish books, zh>ko for a Korean reader of English
ones), not the book's: `chromePair(source, target)` and `myMemoryText(text, from, to)` take it, and the Claude and account translators
take a `source` (`ClaudeDeps.source`, `createAccountTranslator(settings, source)`) and send it as a book in that language would (`lang:
'en'`, none for Chinese), with `to`. Nothing changes on the servers: they already take `lang: 'en'` and `to`. Nothing is translated when
the reader's language is the dictionary's (English for an English reader of Spanish; Chinese, either script, in the English library).
- Translators, in order (`meaningOrder`): Chrome on the device (free, private), the reader's chosen online one, Qwen through the
  account, Claude (the owner's, which costs money). MyMemory only when it is the chosen sentence translator, as Automatic never picks it.
  Local only leaves Chrome alone. The Mac's Ollama model and the gloss are not used.
- When (`settings.translateMeanings`, Settings › Lookup › Meanings in your language; this device's, not synced, since it depends on
  what the browser has): `auto` (the default) translates at once only with Chrome when its pair is ready, and offers any other (or
  Chrome's one-time download, which needs a click) on a button, "Meanings in French"; `always` runs the first ready one at once, online
  too; `ask` always waits for the button; `never` shows the dictionary as it is and asks no translator anything. A click on the
  button counts for the rest of that card: senses shown later go to the same translator without asking again.
- Batches: senses behind "N more" are translated when shown, not before. Chrome translates each sense in its own call (on the device,
  no requests to save). MyMemory too: its limit counts characters, not requests, and its memory matches whole segments. Claude and
  the account get one request per card, the senses as numbered lines (`numbered`, split back by `unnumbered`, which accepts the
  numbers in any digits and refuses an answer that merged, dropped or repeated a sense), in runs under the account's 600 characters.
  An answer in another language than asked (a server from before `to`) is refused.
- Cache: `dushu.meanings.v1` in localStorage, [key, translation] pairs by translator, pair and text, at most 2,000 entries and 150,000
  characters, the oldest dropped first and a meaning used again moved to the end. A card fills from it at once, from any translator's
  earlier answer (they cost nothing to show again), before it opens. Storage blocked keeps it for the visit.

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
Real novels are full of words no dictionary has: character names (王熙凤, 林冲),
places, martial-arts and period terms. Without help they split into single
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
  explains them (洪七 inside 洪七公). On the owner's long wuxia novel this gives 139 entries: 89 names, 29 terms and 21 places; on his short modern novel 13; on the
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
  an idle moment and works in 10 ms slices, so no task is longer than a frame. Known misses: 小紅 (too rare).
- Detection v6 (`DETECTOR_VERSION` 6): a speaker string that makes a word with the verb after it (操大+笑, 替天行+道) does not count, except that
  道 alone does not disqualify a last character (王夫人道). Strings that open with 谓/此/转 or a doubled character are phrases. A final pass
  (`boundaries()`) checks each entry against its neighbors: a name whose usual next character makes a more frequent word with it (大兒|子), or an
  entry whose usual previous character does (拍|馬舞刀), is dropped, as is one that often cuts a dictionary person name (曹|操大, 吳主孫|權) or wraps
  one in a title (先鋒使宋江). A dictionary proper noun that holds a found name (關雲長 around 雲長, 孫悟空 around 悟空) is added with its dictionary
  reading. On the four classics: 11 false entries dropped, 10 real names added, none lost.
- Detection v7 (`DETECTOR_VERSION` 7). The judge: a modifier before a word for a kind of person (老木匠, 小舅妈, 外祖母) is a description; a
  word the book uses on its own far more often plus one character (白玉珪) is not a surname and a given name; a pair that is spoken to and
  speaks now and then (春桃), a surname and a numeral that speaks or is sent (张三), a surname with a kinship title (赵大奶奶) and a final 和 held by
  the character before it are names; a three-character role in 者/人 (守塔人), a bound pair that never speaks (青崖) and a CEDICT word the corpus
  never saw that the book uses once in a thousand characters are terms; a two-character town in 城村镇岛寨 and X湾/沟/屯/坪 are places; a 道 that
  starts 道士/道人 is not speech; a corpus-known name whose dictionary reading is wrong is added for its reading. `family()` (after `boundaries()`,
  whose checks then run on what it adds): the full name of a found name when one surname stands before it often (婆惜 → 閻婆惜); a found two-character
  "name" that follows two or more surnames is a title and becomes a term (提轄 after 魯 and 孫), the officers stay names; brothers that share a
  surname and middle character; the given name of a full name used alone (林如海 → 如海, glossed "short for 林如海"), unless it cuts words at its
  edges, follows other surnames, ends in a title or kinship character or is half of a foreign name; a given name that is a dictionary word also
  needs a non-person sense, a full name that speaks or is spoken to, the surname before it in a quarter of its uses and six times the corpus
  rate (its card keeps the word's meaning); and the household 单家/曾家 of a surname with its own reading. An entry that is usually the tail of a
  longer dictionary word (大|鬧天宮) is dropped. A text under 20,000 Han characters is also read at three sightings, keeping only strings whose
  characters are never apart that end like a place (白马湖, 百草园, 邓脱路) or are a surname and a name that is spoken to (仲密).
  The judge also drops noble titles in 侯 (关内侯), strings of 5+ characters that open with a verb (刺配远恶军州) and a surname-led
  triple whose first two characters are a common word and that never speaks (杨柳枝).
  The third review added a statistic, `voc`: the share of a string's uses that open what someone says and are followed by a comma or
  an exclamation (“苇官，…”). A bound pair called out a third of the time is a person even when it ends like an office or opens with a
  numeral (苇官, 四毛; interjections such as 嗳哟 are not); a surname, a numeral or a trait before a nickname's tail (麻子 脖子 乱子 瘸子 …)
  whose first two characters are never apart and that is spoken to is a person (灰脖子, 牛麻子, 七乱子); a bound string of four or more
  characters that opens with a surname character but not with a dictionary word is a foreign word, not a surname and a given name
  (沙达拉威, but not 柴油机厂); and a name the book follows with 公主 in 3% of its uses reads without the surname table (华蓁公主: Huá).
  Detection v8 (`DETECTOR_VERSION` 8) finds rarer people. A full name is also added at three sightings when no other surname ever stands before the
  given name, the given name is a plain two-character one and the characters before the full name vary (金桂 → 夏金桂, 代儒 → 賈代儒;
  not the end of a nickname, 九紋龍 + 史進, nor a heading after a numeral). The last character of a main character's name, where no
  name found holds it, that stands mostly in one other pair free on both sides makes that pair a name (马岱 → 刘岱, 解珍 → 费珍).
  A surname and two characters whose first two never stand alone may end in 才 (邹永才, with 才 an `EDGE_STOP` character, `headBound`).
  A surname and one character never apart, both rare (pmi ≥ 8), seen ten times and free on the right is a person even when it never
  speaks, and its left side may be all marks (`open` ≥ 0.8: it opens a clause each time). The household rule also covers X家 that the
  dictionary knows only as a town or a village (段家, glossed "the 段 family"), not 墨家 or 苗家. On the 24 books: 15 entries added, none wrong.
  `pinyinOf` reads the surname alone (梁子安 is not 梁子 + 安), 发 fā, 兴 xīng, 冠 guàn, 都 dū, 乾 qián in a name, 术 zhú in a name with no
  Chinese surname, an office in 长 zhǎng (支队长) and a temple in 观 guàn; only a doubled kinship character is neutral (李师师 keeps shī).
- Detection v10 (`DETECTOR_VERSION` 10, plan item 3 "names v9", tests in `tests/core/names-v9.test.ts`) is for books it was never tuned on.
  - **Names that repeat a lot** (`judgeRepeat`, asked after the other judges turn a string down). A short text cannot give a frequent name
    the pmi a long book gives it, so candidates also carry `npmi` (pmi over its ceiling ln(chars / count): near 1 when the parts are never
    apart). Accepted: a pair never apart seen 8 times in a short text or 12 in a long one, free on both sides (敏明; 子君 though 君 ends an
    office; a surname-led pair is a person only with a person's signs, so 石凳-like things stay terms, and an office in a long book
    stays a term: 郡侯); a surname and one character that is a person in a long book (李静: spoken to and speaking, bind ≥ 0.45, free on
    both sides); 阿 + a name (阿随, not 阿母); a pet name in 儿 that is called out, speaks or is spoken to and is free on the left (孝儿;
    jieba may know it whole and read r; not 打|盹儿, 金|钏儿); a nickname in 子 never apart and treated as a person (祥子, 小福子, read with a
    neutral 子; not 小牢子: 牢子 is a word); a given name and a kinship word (附姐); a foreign name made only of `TRANSLIT_CHARS`
    (`names.ts`: 拉希姆, 贝莱赫斯特); in a short text a surname and two characters seen three times that open clauses (张雪峰, so a news
    story of 100 Han characters or more is read too); and a dictionary word the book uses hundreds of times more often than other
    text, never apart, ordered about or addressed a quarter of the time (沙龙 the sorcerer; its card keeps "salon").
  - **One sighting with a cue** (`cued`, after `family()`, so a name seen once never seeds a family): a title before a surname-led name
    (部长盛光祖表示: two characters when a word that follows names comes right after, else three; not 总理李克|强 when the three are a
    dictionary name, nor a known person and the next character, 凤姐忙); a verb of reporting after a name that opens a clause (夏志清认为);
    先生 女士 小姐 after a full name; 名叫 绰号 花名 … (`NAMED`, `NICKNAMED`) and 叫做 唤做 取名 … (`CALLED`: in the old novels these name
    anything, so a surname-led string after them is a person only unquoted, a quoted one is a term, 这一招叫做“…”); the Han text before a
    gloss in Latin letters or a language (睿铁（RAIL.ONE）, 嘉俳日（韩语：…）; not two dictionary words, 波兰饺子); an actor's credit
    （周一围饰）; a storm (飓风文斯, glossed "name of a storm"); a 、 list after 有： whose items are all surname-led names or dictionary
    persons (not 石碗、石盆、石床); an era name before its year from `ERA_NAMES` (Wikidata, CC0: 泰常八年); in a text under 100,000 Han
    characters a street, bridge, lake, hill or building after a word of going or before a locative (过了德胜桥, 白云楼上; not where the ending
    makes a word with the character before, 大楼 西湖, nor a quantity, a verb or a dictionary word seen once, 许多路 遥望山 对面大街); two
    one-character city names before a railway (武广客运专线; 沈 shěn); both halves of a foreign name around · • ‧ ・ (奎登·德拉尔, so 德拉尔
    alone joins; the given name that opens a clause, 旺加里; never the next word, 贾诺维奇|因); and 阿 小 老 + a capital letter seen three times
    (阿Q, 小D, 阿Quei: segment.ts keeps them one token; `lexiconInScript` keeps them though their pinyin has a syllable for the Han
    character only). An era name is added only where the book writes it before a year at least as often as elsewhere (天会二年 once,
    明天会下雨 everywhere else: no entry); a nickname (绰号 外号 诨名 花名) reads its first character as written, not as a surname (外号“盖九
    州”: gài), and is none when it opens with an adverb (绰号尚悬空).
  - **Anthologies** (`perChapter`): when fewer than half of the chapters hold any person the whole book found and most chapters are short,
    each chapter of 150 to 20,000 Han characters is also read alone with the short-text rules (a name seen four times in one story).
  - Everything a cue or a chapter adds is checked against the whole book by `boundaries()`, which also drops a place or a term that runs
    on, nine times in ten or more, into a dictionary word made with its last character (京津城 before 际 and 铁: 京津|城际, 京津|城铁). A
    transliteration in 儿 whose first characters are never seen without the 儿 is bound enough at a lower npmi (珀拉儿). `pinyinOf` reads 少 shào in a name or a place
    (赵少华, 少华山) and 沈 Shěn as a surname; a transliteration ends in 儿 ér. On the held-out corpus the silver checks went from 125 to 261
    right (no check broken); on the 25 tuned books about 320 entries were added, each read in context, and none removed. Detection is about
    10% slower on a 900,000-character novel (the cues scan the text once each).
- Detection v11 (`DETECTOR_VERSION` 11, plan item 8 "gazetteer", tests in `tests/core/gazetteer.test.ts`).
  - **The name list** (`core/gazetteer.ts`, `public/data/names.tsv.gz`, §3: 580,161 people, places and organizations with a Chinese
    Wikipedia article, from Wikidata, CC0). `parseGazetteer(text)` keeps it in typed arrays (one string of all names, offsets, an
    open-addressing hash table, and the name lengths by the hash of their first two characters, so a scan of 920,000 characters takes
    about 30 ms); `loadGazetteer()` fetches it once per session and gives null when it cannot (offline before it was ever stored, an
    old deployment, a file whose `# format` is not 1). `loadLexicon` fetches it in the background job, never for the first page; the
    service worker stores it the first time instead of precaching it (`LAZY_DATA` in vite.config.ts). A book read without the list
    is stored at `WITHOUT_LIST` (10.5) and read again the first time the list can be had.
  - **`listed()`** runs last in `detectGen` (after `princesses()`; whole books only, not one chapter of an anthology): every listed
    string in the text, folded one character at a time as the list was built. A sighting is unclean when a dictionary word crosses an
    edge (国王平定 holds 王平; a common word there, count 100 or more, rules the string out for the book), another listed name overlaps
    it, a found entry holds it or runs across its edge or fills it but one character (史进|道), or it ends in a verb of speech before
    what is said (丹墀道：「). More than a fifth unclean: not taken. A clean sighting must also stand free at both edges: a mark, a
    dictionary word ending before it (主簿|阎象) or a common word after it, a character that opens or closes a name (在 的 和 …;
    `AFTER_NAME`; a locative or 人 after a place), a name dot (昌西·比卢普斯, also 三体's full stop), or for three characters and more
    any common character (遗民|朱舜水, 宫泽理惠|演过), but not after 小 老 阿 (小骚达子), not before a noun after a name in 之 (贺敬之礼),
    nor inside a couplet of verse (two lines of five or seven characters, a comma between them and a stop around: 翠鬓笼松|楚岫云); not
    where the characters around belong to a longer name (陈少|霖, 阿姆斯特|丹, 达摩|克利斯, 三|四里路). A cue that says the kind frees its own side: a title before a person (`LIST_TITLES`: 画家, 太守, 主簿 …), a
    verb of speech, 先生, a life in brackets after one, a word of going before a place (位于, 前往). Then: three characters or more
    are taken at one free sighting, unless they look like a phrase (a locative at the end, 湾子里; a verb at the start, 跟谁学; a
    repeated character in a place, 楼外楼, or two words ending in the same one in a person, 大爷二爷; a dictionary word and one character
    more, 近卫队, 希望之火; a rule of the five phases, 金克木; a dictionary verb at the start of a place with no place ending, 威震天南; a
    pronoun in a person, 任我行; a kind of being seen once, 赤发鬼; lunar mansions beside more of them, 井鬼柳星张翼轸), which needs such a cue; two
    characters need such a cue at half their sightings and, for a person, a surname, or else a surname and a rare given name (戴嵩,
    周昉: count 500 or less) or a place with a rare character and a word of going (到阳羡). Of two listed names where one is the
    other and one character more, the shorter wins when the character is a verb of speech or a word after a name, or the shorter
    stands alone twice as often (李恢|先). A cue's three-character person whose last character is a verb gives way to a listed
    two-character one (画家戴嵩画的牛: 戴嵩, not 戴嵩画). Kinds: a person is a name (pinyinOf with the surname tables), a place or an
    organization is a place (read through its words and the book's entries, so 秦沈客运专线 keeps the shěn of 秦沈), anything else is a
    term; beside a name dot, a person. Glosses: "name (person)", "place name", "name of an organization", "name (Wikipedia)"; a
    place or an organization that no cue and no ending confirms (马塞洛, a footballer the list has as a place) gets "name (Wikipedia)".
    listed() checks its own neighbors, so boundaries() and princesses() do not read its entries again.
  - **Readings by shape** (`shapeReadings` after `pinyinOf` and a place's words, names.ts tables): a lunar mansion (斗木獬 dǒu, 参水猿
    shēn); 不 in a three-character name the dictionary lacks is bù (速不台; the X不Y neutral 不 is a verb's); a khan at the end of a
    name (塔阳汗 hán); hair after a color (赤发鬼 fà), and a traditional form keeps its own reading over `NAME_CHAR_READINGS` (髮 is only
    fà); 小 or 老 + one character + 子 is a neutral nickname (小安子); given names that read as a whole (`NAME_PIECE_READINGS`: 郦食其
    Yìjī, 金日磾 Mìdī, 金兀术 Wùzhú, 司马相如 Xiàngrú) and given-name characters (`PERSON_CHAR_READINGS`: 陈蕃 Fān, 孛 Bó); in a place, Tibet
    at the end (乌斯藏 zàng), Xiamen at the start (厦深铁路 xià), 苕溪 tiáo, the surname 薄 Bó at the start. A two-character name whose
    second character makes a title with the next (刘先|主 against 刘|先主, in a heading detection never read) is not boosted in
    `segment.ts` (`SURNAME_TITLES`).
  - Measured (scratch dumps, list on and off, reading model off): on the held-out corpus 419 entries more (545 sightings, 526 places
    changed, 452 of them in Wikipedia; silver checks 406 → 434 right, the 2 newly wrong are 武广 and 郑西 now inside the whole railway
    name); on the 25 tuned books 749 entries more (2,462 sightings, 2,483 places in 5.4 million Han characters); no entry removed.
    Of the 1,168 new entries all were read in context: 17 are not names (金克木 in 金克木之义, 任我行, 楚岫云, 威震天南, 直快列车 …),
    98.5%; a seeded sample of 100 had 99 real names. Seeded diff samples of 40: corpus 40 better, books 39 better and 1 worse. UD
    "book" F1 +0.58 (GSDSimp) and +0.88 (HK), crossing within 0.002. Detection takes about 0.05 s longer on a 920,000-character
    novel (8%); parsing the list takes 0.12 to 0.17 s once.
  - **Junk names** (the blind audit's common words made names). The rule for a dictionary word that is a story's person (沙龙) now also
    asks that it is treated as someone (spoken, in either script: `said`; called out; or after a verb that takes only a person:
    `pprep`, not 对 和 给 让 被), that no sense is a verb (焚毁), a kind of person (`ROLE_DEF`: 堂倌 "waiter") or, for a proper noun, a
    place or an institution (`PLACE_ORG_DEF`: 清华); so 社群 after 对 与 给 is no person. A name whose "surname" is a measure word and
    follows a numeral or 这 half the time is a count (`counted`: 第二张专辑); and a short text's place may not open with 整 满 这 … and a
    measure (整条街). On the held-out corpus and the 25 tuned books these change nothing; the tests reproduce each audit case.
- Detection v12 (`DETECTOR_VERSION` 12, the name model, tests in `tests/core/nameModel.test.ts`). The repeated names the rules turn down
  (七斤, 四婶, 孙八爷, 周仓, 张十五) are what the name check (§4.13) asked the reader about; a model trained once offline now takes the ones
  it is sure of.
  - **The model** (`core/nameModel.ts`, `public/data/name-model.tsv.gz`, §3): a softmax regression (none, person, place) over string
    features (`nameFeatures`, version `NAME_FEATURES_VERSION` 1): the shape (`nameShape`: `numhon` 七大人 八爷 邹七嫂, `numjin` 七斤,
    `surnum` 黄三, `laonum` 老五, `nick` 老栓, `title`, `translit` 拉希姆, `place`, `er`, `zi`, `kin` 附姐, `sur` 周秉昆, or none) and length;
    the detector's statistics (count, `npmi`, `bind`, neighbor entropy, `said`, `prep`, `pprep`, `voc`, `counted`, `open`); how it
    stands, read once in the text (`standOf`: a mark before or after, followed by a verb a person does, a kinship character, 的, 了 着
    过, a locative or 家, after 的 or 在 到 从, cutting a common word or a dictionary name at an edge or sitting inside an idiom, inside a
    name found or a title, the commonest character on either side); the corpus counts of its first and last pair; whether dictionary
    words make it up or hold a common word; siblings and forms of a name found (as §4.13 finds them); and the character priors (the
    surname's, the given name's mean and least, the foreign-name mean, the end of a place) and the title tails (a two-character string
    that is one: 郡丞, 真君). Bins, not raw numbers: every feature is an indicator.
  - **Where it runs** (`modelNames`, last in `detectGen`, whole books only, after `listed()`): every candidate of two to four
    characters seen at least 5 times in a short text, 8 in a long one (more past 800,000 Han characters) that the book has not taken,
    could be a name (`plausibleName`, shared with §4.13) and is not a dictionary word (jieba's 老张 八爷 孝儿 only in a name's shape).
    Never asked: a numeral first unless the string is a numbered name (万美元, 三桂); 两 anywhere or a numeral before a measure word or a
    group (戴一顶, 阮氏三雄, 河两岸); an ordinary dictionary word and one character more (厉声高, 白玉珪); a string that ends in a word for a
    title or a kind of person (`personWord`: 王驿丞, 韩大叔, 陈源教授, 知县相公, 小沙弥; numbered names excepted); 老 小 and a thing, an
    animal, a kind of person or kin (`NOT_NICK_TAIL`, now in names.ts: 老尼, 小军). It joins as a person when the person probability is
    at least the file's threshold for its shape group (`shapeGroup`, `personThreshold`: 0.85, numbered names 0.65, a given name and a
    kinship character 0.7, two characters of no shape 0.95, three 0.9, four 0.95, foreign names of three or four 0.93), as a place at
    0.9, and only when the book's statistics back it: its own places at the minimum, a fifth or fewer cutting a word or a name (吴主孙|权)
    or inside an idiom (龙骧|虎步), at most 40% inside a name found and 30% in a title, the same character before or after it under 60% of
    the time (not 的 了 说 道 …), not held by a longer candidate, after a numeral or a demonstrative under a quarter of the time (一翁斯),
    not three characters or more ending in a title tail (萧中丞, 赵监生, 王大喜; numbered names excepted), not a numbered title after the
    given names of two or more people found (宝二爷, 琏二爷: 二爷), and a person not after 在 到 从 half the time nor before an office a
    third of the time (`rankAfter`: 龙骧将军王浚 makes 龙骧 a rank). Reading: `pinyinOf`
    (a surname's reading when one leads; 子 neutral in a `zi` name); gloss "name (person)" or "place or group name". It only adds: a
    string the rules found is never asked about, and an empty model or none gives the rules' result exactly.
  - **Loading.** `loadLexicon` fetches the model with the name list in the background job (`loadNameModel`, cached per session; null when
    it cannot be had, or the file's format or features version is not this code's); the service worker stores it when first fetched
    (`LAZY_DATA`). A book read with the list but no model is stored at `WITHOUT_MODEL` (11.75) and read again once the model can be had.
  - **Training** (`scripts/train_name_model.py`; `scripts/eval/zh-name-sites.run.ts` reads every candidate through the app, so the
    features are the app's): 1,512 texts, 25.9 million Han characters (each Ming and Qing novel whole, each piece of a story collection
    or an author's 1920s collection alone, 429 long Wikipedia articles; the four novels of public/samples left out), 20,330 sites the
    statistics back. Labels: the rules' names and places (6,994 and 713, silver), the list's persons and places (361 and 117; a
    two-character place only with a place ending, since 拉图 and 图斯 are pieces of longer names), 421 strings judged in context
    (`scripts/data/name-model-labels.tsv`, picked where earlier models were sure; weight 5; a surname and a title, 王驿丞, is none), and
    the rest none at weight 0.3 (names the list lacks are among them, so scores rank; the thresholds come from the judged strings).
    Out of fold, the judged strings, the hardest of the training texts, are 90% right at 0.85; the thresholds by shape follow them.
  - **Measured** (scratch dumps with `ZH_NAME_MODEL=off` and on, back to back): the held-out corpus gains 7 names (86 places; 老张,
    孙八爷, 八爷, 四婶, 陈阵, 袁四爷, 绿绮湖 …) and the 25 tuned books 71 (1,495 places; 周仓, 童威, 汉中王, 水镜, 会芳园, 拂云叟 …, and 19 in the
    owner's books); none removed. All 78 were read in context: 76 are names, 97.4% (wrong: 龙骧 from 龙骧虎步, 贺统军 a surname and a
    rank); no common word became a name. Silver checks 456 → 460 right, none newly wrong; UD unchanged (the model takes nothing in
    its test sets). The name check offers 14 strings where it offered 31 (§4.13). The pass costs 57 to 72 ms
    on novels of 600,000 to 900,000 characters in Node, 5% to 10% of detection.
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
  a very frequent word (`LEXICON_WEIGHT` 14 nats, or the dictionary's own score if higher), so a name beats the split into 郭|靖. A lexicon
  word that the dictionary lists as an ordinary word with a corpus count of 100 or more (中学, 大海) keeps its corpus score instead (城中|学校
  stays), and a dictionary phrase of 4+ characters that holds a lexicon word (大闹天宫 around 闹天宫) scores at least 14. A token that
  is a lexicon word gets the entry's pinyin when it has one syllable per character; `inDict` stays false. With no lexicon or an empty one the
  result is identical to before.
- `loadLexicon(ctx, bookId, onUpdate)`: returns `'*'` rows + the book's rows at once. If the scope was never scanned (or by an older
  `DETECTOR_VERSION`), detection runs in the background over the stored chapters (idle slices, one run per book), is saved with
  `store.lexicon.putDetected`, and `onUpdate(newLexicon)` fires so the reader can re-render. A user row or a disabled row is never overwritten.
  First open of a 920k-character book: names appear about 1.5 s after the chapter in headless Chrome and about 2 s in WebKit. While the first scan
  runs the reader holds back laying out the neighbor chapters (`pager.holdNeighbors`, `isDetecting`): doing both made the scan take 15 s in WebKit,
  and the neighbors would have been thrown away when the names arrived.
- Reader: `createChapterView({lexicon})` and `setLexicon(lex)`; when the reader's script setting converts the text, the lexicon's words are
  converted too (`lexiconInScript` in ui/reader/shown.ts, memoized by `shownLexicon()` in chapter.ts). The reader re-segments and keeps the position when the lexicon changes (background
  detection, an edit, "Not a word"). The contents drawer's **Corrections** tab (press N; §4.12) lists the names and terms with a switch per row.
- Popups: a word that is a lexicon entry (looked up in either script) gets an "In this book" card first in the word popup (`ui/popup/bookCard.ts`):
  kind chip (Person, Place, Term, Your word), count, the entry's pinyin and meaning, **Edit** (pinyin with tone numbers or marks, meaning) and
  **Not a word** (popup closes, toast with Undo); in the reader both are saved as fixes of the book (§4.12: a word fix, an "unword" fix), which
  sync, and elsewhere as user rows in the book's scope as before. The header reading comes from the entry. The phrase popup in the reader
  offers **Join as one word…** and **Mark as a name…** (§4.12); outside it, **Add as a word…** for a 2–8 character Han-only selection that is
  not already an entry (also offered in the word popup under "not in the dictionary as a word"): pinyin prefilled from what is shown, optional
  meaning, "This book" or "All books" (`'*'`). The phrase popup segments with the lexicon, so a name is one row in the word-by-word list. Edits
  call `onLexiconChange` and the reader reloads the lexicon.

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

### 4.11 Sync through the Mac or a sync account (`core/sync.ts`, `core/syncExchange.ts`, `scripts/sync-bridge.ts`, `cloud/`)
Saved words (with their SRS state), known words (with the learned-from-reading mark), the reading place in each book, looked-up words,
bookmarks and the reading settings (`SYNCED_SETTINGS`) are the same on every device connected to the Mac or signed in to the account, and
books go through the account, and so do the reader's corrections (§4.12: names marked, words joined or split, readings, old spellings, kept as
`l:fix:<id>` records). Review logs and the names Dushu found are not synced. Each language's library syncs on its own, apart (**Languages** below).
- **The Mac** (`scripts/sync-bridge.ts`, route `POST /api/sync`, owner-only through `bridgeRequest`, CORS like the other bridge routes)
  keeps one file, `state.json` in the folder `DUSHU_SYNC_DIR` names (an absolute path; the owner's is `.dushu-local/sync`):
  `{ epoch, version, records: { key: { at, data, rev } }, reader }` (`reader`: the version this server last left the reader's
  records at, **The reader's records** below). There is no default folder: only `scripts/start-local.mjs` (Dushu.command,
  `npm start`, the login item) sets it, and a server started any other way (`npm run dev`, `npm run preview`, a QA script) answers 503
  `{ off: true }`. A save by another process on the same folder (a new inode) is read before the next merge, never overwritten.
  Keys: `v:<word id>`, `k:<word>`, `p:<book key>`, `l:<day>:<word id>` (a looked-up word), `l:fix:<fix id>` (a correction, §4.12), `b:<bookmark id>`, `o:<setting>`, with
  `@<language>:` in front for a language other than Chinese; `data: null` is a deletion. A request sends `{ epoch, since, changes: [{ key, at, data }] }`
  (and `lang` for a language other than Chinese);
  each change wins when its `at` is later (a tie goes to the larger JSON, so every copy agrees; an `at` more than 10 minutes ahead of the
  Mac's clock is clamped). Looked-up words are the exception: two copies of a word's day merge (`mergeLookups` in `core/syncKeys.ts`: the
  larger count, the earliest first and latest last lookup, the words of the copy looked up last), and the device gets the merged copy back
  when it differs from its own; a deletion is still last-writer-wins. `at: 0` means a copy the device never synced: it lands only where the Mac has nothing. The reply holds every
  record with `rev > since` plus the current value of every change that lost, the new `version`, and counts. A different `epoch` (or a
  cursor past the end) gets everything. Writes are atomic; before the first write of a day the previous file is kept as
  `state-YYYY-MM-DD.json` (14 kept); a file that cannot be parsed is set aside, never overwritten. Limits: 8 MB body (a larger one is read
  to the end, then refused with 413), 5,000 changes, 160 characters per key without its language's prefix, 32 KB per record (a larger
  record is answered like a change that lost). A request carries one library, so these never add up across languages.
- **The merge** (`core/syncExchange.ts` `exchange`, over a `RecordTable`) is shared by both hubs: the Mac's table is the JSON file, the
  account's is SQLite. A device syncs with one hub: the account when signed in (`core/cloud.ts` `cloudSession`), else the Mac. Switching
  is an epoch change, so the device sends everything to the new hub and takes what it has (the restart path below).
- **The sync account** (`cloud/`, a Cloudflare Worker; `npm run cloud:deploy`, Node 22 for wrangler): `POST /auth/code {email}` emails a
  six-digit code through Resend (`RESEND_API_KEY`; `ALLOWED_EMAILS` limits who may sign in; `MAIL_MODE=log` prints codes, local only);
  `POST /auth/verify {email, code}` returns a bearer token `<account id>.<secret>`; `GET|POST /sync` is the exchange, `GET /me`,
  `POST /auth/signout`. One Durable Object per email (`idFromName('email:<email>')`) holds `meta` (epoch, version, email, the current
  code), `records` (key, at, data, rev) and `sessions` (SHA-256 of the secret, created, used) in its SQLite database; every operation
  is synchronous over it (`AccountCore`, `account.ts`), so each runs as one transaction; hashing happens before. Codes: 10 minutes,
  5 tries, one per 30 s, 5 per hour; a global Durable Object caps emails per day (`DAILY_EMAILS`, 90). Sessions: 20 per account,
  dropped after a year unused; a 401 signs the device out (`signedout` state). CORS answers only henryyhong.com, loopback and
  `*.ts.net`; the page's CSP adds `CLOUD_URL`'s origin to connect-src at build (`scripts/bridge-csp.ts`; the dev server also allows
  wrangler dev on port 8787). Sign in: the top bar's Sign in button (`ui/signIn.ts`, shown while signed out) and Settings → Your Mac
  and iPad → Sync account, the same panel (`ui/settings/account.ts`); both appear once `CLOUD_URL` is set.
- **Languages.** Each language's library syncs on its own through the same hubs, its records kept apart by key:
  - *Records.* Chinese keeps its keys and sends `{ epoch, since, changes }` exactly as before languages synced. Another language sends
    its keys with `@<id>:` in front (`@ja:v:食べる`, `@es:p:<book key>`, `@fr:o:fontSize`) and `lang: '<id>'`, takes only records that
    start with its prefix and strips it (`ownRecords`); its rows (in its own database) keep the bare keys. The Chinese app from before
    reads only keys whose second character is `:`, so it could never take a Japanese word for a Chinese one even if it saw one.
  - *Hubs* (`exchange`): a request syncs one library. Without `lang` (or with one the hub does not know) it is Chinese: keys with a
    prefix are refused, and the reply holds only Chinese records and counts, as before. With a known `lang` (`OTHER_LANGS` in
    `core/syncKeys.ts`) only keys with its prefix are kept, the reply holds only them, its counts (`countRecord` reads the kind after
    the prefix), and `lang` named back. `RecordTable.changed` and `counts` take the library (`inLang`); the account's SQL picks it by
    `substr(key, …)`. The version counts every library's changes, so a Chinese cursor moves past Japanese ones. `GET /sync` and the
    Mac's `GET /api/sync` report the Chinese library, as before. The reader's records are the one exception (below).
  - *The reader's records* (`isReaderKey` in `core/syncKeys.ts`: reading time `l:act:<day>:<device>` and the goal `l:goal`) are the
    reader's, not a library's, so they are one record each on a hub. A library sends them as it sends everything, under its prefix
    (`@ja:l:goal`); the hub keeps them under the Chinese key (`l:goal`) whichever library sends them, and answers every library with
    them under its own prefix (`exchange`: `RecordTable.changed` with `READER`). So a device that reads only Japanese and one that
    reads only Spanish share one streak and one goal, and a device that opens both libraries makes one record of its day, not two. The
    app needs nothing new for it: the key on the wire is what it always was, and no second copy is sent, so there is no old copy to
    stop sending later. A hub from before (the Worker until it is deployed, the Mac until it restarts) keeps a copy per library, as it
    did, and each library sees only its own, which is no worse than before; none is dropped. The first request an updated hub answers
    folds them (`shareReader`): each copy written since this hub last left the table (`reader` in the account's meta or the Mac's
    file; a hub from before moves `version` on and leaves `reader` alone, so a rollback is folded too) goes into the one record: two
    copies of a day give the larger time of each language, the goal the one chosen last, and a deletion only beats a record older than
    it (live copies go first, so the order does not matter). Then every live reader's record gets a new rev, so a library whose cursor
    passed it while that hub gave it only to Chinese (one that synced then, or first synced then) gets it on its next sync: a few
    hundred small records at most, and only after a hub from before has written. The copies stay where they are (a rolled-back hub
    still lists them), and the updated one never gives them out again. The Chinese app from before reads an `l:` key only when it
    names a day, so it passes the records over, whichever library sent them.
  - *Settings.* A language syncs its own settings (`librarySettings`: the list without `translateTo` and `localOnly`, plus `stress`),
    each compared with its own defaults (`defaultsFor`). `translateTo` and `localOnly` are the reader's: each device spreads them to
    its libraries (`TARGET_KEY`, `LOCAL_ONLY_KEY`) and only the Chinese library syncs them; synced by every library, two libraries on
    one device would undo each other on every sync. The hubs refuse them under a prefix.
  - *Room.* The account keeps two record rooms (100 MB each for the owner, 20 MB each for everyone else, in bytes of JSON;
    `RecordRoom` in `cloud/src/account.ts`): the Chinese library's, as before, so Japanese words never crowd out Chinese ones and the
    Chinese app from before is answered as it was; and one shared by the seven other languages (keys starting with `@`), so an
    account holds at most twice what it did, not eight times. The 413 for the shared one says "for all your languages but Chinese
    together". Only what the merge keeps counts: `exchange` decides every change before it writes and hands the room the bytes it
    would add, so a deletion that loses (time 0, or older than the copy kept) frees nothing and a key deleted and saved again in
    one request counts once. Tombstones of keys never kept still cost nothing (as before languages; bounded only per request).
    The reader's records are kept under Chinese keys, so they count in the Chinese room whichever library sends them (`exchange`
    hands the room each key's bytes, and each room is checked on its own): a day that does not fit there is refused as Chinese.
    Book room stays one for the account (1 GB, 200 MB): books are what storage costs.
  - *A hub from before languages* drops a prefixed record without a word and answers without `lang`. So another language's library
    sends nothing to a hub until a reply has named its language: a library that never synced asks first (`changes: []`), and the
    Worker from before languages, which counts every change toward the Chinese room, never sees its words (a nearly full Chinese
    library would otherwise answer "full" to Japanese). A reply that does not name the language is taken as `outdated`: nothing is
    taken or marked sent, the cursor stays where the library last agreed with a hub that named the language (such a hub can hold
    the language's records all the same: rolled back from this version, it keeps and lists the `@ja:` records the newer one stored,
    and a cursor moved past them would never ask for them again), a hub with another epoch is a restart (cursor 0, everything sent
    again once it is updated), and `#meta.asked` keeps where it answered from. The next syncs only ask, from `asked`, so it does not
    send its Chinese records again each time. The first reply that names the language drops `asked`, and the library asks again
    from its own cursor, then sends what waited. Settings: "The sync server is older than this version of Dushu and does not keep
    Japanese yet…", or "Dushu on your Mac is older than this page…".
  - *Rolling back.* Main's Worker over an account this one wrote: it answers Chinese devices the `@` records too (they read only
    keys like `v:…`, so nothing is taken), counts them as nothing, and refuses `@` keys; another language's library is `outdated`
    and loses nothing (above). Its room sums every record, so while it runs the other languages' bytes count against the Chinese
    20 MB, and a Chinese word that fits today can be refused as full; the next deploy gives the room back. It never sees another
    language's books (Books below). The same holds for the Mac's server started from an older checkout on the same folder. A
    Worker or Mac from before the reader's records were shared keeps copies per library while it runs, which the next request the
    newer one answers folds (`reader`, above).
  - *Switch.* Each library has its own Sync switch: Chinese `dushu.sync.off.v1`; another language `dushu.<id>.sync.off.v1` (`'1'` off,
    `'0'` on). Until it is set it follows the Chinese one, and the library's first syncer writes that down (a reader who turned sync
    off, or a QA run that does, has not turned it on for Japanese by opening Japanese); from then on each is its own, so Chinese
    Delete all data leaves a Japanese library that has synced. Its account books follow it too (`accountBooksHere`), so a library
    whose data was deleted stays empty.
  - *The Mac's records into the account* (`copyMacIntoAccount`) go library by library, each with its own mark
    (`dushu.<id>.cloud.mac-copied.v1`, cleared with the others when the account is deleted, `MARK_LISTS`). The syncer starts the copy
    only after the account has answered for its library, so an account from before languages is never sent one. A Mac that does
    not name the language is tried again in 5 minutes, never marked, and asked from where it last answered (`macAsked`) so it does
    not send its Chinese records each time; the whole read waits until it names the language.
- **Books in the account** (`core/cloudBooks.ts`, run by the Library: on open, on sign-in and 3 s after a book is added): a book is kept as
  the app stored it, a zip (`book.json` with its text and details, images as `a/<i>`) made by `packBook` and checked by `unpackBook`
  (the bounded `import/zip.ts` reader), so a device that downloads it adds the same book with the same sync key and its held place
  lands. `GET|POST|DELETE /books`, `GET|PUT /books/chunk?key&i` (1 MiB pieces, the last one shorter; whole once every piece is in);
  `books` and `book_chunks` tables in the account's SQLite (another language's in `lang_books` and `lang_book_chunks`); 200 MB a book, 1 GB an account; the package's SHA-256 is checked after a
  download. The first device signed in that has a book uploads it (`dushu.cloud.books-up.v1`, per email and key); one this device put
  there that is gone was deleted elsewhere and stays deleted. Library Delete calls `forgetBookInAccount` (`dushu.cloud.books-removed.v1`,
  retried until the server has it, and never downloaded again here). Classics (`s` keys) are not kept. A language other than Chinese
  keeps its books under its prefix (`@ja:b1x2y3`, the same file in two libraries is two books), asks `GET /books?covers&lang=ja` and
  gets `{ lang, books }`, and keeps its marks under its own keys (`dushu.ja.cloud.books-up.v1` …). A request that names no language
  is Chinese and lists only books without a prefix, as before, and the Chinese library passes over any key starting with `@` itself.
  A Worker from before languages refuses `@` in a key (`BOOK_KEY`) and answers a language with its bare Chinese list, so a new
  Japanese library there sends and takes nothing and says the server needs updating; deleting there names `@ja:<key>`, which it does
  not have. Another language's books are kept in `lang_books` and `lang_book_chunks` (`SHELVES` in `cloud/src/sqlStore.ts`) because
  that Worker lists every book in `books` and serves any piece of `book_chunks` by key: rolled back to it, the Worker would hand a
  Japanese book to every Chinese library signed in, the released app included, again on every run. It never reads the other tables.
  The Mac's books (`scripts/account-books.ts`, covers) stay Chinese.
- **Claude through the account** (`GET /claude/status`, `POST /claude/translate`): the same request checks, prompt, effort, fallback
  and NDJSON stream as the Mac (`src/translate/claudeServer.ts`, used by `scripts/claude-bridge.ts` too), with the owner's key as the
  Worker secret `ANTHROPIC_API_KEY`. A request is counted before it is sent (`claudeStart`, 429 `daily_limit` past the limits) and its
  tokens after (`claudeUsed`), per account per UTC day. The app's translator (`src/translate/claude.ts`) goes through the account when
  signed in, else the Mac; Local only turns Claude off either way.
- **Passkeys and invites** (`src/core/passkey.ts`, the passkey routes in `cloud/src/worker.ts`, `@simplewebauthn/server` on the
  Worker, the browser's own WebAuthn in the app): signing in costs nothing and has no daily limit, unlike email. The owner makes
  invite links in Settings (`/invites`, owner only; a link names who it is for and how many accounts it may make). Someone invited
  opens `#/join/<invite>` (`src/ui/join.ts`), types a name, and makes an account with a passkey and no email
  (`/auth/passkey/join-options`, `/auth/passkey/join`); the invite is counted only once the passkey is checked. The account's
  Durable Object id is the passkey's user handle, so a sign-in (`/auth/passkey/options`, `/auth/passkey/signin`: a discoverable
  passkey, no list sent) goes straight to its account, which holds the public key and checks nothing itself: the Worker checks the
  signature, origin, site and challenge. Challenges are kept by the shared Limits object, taken once within five minutes. The rpID
  is the page's host (henryyhong.com on the public copy). Anyone signed in can add a passkey for this device (`/me/passkey`), the
  owner's email account included. Such an account is named `passkey:<id>` where an email would be, has the person's name, and is
  never an owner's. Email codes stay, for the owner and as a way back.
- **Translation for everyone signed in** (`POST /ai/translate`): Qwen3 30B-A3B on Workers AI (`@cf/qwen/qwen3-30b-a3b-fp8`) with the
  local model's prompt and checks, names spelled out (`translateChecked`, target `local`, `spelling`), and Qwen's `/no_think` switch, 600 characters at most. It costs
  about 4 neurons a sentence. Three are taken before the call and the rest of `usage.neurons` after, against the reader's UTC day
  (800; the owner's is the whole 4,000) and everyone's (4,000). With read-aloud's 48,000 characters (about 4,300 neurons), the day stays
  under Workers AI's free 10,000, so nothing is ever billed. Answer: `{ text, unverified? }`.
- **Bringing a device everything**: `copyMacIntoAccount` (core/sync.ts) runs beside a sync on a signed-in device that reaches the Mac,
  once the account has answered, once per account and Mac (`dushu.cloud.mac-copied.v1`; a failure waits 5 minutes), and only into the
  owner's account (`isAccountOwner`, or `GET /me` when this device has not heard yet: the owner's iPad signed in to an account someone
  else made gives it nothing of the Mac): it reads every Mac record (`since: 0`, no changes)
  and sends them to the account with their own times, so the account's merge keeps whichever copy is newer; a sync right after takes
  them. `core/cloudLink.ts`: a device on the Mac stores the Mac's private address in the account (`POST /me {mac}`, only an https
  `*.ts.net` origin); a signed-in device elsewhere that is not connected learns it (`GET /me`) and connects, so the Library adds the
  Mac's books when Tailscale is on. Disconnecting on purpose (`disconnectMac`) sets `dushu.mac-bridge.declined.v1`, and it stays so.
- **A device** keeps one row per record in the store's `sync` table (`SyncRow`: `at`, `sig` = hash of the record, `dirty` when not yet sent,
  `fresh` for a word saved before it ever synced, `held` for a place in a book the device does not have: sent by the Mac before the book
  arrived, or kept by `store.books.remove`; `#meta` holds `epoch`, the cursor and, for another language on a hub from before languages, `asked`). `store.books.add` (and `update`, when marking a book as
  the Mac's changes its key) lands a held place in the same transaction, so a book deleted and added again opens where it was. These rows live in the same IndexedDB as the data, so a wipe or an eviction clears both: the device looks new and only receives;
  sync never reads "missing" as "deleted" unless the device had agreed on the record before. A run (Web Locks `dushu-sync`, one tab at a time):
  apply held places whose book arrived; compare a snapshot of the store with the rows and mark what changed (stamped now; a place with its
  `updatedAt`; a fresh word with `at: 0`); send up to 1,000 changes per request and apply what comes back (`store.sync.apply`, one
  transaction, heard by screens as a remote change). Places are never deleted by sync, and a held place is sent like any other. A fresh word that meets the Mac's copy keeps the one
  studied more (`srs.last`), or itself when it was saved after the Mac's deletion, and is sent again stamped to win.
- **Book keys** (`bookKey`): `m<file digest>` for the Mac's books, `s<id>` for the classics, else `b<hash of chapter count, Han count and
  chapter titles>` (the same import of the same file matches; a rename does not change it). Saved words and looked-up words travel with
  `context.bookId` as the book key and are mapped back to the local id. A change of that key alone (the book deleted here, or imported
  again by a newer importer, `IMPORT_VERSION`) is no change to the word: the row keeps the word's signature without its book (`bare`,
  also recognized through `olderKeys` for a row synced before it kept one), so the word is not sent again stamped now, which would undo
  a deletion of it made meanwhile on another device. A bookmark keeps its book's key (`Bookmark.bookKey`, set when it is
  made, or by the first sync for older ones), travels as `book`, and is moved onto the local book whenever that book is here (it arrived, or
  was deleted and added again); deleting a book keeps its bookmarks and sends nothing. A device always takes the Mac's copy of a looked-up word
  (the store merges it with its own row in `store.sync.apply`) and sends again what only it had.
- **When**: at start, 1.5 s after a change to words, known words, lookups or bookmarks, 5 s after a place is saved, on every screen change, when the page is hidden (keepalive when small) or
  shown again, when the connected Mac changes, when back online, and every 45 s while visible. The reader waits up to 1.5 s for a sync
  before it reads the saved place (`syncBeforeOpen`), never saves a place that did not move (so opening a book on a stale device cannot
  overwrite a newer place), and when another device's place arrives for the open book it offers "Go there" (`dushu:remote-progress`).
- **Settings** → Your Mac and iPad → Sync: a switch (localStorage `dushu.sync.off.v1`, or the language's own), Sync now, and the
  status. Delete all data turns that library's sync off on that device, so the Mac's (or the account's) copy stays there until it is
  turned on again; another language's turns off only its own. It first stops the syncer and waits for a sync under way (`stop()`
  cancels its request and applies nothing it brings), then wipes holding the `dushu-sync` lock (`withoutSync`), so a reply on its way
  never fills the empty library again. The memory fallback never syncs.
- **Tests that check the releases against each other** run the app and Worker live on 2026-10-30, frozen in
  `tests/fixtures/released/` (main ff6ab6c, `syncKeys.ts` included, import paths changed only): `tests/core/sync-languages.test.ts`
  (hub and device), `tests/cloud/sync-languages.test.ts` (the Worker, the Mac copy, the SQL on a real SQLite beside main's own),
  `tests/cloud/books-languages.test.ts`. The released Worker reads the accounts as main's SQL would (`releasedView` in
  `tests/cloud/helpers.ts`: every record, every byte, the `books` table only), and they run new, released, new again, as a rollback would.
  The hubs' merge from before the reader's records were shared is frozen in `tests/fixtures/languages/` (e823516):
  `tests/core/sync-reader.test.ts` (a Mac not yet restarted, then restarted, then started from an older checkout, over the same
  `state.json`) and `tests/cloud/sync-reader.test.ts` (the Worker before its deploy, over the same account) run it, with devices
  that each have their own localStorage (`tests/helpers/readerDevices.ts`).
- **Deploying languages**: the Worker first (`npm run cloud:deploy`), then the Mac's server (restart it from the updated checkout), then
  the site. Any order loses nothing (a library whose hub is older waits, `outdated`), but this order never shows the message. After
  that, roll the Worker forward rather than back: a rollback loses nothing either, but the Chinese room counts every language while
  it runs (Rolling back, above). The reader's records shared across libraries need only the hubs (the app is unchanged): until a
  hub is updated each library keeps its own time and goal there, as before.

- **Reading time** (`core/activity.ts`): each device's day is one record, `l:act:<day>:<device>` with `{ s: seconds by language,
  g: the goal in minutes when last written, t }`, kept in localStorage (`dushu.activity.v1`, no language's prefix) and sent with
  whichever library syncs, so one streak counts every language. Under `l:` like fixes: a hub keeps it as a record of its own (last
  writer wins), one record whichever library sends it (**The reader's records**, in Languages above), and a device from before
  reads an `l:` key only when it names a day, so it passes these over. Copies merge by taking the larger time of each language (the
  day only grows), so the hub's copy is always taken and one with more here goes back. Only the last 60 days are sent; a day past
  that is let go of on the hub and kept here (400 days) for the best streak.

### 4.12 Corrections (`core/fixes.ts`, `ui/reader/bookFixes.ts`, `ui/popup/fixView.ts`, the Corrections tab in `ui/reader/toc.ts`)
No reader cuts and reads every word right. A **fix** (`Fix` in types.ts) is what the reader says about one word of one book, and it acts
after the cut: `segment.ts` never changes for it.
- **Kinds.** `word`: the characters are one word (a person, a place, another name, or the reader's own word; `role`), with its pinyin and an
  optional meaning. `unword`: a name or term Dushu found (or a word made for every book) is not a word in this book. `cut`: a token that is
  `word` is cut at `cuts` (code points). `reading`: a token that is `word` reads `pinyin`. `spelling`: the reader's choice for an old
  spelling of the book (底 for 的, 那 for 哪; `on`), which `core/bookStyle.ts` reads. A fix holds **everywhere in the book**, or **here only**:
  `at` = `{chapter, block, offset, before, after}`, the stored block and UTF-16 offset with up to 8 characters on each side as the book spells
  them. `book` is the book's sync key (`'*'` for every book), `bookId` its id on this device; `t` when it changed; `n` the places counted when
  it was made. Words are kept as the book spells them, whatever script the page shows.
- **Ids.** `fixId(book, kind, word, at)`: a word's joins, cuts and "not a word" share an id (the latest says what the word is), a reading has
  its own, each place of a "here only" fix its own. The same fix made on two devices is one record.
- **On the page.** `withFixes(lexicon, fixes)` lays them over the book's names and terms: a word for every book counts least, then what was
  found, then the book's own names, places and other names; "not a word" takes the word out. A word the reader joined as an ordinary word
  (`role: 'user'`) stays out of the cut's candidates (as a candidate, 有的 took 有的是 and 所有 apart on the corpus); `applyFixes` joins it
  where the page cuts it into whole tokens. The fixes that act after the cut ride on `Lexicon.fixes` (`lexiconInScript` keeps every extra
  field). `segmentShown(…, here)` calls `applyFixes(tokens, bookText, dict, fixes, here)`: joins everywhere (aligned tokens only), cuts
  everywhere, then the "here only" joins (the edges cut first when the page now cuts across them; the piece left over stays a word of its
  own: joining it back to its other neighbor when the dictionary has the pair was as often wrong as right on the audits), "here only"
  cuts; then the tokens a fix made and their neighbors are read again as segment.ts reads every token (prev, next, after, the
  paragraph's tokens, the book's characters, the old spellings; a name's or a given reading stays), so the 地 left after a joined 分外
  reads de; then readings everywhere, then readings here. `placeHere(fixes, chapter,
  blockTexts)` finds each "here only" fix: where its anchor says while the word and one side of its context are there; else where the word
  and both sides are, nearest the old block (a book imported again); else the one place with the word and one side; else nowhere.
  `hereIn` hands each piece of a long paragraph its own. With no fixes the tokens are the same array: the dumps of the corpus and the 25
  tuned books are byte for byte those of stage 1. The chapter view, the Words tab (`chapterWords(…, { here })`), the word card, the HSK chip
  and read-aloud all use the fixed tokens.
- **Store.** Table `fixes` (keyPath `id`, `DB_VERSION` 5), `store.fixes.list/put/remove/adopt`. Fixes are kept when their book is deleted
  (they come back with it, by key) and travel in backups (`fixes`). `adopt(bookId, key)` moves the user's own rows of a book's lexicon and of
  `'*'` into fixes once, stamped 0 (a deletion made since on another device wins over them); a "Not a word" row stays in the lexicon as found.
- **Sync.** Each fix is the record `l:fix:<id>` (`fixKey`), its data the fix without `bookId`. Under `l:` because every hub keeps any `l:`
  key as a record of its own, last writer wins (a fix never has a lookup's numeric count, first and last, so it is never merged as one): the
  Mac's server and the Worker need no change, and a device from before fixes reads an `l:` key only when it names a day, so it passes these
  over and never sends one back (`tests/core/sync-fixes.test.ts` runs the released app and hub, tests/fixtures/released). The hubs count them
  with the lookups, which no screen shows. A fix of a book that is not on the device is kept under the key and moved onto the book when it
  arrives (like bookmarks); a deletion is a tombstone like any other.
- **The word card** (reader only): the pencil in the header opens the Fix sheet: **Split** (the characters large with a 44 px gap to tap
  between each two, a live preview of the pieces with pinyin and first meaning), **Join with previous / next** (the joined word, its
  dictionary meaning or an optional one, Word / Person / Place / Other name), **Reading** (each character's readings as chips, the one
  shown pressed; the dictionary's, Unihan's and the neutral tone), **It's a name** (two characters or more: Person / Place / Other name, the
  pinyin prefilled with the surname's reading and capitals, `pinyinOf`). Each ends with **Here only** and **Everywhere in this book (N
  places)**, said "up to N places" for a split, a reading or a join (N counts the word in the text; the fix acts where the page shows it
  whole, not 掌柜 inside 掌柜的) (names: **Mark in this book (N places)**); saving closes the card, the page is cut again and a toast says
  what changed, with Undo. A fix the store would not keep (`cleanFix`) is refused with a message, never toasted as done. Fixes already made
  for the word are listed at the top as "Your corrections" with Remove. The pinyin field takes tone numbers, tone marks, runs and the
  form's own name style (`parseEntryPinyin`: guo1 jing4, guōjìng, Dīng Jǔrén, Xīyóushì'èchuán) and asks for the tones when none are given
  (lu zhen). The phrase card (one paragraph, 2 to 8 Han characters, not already a name) has **Join as one word…** (here, in the book, or in
  all books) and **Mark as a name…**; it starts from one syllable a character, also where the selection starts or ends inside a word of the
  page (店里 in 酒店|里: `fixTarget` reads each character from the token that holds it), scrolls the form's buttons into view and focuses its
  first field. Joined for the book or all books where the page cuts across the selection, the place is joined "here only" too (one Undo
  takes both), so the page changes where the reader asked. With the keyboard cursor on, the cursor stays on its word when the page is
  drawn again and keeps the focus; Enter on a button (the toast's Undo) is the button's.
- **The Corrections tab** (the contents drawer's former Names & terms tab, press N): Names, Words and Readings, each with its count; it
  opens on the first part that has rows until the reader picks one. A row shows the word, its pinyin (a split shows its pieces, in the
  script the page shows), kind (Person, Place, Other name, Term, Joined, Split, Reading, Not a word, Not a name: a person, a place or an other name the
  reader marked is under Names, its pinyin with capitals), places, scope (Found, This book, Here and the chapter, All books), a switch and,
  for the reader's own fixes, Delete (toast with Undo). A switched row keeps its place until the list is opened, filtered or switched to
  another part; the filter matches pinyin typed without tones (xian finds Xiánhēng). A found name switched off is an `unword` fix. **Export
  corrections** writes `<title> corrections.json` (`exportFixes`: the book's fixes with their context, no device ids, and the words joined
  for all books, marked `all`); **Import corrections** reads one into the open book (`importFixes`, ids remade for this book; one already
  here stays when it is newer), after asking when the file names another book.
- **Measured** (stage 1 + this alone, scripts/eval): the corpus and the 25 tuned books dump identically (0 changed regions; silver 125/1129
  before and after). With the fix a reader would make for each audited error of the corpus (789 fixes; here only for polyphones, everywhere
  when the same error repeats), 859/1129 checks are right and none that was right turns wrong; the 3 most frequent errors of each text
  (155 fixes) take it to 345, the most frequent alone (57) to 238. Every change the fixes made away from an audited place (324 tokens,
  38 distinct) was read: the same names and words elsewhere, all right but 今|天|子君 (better than 天子, still cut).
- **Old spellings** (`ui/reader/oldSpellings.ts` over `core/bookStyle.ts`): once per book and detector version, 1.2 s after the book opens,
  `detectOldSpellings` reads the chapters and the report is kept on the book (`BookMeta.oldSpellings`). The switches that apply are the
  reader's choice (a `spelling` fix of the book, synced) or else what the book was found sure of; the reader's lexicon carries them
  (`withOldSpellings`, then `withFixes`). A book found sure of one, with no choice yet, asks once at the bottom of the page ("This book
  writes 底 for 的, as many older books do. Read it that way?" Yes / No, after the first-visit hint; toasts show above it while it is up).
  No to 那 for 哪 reads 那 as written everywhere (`naAsWritten`). The Corrections tab shows a switch
  under **Old spellings** for each spelling the book shows or the reader chose.

### 4.13 The name check (`core/nameCandidates.ts`, `ui/reader/nameCheck.ts`)
Names a book repeats in shapes the detector turns down (七斤, 七大人, 老栓, 觉新/觉民/觉慧) are the largest family left on unseen fiction,
and one tap clears every place of one. So once a book's names are found, the reader is asked once: **"Names in this book?"**
- **Candidates** (`nameCandidatesGen(chapterTexts, dict, taken, found)`, also `findNameCandidates` in idle slices and `nameCandidates`
  at once). It runs the detector's statistics alone (`detectGen(…, { statsOnly: true, debug })`, maxLen 5: counts, bind, npmi,
  neighbor entropy, speech, address, `open`, `key`) and keeps the 2-4 character strings seen at least 5 times (8 in a long book,
  more past 800,000 Han characters) that the book has not taken (`taken`: its names and terms and every word the reader fixed), in
  one of these shapes:
  - **numbered**: a numeral, or a surname and a numeral, before an honorific (七大人, 八爺, 四嬸, 九公, 鄒七嫂); a numeral and 斤 (七斤);
    a surname and a numeral (黄三); 老 or 小 and a numeral (老五, 陈老五). Not 二公 or 三公 (the two lords).
  - **nickname**: 老 小 阿 and one character that is not a kind of person, a kinship word or a thing (老栓, 小乙, 阿长; 老张 though jieba
    has it).
  - **siblings**: two to six pairs never apart sharing a first or a last character, which the book uses mostly in them (觉新 觉民 觉慧).
  - **derived**: a character of a found name's given name with an honorific, or 老 小 阿 before it (础翁 beside 尔础), never apart.
  - **word**: a two-character dictionary word whose senses are all ordinary nouns (no proper noun, verb, adverb, kind of person, animal
    or saying), used hundreds of times more than in general text, that speaks or is called out (水生, a boy in 故乡).
  - **repeat**: anything else never apart (npmi 0.75, bind 0.7), not made of dictionary words, with no common word inside, not a word
    for a kind of person or thing at its end (村女, 老船夫), not a word written back to front (蹺蹊), acting as a person.
  Then one pass over the text gives each how it stands: opening or closing a clause, followed by a verb a person does or a kinship
  word, cutting a common word with a neighbor (dropped past 30%), inside a name found (its places are not its own), inside 《》〔〕
  (a title or a note), the same character always before or after it (a piece of something longer: 小楼 of 段小楼), after 在 到 从
  half the time (somewhere, not someone), and a longer candidate that holds it. The score is shape weight × log2(places) × (0.5 +
  signs) × (1 − cuts); each shape needs a minimum of signs, and repeat and siblings must speak, be called out or open most clauses.
  At most 8 (`MAX_NAME_CANDIDATES`), best first; none is no prompt. The kind suggested is a person, a place for a repeat that ends
  like one.
- **The card** (`createNameCheck`): after the first scan ends (and after the first-visit hint and the old spellings question, which use
  the same place at the bottom), the candidates are found in idle slices and kept on the book (`BookMeta.nameCheck`: version, detector
  version, `asked`, the words, and the dictionary words said not to be names). Each is a chip with its count: a tap marks a person
  (a check and the kind), the chevron or a long press shows Person / Place / Other name as a row under it, × says it is not a name
  (struck through). A right click opens the kind menu at once (only the click that ends a long press is swallowed); the menu's arrows
  move between the kinds. **Done** (**Not now** while nothing is marked) and the card's Close save the answers as fixes of the book: a
  `word` fix with the role and `pinyinOf`'s reading for a name, an `unword` fix for a string the dictionary lacks said not to be one (a
  dictionary word is kept on the book instead, `nameCheck.no`, since "not one word" would not be true of it; Corrections lists it under
  Words as "Not a name", and deleting the row lets Check names ask again). One toast says what changed, with Undo for all of them
  (the kept dictionary words too); they sync and show under Corrections like any fix. The card is answered once per book; every
  control is 44 px. It comes right after the top bar in the page's order (Tab reaches it before the text) and sits above the
  read-aloud bar and the Pages footer (`--rd-coach-b` in reader.css; the first-visit hint and the spellings question do too).
  A numbered title that follows the given names of two or more found people at least a tenth of the time (宝二爷, 琏二爷) is not
  offered: each of them is called so.
- **Check names** (Corrections tab footer): closes the drawer and finds the candidates again without the ones answered, so others can
  come up; "No more names to check in this book." when there are none.
- **Cost.** In Node the statistics and the pass take 0.3 to 0.6 s on a 900,000-character novel (the statistics are about 60%), in slices
  of at most about 25 ms; in headless Chrome the card shows 4 to 5 s after such a book first opens (the detector's scan comes first).
  The code is in the reader chunk; no data file.
- **Measured** (2026-11, `offer.test.ts` in the owner's scratch tools; every offer read in context): the held-out corpus and the
  samples offer 31 candidates in 16 of 72 texts, all names or numbered titles used as names (老張, 八爺, 四嬸, 慧生, 陈阵, 白臉兒狼, 二爺,
  小螺, 糜芳, 小乙, 趙毅, 拂雲叟, 阿长 …; 胡庆余堂 is a shop, offered as a person); the 8 private tuned books 9, all names; chapters of five Qing
  novels never read while tuning (Wikisource, 218,000 characters) 4, all names (林之洋 ×76, 廉錦楓, 五科, 二相公). Recall is low by
  design: the rules give up 黑妞, 王生, 賈逵 and the like that do not stand like people often enough. Tests: `tests/core/nameCandidates.test.ts`
  (an invented story, `tests/core/nameStory.ts`) and `tests/reader/name-check.test.ts`.
- **With the name model** (Detection v12, §4.9) the detector takes the candidates it is sure of, which are then taken and never
  offered. Measured with `scripts/eval/zh-name-check.run.ts` (detection as the reader runs it, then the candidates): the held-out
  corpus, the samples and the owner's books offer 14 strings where they offered 31 (public texts 26 → 13, the owner's books 5 → 1;
  the PDF one cannot be imported by the tool). Left: 白臉兒狼, 慧生, 異史氏, 曇摩蜱, 水生, 小螺, 糜芳, 雅丹, 宋三郎, 大聖, 木吒, 勁節, 阿长.
  `plausibleName` (what could be a name at all) is shared with the model's pass and lives in `lexicon.ts`.

## 5. UI

### 5.1 Shell (`main.ts`, done)
Routes: `#/` library · `#/read/<bookId>?ch=<n>` reader · `#/vocab` · `#/review` ·
`#/settings` · `#/about`. Each screen module exports `mount: MountFn` and returns a cleanup.
The reader hides the nav (`body[data-route=read]`) and draws its own top bar.
On a route change the old screen's cleanup runs before `body[data-route]` changes, so the reader saves its place under its own
layout (with the nav back in the flow it measured a line early on every visit). A screen that finishes mounting after the route
moved on is cleaned up at once and never replaces the current screen's cleanup.
Motion is calm and only says what changed: a change of screen fades through the paper with the View Transitions API (the new screen
rising 6 px, about 240 ms; the bar is left out of it and taps go through), never into or out of the reader or for the same screen,
and a plain fade of `#screen` without the API; one underline (`.app-nav-line`, moved and sized with a transform) slides to the new
tab and is set in place when the bar itself changes; a toast put away fades out (one replaced by a newer one goes at once). The
first shelf since the app opened eases in a card at a time (`library.ts` shelfAt, under half a second), today's goal bar fills
with a transform and a new streak number rolls in, and a word card grows from its caret and fades out (`host.ts` leave: no longer
`.pp-pop`, so the reader sees no card). All of it stops under prefers-reduced-motion and does nothing where the APIs are missing.
`ctx.dict()` is a cached promise; `ctx.dictSync()` is non-null once loaded. A failed download is not cached: the next use tries
again, and the toast says "Could not download the dictionary. Check your connection; Dushu will try again."

### 5.2 Popups (`ui/popup/popup.ts`, signatures in the stub)
One popup at a time (opening one closes the other). Positioned near the anchor, flips
above/below, clamps to the viewport, becomes a bottom sheet under 640 px width. Closes on Esc,
outside click, route change. Keyboard: ←/→ = `onStep`, Shift+←/→ = `onResize`, S = save,
K = known, P = play audio.
- **Word popup**: headword large (simplified; traditional alongside if different), pinyin in
  the user's style + tone colors, speak button, HSK chip, Save (star) and Known (check)
  toggles (the HSK chip is the level of the reading on screen, `dict.hsk(simp, syllables)`: 行 háng is HSK 3; none on a name or place
  of the book's lexicon, or on 道 "said", `isSaidDao` in `core/hskMatch.ts`: after 笑 说 问 答 叫 骂 喝 回 便 又, or before a colon or
  opening quote, or before a comma unless a numeral or demonstrative comes first, since the list's 道 is the measure word; when the list
  has the word only in another reading, a muted `span.chip.pp-hsk-other` "HSK 1 as jiāo" in the reader's pinyin style instead), then every reading's definitions (classifiers "CL:個|个[ge4]" rendered as a
  "measure word: 个 gè" line; cross-references like 瞭|了[liao3] rendered as clickable links that
  re-open the popup on that word), then a character breakdown for multi-char words (each char:
  big glyph, pinyin, first gloss, radical + strokes; click to drill in; a Back button returns),
  then for single chars: radical, strokes, variants (clickable), Unicode code point and block,
  stroke-order animation via hanzi-writer (data fetched from jsdelivr on demand; hide quietly if
  unavailable), and links (MDBG, Wiktionary, zdic 汉典). If the word is not in CEDICT, say which
  source the info came from. Footer: "Translate sentence" (opens the phrase popup for
  `context.sentence`). A reader whose language is not the dictionary's gets each sense in it, the dictionary's words under it (§4.7,
  "A word card's meanings"); so does the card of another language (`langWordView.ts`).
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
  level is the lowest level at which the list reads it the same way, in any word (`dict.hskReadings(7)`, the list's own readings
  with their same-word readings): same syllable and tone, or a neutral tone in the text (a
  character learned only in a neutral tone, like 楚 in 清楚, does not teach its full tone), so a reading only one word has comes at
  that word's level (银行 háng). A listed word read with a neutral tone keeps its list level, since which syllable goes neutral is the
  word's (本事 běnshi; a 儿 a book adds to a listed word, 样儿, is not such a tone), and a listed word falls back on its list level whenever a
  character has none. The list level is the one for the token's reading (`dict.hsk(word, pinyin)`: 喝 hè is 7-9, not 喝 hē's 1, and a
  reading the list does not have, 石头 dàntou, has none). A listed word teaches only the readings the list gives it (便宜 piányi says
  nothing of 宜 yí; 子 is the neutral suffix at HSK 1, so 子 zǐ comes with 子女 at 3). A glyph variant
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
  the bar, so reaching for a word near the edge no longer turns the page. A mouse click on a word always looks it up. The first time a book is opened on a device the reader's walkthrough
  (`ui/guide.ts`, steps in `showReaderHint`) lights up, one step at a time, a word on the page, the 拼 seal, Aa, read aloud, chapters, the
  bookmark and the way back, and says how pages turn; the rest of the screen is dimmed and takes no taps or keys while it shows. Seen once
  it is finished or skipped (`dushu.reader-hint.v1`); leaving the book in the middle shows it again. The Aa menu shows it again.
- A chapter that cannot be loaded or drawn shows "Could not display this chapter" with Previous, Next, Open chapter list and (the first time) Try
  again; keys still turn chapters; the saved place is not overwritten. Failures are counted per chapter in localStorage (`dushu.chapter-failures`):
  after two, opening the book shows the error and the chapter list instead of trying that chapter again.
- Words tab (`ui/reader/wordsTab.ts`, counting in `core/chapterWords.ts`): the chapter drawer's middle tab (press W) lists the words of the
  current chapter, segmented like the reader (same dictionary and lexicon; the book's names and terms are left out, they have their own tab),
  one row per simplified form with its count, its most common reading in the chapter, a short gloss, its HSK band (of that reading: none when the list has the word only in another), and the sentence it first
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
- Script and fonts: the article's `lang` is `zh-Hant` or `zh-Hans` from the script setting (original = the book's script; the default is
  simplified since 2026-10-24, and a device that kept the old default "As written" moves once, `dushu.settings.simplified.v1`). Library
  titles and authors follow the setting too. The text goes through `ui/reader/shown.ts` (`inScript`, `segmentShown`): converted, then cut in
  the script shown and read from the book's own characters (§4.2 `orig`; the phrase popup gets the selection's `orig` too). A book already in
  the script shown (`createChapterView({script})`, BookMeta.script) keeps a character that is standard there in itself and not called a
  variant of what OpenCC makes of it: a simplified book keeps 乾坤 and 一坏 (OpenCC: 干坤, 一坯), a traditional one 干 (OpenCC: 幹). `--rd-font` is set
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

### 5.4.1 Welcome, goal and streak (`ui/welcome.ts`, `ui/goalCard.ts`, `core/plan.ts`, `core/readingClock.ts`)

- A device never used (no `dushu.*` key at all) sees the welcome screen before the dictionary downloads: the languages to learn,
  the language translations go into (any of `translate/targets.ts`, 94), and a daily goal. Finishing opens the first language
  chosen; a device used before the screen existed is marked welcomed and never interrupted. Settings › Learning changes the
  languages and the goal and shows the screen again. The languages being learned come first in the language switcher.
- Finishing the welcome makes the library's walkthrough due (`ui/siteGuide.ts`, `dushu.site-guide.v1`): once the library is drawn
  and nothing is open over it, it lights up the first book, Find a book, Paste text, Import book, then Vocabulary, Review, Settings,
  the language switch and Sign in, and says the reader shows itself the first time a book opens. Settings › Learning › Walkthrough
  shows both again. The welcome's next step slides in 20 px from the side the reader went to as it fades in (the footer stays
  put); a walkthrough's card glides with the spotlight to the next step (260 ms, its height with it) while the new words fade in.
- needsWelcome writes the unfinished plan (`welcomed: 0`) at once, so a reload or a second tab during the welcome brings it back.
  The welcome is a modal `<dialog>`. Skip keeps a language already picked; with none picked the bar keeps its language chip. From
  Settings, Done stays in the open library unless that language was dropped, and Esc acts as Cancel.
- The reading clock runs on the Read and Review routes (`main.ts`) and while Practice is open: time counts while the page is in
  front and there was input in the last three minutes (or any voice is reading aloud), flushed every five seconds. Reaching the goal
  says so once, in a toast.
- The goal syncs as `l:goal` (`{ g }`, core/sync.ts), the one chosen last on any device winning, in every library (one record on
  the hub whichever library sends it, §4.11); a device that never chose one sends nothing and takes the account's, and finishing
  the welcome without touching the goal is not a choice.
- A day is won when its time reaches the goal in force that day, so raising the goal never undoes a day. A past day is judged by
  this device's own goal for it (its record, or the stamp the goal card writes), and by the easiest goal of the other devices only
  when this device has no record for that day. The streak runs to today once today is won, else to yesterday.

### 5.4.2 Find a book (`ui/library/findBooks.ts`, `cloud/src/worker.ts` relayEpub)

- Two catalogs, searched from the page (both send Access-Control-Allow-Origin, and the CSP's connect-src names them): Project
  Gutenberg's OPDS search (`l.<code>` for the language, `sort_order=downloads`) and the language's Wikisource search API
  (`generator=search` with `pageprops|categories`, so disambiguation pages and lists of editions are left out; a part of a
  work, "吶喊/狂人日記", too). Wikisource has no "most read" list: Chinese and Japanese open on it with a short list of
  well-known works whose pages hold the whole work.
- The book itself comes through the Worker, which fetches only `GET /gutenberg/<number>` (gutenberg.org's EPUB 3, then older
  EPUBs) and `GET /wikisource/<lang>/<title>` (ws-export.wmcloud.org's EPUB of that page, for the nine reading languages): Origin
  must be one of the app's, a network may fetch 200 books a day, 40 MB at most, an EPUB (a zip) only, a week in the Worker's
  cache. The file is named `gutenberg-<n>.epub` or `wikisource-<lang>-<title>.epub`, which is how the dialog knows a book is
  already in the library.
- Import: Gutenberg's license header and footer were already dropped (`stripGutenberg`); its printed title page and contents
  page now are too (`spine.ts dropTitlePage`, `dropContentsPages`). A ws-export EPUB (its OPF's dc:source is a wikisource.org
  page) loses each part's header template (`headerContainer`, `navigationHeader`/`navigationNotes`, `headertemplate`), sister
  links, page numbers, license icons, the logo as cover and the English About page; the author comes from the header's author
  link, and a part whose title was only in the header (西遊記's couplets) gets it back as its heading (`epub.ts tidyWikisource`).
- Japanese also gets Aozora Bunko (青空文庫), first: its catalog is shipped as `data/ja/aozora.tsv.gz` (17,229 works out of
  copyright with an XHTML file, most read first by its 2022 access ranking, then modern spelling; 610 KB, fetched only when the
  dialog opens there, and cached with the Japanese data) and searched on the page by title, reading, author or the author's
  reading, katakana as hiragana. The work's XHTML page comes through the Worker (`GET /aozora/<card>/<file>`, only a page whose
  DC publisher tag is there). `import/html.ts tidyAozora` keeps only `.main_text` and takes the title and author from the DC
  metadata; the page's `<ruby>` readings stay on the blocks (below).
- Printed readings: for a Japanese book (the app's language, or the EPUB's or page's own), `extractBlocks` keeps each
  `<ruby>`'s readings (mono ruby 御<rt>お</rt>釈<rt>しゃ</rt> as one pair each, group ruby as one) as RubySpans, the same spans
  the Aozora text format gives (`import/aozora.ts`), which the Japanese engine takes over its own guess. While text is gathered a
  reading rides inside it between noncharacters U+FDD0–U+FDD2, so cleaning and paragraph cutting move it with its base text;
  `takeMarkedRuby` turns the marks into spans at the end. Chinese pages keep dropping <rt> (pinyin) as before.
- Problems while adding (wrong language, a damaged file, already in the library) are said in the dialog, not in a toast it
  would cover (`Importer.files` `onProblem`).
- A link pasted into the search box (`parseBookLink`: a Gutenberg book or file, a page of any Wikisource, an Aozora card or work
  page) shows that one book, whichever tab is open; a link to another language's library says which library to open.
- From outside the app (`ui/library/incoming.ts`): the manifest's `share_target` (Android) posts to `./share-target`, which
  sw.js answers by keeping the files (up to 20), title, text and link in the cache `dushu-shared` and redirecting to the library;
  its `file_handlers` ("Open with", installed from Chrome or Edge) hand files to `launchQueue`, kept from the start of main.ts.
  The library takes either when it opens: files are imported (one opens), a link to a book opens Find a book on it, other text
  opens Paste text filled in. iOS offers neither.

### 5.4.3 Your language (`src/i18n/`)

- The app's own words are written in English in the code and shown through `tt()` (`ttn()` for a count, `ttx()` for one English
  word with two meanings, `ttm()` to mark a string kept in a constant). The English is the key, so English needs no catalog and
  reads exactly as written; a string a catalog lacks stays English.
- `scripts/i18n/extract.mjs` collects every such string, and the classics' blurbs from `public/samples/**/index.json`, into
  `src/i18n/strings.json` with the files each is in. `src/i18n/catalogs/<code>.json` translate them (a count by its CLDR forms).
  `tests/i18n/catalogs.test.ts` fails when strings.json is out of date, a catalog drops or adds a `{value}`, or covers under 95%.
- Ten languages besides English: zh, zh-Hant, ja, ko, es, fr, de, it, pt (Brazil), ru. A device starts in its browser's
  language when the app has it; Settings › Learning › Your language (`dushu.ui.v1`, on this device) chooses one, sets
  `translateTo` to it and reloads. The welcome's language step is the same choice. `main.ts` loads the catalog (a lazy chunk,
  precached with the app) before anything is drawn and sets `<html lang>`.
- Not translated: books, the dictionaries' meanings (English, Chinese in the English library), translations, and messages
  that come from a server as they are. The word card machine-translates the meanings it shows into the reader's language, marked as
  a translation, with the dictionary's own words under each (§4.7, "A word card's meanings").
- The top bar measures itself: when a language's tab labels do not fit (German on a phone), it shows the icons alone.

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
  Motion (`review/motion.ts`, `swipe.ts`), small and short and only where it says something: the answer unfolds from the rule
  under the word (300 ms); a graded card leaves to the side of its grade (right remembered, left forgotten) as an inert copy
  hidden from screen readers while the next word settles in (about 300 ms in all, the next card usable at once); once the
  answer shows, a finger or pen can swipe the card to grade it (right Got it or Good, left Forgot or Again, a faint tint and
  label on the way, past about a third of the card or a flick; touch-action pan-y keeps the page scrolling); from 3 remembered
  in a row a quiet "3 in a row" sits over the card's top-left edge beside Pengu (`ReviewSession.streak`), gone at a forgotten
  word; the summary's numbers count up as its tiles ease in (screen readers read the final numbers from a hidden copy).
  Web Animations only, gated on `Element.animate` and reduced motion, so nothing waits on them and tests run without them.

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
live preview sentence rendered with the reader's renderer if exported, otherwise simple ruby. Lookup has "Meanings in your language"
(Automatic, Always, When I ask, Never: `translateMeanings`, §4.7), shown only when the reader's language is not the dictionary's.
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
  50 ms (130 to 220 ms at 4x; it was 100 to 450 ms and 0.9 to 1.8 s). A 20,000-character chapter of the owner's long wuxia novel opens in about 220 ms. In headless
  WebKit at iPad Pro size (software compositing, a desktop CPU): first spread about 560 ms warm, a font step about 530 ms, flip frames about 20 ms
  with the leaf on screen within 50 to 75 ms. In the 1.4 s after a tap the longest frame is 93 to 120 ms landscape, 92 to 142 ms portrait and 64 to 101 ms on an iPhone
  profile (2 to 7 frames over 50 ms; it was 96 to 136, 115 to 208 and 76 to 105 ms with 4 to 8 such frames: the old 200 ms stall was the turn pictures being copied and laid
  out in one go). The first of those frames is the turn starting; the rest is background work. The turn pictures are now built a few blocks at a time (`buildFaceSteps`, a pause
  after about 12 ms), 300 ms after the page settles. What is left, 50 to 90 ms a few times in the second after a turn, is the browser laying the whole column strip out again
  after the pump draws the pinyin of the neighboring spreads and the pictures are added: it is layout, not script (the pump's own slices take 0 to 30 ms), and drawing that
  pinyin one block at a time made it more frames, not cheaper ones. Real iPad GPU and CPU numbers are not measured.

### 5.8 Shell, fonts, PWA
- Pengu, the mascot (`ui/pengu.ts`): a fluffy emperor penguin chick peeking over an open book, a sticker (`art/pengu-logo.png`,
  a generated picture, on pale blue). `scripts/make-pengu.py` cuts the sticker out of the blue (the blue region reachable from the
  edge, each pixel as see-through as it is close to the blue, the blue taken out of the edge's colors) and recolors the book to
  the app's vermilion: that is the mascot (`ui/pengu/pengu.webp`, `penguHtml`, `penguEl`); on the app's ink blue with rounded
  corners it is the logo (`ui/pengu/logo.webp`, `penguMark`), `public/icon.svg` and the PNG icons (the maskable one with Pengu
  inside the safe zone). Two of the app's colors and Pengu's grays, so it sits with the rest of the page.
  Pengu is alive (`ui/pengu.ts`, `styles/pengu.css`): the picture breathes and sways (CSS, each one from a different moment), and
  its span takes one-off moves from the Web Animations API (pop, hop, boing, cheer, duck, nod), so the two add up. It pops in on
  the welcome screen and the empty screens, hops with each walkthrough step and cheers at the last, jumps when tapped, peeks over
  the top edge of Review's flashcard (`penguPeek`: tilting its head at the answer, hopping at a remembered word, ducking at a
  forgotten one) and of the library's first book, cheers over the confetti when a session ends, reads in place of the spinner
  while the library opens, and pops up from the bottom of the screen to say the day's goal is reached (`penguSays`). The first
  time a reader gets to the end of a book, it says so with a small burst of paper from behind it (`penguSays(…, { confetti })`,
  `penguConfetti`; the reader's `ui/reader/bookEnd.ts`: once per book on this device, `dushu.books-finished.v1`; never for a book
  that opens at its end, a saved place already "Finished", a chapter still being laid out, or where the browser cannot animate).
  A word saved from its card sends its star along a short curve to Vocabulary in the top bar, which nudges once (`ui/fly.ts`
  `flyTo`; nothing when the bar is hidden, as in the reader, or off screen). Transforms
  and opacity only; nothing moves with reduced motion. `scripts/make-icons.mjs` draws the link picture. One picture serves every pose
  for now (`PenguPose` names the use, and styles move it). It waves on the welcome screen, stands
  beside each walkthrough step (`ui/guide.ts`), reads over empty Vocabulary and About, and cheers when a review session ends.
  Fixed colors, not the theme's, so it looks the same in light and dark; its animations stop with reduced motion.
- Page heads: `ui/pageHead.ts` `pageTitle(screen, title)` builds each screen's one `h1`: the screen's name in the library's language first
  (书架 生词 复习 设置 关于 in the Chinese library, Biblioteca in the Spanish one; `span.page-title-zh[aria-hidden=true]`), then the title in
  the app's language, which is what a screen reader announces. The name is left out when the title already starts with it.
- Interface fonts: Newsreader (OFL 1.1, `public/fonts/newsreader-roman.woff2` with the optical-size axis and `newsreader-italic.woff2`,
  wght 400 to 500, Latin-1 plus typographic punctuation, 118 KB together, `Newsreader-OFL.txt` beside them) is declared in `injectFonts()`
  with a matching `unicode-range` and `font-display: swap`, and precached by `sw.js` (`UI_FONTS`). It sets only the app's own English
  (`--font-display`): screen titles, italic subtitles, folios, numbers. It has no ǎ ǐ ǒ ǔ ǖ ǘ ǚ ǜ, so pinyin, Chinese, book titles and
  dictionary text never use it; definitions and translations use `--font-book` (Iowan Old Style, Palatino, Georgia: all have the tone letters).
- Fonts: Noto Serif SC and TC (400, 700) and LXGW WenKai (regular) from the installed packages, woff2 slices only (a vite plugin strips the woff
  fallbacks from their CSS; `dist/assets` holds about 500 slices). The 527 KB of `@font-face` CSS lives in `src/fonts.ts`, a separate chunk
  `main.ts` imports after the dictionary, only for the zh, ja and en libraries, with `font-display: swap`. `tokens.css` has the stacks `--font-serif`, `-serif-hant`, `-sans`,
  `-sans-hant`, `-kai`, `-kai-hant` (Songti first on a Mac) and a Jigmo last resort; the plain ones switch to the Hant ones under `:lang(zh-Hant|zh-TW|zh-HK)`.
- Service worker (`public/sw.js`; build id, data version and three lists are filled in by `serviceWorker()` in vite.config.ts: SHELL
  (assets, icons, manifest; every device), ZH_STATIC (top-level `data/` and the short Chinese classics; precached only when the page
  handed the Chinese dictionary over on a first visit or an older `dushu-static` cache had it) and FONT_SHEETS (the `@font-face`-only
  stylesheet; kept only when the page loaded it). On a first visit `main.ts` puts every dictionary file it downloads, in any language,
  plus the reading fonts stylesheet, into `dushu-first-visit`; install files each one in `dushu-lang-<id>-<v>` or `dushu-static` after
  an ETag check, then deletes that cache. Each dictionary folder in the build has a `sizes.json` (`writeDataSizes`) that the reader's
  download line reads. Three caches:
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
  A Settings segmented control's paper segment, and the welcome's goal ring, slide to a choice made by hand (`ui/choiceGlide.ts`: a
  mark shown only while it moves, so the chosen button's own style is the highlight at rest); never on a first draw or a change from elsewhere.
  Hover washes sit inside `@media (hover: hover)`. Italic only on English the app writes, never on an element that can hold Chinese.
  Respect light/sepia/dark themes (test all four, system dark too). Must work at 390 px wide. A new theme cross-fades the whole page
  (`main.ts` applyTheme, 240 ms, View Transitions with `.app-theme-fade`); the first draw, the system's own switch under Auto and
  reduced motion change it at once.
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
  word and Undo, Edit, the Corrections tab, persistence over a reload, Pages), **mobi** (the Gutenberg fixtures in tests/fixtures/import), offline
  (production only). `read` and `epub` seed `layout: 'scroll'` because they assert scroll offsets and the Next chapter button.
- `scripts/qa-reader.mjs` (Scroll and Pages, popups, grid measurements, big chapters; `QA_BASE=…` uses a running server) and `scripts/qa-ipad.mjs`
  (WebKit at iPad Pro 11 landscape/portrait, iPad Mini, iPhone 13: layout, taps, swipes, selection, rotation, flip, and the names card) run against the
  dev server. `qa-shell.mjs` checks the shell and PWA (and, with `QA_ONLY=offline QA_DIST=<scratch build> QA_PREVIEW_PORT=<port>`, the service worker with the server stopped), `qa-vocab.mjs` the vocab screens. None of them print book text.
- `public/sw.js` is the service worker (registered in production builds only). The build fills in its build id,
  data version and precache list (`serviceWorker()` plugin in vite.config.ts). index.html is network first,
  `assets/` cache first, `data/` `fonts/` `samples/` cache first in a cache that survives app updates.

### 7.1 Measuring Chinese reading on unseen text

Everything here reads text the way the page shows it: the app's import (`importFile`), name detection over the chapters'
paragraphs and quotes (`detectTerms`, as `core/lexicon.ts` `bookTexts` feeds it), and `ui/reader/shown.ts` (`inScript`,
`lexiconInScript`, `segmentShown`) with the display simplified. That path lives in `scripts/eval/zh-shown.ts`, which the tools and
the tests share, so what is measured is what a reader sees.

- **Dumps.** `node scripts/eval/zh-dump.mjs --out DIR [--books LIST] [--only a,b] [--script simplified|traditional|original]
  [--compact FILE] [--no-names] PATH...` reads every book in the folders or files given (TXT, EPUB, MOBI/AZW3, PDF, HTML, Markdown;
  `INDEX.md`-style uppercase files are skipped) and writes per book `seg.txt` (tokens joined by `|`, the reading in braces where a
  character or word has more than one), `full.txt` (every Han token with its reading), `lexicon.tsv`, `tokens.tsv`,
  `singles.tsv`, `pairs.tsv` (neighbors that together are a dictionary word) and `readings.tsv`, plus `index.json`. Lines are
  `chapter.block<TAB>tokens`. It runs inside Vitest (`scripts/eval/zh.vitest.config.mts`, jsdom) so the TypeScript is used as it is;
  a PDF that pdf.js cannot open there falls back to `pdftotext` and says so in `index.json`. `--books` takes `id<TAB>path` rows from
  a list kept outside the repository, for the owner's books: their names stay out of the repo, and the tool refuses an output
  folder inside it (except under `.cache/`). It prints ids and counts only.
- **Diffs.** `python3 -I scripts/eval/zh-diff.py BEFORE AFTER OUT [book ...] [--sample N] [--seed S] [--genres tests/corpus/zh/texts.tsv]`
  compares two dumps region by region (a region runs between two boundaries both dumps share): `seg` when the cut changed, `read`
  when the same token got another reading, `text` when the text itself changed (aligned with difflib). It writes `summary.tsv` (most
  frequent first, with per-book counts and contexts), one TSV per book, and with `--sample` a seeded random sample of changed places
  to judge better / same / worse. Every change that touches `segment.ts`, `dict.ts`, the pinyin rules, the lexicon or the data ships
  with these counts and a judged sample of 40; run it on the private books locally too and report counts only.
- **Held-out corpus** (`tests/corpus/zh`, 55 texts, about 487,000 Han characters in 8 genres, each with source and license in
  `INDEX.md`; one folder per license, `LICENSES.md`). Never tuned on, never copied into rules: a fix names its mechanism.
- **Silver gold** (`tests/corpus/zh/silver.tsv`, 1,129 checks from the three blind audits; format in `tests/corpus/README.md`;
  `scripts/eval/zh-silver.ts`). `tests/corpus/zh-corpus.test.ts` scores them on every `npm test` and fails only when fewer are right
  than `tests/corpus/zh/baseline.json` records. Each stage that fixes some raises the baseline (`UPDATE_ZH_BASELINE=1`).
- **Corpus diff in CI.** The same test compares the corpus's groupings and written readings with `tests/corpus/zh/shown-baseline.tsv`
  (a compact form: token boundaries as bits, readings as exceptions to each token's most common one) and prints the changed regions
  per genre, the most frequent changes and a seeded sample of 40 with context. It does not fail; `ZH_CORPUS_STRICT=1` makes it.
- **UD gate** (`tests/corpus/ud.test.ts`, UD Chinese GSDSimp and HK test sets, CC BY-SA, word forms only). F1 and crossing rate per
  set, with each line read alone (`dict`) and as one book with detected names (`book`). Fails when crossing rises more than 0.03
  points or F1 falls more than 0.3 below `tests/corpus/ud/baseline.json`.
- **Local benchmarks.** `ZH_BENCH_DATA=<folder of .gold files> [ZH_BENCH_CPP=<folder with test.sent, test.lb>] node
  scripts/eval/zh-bench.mjs [--record FILE] [--baseline FILE]` scores SIGHAN 2005, ZX and the CPP polyphone set, which may not be
  stored here (research-only or someone else's dataset). Same F1 and crossing, CPP accuracy strict and on one-character tokens.
  `--baseline` fails past the plan's tolerances (crossing +0.03, F1 -0.3, CPP strict -0.2, CPP one-character -0).
- **The reading model in the tools.** The dumps and benchmarks read with the reading model when `public/data` has it, as the reader
  does once it has loaded (`loadEvalDictionary`); `ZH_READING_MODEL=off` reads with the rules alone (diff the two dumps for the
  model's own changes), a path reads another model file. The tests in `tests/` use the test dictionary, which has no model,
  except the corpus gate (`zh-corpus.test.ts`), which hands it the model the same way (`loadEvalReadingModel`), so the silver
  checks and `shown-baseline.tsv` score the readings the reader shows.
- **Sealed set.** About 160,000 Han characters from other works and articles of the same genres, kept outside the repository for the
  final blind audit. Nobody reads it while fixing; after an audit round its texts may join the corpus and a new one is fetched.
- Updating every baseline at once: `UPDATE_ZH_BASELINE=1 npx vitest run tests/corpus` (about 5 seconds).
- The eval path reads names with the name list, as the reader does once it has loaded (`public/data/names.tsv.gz`).
  `ZH_GAZETTEER=off` detects with the rules alone (for a diff of the list's own changes); a path reads another list file.
- The eval path and the corpus tests read names with the name model too (`loadEvalNameModel`, called by `loadEvalGazetteer`).
  `ZH_NAME_MODEL=off` detects without it (a diff of the model's own changes); a path reads another model file.
  `scripts/eval/zh-name-sites.run.ts` writes every candidate the model is asked about, with its features and scores (the training
  script runs it); `scripts/eval/zh-name-check.run.ts` counts what the name check would offer per book (ids and counts only for
  the owner's books).
- `ZH_CORPUS_WORDS=off` leaves `corpus-words.tsv.gz` out of the eval dictionary and the tests' (`tests/helpers/data.ts`), so a
  diff of two dumps shows the file's own changes; a path reads another file.

## 8. Licenses
CC-CEDICT (CC BY-SA 4.0, attribution required in About), Unihan (Unicode License v3), jieba
(MIT), hsk30 by Ivan Krasilnikov (MIT; HSK 3.0 levels by reading, a transcription of GF0025-2021) and complete-hsk-vocabulary
(MIT), both notices in `public/data/hsk-LICENSES.txt`, OpenCC (Apache-2.0), Jigmo (CC0), Wiktionary via kaikki
(CC BY-SA), hanzi-writer (MIT) + hanzi-writer-data (Arphic Public License, fetched at runtime),
Newsreader (SIL OFL 1.1, no Reserved Font Name; `public/fonts/Newsreader-OFL.txt`), Unicode's EquivalentUnifiedIdeograph.txt (Unicode
License v3, `import/radicals.ts`), the WHATWG Encoding Standard's index-big5 (CC BY 4.0, credited in About and `import/hkscs.ts`),
Wikidata (CC0 1.0: the name list `public/data/names.tsv.gz`, credited in About, the README and the file's header), the name model
(`public/data/name-model.tsv.gz`: character priors from the Wikidata list against character counts of Chinese Wikipedia and
public-domain Wikisource text, title tails counted in that text, weights learned from it and from hand labels of strings in it;
treated as CC BY-SA 4.0 and credited in About, the README and its header; never from the owner's books), Chinese
Wikipedia (CC BY-SA 4.0: counted, not copied, for `public/data/corpus-words.tsv.gz`, which is CC BY-SA 4.0 and credited in About,
the README and its header; its new words point to Wiktionary's redirects), and
CPP (Kakao Brain's g2pM data: Apache-2.0 code, sentences from Chinese Wikipedia, CC BY-SA 4.0): the reading model trained on it
(`public/data/reading-model.tsv.gz`) is treated as CC BY-SA 4.0 and credited in About and the README. The model also learns from
public-domain Wikisource books (`scripts/data/reading-model-books.tsv` and `reading-model-books-2.tsv`, first published in 1930 or
earlier; credit zh.wikisource) and from hand labels on places in them and in the held-out corpus, whose texts keep their own
licenses and credits (`tests/corpus/zh/INDEX.md`); never from the owner's books, which only measure it (counts, and a judgement
of each change it makes there).

## 9. Other languages (`src/lang/`)

Dushu reads Japanese, Spanish, French, German, Italian, Portuguese, Russian and English as well as Chinese. It is one app: the language
is chosen per page load (`lang/active.ts`: `?lang=ja` in the address, else the last one opened, else Chinese) and switching
reloads at the library. Chinese is the original app and keeps every name it had; nothing about it changes when another language
exists.

- **English is for Chinese speakers.** Every other library explains its language in English; the English one explains English in
  Chinese. Its dictionary (`scripts/lang/en/build_en.py`) is ECDICT (MIT): Chinese glosses and hints, the forms of each word
  (went is go's past tense; a noun's 's and s' its possessive), COCA/BNC ranks, and the Chinese exam lists, which give its levels
  (`levels.tsv.gz`, read by the spaced engine when a language has one: 中考, 高考, CET-4, CET-6, IELTS/TOEFL with 考研, GRE; a word
  is at the first list it is on). The main dictionary keeps about 68,000 words (ranked, on a list, or met in the starter books); the
  other 340,000 single ECDICT words with a translation are in `data/en/rare/<first two letters>.tsv.gz` (`build_rare.py`, 6 MB in
  all), which the word card fetches only for a word the dictionary lacks (cavillers: caviller), trying its regular forms
  (`lang/spaced/rareWords.ts`); none is downloaded ahead. `scripts/lang/en/curated.tsv` replaces ECDICT's entries for the commonest words, whose Chinese
  is thin there ("the" is only 那), and adds the contractions (don't, I'm, it's are words of their own) and be/have/do's forms.
  Phrasal verbs are ECDICT's verb + particle rows for common verbs, matched before a noun too (`SpacedLang.phrasesBeforeNoun`:
  "gave up the idea"). The card says how the word on the page and its dictionary form are pronounced (went /went/, go /ɡəʊ/):
  ECDICT's phonetics, which mix the older British notation Chinese textbooks used ('kʌlә, liv) with the current one, all in the
  current one (`ipa.tsv.gz`, `SpacedLang.pronunciations`, read after the engine is ready since it is 460 KB; not on flashcards,
  whose reading field sorts the word list). A sentence from an English book translates into Chinese unless the reader picks another language
  (`targetFor`), and the screens keep their Chinese names (书架, 生词 …) for a reader whose translations go into Chinese; anyone else sees
  the English names (once, when the app is in English).
- **Each language is its own library.** Chinese keeps the `dushu` database and the `dushu.*` keys; another language uses the
  database `dushu-<id>` and the keys `dushu.<id>.*` (`langKey`, `storeName`), so its books, words, places and settings never mix
  with the Chinese ones. A backup records its language and is refused by another one.
- **Each library syncs on its own** (§4.11 Languages): its words, known words, places, lookups, bookmarks and its own settings travel
  as `@<id>:<key>` with `lang` in the request, its books in the account as `@<id>:<book key>`, and Chinese sends and takes exactly
  what it did before. `translateTo` and `localOnly` are the reader's and sync with the Chinese library only. Each library has its own
  Sync switch (starting from the Chinese one), and its Delete all data turns off only its own. The Mac's books stay Chinese.
- **The contract** is `lang/types.ts`: a language's engine (`src/lang/<id>`, loaded by `lang/registry.ts`) segments a paragraph into
  tokens (kind `'word'`, with `key` = the folded dictionary form every form of a word shares, `lemma`, Japanese `ruby` and `reading`,
  Russian `stress`, `name`), looks a word up (`WordLookup`: entries with senses, the form on the page "past tense of …", the parts of a
  clitic or compound word, Japanese kanji), normalizes a word to its key, and gives levels and a short hint. `LangInfo` in the registry
  holds what the app needs before the engine loads: names, the BCP 47 tag, voices, the reading aid (furigana or hints), levels, fonts.
- **Where the app asks.** `main.ts` loads the engine instead of the Chinese dictionary and sets it active; `ctx.dict()` then returns
  `noChineseDictionary` (no entries, text unchanged), so a screen written for Chinese degrades instead of breaking. `core/segment.ts`
  hands a paragraph to the active engine. `lang/token.ts` `isWord` replaces the old `kind === 'han'`. The reader draws a word as one
  span (`render.ts renderWord`): Japanese kanji pieces as rubies with furigana, a hint over a hard word as a ruby over the whole word, the
  Russian stressed vowel in `.rd-stress`. Every word or piece carries `data-o` and the class `rd-o`; `POS_SEL` (`ruby.rd-c, .rd-o`) is
  what pages, marks and places measure. Known and saved words are by key; levels replace HSK (`lang/labels.ts`: "Furigana" and "N4",
  "Hints" and "B1"). The word card for another language is `ui/popup/langWordView.ts`; saving makes the card in `lang/words.ts`.
- **Counting.** `import/han.ts countHan` counts the language's letters instead of Han characters (kana and kanji for Japanese), so a
  book's length, its chapter offsets and reading places work the same; thresholds tuned in Han characters scale by `unitScale` (1.5
  for Japanese, 3.5 for the languages with spaces). The library shows words (letters / 5.6) for those.
- **Importing.** `import/encoding.ts` decodes the language's legacy encodings (Shift_JIS, EUC-JP; Windows-1251, KOI8-R; Windows-1252);
  `import/chapters.ts` finds its headings (CAPÍTULO III, Chapitre premier, Erstes Kapitel, Глава, a Roman numeral alone) and joins
  wrapped lines with a space; `lang/detect.ts` turns away a book plainly in another language and says where it belongs.
- **Translating.** A request names its language (`TranslateRequest.lang`); `translate/prompt.ts otherSystem` gives the instructions for
  it, and `checkTranslation` runs only the checks that hold for any language. Chrome's translator and MyMemory translate from the
  language's tag. The offline gloss reads the engine. The Mac's local model stays Chinese only on Automatic. The language translated
  into (§4.7, `TranslateRequest.to`) is the reader's in every library; a choice of the book's own language means English there.
- **Classics.** `public/samples/<id>/index.json` and Markdown texts (`# Title`, `## Chapter`), with public-domain paintings as covers.
- **Offline.** Each language's data and classics live in a cache of their own (`sw.js`, `dushu-lang-<id>-<version>`), named by their
  contents (`vite.config.ts` `__LANG_VERSIONS__`): handed over on the first visit (stored the first time the language opens
  otherwise), kept through Chinese updates.
- **Reading a word in its sentence (the spaced languages, `lang/spaced/core.ts`).** `segment()` reads each word alone (every entry it can
  be, scored by frequency, the treebank prior and its spelling), then reads the paragraph left to right, once, choosing among each word's
  readings from its neighbors. First it asks the language's own rules, `SpacedLang.context` (`lang/spaced/context.ts`):

  `context?: (q: ContextQuery) => { prefer: (r: ContextReading, i: number) => boolean; margin: number; reflexive?: boolean } | null`

  `q` has the word, its sentence's words (each with its text, folded `low`, readings likeliest first with key, head, part of speech,
  gender, form description, hint and score, the reading already `chosen` for the words before it, the marks `before` and `after` it, and
  whether it is a name), `prev`/`next` when only space separates them, `sentenceStart` and `question`. The likeliest preferred reading
  wins if it is within `margin` nats of the likeliest one (`CONTEXT_MARGIN`, 5, for a weak cue; `Infinity` for a decisive one);
  `reflexive` forces the verb's reflexive sense or keeps it off. An answer replaces the generic rules for that word; `null` leaves it
  to them. French en after s' or n', or before a finite verb, is the pronoun:
  `context: (q) => q.word.low === 'en' && (["s'", "n'"].includes(q.prev?.low ?? '') || (q.next && isFiniteVerb(q.next.readings[0])))
  ? { prefer: (r) => r.pos === 'pronoun', margin: Infinity } : null`. Rules that hold in one language (sí, solo, der/die/das, sie/Sie,
  его/их, да, все/всё, ci, come, que, se …) go there; the generic ones stay in core: an article or a determiner that agrees before a
  noun, a preposition before a noun or an infinitive, an auxiliary before a past participle, la/lo/l' as the article or the pronoun by
  all the next word's readings (and the pair agreeing), an agreeing adjective after a noun, a function word's bonus taken back where it
  cannot stand, a preposition with nothing after it as the adverb, an interjection standing apart.
- **Fixed phrases.** `public/data/<id>/phrases.tsv.gz` is optional: `<words folded, lower-case, space-separated as segment() cuts them
  (c' est à dire)>\t<hint>\t<sense>\t<sense>…`. Adjacent words that spell a phrase (longest first, at most 4; an elided word matches its
  full form, parce qu' matching parce que, and a contraction may end one, a pesar del matching a pesar de) all take its hint, and a
  lookup of any of them (`WordLookup.phrase`) shows the phrase first with the form "part"; the key stays the word's own.
- **German separable verbs** (`SpacedLang.separable`): a particle ending its clause (before a mark, und + not another particle, or zu +
  an infinitive) and the clause's finite verb are one reading when the dictionary has particle + verb: both take its key, lemma and
  hint ("ich stehe schon auf" is aufstehen), the card leads with it and shows both pieces.
- **Names and sentence starts.** A sentence starts after . ! ? …, after a colon (not in German) and after `SpacedLang.sentenceOpeners`
  (default « “ „ ¿ ¡ —). A capital in mid-sentence makes a name; a capitalized word the book uses so in mid-sentence, if the dictionary
  has it only as a rare word (Platero "silversmith"), stays a name at a sentence start: each engine keeps such names, bounded, and
  `LangEngine.beginBook(text)` (the reader calls it when a book opens) forgets the last book's and learns the new one's up front. An
  unknown capitalized word at a sentence start is not a name.
- **Spellings a book has its own way.** When nothing reads a word, the engine tries the other accent (Collodi's sè is sé), the word
  without its accents (fué), with one added or as an accented headword without them (oir is oír, Machado's ceu céu), and
  `SpacedLang.respell` (Italian bujo → buio, picchiar → picchiare; Portuguese cabellos → cabelos, visinho → vizinho), only after the
  enclitic split (verte is ver + te, not verter's verté).
