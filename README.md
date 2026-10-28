# Dushu 读书

Dushu is a reader for learning Chinese from real books. Open an EPUB, a text file or a PDF, or paste a chapter. Click any word to see its pinyin, English meanings and how it is built from its characters. Drag across a sentence for its pinyin and a translation. Words you save become flashcards.

It handles every Chinese character, including the rare ones in the Unicode extension blocks. It works with simplified and traditional text, and it works offline once it has loaded.

## Use the hosted site

Open https://henryyhong.com/dushu/ in any current browser. It is a static website: the dictionary, the fonts and a shelf of public-domain classics are all in the page, and there is no account and no server that sees what you read.

- Your books, saved words, progress and settings stay in your own browser. Nothing is uploaded.
- Add a book with **Import book**, drop a file on the Library page, paste text, or start with a classic (Tang poems, Lu Xun, the Analects, the four classical novels).
- On an iPad or iPhone, use Share, then Add to Home Screen. Safari can clear the data of a site you only visit, and a Home Screen app is treated much more kindly. Dushu also asks the browser to keep its data once you add a book.
- It works offline after the first load, including the dictionary and every book you added.
- Sentence translation uses your browser's own translator where it has one (Chrome does, Safari does not) and otherwise shows the word-by-word gloss from the dictionary. For better translation, connect your own Mac (below).

Books are read in a vertically scrolling reader by default. Use **Aa, then Layout** to switch to turning pages, with a two-page spread on a wide screen.

## Connect your own Mac

You can run Dushu on a Mac you own and let the hosted site use it as a private helper. The Mac adds Claude sentence translation, a local translation model, Premium Mac voices and books that live on the Mac. Nothing here is available to anyone else, and the hosted site never contains your Mac's address.

1. Run Dushu on the Mac (see Run it below) and set up private access with Tailscale. `npm run ipad` publishes it over Tailscale Serve, which is private to your tailnet. It never uses public Funnel.
2. For Claude translation, put your Anthropic API key in `~/.config/dushu/anthropic-api-key` on the Mac and make it readable only by you (`chmod 600`). The key stays on the Mac. The browser never sees it, and it is not in the website, settings or backups. Without a key, the local model takes over.
3. On the device you want to connect, open the hosted site, then Settings, then Connect this device to your Mac. You can paste the Mac's private address, or open the connect link that Settings shows on the Mac copy, which fills it in. This is done once per device. The address is kept in that browser only.
4. The Mac accepts the hosted site's origin only, and only from your exact Tailscale identity. Other people on your tailnet are refused.

Claude uses Sonnet 5.5 by default; Settings also offers the cheaper Haiku 5.5. No other model is accepted. The Mac keeps a daily spend guard (3,000 requests or 3 million input tokens by default; set `DUSHU_CLAUDE_MAX_REQUESTS` or `DUSHU_CLAUDE_MAX_INPUT_TOKENS` to change it) and Settings shows today's use. To try the hosted site against the Mac from another local origin, set `DUSHU_EXTRA_ORIGINS` (testing only).

When a device is connected, the Library adds any book the Mac shares in the background, then keeps it like any other book, with your place and names, even offline and with the Mac off. These books are always there: they have no Delete, and if the browser clears them they come back the next time the device reaches the Mac. **Add books from Mac** remains as a manual fallback. A **Local only** setting keeps every sentence on the Mac, so nothing goes to Anthropic or any online service.

If the Mac is asleep, the Library says so and everything else keeps working.

## Sync without Tailscale

