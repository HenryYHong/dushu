# Corpus tests: how well Dushu reads Chinese it was never tuned on

Two gates run with `npm test` and need nothing outside the repository:

| Test | Data | Fails when |
|---|---|---|
| `zh-corpus.test.ts`, silver gold | `zh/` (the held-out corpus, `zh/INDEX.md`), `zh/silver.tsv` | fewer audited errors are right than `zh/baseline.json` records |
| `zh-corpus.test.ts`, groupings | `zh/shown-baseline.tsv` | never (it prints every change); `ZH_CORPUS_STRICT=1` makes any change fail |
| `ud.test.ts` | `ud/` (UD Chinese GSDSimp and HK test sets) | crossing rises more than 0.03 points or F1 falls more than 0.3 below `ud/baseline.json` |

Both read the texts the way the reader shows them: the app's import, its name detection over the book, and
`ui/reader/shown.ts` with the page set to simplified (`scripts/eval/zh-shown.ts`). The whole run takes about 5 seconds.

## Silver gold (`zh/silver.tsv`)

Three blind native-speaker audits read about 78,500 Han characters of this corpus through the reader (1920s fiction and essays,
Qing novels and 聊齋, Wikipedia, Wikinews, the stories) and listed 1,339 error occurrences. Each row of `silver.tsv` is one place
an auditor marked, as a check:

| Column | Meaning |
|---|---|
| `audit`, `id`, `genre` | which audit, which text, its genre |
| `family` | the fix family of the plan (NAME-STAT, NAME-RULE, NAME-HARD, VOCAB, GAP, VARIANT, DISPLAY-ZHE, LEX-JUNK, READ-RULE, READ-HARD, SEG-RULE, SEG-HARD) |
| `type` | the auditor's kind: name, missed-word, wrong-boundary, false-merge, reading, import |
| `key`, `before`, `target`, `after` | where: block "chapter.block" of the text as imported, and the shown (simplified) text around the place |
| `expect_seg` | the words the auditor expected over the target, joined by `\|` (empty: the cut is not in question) |
| `expect_py` | the expected reading, one numbered syllable per character, `_` where nothing is said |
| `expect_text` | for a display fix (靑 → 青, 著 → 着), the characters the page should show |
| `shown_at_audit` | what the reader showed when audited |
| `n`, `status`, `expected_note`, `why` | the auditor's count, whether the row is scored, the auditor's own words and mechanism |

A check is right when the cut over the target is exactly `expect_seg`, every asserted syllable matches (一 and 不 in any tone) and
the page shows `expect_text`. It is found again by its context if the text moves (an import change); "lost" means it was not. Every
scored check was wrong at the audit, so the count right is the measure: 0 of 1,129 on 2026-11-03. 13 rows are not scored (a name
card or lexicon question rather than a cut or a reading, or no reading given) and 5 corpus-preparation rows are left out.

The checks are silver, not gold: the auditors left many granularity choices alone, so a check that turns wrong is worth a look,
not automatically a regression. The test lists those ("newly wrong").

## Updating the baselines

When a change is meant to move the numbers (more audited errors fixed, a better cut on UD, new groupings over the corpus):

    UPDATE_ZH_BASELINE=1 npx vitest run tests/corpus

That rewrites `zh/baseline.json` (silver count and the corpus's size per genre), `zh/shown-baseline.tsv` and `ud/baseline.json`.
Read the printed changes first: every change that touches the cutting, the readings, the lexicon or the data ships with its
counts and a judged sample (the plan asks for at most 10% worse in the seeded sample of 40).

## Tools

- `node scripts/eval/zh-dump.mjs --out DIR PATH...` dumps any folder of books or texts through the same path (seg.txt, full.txt
  and more per book); `python3 -I scripts/eval/zh-diff.py BEFORE AFTER OUT --sample 40` lists every change between two dumps.
- `ZH_BENCH_DATA=… node scripts/eval/zh-bench.mjs` scores the benchmarks that stay off the repository (SIGHAN, ZX, CPP).
- The sealed test set for the final blind audit is kept outside the repository and is never read while fixing.

See ARCHITECTURE.md §7 for the details.
