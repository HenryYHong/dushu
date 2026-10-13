# Dushu 读书

Dushu is a reader for learning Chinese from real books. Open an EPUB, a text file or a PDF, or paste a chapter. Click any word to see its pinyin, English meanings and how it is built from its characters. Drag across a sentence for its pinyin and a translation. Words you save become flashcards.

Books open in a vertically scrolling reader by default. Use **Aa → Layout** to switch to turning pages. The speaker button reads from your current position to the end of the chapter; use Pause or Resume in the audio controls, or press the speaker button again to stop. Scroll shows an audio control strip with playback state and speed; Pages keeps these controls in the header. Speed changes apply at the next sentence. A spoken word is highlighted when the browser voice reports word timing. Choose a voice in Settings → Speech.

Automatic prefers Apple Premium Mandarin voices (Lili for mainland Mandarin, Meijia for Taiwanese Mandarin) from your Mac. The private launcher renders speech locally, preloads the next sentence, preserves pitch at different speeds, and deletes temporary audio after rendering. Premium playback highlights paragraphs; browser voices remain available for word-timed highlighting. A privately connected iPad can use the same Mac voices; no book text is sent to a cloud speech service.

To choose an exact audio starting point, tap a word (or select a passage) and choose **Read from here**. Playback starts at that word or the beginning of the selection, then continues through the rest of the chapter. This works in Scroll and Pages; the popup speaker still pronounces only the word or selection.

Word cards put **Translate sentence** and **Read from here** directly under the word's pinyin, before dictionary details. Touch devices get 44px action targets. Context suggestions show a dictionary sense and exact source quote, not an unverified English rationale.

Short dictionary glosses prefer ordinary meanings over same-reading surnames or country abbreviations when both exist (红: red, 清: clear, 波: wave). A book's own glossary still takes priority and every dictionary sense remains available. These are starting meanings, not automatically verified sentence meanings.

It handles every Chinese character, including the rare ones in the Unicode extension blocks. It works with simplified and traditional text, and it works offline once installed.

## Run it

You need Node.js 20 or newer. The launcher uses your installed Node.js and the versions pinned in `package-lock.json`.

Easiest: double-click `Dushu.command`. The first run installs the packages and builds the app, which takes a minute. After that it starts a local server on port 4317 and opens http://localhost:4317 in your browser. It also starts the already-installed Ollama service on loopback when needed, without downloading models or changing Tailscale settings. If AI cannot start, dictionary reading is still available and the launcher explains what to do. The server keeps running when the Terminal window or chat closes.

From a terminal:

```
npm install
npm run dev          # development server at http://localhost:5173
npm run build        # typecheck and build into dist/
npm start            # start the build in the background at http://localhost:4317
npm run preview      # serve the build at http://localhost:4317
npm run ipad         # private owner-only HTTPS through your connected Tailscale account
```

If a browser asks, use "Install" or "Add to Dock" to keep it as an app. The built version caches itself, so it opens without a network connection. When a new build is available, a toast offers "Reload".

## Read on your iPad

Scroll defaults to larger 28px text with no horizontal progress bar. Pages uses two pages in landscape and one upright. Use current iPadOS Safari (17.4 or newer).

**Connect privately.** Connect Tailscale on the Mac using your existing account, build Dushu and run `npm run ipad`. This prepares owner-only access and restarts only Dushu's tracked server. It uses Tailscale Serve on HTTPS port 8443, never public Funnel or an open Wi-Fi server. The Mac endpoint accepts only loopback requests with the configured host and your exact Tailscale identity. Other users in the tailnet cannot use it. The underlying app and Ollama remain on loopback.

1. Install Tailscale on the iPad and connect with the **same account** as this Mac. Open the private link shown by the launcher or Settings in Safari. The import link adds the owner's existing 活着 and 射雕英雄传 EPUBs; no books are bundled in the website build.
2. Tap Share → Add to Home Screen, then use that icon consistently. Imported books and downloaded dictionary/font data work offline; Mac AI and Premium Mac voices require the Mac awake, Dushu/Ollama running and Tailscale connected. Choose an iPad on-device Chinese voice in Settings for speech without the Mac.
3. If the Home Screen library is empty, choose **Library → Add books from Mac** inside the installed app. Keep backups: Safari and a Home Screen app can have separate storage; installing does not guarantee an existing Safari library is copied. Storage protection is best-effort, not a substitute for backups.

The Mac's Tailscale device key can expire; reconnect/reauthenticate it when Tailscale requests that. Do not bypass certificate warnings. To turn off this private endpoint without affecting other services: `tailscale serve --https=8443 off`.

Automatic speech avoids cached Mac voices when the browser is offline and uses an available device Chinese voice. Mac voice discovery retries after temporary errors and is refreshed periodically, so an old voice list does not remain authoritative forever. If the connection fails during rendering, the reader explains how to reconnect or switch to an on-device voice.