Tap **Sign in** at the top right (or Settings, Your Mac and iPad, Sync account), enter your email and type the six-digit code it emails you. Every device signed in with that email keeps the same saved words (with their review schedule), known words, reading places, looked-up words and bookmarks, from anywhere, without Tailscale and with the Mac asleep. Your books are kept in the account too: the first device that has a book puts it there, and every other device signed in adds it, ready to read where you left off. Deleting a book in the Library removes it from the account as well. The classics are not kept (any device adds them from the site). Settings and Claude translation are not part of it; Claude still runs on the Mac. A device that is not signed in keeps syncing through the Mac. The first time a signed-in device reaches your Mac, everything the Mac holds from your other devices is copied into the account (a newer change is never replaced), and a device on the Mac tells the account the Mac's private address, so your other signed-in devices connect to it and add your Mac books the next time Tailscale is on.

The sync server is a Cloudflare Worker in `cloud/` (one small SQLite database per account, merged exactly as the Mac merges). To run your own, with Node 22 or later:

1. Make free accounts at Cloudflare and Resend (resend.com, which sends the codes), then `npx wrangler login`.
2. `npm run cloud:deploy`, then add the secrets: `npx wrangler secret put RESEND_API_KEY` and, to let only you sign in, `npx wrangler secret put ALLOWED_EMAILS` (both run in `cloud/`).
3. Put the Worker's address in `CLOUD_URL` (`src/core/cloud.ts`) and build. Until it is set, Settings does not offer to sign in.
4. For Claude through the account: `npx wrangler secret put ANTHROPIC_API_KEY < ~/.config/dushu/anthropic-api-key` (in `cloud/`). Each account gets the Mac's daily limit (3,000 requests or 3 million input tokens; `CLAUDE_MAX_REQUESTS`, `CLAUDE_MAX_INPUT_TOKENS`).

Resend's shared sender only delivers to the email you signed up with. To let other people sign in, verify a domain at Resend and set `MAIL_FROM` in `cloud/wrangler.toml`. `npm run cloud:dev` runs the server locally and prints codes instead of emailing them.

## Run it yourself

You need Node.js 20 or newer. The launcher uses your installed Node.js and the versions pinned in `package-lock.json`.

Easiest on a Mac: double-click `Dushu.command`. The first run installs the packages and builds the app, which takes a minute. After that it starts a local server on port 4317 and opens http://localhost:4317. It also starts the already-installed Ollama service on loopback when needed, without downloading models. Once iPad access is set up (`npm run ipad`), it also keeps it up: if Tailscale was switched off it turns it back on, and if the iPad address is gone from Tailscale it serves it again. It never signs in, changes other Tailscale settings or takes over a port another app uses.

To have Dushu start by itself when you log in, run `npm run autostart` once in this folder. It also checks every 15 minutes and starts Dushu again if it has stopped, and turns Tailscale and the iPad address back on if they went away, so your iPad, sync and your Mac's books are there without opening anything. The Mac's Tailscale key still expires unless you turn off key expiry for this Mac in the Tailscale admin console. `npm run autostart -- status` shows whether it is set up, and `npm run autostart -- remove` turns it off. It is a LaunchAgent for your user only (`~/Library/LaunchAgents/com.dushu.reader.plist`, log in `~/Library/Logs/Dushu`).

From a terminal:

```
npm install
npm run dev          # development server at http://localhost:5173
npm run build        # typecheck and build into dist/
npm start            # start the build in the background at http://localhost:4317
npm run preview      # serve the build at http://localhost:4317
npm run ipad         # private owner-only HTTPS through your connected Tailscale account
```

If a browser asks, use Install or Add to Dock to keep it as an app. The built version caches itself, so it opens without a network connection. When a new build is available, a toast offers Reload.

## Read on an iPad

Scroll is the default, with larger text and no horizontal progress bar. Pages uses two pages in landscape and one upright. Use current iPadOS Safari (17.4 or newer).

1. Install Tailscale on the iPad and sign in with the same account as the Mac. Open the Mac's private address in Safari, or open the hosted site and connect it once as described above.
2. Tap Share, then Add to Home Screen, and use that icon from then on. Books and the dictionary work offline. Mac features need the Mac awake and Tailscale connected.
3. Safari and a Home Screen app can have separate storage, so a library made in Safari is not copied into the Home Screen app. Books that live on your Mac are added again by the sync. For your own files, keep a backup.

