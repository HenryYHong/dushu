# Licenses of the held-out Chinese corpus

The texts are kept in one folder per license. They are test data: nothing here is bundled into the app or published with the site.

| Folder | What | License | Attribution |
|---|---|---|---|
| `public-domain/` | 1920s fiction and essays (魯迅, 郁達夫, 廬隱, 許地山, 老舍, 徐志摩, 胡適), Qing novels (儒林外史, 老殘遊記, 鏡花緣, 官場現形記, 兒女英雄傳) and 聊齋誌異, transcribed by Wikisource | Public domain in the United States: first published in 1930 or earlier (the Qing and older works centuries ago). 胡適 died in 1962, so his essays are still protected in countries with a life + 70 term until 2033 | Source pages in `INDEX.md` |
| `cc-by-sa/` | Wikipedia articles and plot sections (zh.wikipedia.org) | Creative Commons Attribution-ShareAlike 4.0 International (https://creativecommons.org/licenses/by-sa/4.0/) | "Wikipedia contributors"; each file's article and revision id is in `INDEX.md`, where the full author list is in the page history. Adapted (sections cut, sentences dropped, see `INDEX.md`); the adaptation is under the same license |
| `cc-by/` | Wikinews articles (zh.wikinews.org) | Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/) | "Wikinews contributors"; article and revision id per file in `INDEX.md`. Adapted (sources sections cut, a few sentences dropped) |
| `cc-by/` | 54 Mandarin stories of Global Storybooks (`global-storybooks-zh.txt`) | Creative Commons Attribution 3.0 or 4.0 per story (only the CC BY stories were taken; the CC BY-NC ones were left out) | Author, translator and illustrator of each story in `global-storybooks-zh.credits.tsv`; the African Storybook Initiative and Global Storybooks (https://github.com/global-asp/global-asp) |
| `cc-by/` | Tatoeba sentences (`tatoeba-juzi-*.txt`) | Creative Commons Attribution 2.0 France (https://creativecommons.org/licenses/by/2.0/fr/) | Tatoeba contributors; each sentence's id is in the matching `.ids.tsv` (https://tatoeba.org/sentences/show/<id>) |

`silver.tsv`, `baseline.json` and `shown-baseline.tsv` are derived from these texts (contexts of a few characters, and the reader's
own cuts and readings) and carry the licenses of the texts they quote.

Never added here: the SIGHAN 2005 bakeoff sets and ZX (research use only), the CPP polyphone set (kept local: its sentences are
someone else's dataset), any text that is not public domain or under CC0, CC BY, CC BY-SA, MIT or Apache, any ND or NC text, and the
owner's own books, not even a phrase or a title. The local benchmarks read those from outside the repository
(`scripts/eval/zh-bench.mjs`).