**Bring your books.** Tap Import book, then Browse, and pick an EPUB from the Files app (iCloud Drive, On My iPad, Downloads).

**Move your words between devices.** Import the same book files on the destination first. Then export a fresh backup in Settings → Data on the source and import it on the destination. New backups match books by a SHA-256 digest of their chapter structure and text, so progress and your edited terms do not depend on random device-specific book IDs. Different editions or ambiguous duplicate copies are not guessed. Backups exclude books/images and API keys; older backups without content identities cannot remap independently imported copies. There is no automatic syncing.

## Add books

Your library can be searched by title or author, in simplified or traditional characters, and sorted by recently read, title, or date added.

- **Import book**, or drop a file anywhere on the Library page. Supported: EPUB, MOBI and AZW3 (Kindle files without DRM), TXT (UTF-8, GBK, Big5 and UTF-16 are detected), PDF with a text layer, HTML and Markdown.
- The private launcher can add the owner's existing `活着.epub` and `射雕英雄传.epub` from Downloads with the one-time `?importLocalBooks=1` URL, locally or on the owner's privately connected iPad. EPUBs are never copied into the app build, exposed on the open LAN, or served to another Tailscale account.
- **Paste text** for an article or a chapter you copied from the web.
- **Start with a classic** adds a public-domain text in one click: Tang poems, Lu Xun stories, the Analects, and the four classical novels.

Not supported: scanned PDFs (they have no text to read) and DRM-protected books, including Kindle store purchases.

## Names and terms

Novels are full of names the dictionary does not have. The first time you open a book, Dushu scans it in the background and learns its people, places and martial-arts terms (郭靖, 桃花岛, 降龙十八掌), so each reads as one word with a name's pinyin. Tap one to see an "In this book" card. You can edit its pinyin and meaning, say it is not a word, or select any phrase and choose "Add as a word". The list is under the contents button, on the Names & terms tab. Everything stays on your device.

Books stay in your browser. Nothing is uploaded.

## Look things up

- **Click a word** (or hover, if you pick that in Settings) to open its card: pinyin, definitions, the characters inside it, radical and stroke count, stroke-order animation, and links to MDBG, Wiktionary and 汉典. Use the arrow keys to step to the neighboring words, and Shift with the arrows to make the selection shorter or longer.
- **Double-click** does the same.
- **Drag across text** to open the phrase card: pinyin over the whole phrase, a translation, and a word-by-word list. On a phone, press and hold, then adjust the selection.
- Star a word to save it with the sentence you found it in. Mark it known and its pinyin stays hidden.

## Pinyin modes

Press `P` in the reader, or use the eye button in the top bar.

- **Off**: no pinyin.
- **All**: pinyin over everything.
- **Unknown**: pinyin only over words you have not marked as known.
- **HSK**: pinyin only over words above an HSK level you choose (words outside HSK always count as above).

In Settings you can choose tone marks (hǎo), numbers (hao3) or zhuyin, color the tones, and turn on tone changes for 一 and 不 (yí gè, bú shì). You can also display a book in simplified or traditional characters whatever it was written in.

## Translation

Single words always show the built-in dictionary. Locally or on a privately connected iPad, word cards can also ask the Mac's model for a context-specific suggestion. It is marked as an AI suggestion because it can be wrong. Sentence translation uses the first of these that is available:

You can stop a translation while it is loading, switch providers, or copy the result. **Explain** can use the local model even when the browser provided the translation. **Plain translation** restores the original answer immediately.

Translation references distinguish names, ordinary terms and idioms. Names keep their readings, rare objects use their dictionary descriptions, and figurative idioms use their intended meanings. For narrowly evidenced wine-shop/lodging passages and raw pronunciation codes in dictionary terms, the app checks the answer before displaying it, tries one correction, and withholds a repeated contradiction. This is a limited safeguard, not a general semantic accuracy validator. Other machine output remains explicitly unverified.

1. **Qwen3.5 9B on this Mac**, when installed in Ollama. The preferred private model was evaluated on older usage, names, idioms, and negation. No API key is needed; it can explain sentences too.
2. **Chrome on-device translation** (Chrome 138 or newer), when its model is ready. Private and faster. The first use needs a one-time model download, which you start with a button in the phrase card or in Settings.
3. **A smaller supported Ollama model**, when installed. Context suggestions must match a dictionary sense and quote a clue in the paragraph.
4. **Claude**, if you add your own Anthropic API key in Settings. It also offers an Explain button with notes on words and grammar. The key is stored only in this browser and is left out of backups.
5. **Word-by-word gloss** from the dictionary, offline. Not a real translation or a context-aware choice between dictionary senses.