The Mac's Tailscale device key can expire. Reconnect it when Tailscale asks. To turn the private endpoint off without affecting other services: `tailscale serve --https=8443 off`.

**Your words on every device.** Saved words, known words and your place in each book sync through your Mac whenever a device can reach it (Settings, then Your Mac and iPad, then Sync). Changes made while the Mac is asleep sync when it wakes. If you open a book on one device after reading further on another, Dushu offers to go to the newer place. The Mac keeps a daily copy of the synced words for two weeks in `.dushu-local/sync`. Backups still work for moving to a device that cannot reach the Mac: export one in Settings, then Data, and import it on the other device after the same books are there.

## Add books

Your library can be searched by title or author, in simplified or traditional characters, and sorted by recently read, title, or date added.

Once you have marked some words known, each book in your library says how much of its vocabulary you know ("You know 82% of its words"), estimated from six chapters spread through it. Use it to pick a book at your level.

- **Import book**, or drop a file anywhere on the Library page. Supported: EPUB, MOBI and AZW3 (Kindle files without DRM), TXT (UTF-8, GBK, Big5 and UTF-16 are detected), PDF with a text layer, HTML and Markdown. Importing a book that is already in your library offers to open it instead of adding a second copy.
- **Paste text** for an article or a chapter you copied from the web.
- **Start with a classic** adds a public-domain text in one click.
- **Books from your Mac** arrive on their own on a connected device (see Connect your own Mac).

Not supported: scanned PDFs (they have no text to read) and DRM-protected books, including Kindle store purchases.

## Names and terms

Novels are full of names the dictionary does not have. The first time you open a book, Dushu scans it in the background and learns its people, places and martial-arts terms (郭靖, 桃花岛, 降龙十八掌), so each reads as one word with a name's pinyin. Tap one to see an "In this book" card. You can edit its pinyin and meaning, say it is not a word, or select any phrase and choose "Add as a word". The list is under the contents button, on the Names & terms tab. Everything stays on your device.

## Read aloud

The speaker button reads from your current position to the end of the chapter, with Pause, Resume and a speed control. To start at an exact spot, tap a word or select a passage and choose **Read from here**. Voices played through your Mac highlight each word as it is spoken, and so do ordinary browser voices. Premium voices built into the browser highlight only the paragraph. Connected to your Mac, Automatic prefers its Premium Mandarin voices; speech is rendered on the Mac and no text goes to a cloud speech service. Choose a voice in Settings, then Speech.

## Look things up

- **Click a word** (or hover, if you pick that in Settings) to open its card: pinyin, definitions, the characters inside it, radical and stroke count, stroke-order animation, and links to MDBG, Wiktionary and 汉典. Use the arrow keys to step to the neighboring words, and Shift with the arrows to make the selection shorter or longer.
- **Double-click** does the same. On a touch screen, tap a word twice to open its whole sentence with the translation.
- **On an iPad** the card is a small bubble at the word; the page stays where it is. The Aa and pinyin menus are bubbles under their buttons too. On a phone they are sheets at the bottom.
- **Keyboard:** press Enter to put a cursor on the first word of the page, move it with the arrow keys (up and down by line), and press Enter again to open the card. Escape puts the cursor away. In Pages, tap the blank margin at the outer edge of the spread to turn the page, or swipe. A tap on a word always opens its card, even near the edge.
- **Drag across text** to open the phrase card: pinyin over the whole phrase, a translation, and a word-by-word list. On a phone, press and hold, then adjust the selection.
- Star a word to save it with the sentence you found it in. Mark it known and its pinyin stays hidden.
- **Words in this chapter** (press `W`, or the Words tab under the contents button) lists the chapter's words you have not marked known, the most frequent first, with how much of the chapter you already know. Look through them before you read, or after. Tap a word for its card, star it to save it with the sentence it first comes up in, or check it off as known. The arrows at the top show the next chapter's words without leaving your page. The end of every chapter links here too, so you can go over what you just read.