Local translation handles the entire selection in sentence-boundary chunks rather than cutting off long text. Book glossary readings accompany names, and incomplete responses are reported as errors. Low-confidence contextual guesses are withheld; other AI suggestions remain explicitly unverified. No machine translator can guarantee every literary nuance. A real-model evaluation script is available at `scripts/evaluate-translations.mjs` with original passages covering older usage, names, negation, idioms, and traditional characters.

**MyMemory** (a free online service, about 5,000 characters a day) is never used unless you choose it, because it sends the selected text to a third party. You can pick it in Settings or from "Try another provider" in the phrase card.

If no model is ready, Automatic offers the browser model download before the remaining fallbacks. Strong literary clues can also select a dictionary sense directly: for example, 酒店 means a wine shop or tavern in the passage about warming wine and selling bowls of it in 孔乙己.

## Review

Saved words come back as flashcards. Press Space to reveal, then 1 to 4 for Again, Hard, Good, Easy. The intervals are shown on each button. Export your words for Anki from the Vocabulary page (Anki text or CSV).

## Keyboard shortcuts

| Key | Does |
|---|---|
| Click, double-click, drag | Look up a word, look up a word, translate a phrase |
| `P` | Cycle the pinyin mode (in a word card: speak) |
| `[` and `]` | Smaller and larger text |
| `C` | Chapter list |
| `Page Down`, `Page Up` | Next or previous chapter when you are at the end or start of one |
| `Shift` + `→` or `←` | Next or previous chapter from anywhere |
| `←` `→` in a word card | Previous or next word |
| `Shift` + `←` `→` in a word card | Shorter or longer selection |
| `S`, `K` in a word card | Save the word, mark it known |
| `Space`, `1` to `4` in Review | Reveal, grade |
| `?` | Show the shortcut sheet |
| `Esc` | Close the card or menu |

## Privacy

Everything is local. Books, saved words, progress and settings live in your browser's own storage, and the dictionary is served from this app. The app only contacts another site when you ask it to: the stroke-order data for a character (from jsDelivr), and the selected text if you pick Claude or MyMemory as the translator. Settings has a backup export and a "Delete all data" button. Backups hold your words, progress and settings, but not your books or your API key.

## Data sources and licenses

| Source | Used for | License |
|---|---|---|
| CC-CEDICT | Words, pinyin, English definitions | CC BY-SA 4.0 |
| Unihan (Unicode) | Readings, definitions, radicals, strokes for 101,997 ideographs | Unicode License v3 |
| Wiktionary via kaikki.org | Readings and definitions for rare characters and extra words | CC BY-SA 4.0 |
| jieba | Word frequencies for splitting sentences | MIT |
| complete-hsk-vocabulary | HSK levels | MIT |
| OpenCC | Simplified and traditional conversion | Apache-2.0 |
| Jigmo fonts | Glyphs for rare characters, so nothing shows as an empty box | CC0 |
| Noto Serif SC and TC (@fontsource) | The book typeface where there is no system Song font | SIL OFL 1.1 |
| LXGW WenKai | The Kai reading typeface | SIL OFL 1.1 |
| hanzi-writer, hanzi-writer-data | Stroke-order animation | MIT, Arphic Public License |
| Wikisource | The bundled classics (all public domain) | public domain |

The About page in the app lists the same sources with links.

## Fonts and icons

Book text uses the system Songti on a Mac and the bundled Noto Serif SC or TC elsewhere. The Kai option uses LXGW WenKai. The fonts are bundled as small slices, so a page downloads only the pieces it draws, and each slice is kept for offline reading once fetched. Rare characters fall back to Jigmo.

The app icons in `public/icons/` are drawn from `public/icon.svg` by `npm run icons` (headless Chrome).

## Rebuild the data

The dictionary files in `public/data/` are generated and checked in. To rebuild them you need Python 3:

```
python3 scripts/build_data.py --download     # CC-CEDICT, Unihan, jieba, HSK, OpenCC, Jigmo fonts
python3 -I scripts/build_rare_chars.py .     # rare-character supplement (streams about 1.2 GB once)
python3 -I scripts/build_words_extra.py .    # extra words CC-CEDICT lacks
python3 -I scripts/fetch_samples.py .        # the short sample texts
python3 -I scripts/fetch_classics.py .       # the four classical novels
```

Raw downloads are cached in `.cache/raw/`, so reruns are mostly offline. The file formats are described in `ARCHITECTURE.md`.

## Develop

```
npm test             # unit tests
npm run typecheck
npm run qa -- http://localhost:4317/ qa-out/run all
npm run qa:ipad     # headless WebKit, using an isolated test library
```

`scripts/qa.mjs` drives headless Chrome through the real app (smoke, read, epub, vocab, rare, themes, mobile, pages, lexicon, mobi, offline) and prints PASS or FAIL for each check. Use it against `npm run dev` (port 5173) or `npm run preview`. `ARCHITECTURE.md` explains how the code is organized.