## Pinyin modes

Press `P` in the reader, or use the eye button in the top bar.

- **Off**: no pinyin.
- **All**: pinyin over everything.
- **Unknown**: pinyin only over words you have not marked as known. Turn on **Learn known words as I read** (in the pinyin menu or Settings) and a word you read past on 10 pages over 2 days without looking it up is marked known for you. Looking it up takes it back off.
- **HSK**: pinyin only over words you can't read yet at the HSK level you choose (the stepper in the pinyin menu, or the slider in Settings). A word loses its pinyin once you've met each of its characters, read the way it's read there, in an HSK word at or below your level. So 说道 goes at HSK 1, though the list puts it at 7-9, and so do names and words the list leaves out, like 一个. A word with a toneless syllable, like 本事 (běnshi), waits for its own HSK level, since its characters don't tell you which syllable goes toneless. Traditional characters count as their simplified forms. The menu shows how much of the chapter still has pinyin.

To make the text bigger or smaller, use the **Aa** button in the reader's top bar, the `[` and `]` keys, or Text size in Settings. Pages and Scroll each remember their own size.

In Settings you can choose tone marks (hǎo), numbers (hao3) or zhuyin, color the tones, and turn on tone changes for 一 and 不 (yí gè, bú shì). Books show in simplified characters by default, whatever they were written in, and so do titles in the Library; choose traditional, or the book as written, in the Aa menu or Settings.

## Translation

Single words always show the built-in dictionary, which works offline. For sentences, Automatic uses the first of these that is ready:

1. **Claude**, through your sync account when you are signed in (so it works anywhere), or else through your Mac. The server asks Claude (by Anthropic) to translate the selected sentence, with a little nearby context. The API key stays on the server: a Cloudflare secret for the account, a file on the Mac. Skipped when Local only is on.
2. **Qwen3.5 9B on your Mac**, when it is installed in Ollama. It runs on the Mac and nothing leaves it.
3. **Chrome on-device translation** (Chrome 138 or newer), when its model is ready. The first use needs a one-time download.
4. **A smaller local Ollama model**, when installed.
5. **Word-by-word gloss** from the dictionary, offline. It is not a real translation.

The translation panel says which one answered. You can stop a translation, switch providers or copy the result. **Explain** gives notes on words and grammar, and **Plain translation** restores the original answer.

**MyMemory** is a free online service. It is never used unless you choose it, because it sends the selected text to a third party. With **Local only** on, it is off, and every sentence stays on your Mac.

Machine translation is a help, not a proof. Names keep their readings, and the dictionary stays the source of truth for pinyin. A real-model evaluation script is in `scripts/evaluate-translations.mjs`.

## Words you looked up

Every word you tap while reading is kept on the Vocabulary page under **Looked up**, day by day (Today, Yesterday, then dates), with its pinyin, meaning, the sentence it was in and the book. Tap one for its card, star it to add it to your flashcards, or remove it. **Practice** runs quick flashcards over one day or the last 7 days: Show (or Space), then Again or Got it (1 or 2). Practice does not change your flashcards' schedule. Stepping through words with Prev and Next in a card does not add them.

## Bookmarks and full screen

Tap the bookmark at the top of a page (or press `B`) to bookmark it; the button fills in on a bookmarked page, and tapping it again takes the bookmark away. Your bookmarks are listed under **Bookmarks** in the chapter list, and a tap takes you back. **Full screen** is a button in the top bar while you read, next to read-aloud (also in the Aa menu, or press `F`). On an iPad, Safari can go full screen; added to the Home Screen, Dushu opens without the browser bars anyway. Bookmarks and the Looked up list sync like your saved words.

## Review

Saved words come back as flashcards. Press Space to reveal, then 1 to 4 for Again, Hard, Good, Easy. The intervals are shown on each button. Export your words for Anki from the Vocabulary page (Anki text or CSV).

## Keyboard shortcuts

| Key | Does |
|---|---|
| Click, double-click, drag | Look up a word, look up a word, translate a phrase |
| `P` | Cycle the pinyin mode (in a word card: speak) |
| `[` and `]` | Smaller and larger text |
| `C` | Chapter list |
| `B` | Bookmark this page, or take its bookmark away |
| `F` | Full screen on or off |
| `Page Down`, `Page Up` | Next or previous chapter when you are at the end or start of one |
| `Shift` + `→` or `←` | Next or previous chapter from anywhere |
| `←` `→` in a word card | Previous or next word |
| `Shift` + `←` `→` in a word card | Shorter or longer selection |
| `S`, `K` in a word card | Save the word, mark it known |
| `Space`, `1` to `4` in Review | Reveal, grade |
| `?` | Show the shortcut sheet |
| `Esc` | Close the card or menu |

## Privacy

On the hosted site, everything is local to your browser. Books, saved words, progress and settings live in the browser's own storage, and the dictionary is served with the app. If you connect your own Mac, your words, reading places and bookmarks are also kept on that Mac. If you sign in to a sync account, they are kept in it, on Cloudflare, with your email, and so are your books (except the classics), privately, so your other devices get them by signing in. The app contacts another site only when you ask it to: the stroke-order data for a character (from jsDelivr), the selected text if you choose MyMemory, your own Mac if you connect one, and the sync server if you sign in. Settings has a backup export and a Delete all data button. Backups hold your words, progress and settings, but not your books or any key.

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
| Newsreader (Production Type) | The serif of screen titles, folios and numbers (a Latin subset in `public/fonts/`) | SIL OFL 1.1 |
| hanzi-writer, hanzi-writer-data | Stroke-order animation | MIT, Arphic Public License |
| Wikisource | The bundled classics (all public domain) | public domain |

The About page in the app lists the same sources with links.

## Fonts and icons

Book text uses the system Songti on a Mac and the bundled Noto Serif SC or TC elsewhere. The Kai option uses LXGW WenKai. The fonts are bundled as small slices, so a page downloads only the pieces it draws, and each slice is kept for offline reading once fetched. Rare characters fall back to Jigmo.

The interface is set like a printed Chinese-English edition: screen titles, folios and numbers in Newsreader (two small Latin files, 118 KB together, `public/fonts/newsreader-*.woff2` with `Newsreader-OFL.txt`, stored for offline use when the app installs), the rest in the system font. Newsreader has no third-tone or ü-tone letters, so it never sets pinyin, Chinese or any text from a book.

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
node scripts/check-public.mjs   # fails if the repo or the build holds anything private
```

`scripts/qa.mjs` drives headless Chrome through the real app (smoke, read, epub, vocab, rare, themes, mobile, pages, lexicon, mobi, offline) and prints PASS or FAIL for each check. Use it against `npm run dev` (port 5173) or `npm run preview`. `ARCHITECTURE.md` explains how the code is organized.

## Publish the hosted copy

`.github/workflows/pages.yml` builds with `npm ci` and `npm run build` and deploys `dist/` to GitHub Pages on every push to `main`. The app uses relative paths, so the same build works from `/dushu/` under a custom domain or from any other folder. `scripts/check-public.mjs` runs before the deploy and fails it if the files or the build contain an email address, a Tailscale hostname, an API key, an EPUB, or text from the owner's own books. To try a build under the same subpath locally:

```
npx vite build --outDir .cache/build-pages
node scripts/serve-subpath.mjs .cache/build-pages /dushu/ 5243
node scripts/qa.mjs http://127.0.0.1:5243/dushu/ qa-out/public smoke,read,offline
```
