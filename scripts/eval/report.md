# Translation accuracy report

Run `node scripts/evaluate-translations.mjs` to rebuild this file. The tables are generated; this opening section is written
by hand in `report-notes.md` (an input to the generator).

## Summary

- **Claude Sonnet 5.5 is the right default.** On the held-out passages it made no major error with the shipped prompt (3 of 81
  samples before) and is fully correct on 78% of samples. Haiku 5.5 is cheaper but far behind: 43% fully correct, 2 major
  errors, and about 2.5 times as many minor ones. Haiku does not match Sonnet within noise, so it stays the "cheaper" option only.
- **The old Claude prompt was already good.** Tuning moved Sonnet's held-out strict pass rate from 70% to 78%, but that is about
  the size of the noise (the same configuration, sampled again, landed between 69% and 78%). What is solid: major errors went
  from 3 to 0 on held-out and from 1 to 0 on dev, name errors dropped, and Haiku improved on dev (49% to 56%).
- **Qwen3.5 9B improved where it matters, not in strict accuracy.** Major errors on held-out fell from 13 to 4 and lenient pass
  (no major error) rose from 70% to 89%. Fully correct stayed at 33%. It is a fallback: most sentences still carry a slip.
- **Paragraph context is the one lever with a clear effect.** Without it Sonnet's major errors went from 1 to 5 on dev and
  Haiku's from 10 to 15. The previous sentence alone is not enough.
- **Thinking mode is not usable on this Mac.** One sentence took 250 s, and the next 11 returned nothing inside a 4,000 token budget.

## How this was measured, and the limits

- 69 passages from the public-domain texts the owner will read (红楼梦, 西游记, 三国, 水浒, three Lu Xun stories, the Analects,
  Tang poems) plus the 25 older hand-made fixtures. 42 passages are dev (tuning) and 27 are held-out, split inside every large
  book. Names come from the real per-book name detector run over the whole book, as the reader supplies them.
- Answer keys (reference translation, checkable meaning points, traps) were drafted by Sonnet and then read line by line against
  the Chinese and corrected by me, a Claude model. **No native speaker reviewed them.** Where a reading is disputed the key
  picks the standard one.
- **The judge is Claude Sonnet 5.5 grading Claude and Qwen output.** That can favor Claude phrasing. Two checks: the judge called
  67 of 69 reference translations fully correct and none wrong, and caught all 38 translations with one deliberately seeded
  error (24 as major, 34 with the right type). Judging the same outputs twice changed a count by 1 to 3 of 81 to 126. I read the
  held-out failures of the shipped configurations. The major ones I saw were real (a Tang couplet where 臨行 is the son leaving,
  戒尺 rendered "clapper", a garbled 中郎將); the minor ones are often picky.
- **Claude cannot be run at temperature 0**, so each Claude passage was sampled 3 times. Even so, 27 held-out passages cannot
  separate configurations that differ by less than about 8 points. Read the lever table for direction, not for ranking.
- Qwen runs at temperature 0 (deterministic), but a small prompt change moves its result by 3 to 4 of 42 passages.
- Not measured: Explain mode, a native-speaker preference, and long multi-paragraph selections.

## What each lever did

Rule used: keep a change only if dev improves and held-out does not get worse. With this much noise that rarely settles a choice,
so I also looked at major errors and at the error type a lever targets. "Strict" is the share of samples with no error.
Lever rows were run before the last two prompt clauses described below.

| Lever | Sonnet dev / held strict (major errors) | Haiku dev / held strict | Qwen dev strict (major) | Decision |
|---|---|---|---|---|
| Old prompt (baseline) | 86% / 70% (1 / 3) | 49% / 44% | 26% (14) | start |
| New instructions | 87% / 68% (1 / 1) | 52% / 47% | 31% (10) | keep: majors fall everywhere |
| New message: glossary limited to the sentence, exact name spellings | 86% / 68% | 52% / 52% | 36% (10) | keep: name errors fall (Sonnet 4 to 0 on dev) |
| Names as plain pinyin instead of spellings | 83% / 70% | 53% / 49% | 36% (10) | drop |
| Dictionary senses of archaic and dialect words (却说, 洒家, 俺) | 89% / 68% | 58% / 57% | 31% (11) | keep: helps Claude, neutral for Qwen |
| Previous sentence only | 82% / 72% (6 / 3 majors) | 44% / 46% | 31% (10) | drop |
| No context | 75% / 73% (5 / 5 majors) | 43% / 42% (15 / 14 majors) | 29% (13) | drop, the paragraph matters |
| Four worked examples | 84% / 75% (0 / 0 majors) | 48% / 43% | 36% (12) | drop: no dev gain, costs prompt space |
| Effort medium instead of low | 87% / 70% | 52% / 46% | n/a | drop: same accuracy, same first-token time |
| Checks and one corrective retry | unchanged, the checks never fired | 53% / 52% | 38% (9), name problems labeled not retried | keep as a safety net |
| Temperature 0.3 (Qwen) | n/a | n/a | 33% (11) | drop |
| Presence penalty 0 (Qwen; the model file sets 1.5) | n/a | n/a | 33% (12) | drop |
| Thinking on (Qwen) | n/a | n/a | 0 of 12 answered | drop |

After this table two short clauses were added to the instructions (没少帮忙 is "helped a lot", not "helped him"; 画蛇添足 as an idiom
example) to repair two regressions found in the 25-sentence set. The `final.*` rows were rerun with them on all splits.

## Errors by type

See "Before and after, held-out" below.

- **Sonnet:** the three major errors before were a name turned into a word (平兒 as "Patience"), 臨行 misread in the Tang couplet
  and one more wrong-sense. After, there are none on held-out; what remains is minor wrong-sense and register ("Old Lady" for
  老太太, a lost nuance of 窃 versus 偷).
- **Haiku:** mostly wrong-sense and omission, mostly minor. Its major errors concentrate in two passages (the Tang couplet, and
  who pampered Baoyu).
- **Qwen:** wrong-sense dominates (who does what, 有命, 须见, 戒尺), then omitted clauses and additions. Names are fine when the
  glossary has them.

## Why the checks are label-only for some problems on the local model

The mechanical checks (names, negation, numbers, converted units, leftover Chinese or pinyin, commentary, drafts and
"Correction:" blocks, length) almost never fire for Claude (1 retry in 162 held-out samples). For Qwen, asking it to put a missing
name back made it invent one ("Brother Lu") and turned a correct answer into a wrong one. So for the local model a missing
name, negation or number is labeled "Unverified" and not retried; leftover Chinese, pinyin, commentary and length problems are
retried once. For Claude every issue gets one retry. The label is modest in precision (on the dev set only one of three labels
marked a real problem) and is meant as a hint to check the reference words, not a verdict.

## Latency

- **Claude first token** (one request at a time, shipped pipeline, 42 sentences): Sonnet p50 1.0 s, p90 1.8 s, p95 2.4 s; Haiku
  p50 0.7 s, p90 1.3 s, p95 2.1 s. That meets "under 2 s typical". Total p50 is 1.6 s and 1.1 s. One Haiku request hung 8 minutes
  before its first token (my client had no timeout; the Mac bridge's 90 s timeout bounds this) and one took 60 s.
- **Qwen on the M1 Pro** through the production bridge with little else queued: first text p50 about 2.6 s, total p50 about
  3.5 s, p95 about 6 s per sentence (4.5 s and 8 s in an earlier, busier run). The lever runs show longer totals and a few 200 s outliers because other agents loaded the
  Mac at the same time (load average above 25); those numbers are in the tables but are not the model's.

## What ships

- `src/translate/prompt.ts`: instructions, message layout (name spellings, dictionary senses, paragraph window), the checks,
  `translateChecked` (generate, check, one retry) and `CLAUDE_TRANSLATE_EFFORT`. Shared by Qwen and available to the Claude bridge.
- `localMeaning.ts` (uses it), `contextSense.ts` (`wordSenseHint`), `gloss.ts` (the offline gloss lets the paragraph settle
  酒店), `ui/popup/translation.ts` (`translationTerms` adds archaic and dialect senses and drops dictionary proper nouns such as
  千山 that were offered as ordinary words; the panel shows an "Unverified" line).
- Not done by me: the Claude bridge still builds its prompt from `src/translate/claudePrompts.ts` (the old prompt). Switching it to
  `translationSystem('translate', 'claude')`, `translationMessage` and `CLAUDE_TRANSLATE_EFFORT` is the change that makes the
  Claude numbers in this report apply in the app.

## Before and after, held-out (27 passages, never used for tuning)

Claude rows are 3 samples per passage (n is passages times samples). Strict pass: no error at all. Lenient pass: no major error. "Before" is the app as it was at the start of this round; "after" is what ships now.

| Model |  | Configuration | Strict pass | Lenient pass | Major errors | Minor errors | wrong-sense | name-mangled | negation-modality | omission | addition | idiom-literal | number-unit | register-fluency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Sonnet 5.5 | before | `baseline.sonnet` | 57/81 (70%) | 78/81 (96%) | 3 | 30 | 18 (3 major) | 1 | 0 | 1 | 4 | 2 | 1 | 6 |
| Claude Sonnet 5.5 | after | `final.sonnet` | 63/81 (78%) | 81/81 (100%) | 0 | 24 | 12 | 1 | 0 | 1 | 0 | 2 | 0 | 8 |
| Claude Haiku 5.5 | before | `baseline.haiku` | 36/81 (44%) | 80/81 (99%) | 1 | 70 | 22 (1 major) | 2 | 0 | 13 | 8 | 7 | 2 | 17 |
| Claude Haiku 5.5 | after | `final.haiku` | 35/81 (43%) | 79/81 (98%) | 2 | 63 | 29 (2 major) | 3 | 1 | 11 | 5 | 8 | 0 | 8 |
| Qwen3.5 9B (Mac) | before | `baseline.qwen-app` | 9/27 (33%) | 19/27 (70%) | 13 | 43 | 31 (10 major) | 3 (1 major) | 1 (1 major) | 5 | 4 | 3 | 2 (1 major) | 7 |
| Qwen3.5 9B (Mac) | after | `final.qwen-app` | 9/27 (33%) | 24/27 (89%) | 4 | 39 | 17 (2 major) | 2 | 1 (1 major) | 9 | 5 | 2 | 2 (1 major) | 5 |

## Held-out results, every configuration (27 passages, never used for tuning)

Strict pass = no error at all. Lenient pass = no major error. Error type cells count every error of that type (major ones in brackets).

| Configuration | n | Correct | Minor only | Wrong | Strict pass | Lenient pass | Major errors | Minor errors | wrong-sense | name-mangled | negation-modality | omission | addition | idiom-literal | number-unit | register-fluency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `baseline.sonnet` | 81 | 57 | 21 | 3 | 70% | 96% | 3 | 30 | 18 (3 major) | 1 | 0 | 1 | 4 | 2 | 1 | 6 |
| `baseline.haiku` | 81 | 36 | 44 | 1 | 44% | 99% | 1 | 70 | 22 (1 major) | 2 | 0 | 13 | 8 | 7 | 2 | 17 |
| `baseline.qwen-raw` | 27 | 9 | 10 | 8 | 33% | 70% | 13 | 43 | 31 (10 major) | 3 (1 major) | 1 (1 major) | 5 | 4 | 3 | 2 (1 major) | 7 |
| `baseline.qwen-app` | 27 | 9 | 10 | 8 | 33% | 70% | 13 | 43 | 31 (10 major) | 3 (1 major) | 1 (1 major) | 5 | 4 | 3 | 2 (1 major) | 7 |
| `sonnet.rules` | 81 | 55 | 25 | 1 | 68% | 99% | 1 | 35 | 16 (1 major) | 2 | 0 | 1 | 2 | 5 | 0 | 10 |
| `sonnet.glossary` | 81 | 55 | 23 | 3 | 68% | 96% | 3 | 31 | 13 (2 major) | 3 (1 major) | 1 | 4 | 1 | 5 | 0 | 7 |
| `sonnet.nospell` | 81 | 57 | 21 | 3 | 70% | 96% | 3 | 28 | 14 (3 major) | 2 | 1 | 2 | 0 | 5 | 0 | 7 |
| `sonnet.senses` | 81 | 55 | 24 | 2 | 68% | 98% | 2 | 32 | 13 (2 major) | 2 | 1 | 3 | 0 | 5 | 0 | 10 |
| `sonnet.prev` | 81 | 58 | 20 | 3 | 72% | 96% | 3 | 23 | 16 (3 major) | 2 | 0 | 2 | 0 | 2 | 0 | 4 |
| `sonnet.examples` | 81 | 61 | 20 | 0 | 75% | 100% | 0 | 25 | 11 | 1 | 0 | 1 | 0 | 3 | 0 | 9 |
| `sonnet.noctx` | 81 | 59 | 17 | 5 | 73% | 94% | 5 | 26 | 15 (5 major) | 4 | 0 | 1 | 0 | 4 | 0 | 7 |
| `sonnet.medium` | 81 | 57 | 23 | 1 | 70% | 99% | 1 | 27 | 18 (1 major) | 1 | 0 | 2 | 0 | 4 | 0 | 3 |
| `sonnet.checks` | 81 | 55 | 23 | 3 | 68% | 96% | 3 | 31 | 13 (2 major) | 3 (1 major) | 1 | 4 | 1 | 5 | 0 | 7 |
| `haiku.rules` | 81 | 38 | 41 | 2 | 47% | 98% | 2 | 62 | 35 (2 major) | 3 | 0 | 10 | 0 | 6 | 0 | 10 |
| `haiku.glossary` | 81 | 42 | 35 | 4 | 52% | 95% | 5 | 56 | 30 (5 major) | 4 | 0 | 10 | 2 | 5 | 0 | 10 |
| `haiku.nospell` | 81 | 40 | 37 | 4 | 49% | 95% | 5 | 61 | 32 (5 major) | 5 | 0 | 10 | 2 | 5 | 0 | 12 |
| `haiku.senses` | 81 | 46 | 31 | 4 | 57% | 95% | 5 | 49 | 25 (5 major) | 4 | 0 | 5 | 3 | 5 | 0 | 12 |
| `haiku.prev` | 81 | 37 | 36 | 8 | 46% | 90% | 9 | 59 | 31 (7 major) | 3 (1 major) | 0 | 6 | 3 | 10 (1 major) | 0 | 15 |
| `haiku.examples` | 81 | 35 | 43 | 3 | 43% | 96% | 3 | 65 | 19 (2 major) | 2 | 2 | 8 | 6 | 7 | 1 (1 major) | 23 |
| `haiku.noctx` | 81 | 34 | 35 | 12 | 42% | 85% | 14 | 69 | 47 (11 major) | 3 (1 major) | 1 | 8 | 5 | 8 (2 major) | 0 | 11 |
| `haiku.medium` | 80 | 37 | 38 | 5 | 46% | 94% | 5 | 61 | 27 (2 major) | 4 (2 major) | 3 | 12 | 2 | 8 (1 major) | 0 | 10 |
| `haiku.checks` | 81 | 42 | 35 | 4 | 52% | 95% | 5 | 56 | 30 (5 major) | 4 | 0 | 10 | 2 | 5 | 0 | 10 |
| `final.sonnet` | 81 | 63 | 18 | 0 | 78% | 100% | 0 | 24 | 12 | 1 | 0 | 1 | 0 | 2 | 0 | 8 |
| `final.haiku` | 81 | 35 | 44 | 2 | 43% | 98% | 2 | 63 | 29 (2 major) | 3 | 1 | 11 | 5 | 8 | 0 | 8 |
| `final.qwen-raw` | 27 | 9 | 15 | 3 | 33% | 89% | 4 | 39 | 17 (2 major) | 2 | 1 (1 major) | 9 | 5 | 2 | 2 (1 major) | 5 |
| `final.qwen-app` | 27 | 9 | 15 | 3 | 33% | 89% | 4 | 39 | 17 (2 major) | 2 | 1 (1 major) | 9 | 5 | 2 | 2 (1 major) | 5 |

## Dev results (42 passages, used for tuning)

| Configuration | n | Correct | Minor only | Wrong | Strict pass | Lenient pass | Major errors | Minor errors | wrong-sense | name-mangled | negation-modality | omission | addition | idiom-literal | number-unit | register-fluency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `baseline.sonnet` | 126 | 108 | 17 | 1 | 86% | 99% | 1 | 22 | 14 (1 major) | 1 | 0 | 3 | 2 | 0 | 0 | 3 |
| `baseline.haiku` | 126 | 62 | 54 | 10 | 49% | 92% | 10 | 80 | 49 (8 major) | 6 | 6 (2 major) | 7 | 1 | 3 | 1 | 17 |
| `baseline.qwen-raw` | 42 | 11 | 18 | 13 | 26% | 69% | 14 | 52 | 33 (10 major) | 4 (1 major) | 2 (2 major) | 8 | 2 | 0 | 1 (1 major) | 16 |
| `baseline.qwen-app` | 42 | 11 | 18 | 13 | 26% | 69% | 14 | 52 | 33 (10 major) | 4 (1 major) | 2 (2 major) | 8 | 2 | 0 | 1 (1 major) | 16 |
| `sonnet.rules` | 126 | 109 | 16 | 1 | 87% | 99% | 1 | 18 | 7 (1 major) | 1 | 2 | 0 | 0 | 2 | 0 | 7 |
| `sonnet.glossary` | 126 | 108 | 17 | 1 | 86% | 99% | 1 | 25 | 12 (1 major) | 0 | 0 | 3 | 0 | 2 | 0 | 9 |
| `sonnet.nospell` | 126 | 105 | 19 | 2 | 83% | 98% | 2 | 30 | 12 (1 major) | 4 (1 major) | 0 | 3 | 0 | 2 | 0 | 11 |
| `sonnet.senses` | 126 | 112 | 13 | 1 | 89% | 99% | 1 | 21 | 11 (1 major) | 0 | 0 | 3 | 0 | 0 | 0 | 8 |
| `sonnet.prev` | 126 | 103 | 18 | 5 | 82% | 96% | 6 | 28 | 19 (5 major) | 0 | 1 (1 major) | 2 | 1 | 1 | 0 | 10 |
| `sonnet.examples` | 126 | 106 | 20 | 0 | 84% | 100% | 0 | 28 | 21 | 0 | 0 | 5 | 0 | 0 | 0 | 2 |
| `sonnet.noctx` | 126 | 95 | 26 | 5 | 75% | 96% | 5 | 38 | 23 (5 major) | 3 | 1 | 3 | 1 | 1 | 3 | 8 |
| `sonnet.medium` | 126 | 109 | 17 | 0 | 87% | 100% | 0 | 23 | 12 | 0 | 1 | 2 | 1 | 1 | 0 | 6 |
| `sonnet.checks` | 126 | 108 | 17 | 1 | 86% | 99% | 1 | 25 | 12 (1 major) | 0 | 0 | 3 | 0 | 2 | 0 | 9 |
| `haiku.rules` | 125 | 66 | 53 | 6 | 53% | 95% | 6 | 79 | 45 (5 major) | 5 | 4 (1 major) | 8 | 1 | 0 | 1 | 21 |
| `haiku.glossary` | 126 | 65 | 54 | 7 | 52% | 94% | 7 | 84 | 42 (4 major) | 2 | 4 (2 major) | 10 | 0 | 2 (1 major) | 0 | 31 |
| `haiku.nospell` | 126 | 67 | 53 | 6 | 53% | 95% | 6 | 84 | 36 (4 major) | 2 | 5 (1 major) | 11 | 0 | 2 (1 major) | 0 | 34 |
| `haiku.senses` | 126 | 73 | 45 | 8 | 58% | 94% | 8 | 74 | 41 (4 major) | 3 (1 major) | 4 (2 major) | 9 | 0 | 2 (1 major) | 0 | 23 |
| `haiku.prev` | 126 | 56 | 60 | 10 | 44% | 92% | 10 | 106 | 60 (9 major) | 8 (1 major) | 5 | 14 | 4 | 1 | 0 | 24 |
| `haiku.examples` | 126 | 60 | 56 | 10 | 48% | 92% | 10 | 89 | 45 (6 major) | 7 | 8 (3 major) | 12 (1 major) | 5 | 2 | 0 | 20 |
| `haiku.noctx` | 126 | 54 | 61 | 11 | 43% | 91% | 15 | 101 | 69 (14 major) | 2 | 5 (1 major) | 5 | 4 | 0 | 0 | 31 |
| `haiku.medium` | 125 | 65 | 51 | 9 | 52% | 93% | 9 | 88 | 43 (7 major) | 8 | 8 (2 major) | 7 | 2 | 0 | 0 | 29 |
| `haiku.checks` | 126 | 67 | 52 | 7 | 53% | 94% | 7 | 80 | 42 (4 major) | 2 | 4 (2 major) | 10 | 0 | 1 (1 major) | 0 | 28 |
| `qwen.rules` | 42 | 13 | 19 | 10 | 31% | 76% | 10 | 48 | 29 (7 major) | 4 (1 major) | 2 (2 major) | 6 | 1 | 1 | 0 | 15 |
| `qwen.glossary` | 42 | 15 | 18 | 9 | 36% | 79% | 10 | 50 | 20 (4 major) | 3 (1 major) | 4 (3 major) | 10 (1 major) | 1 | 0 | 1 (1 major) | 21 |
| `qwen.nospell` | 42 | 15 | 18 | 9 | 36% | 79% | 10 | 49 | 19 (4 major) | 3 (1 major) | 4 (3 major) | 8 (1 major) | 2 | 0 | 1 (1 major) | 22 |
| `qwen.senses` | 42 | 13 | 19 | 10 | 31% | 76% | 11 | 52 | 25 (5 major) | 2 (1 major) | 4 (3 major) | 11 (1 major) | 0 | 0 | 1 (1 major) | 20 |
| `qwen.prev` | 42 | 13 | 21 | 8 | 31% | 81% | 10 | 46 | 22 (4 major) | 3 (1 major) | 3 (3 major) | 10 (2 major) | 3 | 2 | 0 | 13 |
| `qwen.examples` | 42 | 15 | 16 | 11 | 36% | 74% | 12 | 40 | 28 (7 major) | 2 (1 major) | 3 (3 major) | 11 (1 major) | 1 | 0 | 0 | 7 |
| `qwen.noctx` | 42 | 12 | 19 | 11 | 29% | 74% | 13 | 48 | 34 (8 major) | 3 (1 major) | 5 (4 major) | 9 | 1 | 1 | 0 | 8 |
| `qwen.temp3` | 42 | 14 | 17 | 11 | 33% | 74% | 11 | 44 | 29 (6 major) | 1 (1 major) | 2 (1 major) | 9 (2 major) | 2 | 0 | 1 (1 major) | 11 |
| `qwen.nopenalty` | 42 | 14 | 17 | 11 | 33% | 74% | 12 | 45 | 25 (6 major) | 1 (1 major) | 4 (2 major) | 10 (3 major) | 1 | 0 | 0 | 16 |
| `qwen.think` | 12 | 0 | 0 | 12 | 0% | 0% | 12 | 0 | 0 | 0 | 1 (1 major) | 11 (11 major) | 0 | 0 | 0 | 0 |
| `qwen.checks` | 42 | 16 | 17 | 9 | 38% | 79% | 9 | 46 | 20 (5 major) | 2 | 3 (2 major) | 9 (1 major) | 1 | 0 | 1 (1 major) | 19 |
| `final.sonnet` | 126 | 112 | 14 | 0 | 89% | 100% | 0 | 18 | 10 | 0 | 0 | 3 | 2 | 0 | 0 | 3 |
| `final.haiku` | 126 | 71 | 49 | 6 | 56% | 95% | 6 | 69 | 35 (6 major) | 4 | 7 | 8 | 2 | 3 | 0 | 16 |
| `latency.sonnet` | 42 | 36 | 6 | 0 | 86% | 100% | 0 | 9 | 5 | 0 | 0 | 3 | 0 | 0 | 0 | 1 |
| `latency.haiku` | 42 | 28 | 12 | 2 | 67% | 95% | 2 | 20 | 10 (1 major) | 2 | 1 (1 major) | 3 | 1 | 0 | 0 | 5 |
| `final.qwen-raw` | 42 | 10 | 22 | 10 | 24% | 76% | 10 | 51 | 26 (6 major) | 1 | 4 (3 major) | 11 | 1 | 1 | 1 (1 major) | 16 |
| `final.qwen-app` | 42 | 10 | 22 | 10 | 24% | 76% | 10 | 51 | 26 (6 major) | 1 | 4 (3 major) | 11 | 1 | 1 | 1 (1 major) | 16 |

## Older hand-made fixtures (25 sentences the app was tuned on before this round)

These carry the app's old special cases (the 酒店 sense). They guard against regressions and are not part of the dev or held-out numbers.

| Configuration | n | Correct | Minor only | Wrong | Pattern screen passes |
|---|---|---|---|---|---|
| `baseline.sonnet` | 75 | 75 | 0 | 0 | 74/75 |
| `baseline.haiku` | 75 | 61 | 13 | 1 | 67/75 |
| `baseline.qwen-raw` | 25 | 24 | 1 | 0 | 25/25 |
| `baseline.qwen-app` | 25 | 24 | 1 | 0 | 25/25 |
| `sonnet.rules` | 75 | 72 | 3 | 0 | 75/75 |
| `sonnet.glossary` | 75 | 73 | 2 | 0 | 75/75 |
| `sonnet.nospell` | 75 | 73 | 2 | 0 | 75/75 |
| `sonnet.senses` | 75 | 73 | 2 | 0 | 75/75 |
| `sonnet.prev` | 75 | 73 | 2 | 0 | 75/75 |
| `sonnet.examples` | 75 | 72 | 3 | 0 | 73/75 |
| `sonnet.noctx` | 75 | 73 | 2 | 0 | 75/75 |
| `sonnet.medium` | 75 | 71 | 4 | 0 | 75/75 |
| `sonnet.checks` | 75 | 73 | 2 | 0 | 75/75 |
| `haiku.rules` | 75 | 67 | 8 | 0 | 67/75 |
| `haiku.glossary` | 75 | 58 | 17 | 0 | 64/75 |
| `haiku.nospell` | 75 | 59 | 16 | 0 | 65/75 |
| `haiku.senses` | 75 | 58 | 17 | 0 | 64/75 |
| `haiku.prev` | 75 | 58 | 17 | 0 | 64/75 |
| `haiku.examples` | 75 | 64 | 11 | 0 | 68/75 |
| `haiku.noctx` | 75 | 58 | 17 | 0 | 64/75 |
| `haiku.medium` | 75 | 60 | 15 | 0 | 62/75 |
| `haiku.checks` | 75 | 58 | 17 | 0 | 64/75 |
| `final.sonnet` | 75 | 72 | 3 | 0 | 75/75 |
| `final.haiku` | 75 | 58 | 17 | 0 | 65/75 |
| `final.qwen-raw` | 25 | 24 | 1 | 0 | 25/25 |
| `final.qwen-app` | 25 | 24 | 1 | 0 | 25/25 |

## Latency (all 69 new passages; Claude calls ran 4 at a time, Qwen one at a time)

| Configuration | First token p50 | First token p95 | Total p50 | Total p95 | Model calls |
|---|---|---|---|---|---|
| `baseline.sonnet` | 1.0 s | 2.2 s | 1.6 s | 2.9 s | 207 |
| `baseline.haiku` | 0.7 s | 2.2 s | 1.1 s | 2.5 s | 207 |
| `baseline.qwen-raw` | 5.1 s | 10.1 s | 11.8 s | 60.3 s | 69 |
| `baseline.qwen-app` | 5.2 s | 20.9 s | 10.1 s | 41.4 s | 69 |
| `sonnet.rules` | 1.3 s | 2.6 s | 1.7 s | 3.3 s | 207 |
| `sonnet.glossary` | 1.2 s | 3.1 s | 1.6 s | 3.5 s | 207 |
| `sonnet.nospell` | 1.1 s | 2.5 s | 1.6 s | 3.2 s | 207 |
| `sonnet.senses` | 1.1 s | 3.1 s | 1.6 s | 4.6 s | 207 |
| `sonnet.prev` | 0.9 s | 2.8 s | 1.6 s | 3.2 s | 207 |
| `sonnet.examples` | 1.0 s | 2.6 s | 1.6 s | 3.1 s | 207 |
| `sonnet.noctx` | 0.9 s | 4.3 s | 1.6 s | 4.8 s | 207 |
| `sonnet.medium` | 1.1 s | 2.5 s | 1.6 s | 3.0 s | 207 |
| `sonnet.checks` | 1.2 s | 3.1 s | 1.7 s | 3.5 s | 211 |
| `haiku.rules` | 0.7 s | 2.1 s | 1.2 s | 2.6 s | 207 |
| `haiku.glossary` | 0.7 s | 2.0 s | 1.1 s | 2.2 s | 207 |
| `haiku.nospell` | 0.7 s | 2.0 s | 1.1 s | 2.5 s | 207 |
| `haiku.senses` | 0.7 s | 2.0 s | 1.1 s | 2.5 s | 207 |
| `haiku.prev` | 0.7 s | 2.9 s | 1.1 s | 3.3 s | 207 |
| `haiku.examples` | 0.7 s | 1.2 s | 1.1 s | 1.5 s | 207 |
| `haiku.noctx` | 0.6 s | 1.9 s | 1.1 s | 2.2 s | 207 |
| `haiku.medium` | 0.7 s | 1.5 s | 1.1 s | 2.0 s | 207 |
| `haiku.checks` | 0.7 s | 2.0 s | 1.1 s | 2.5 s | 214 |
| `qwen.rules` | 2.5 s | 18.4 s | 5.2 s | 25.3 s | 42 |
| `qwen.glossary` | 2.0 s | 4.3 s | 4.9 s | 8.0 s | 42 |
| `qwen.nospell` | 2.9 s | 8.6 s | 5.9 s | 12.3 s | 42 |
| `qwen.senses` | 2.0 s | 4.3 s | 4.6 s | 8.0 s | 42 |
| `qwen.prev` | 0.9 s | 1.6 s | 3.4 s | 6.3 s | 42 |
| `qwen.examples` | 1.7 s | 6.6 s | 3.5 s | 9.6 s | 42 |
| `qwen.noctx` | 0.6 s | 1.3 s | 2.5 s | 6.0 s | 42 |
| `qwen.temp3` | 1.8 s | 5.5 s | 3.5 s | 6.8 s | 42 |
| `qwen.nopenalty` | 4.1 s | 11.7 s | 9.1 s | 15.6 s | 42 |
| `qwen.think` | 248.9 s | 248.9 s | 250.2 s | 250.2 s | 12 |
| `qwen.checks` | 2.7 s | 217.6 s | 4.9 s | 220.0 s | 42 |
| `final.sonnet` | 1.2 s | 8.8 s | 1.7 s | 9.5 s | 209 |
| `final.haiku` | 0.6 s | 2.1 s | 1.1 s | 2.4 s | 212 |
| `latency.sonnet` | 1.0 s | 2.4 s | 1.6 s | 3.0 s | 43 |
| `latency.haiku` | 0.7 s | 2.1 s | 1.1 s | 2.8 s | 43 |
| `final.qwen-raw` | 2.1 s | 6.1 s | 4.2 s | 8.5 s | 69 |
| `final.qwen-app` | 2.6 s | 5.0 s | 3.5 s | 6.1 s | 69 |

## Configurations

- `baseline.sonnet`: Sonnet 5.5, old prompt. Frozen pre-tuning prompt (old claude.ts), effort low, server-side fallback on Sonnet.
- `baseline.haiku`: Haiku 5.5, old prompt. Frozen pre-tuning prompt (old claude.ts), effort low, server-side fallback on Sonnet.
- `baseline.qwen-raw`: Qwen3.5 9B, old prompt, raw model. Frozen pre-tuning system and JSON prompt exactly as the old local translator sent them, temperature 0, think off, no post-check.
- `baseline.qwen-app`: Qwen3.5 9B, old app pipeline (bridge on :4317). createLocalTranslator() as shipped before tuning, through the production bridge: includes the 酒店 hints and one corrective retry.
- `sonnet.rules`: sonnet: new instructions only. Lever 1. The new instruction set (faithful, negation, numbers, idioms, names, vernacular, register, data); the old message layout and glossary.
- `sonnet.glossary`: sonnet: + new message and name spellings. Lever 2. Adds the new message: glossary limited to the sentence, names with the exact spelling to write, paragraph window.
- `sonnet.nospell`: sonnet: new message, names as plain pinyin. Ablation of lever 2: the new message layout, but name glossary lines carry only the numbered pinyin, not a ready spelling.
- `sonnet.senses`: sonnet: + dictionary senses of older words. Lever 2b. As lever 2, and the glossary also carries words the dictionary marks archaic, literary, storytelling or dialect (卻說, 洒家, 俺).
- `sonnet.prev`: sonnet: previous sentence only. Lever 2c. The sentence before the selected one instead of the whole paragraph.
- `sonnet.examples`: sonnet: + worked examples. Lever 3. Adds four worked examples from public-domain books.
- `sonnet.noctx`: sonnet: no paragraph context. Ablation of lever 2: the sentence alone, no paragraph.
- `sonnet.medium`: sonnet: effort medium. Lever 4. As lever 2 with output_config.effort medium instead of low.
- `sonnet.checks`: sonnet: + checks and one corrective retry. Lever 5. As lever 2 with the mechanical checks (names, negation, numbers, units, leftover Chinese, commentary, length) and one retry.
- `haiku.rules`: haiku: new instructions only. Lever 1. The new instruction set (faithful, negation, numbers, idioms, names, vernacular, register, data); the old message layout and glossary.
- `haiku.glossary`: haiku: + new message and name spellings. Lever 2. Adds the new message: glossary limited to the sentence, names with the exact spelling to write, paragraph window.
- `haiku.nospell`: haiku: new message, names as plain pinyin. Ablation of lever 2: the new message layout, but name glossary lines carry only the numbered pinyin, not a ready spelling.
- `haiku.senses`: haiku: + dictionary senses of older words. Lever 2b. As lever 2, and the glossary also carries words the dictionary marks archaic, literary, storytelling or dialect (卻說, 洒家, 俺).
- `haiku.prev`: haiku: previous sentence only. Lever 2c. The sentence before the selected one instead of the whole paragraph.
- `haiku.examples`: haiku: + worked examples. Lever 3. Adds four worked examples from public-domain books.
- `haiku.noctx`: haiku: no paragraph context. Ablation of lever 2: the sentence alone, no paragraph.
- `haiku.medium`: haiku: effort medium. Lever 4. As lever 2 with output_config.effort medium instead of low.
- `haiku.checks`: haiku: + checks and one corrective retry. Lever 5. As lever 2 with the mechanical checks (names, negation, numbers, units, leftover Chinese, commentary, length) and one retry.
- `qwen.rules`: qwen: new instructions only. Lever 1. The new instruction set with the old JSON message (and the old 酒店 hint).
- `qwen.glossary`: qwen: + new message and name spellings. Lever 2. Adds the tagged message: glossary limited to the sentence with name spellings, paragraph window.
- `qwen.nospell`: qwen: new message, names as plain pinyin. Ablation of lever 2: the tagged message, but names carry only the numbered pinyin.
- `qwen.senses`: qwen: + dictionary senses of older words. Lever 2b. As lever 2, and the glossary also carries words the dictionary marks archaic, literary, storytelling or dialect.
- `qwen.prev`: qwen: previous sentence only. Lever 2c. The sentence before the selected one instead of the whole paragraph.
- `qwen.examples`: qwen: + worked examples. Lever 3. Adds four worked examples.
- `qwen.noctx`: qwen: no paragraph context. Ablation: the sentence alone.
- `qwen.temp3`: qwen: temperature 0.3. Lever 4a. As lever 2 at temperature 0.3 (the bridge forces 0).
- `qwen.nopenalty`: qwen: presence penalty 0. Lever 4c. As lever 2 with the presence penalty of 1.5 that the model file sets by default turned off (the bridge does not send it).
- `qwen.think`: qwen: thinking on. Lever 4b. As lever 2 with thinking on (the bridge forces it off; needs a bigger context and output budget).
- `qwen.checks`: qwen: + checks and one corrective retry. Lever 5. As lever 2 with the mechanical checks and one corrective retry.
- `final.sonnet`: Sonnet 5.5, shipped prompt. The shipped prompt (src/translate/prompt.ts), glossary with dictionary senses of older words, effort low, mechanical checks and one corrective retry.
- `final.haiku`: Haiku 5.5, shipped prompt. The shipped prompt (src/translate/prompt.ts), glossary with dictionary senses of older words, effort low, mechanical checks and one corrective retry.
- `latency.sonnet`: Sonnet 5.5, shipped prompt, one request at a time. Latency run: dev passages, sequential, fresh calls (run with --fresh --concurrency 1).
- `latency.haiku`: Haiku 5.5, shipped prompt, one request at a time. Latency run: dev passages, sequential, fresh calls (run with --fresh --concurrency 1).
- `final.qwen-raw`: Qwen3.5 9B, shipped prompt, raw model. The shipped prompt and checks sent straight to Ollama with the bridge options (temperature 0, think off, 4096 context).
- `final.qwen-app`: Qwen3.5 9B, shipped app pipeline (bridge on :4317). createLocalTranslator() as shipped now, through the production bridge: prompt, checks, one corrective retry, unverified label.

## What still goes wrong

### `final.sonnet` held-out passages that were not fully correct

- `hlm-wang-indulged` (minor): wrong-sense/minor: The source says 別人 (other people), not specifically boys; narrowing it is a slight inaccuracy. wrong-sense/minor: 老太太 is the family matriarch, but "his grandmother" is still accurate here, so the rendering is only slightly less clear as to who she is.
- `hlm-wang-indulged` (minor): wrong-sense/minor: 別人 means 'other people', not specifically 'other boys'; the narrowing is small and doesn't distort the point. register-fluency/minor: 'Old Lady' is a vague rendering of 老太太; 'Grandmother' or 'the Matriarch' makes clear this is Daiyu's grandmother.
- `hlm-wang-indulged` (minor): wrong-sense/minor: 別人 means 'other people' in general, not specifically boys, so the rendering narrows the meaning slightly. wrong-sense/minor: 老太太 is Grandmother Jia, Daiyu's grandmother, but 'the old lady' is vague and could be read as any elderly woman.
- `hlm-just-in-time` (minor): register-fluency/minor: The maids are addressing Daiyu's party, so "her/she" shifts the person oddly; the sense survives but "you" would be more natural. register-fluency/minor: 臺磯 is just the stone steps, so "of the terrace" adds a slightly inaccurate detail, though the meaning is basically preserved.
- `hlm-just-in-time` (minor): wrong-sense/minor: 迎上來 means hurrying forward to meet them, and 'down' is not in the source, though the steps make it plausible.
- `xyj-patriarch-scold` (minor): wrong-sense/minor: 戒尺 is a disciplinary ruler or rod, not a 'clapper'; the reader loses the sense of a rod for punishing, though the later beating makes the use somewhat clear.
- `xyj-patriarch-scold` (minor): wrong-sense/minor: 戒尺 is a disciplinary ruler or rod, and the plain "ruler" loses the disciplinary sense, though the context of the scolding makes the meaning fairly clear.
- `sg-lu-zhi` (minor): wrong-sense/minor: 中郎將 is a specific title (General of the Palace Gentlemen); "Colonel" is a loose rendering that drops "Palace/Zhonglang", though the meaning stays broadly intact.
- `sg-lu-zhi` (minor): register-fluency/minor: The title 中郎將 is one office, but "Attendant and General" reads as two titles.
- `sh-zhishen-bianliao` (minor): wrong-sense/minor: 胡亂 means 'any old way / casually', not 'secretly'; the secrecy is expressed separately in the next clause.
- `sh-zhishen-bianliao` (minor): omission/minor: "胡亂" (any old way, casually) is not rendered, though the sense of selling a little without fuss is mostly carried.
- `sh-village-tavern` (minor): register-fluency/minor: 回 means to buy and bring back flour to make flatbread; the candidate loses the fetching sense but the meaning is mostly intact. register-fluency/minor: The four names are given as bare given names, so an English reader cannot tell who Chao and Ba are (the two officers) and may be confused, though they are read as names.
- `sh-village-tavern` (minor): name-mangled/minor: Names are given as bare single-character given names, so Lin Chong, Dong Chao and Xue Ba are not identified and the reader cannot tell who the four are, though the names themselves are not misread. wrong-sense/minor: Minor: the tavern keeper is the one told to buy the goods, which is the source's meaning, so this is fine; 'two jiao of wine' leaves the measure unexplained for an English reader.
- `sh-mouth-bland` (minor): idiom-literal/minor: The crude idiom 淡出鳥來 is rendered as a redundant 'bland... tasteless' with 'damn' as the intensifier, so the 'birds' expletive is lost, though the blandness is kept.
- `sh-mouth-bland` (minor): idiom-literal/minor: The idiom 淡出鳥來 is rendered as feathers growing, an invented image, though blandness and the crude tone are kept.
- `ky-dead` (minor): register-fluency/minor: Awkward and tense-shifted; 'To this day I still haven't seen him' is more natural, and 'had died' shifts the present conclusion into the past.
- `ly-three-checks` (minor): wrong-sense/minor: This reads 傳 as transmitting to others, a traditional variant but less standard than the received-teaching sense (have I failed to practice what I was taught); the reading is defensible, and the meani
- `tang-wanderer` (minor): register-fluency/minor: The first-person 'I' is added though the source has no pronoun, and the poem is usually read as narrated about a traveler ('he'); this is a defensible choice, but it is inconsistent with the third-per

### `final.haiku` held-out passages that were not fully correct

- `hlm-jiamu-blind` (minor): wrong-sense/minor: The dismissive rhetorical question is rendered as a plain question, which loses its force, though the following lines make the intent fairly clear. idiom-literal/minor: The figure of 'blind people with eyes open' meaning illiterate is flattened to literal 'not blind', so the point that they are barely literate is lost.
- `hlm-jiamu-blind` (minor): wrong-sense/minor: The dismissive rhetorical sense ('what books do they read?') is kept, but 'are they reading' reads more like a literal question and the tone is slightly weakened. idiom-literal/minor: The figure 'blind people with eyes open' (meaning illiterate) is reduced to 'aren't blind', so the point about literacy is lost and it could be read as literal blindness.
- `hlm-jiamu-blind` (minor): wrong-sense/minor: The dismissive rhetorical question is rendered as a plain question, which loses its force, though the following lines make the intent fairly clear. idiom-literal/minor: The figure of 'blind people with eyes open' meaning illiterate is flattened to literal 'not blind', so the point that they are barely literate is lost.
- `hlm-lifeblood` (minor): wrong-sense/minor: 命根子 is rendered as a generic 'treasure', which loses the 'life-root' or lifeline sense. The jade is still implied, so the meaning is mostly intact.
- `hlm-lifeblood` (minor): idiom-literal/minor: 命根子 is rendered as a bland 'precious thing', losing the 'life-root' image of his very lifeline, though the meaning of something dearly held survives. register-fluency/minor: The reproachful, exasperated force of 何苦 ('why ever bother') is flattened into a plain question, and 摔 ('hurl hard') is rendered weakly as 'throw down'.
- `hlm-lifeblood` (minor): wrong-sense/minor: 摔 means to dash or hurl down hard, and "throw away" suggests discarding; "life's treasure" also softens 命根子 (lifeline) and does not clearly point to the jade.
- `hlm-wang-indulged` (minor): wrong-sense/minor: 老太太 is Grandmother Jia, Daiyu's grandmother; "the old lady" is vague and could be read as some unrelated old woman, though the context makes the meaning mostly clear.
- `hlm-wang-indulged` (minor): wrong-sense/minor: 老太太 is Grandmother Jia, the family matriarch and Daiyu's grandmother, not a generic 'old lady'; the reader may not identify her. omission/minor: 一處 ('in the same place') is dropped, so the point that he was raised alongside the girls is weaker.
- `hlm-wang-indulged` (minor): wrong-sense/minor: 老太太 is Grandmother Jia, the family matriarch and Daiyu's grandmother; "the old lady" is generic and loses the identification, though the doting is correctly attributed.
- `hlm-liu-laolao-ask` (minor): wrong-sense/minor: "太太" is the lady of the house, Lady Wang, and 陪房 is a servant who came with her dowry. "Your lady" and "attendant" are loose renderings, but the gist is preserved.
- `hlm-liu-laolao-ask` (minor): wrong-sense/minor: 陪房 is a servant who came with her as part of her dowry; "attendant" loses the dowry/marriage sense, though the basic idea of accompanying her is kept.
- `hlm-liu-laolao-ask` (minor): wrong-sense/minor: 陪房 is a servant who came as part of the lady's dowry on her marriage, and "attendant" loses that sense, though the link to the lady is kept.
- `hlm-just-in-time` (minor): wrong-sense/minor: 念 means was thinking of or talking about; "asking after you" suggests inquiring about her welfare, which shifts the nuance slightly. omission/minor: 穿紅著綠 means dressed in red and green, but "in red and green" is fine; however "hurried down" replaces "hurried forward", a slight shift because the maids were on the steps and came up to meet them (迎上來
- `hlm-just-in-time` (minor): wrong-sense/minor: 念 means was talking about or thinking of, not 'asking after'. The nuance shifts slightly, but the meaning is mostly kept. addition/minor: 上來 means forward or up toward them. 'Down' reverses the direction, since the maids were on the steps and came toward the arrivals.
- `hlm-just-in-time` (minor): wrong-sense/minor: 念 means was thinking of or talking about her, not 'asking after' her. The sense is close but slightly shifted. omission/minor: 穿紅著綠 (dressed in red and green) is shortened to 'in red and green'. This is acceptable, so the omission is trivial.
- `xyj-patriarch-scold` (minor): wrong-sense/minor: 手持戒尺 means he held a disciplinary ruler (rod); 'teacher's ruler' loses the disciplinary sense and 'took up' is slightly off.
- `xyj-patriarch-scold` (wrong): wrong-sense/major: 戒尺 is a disciplinary ruler or rod, not a clapper; the reader misses the instrument of punishment (the later three blows on the head). register-fluency/minor: 猢猻 here is a scolding insult, and "little" softens it and adds a nuance that is not in the source.
- `xyj-one-opens` (minor): idiom-literal/minor: The proverb is rendered almost word for word, so the sense of quick comprehension is weak, though a reader can still infer it.
- `xyj-bajie-dates` (minor): omission/minor: Does not say the dates went down into his belly (咽在肚裡), though the meaning is mostly carried. register-fluency/minor: The causal 'since' clause is fused awkwardly with 'he saw...', so it reads as if the appetite caused him to see the dates.
- `xyj-bajie-dates` (minor): register-fluency/minor: The causal 'since' is illogical, because a big appetite did not cause him to see the dates; the sentence is clumsily joined. omission/minor: 'into his belly' is lost; the meaning is mostly kept by 'gulped down'.
- `xyj-pills` (wrong): wrong-sense/major: The speaker is saying he himself has never seen it ("I"), but the candidate turns it into a question addressed to "you".
- `sg-lu-zhi` (minor): wrong-sense/minor: The source names the rebel leader 張角, whose standard romanization is Zhang Jiao; "Jue" is a variant reading, so the name differs from the reference. omission/minor: The title 中郎將 (Palace Attendant-General / General of the Palace Gentlemen) is reduced to a generic "Commander", losing the specific rank.
- `sg-lu-zhi` (minor): wrong-sense/minor: 中郎將 is a general-grade title (Palace Attendant-General), not simply 'Captain'; the rank is understated.
- `sg-lu-zhi` (minor): wrong-sense/minor: The title 中郎將 (General of the Palace Gentlemen) is flattened to a generic "Commander", losing the specific rank.
- `sh-what-state` (minor): omission/minor: 大驚 and 連忙 (greatly startled, hurriedly) are rendered only as an exclamation, so the 'hurriedly' nuance is lost.
- `sh-what-state` (minor): addition/minor: This turns 大驚 (greatly startled) into an invented exclamation, and the hurried quality of 連忙 is lost.
- `sh-zhishen-bianliao` (minor): wrong-sense/minor: 胡亂 means 'just any old way, casually'; the candidate renders it as 'whatever you have', which shifts the sense toward the kind of wine rather than selling it without fuss.
- `sh-zhishen-bianliao` (minor, labeled unverified): omission/minor: The sense of 胡亂 ('any old way', casually) is only loosely carried by 'Just', and the 'Zhishen said' attribution is missing, though the meaning survives.
- `sh-zhishen-bianliao` (minor, labeled unverified): omission/minor: 「胡亂」 ('any old way, casually') is not rendered, though the sense of selling just a little casually is mostly kept.
- `sh-village-tavern` (minor): name-mangled/minor: The four are given by bare single given-name characters without identifying them (Lu Zhishen, Lin Chong, Dong Chao, Xue Ba), so the reader cannot tell who they are or that two are officers. wrong-sense/minor: 回 means fetching or buying back flour, which is slightly different from simply asking for it, but the gist is intact.
- `sh-village-tavern` (minor): name-mangled/minor: Uses bare given-name characters for Lin Chong, Dong Chao and Xue Ba without surnames, so the reader may not identify the two officers; the source itself abbreviates these names, so this is a small cla
- `sh-village-tavern` (minor): name-mangled/minor: The four are given as bare single characters, 'Shen' standing for Zhishen (Lu Zhishen), so the names are incomplete and unclear to the reader, though they are at least treated as names.
- `sh-mouth-bland` (minor): idiom-literal/minor: "birdlike" is meaningless; the crude idiom means the mouth is so tasteless it could spit out "birds", with 鳥 as a vulgar expletive. wrong-sense/minor: 員外 is a landlord or squire title, and "Master" is a slightly off rendering, though a defensible one. addition/minor: "up" is a small addition, since the source does not say the food came up the mountain, though it is implied.
- `sh-mouth-bland` (minor): omission/minor: The vulgar 鳥 in 淡出鳥來 is dropped, so the crude, grumbling register is lost, though the blandness is conveyed.
- `sh-mouth-bland` (minor): idiom-literal/minor: The crude 鳥 expletive is lost and 'gone sour' is invented; the idiom means the mouth is damn tasteless.
- `ky-dead` (minor): omission/minor: The dash marking the broken-off sentence is smoothed into a complete sentence, losing the trailing-off effect.
- `ky-dead` (minor): register-fluency/minor: The dash that breaks off the sentence is smoothed into a complete sentence, so the narrator's trailing-off is lost.
- `ky-dead` (minor): register-fluency/minor: The dash that breaks off the sentence is smoothed into a complete sentence, so the narrator's trailing-off is lost.
- `gx-road` (minor): register-fluency/minor: The source speaks of roads on the earth in general; the singular 'the road' with 'there' reads as one specific spot, which is slightly off but the meaning is mostly intact.
- `kr-book` (minor): wrong-sense/minor: 横竖 means 'in any case, anyway'. 'Either way' is close but a little unnatural, and it is acceptable only as a near-synonym. wrong-sense/minor: 字缝 is the gaps between characters, though the reference accepts 'between the lines', so this is only a slight loss of precision.
- `kr-book` (minor): idiom-literal/minor: 横竖 means 'in any case'; 'either way' is a bit odd but the meaning of 'anyway' is largely retained.
- `kr-book` (minor): wrong-sense/minor: 满本 means the whole book, not every page, and the clause is awkwardly restructured.
- `ly-three-checks` (minor): wrong-sense/minor: 為人謀 means planning or counselling on behalf of others, not just 'doing things', and 'unfaithful' is a loose rendering of 不忠 (not doing one's utmost). The overall sense survives.
- `tang-spring-dawn` (minor): negation-modality/minor: The rhetorical 'who knows / I wonder how many' sense of 知多少 is lost; it reads as a plain question, though the implication that many fell mostly survives. register-fluency/minor: This is a verbless fragment, and the sense of hearing the storm during the night is only implied.
- `tang-wanderer` (minor): addition/minor: The source has no first-person narrator, so "I" is invented; the poem speaks of the traveler in the third person, and the candidate also leaves the traveler's garment unstated. wrong-sense/minor: "Just before leaving" is acceptable, but the pronoun "it" has no antecedent, so the garment is never identified. wrong-sense/minor: "Three springs" can be read as three years rather than the three months of spring.
- `tang-wanderer` (minor): addition/minor: The poem has no first-person speaker; 'I' is an added narrator, though it is a plausible reading of the traveler's voice.

### `final.qwen-raw` held-out passages that were not fully correct

- `hlm-jiamu-blind` (wrong): wrong-sense/major: The line is about the girls, not Daiyu. Rendering it as "you" makes Grandmother Jia insult Daiyu, which is the trap named in the key. negation-modality/major: The source says "not an open-eyed blind person, that's all", a modest minimization meaning they are minimally literate. The candidate turns it into a harsh insult that they are as bad as illiterate pe name-mangled/minor: "Master Grandmother" is an odd rendering of 賈母; "Grandmother Jia" would be correct. wrong-sense/minor: "Barely" adds a stronger sense of illiteracy than 不過是認得兩個字 ("just know a few characters") carries.
- `hlm-lifeblood` (minor): wrong-sense/minor: 命根子 (life-root, his very lifeline) is flattened to 'precious talisman', losing the 'life' sense, and 那 becomes 'this'. register-fluency/minor: The conditional 'when you are angry' is turned into an abstract statement, which is slightly awkward but keeps the meaning.
- `hlm-liu-laolao-ask` (minor): omission/minor: The ingratiating smile (陪笑) and Granny Liu as speaker are not conveyed, so the humble tone is lost. wrong-sense/minor: 陪房 means a servant who came with her dowry, and the candidate renders it as a generic retainer, losing that sense. addition/minor: The source says only 太太; the name is supplied from outside the passage, though it is correct.
- `hlm-just-in-time` (minor): wrong-sense/minor: 老太太 is the family matriarch, the Old Lady, and "Grandma" is a slightly off register for maids addressing her, though the meaning is understandable and acceptable by role. omission/minor: 可巧 (by lucky coincidence, right on time) is not rendered; the sense of fortunate timing is weakened.
- `xyj-patriarch-scold` (minor): wrong-sense/minor: 戒尺 is a disciplinary ruler or rod, not a clapper, though the action of holding it is conveyed. wrong-sense/minor: The sense is 'you refuse to learn this way, refuse to learn that way', and the rendering blurs the refusal into a general statement that he learns nothing.
- `xyj-one-opens` (minor): idiom-literal/minor: The proverb is half-literal and muddled: 'opening' is kept but 'essence' is added, and it loses the plain sense that once one point is understood, all the rest follows. addition/minor: 'Diligently' is not in the source, which only says he practiced and refined it himself.
- `xyj-bajie-dates` (minor): wrong-sense/minor: 鍾子 is a small cup, not a bowl. register-fluency/minor: 原來是食腸大大的 means he is a big eater by nature; this wording is a stilted, literal rendering of the appetite. register-fluency/minor: Stilted storyteller phrasing; "Now Bajie..." is more natural, though the meaning is intact. omission/minor: Omits "into his belly", which is minor; "one go" is an addition but acceptable.
- `sg-tripod-plan` (minor): register-fluency/minor: "Make it your home" is slightly awkward; "home base" would be more natural. addition/minor: "Reclaim" adds a nuance not in 圖中原; "seize" or "plan to take" would be more accurate.
- `sg-lu-zhi` (minor): wrong-sense/minor: 中郎將 is the title Palace Attendant-General / General of the Palace Gentlemen; "middle-lance general" is a literal, garbled rendering of the title. addition/minor: "Master" is added to the name, which the source does not have, though the sense of teacher is implied by 師事.
- `sh-zhishen-bianliao` (minor, labeled unverified): omission/minor: The speaker's rough self-reference 洒家/俺 and the closing 便了 ('that'll be that') are not rendered, but the promise of secrecy and the meaning are intact.
- `sh-village-tavern` (minor): name-mangled/minor: The four names are given as bare single characters (Shen, Chong, Chao, Ba), which hides who they are; Lu Zhishen and Lin Chong in particular cannot be identified, and the surnames of the two officers  wrong-sense/minor: 酒保 is the tavern waiter or barman, not the innkeeper, though the sense of a tavern worker is roughly kept.
- `sh-mouth-bland` (minor): idiom-literal/minor: The vulgar intensifier 鳥 ("my mouth is so bland I could spit out birds") is turned into a simile about a bird's mouth, and "dry" is added, so the crude force is lost although the blandness is kept. omission/minor: The 又 ("again") with its implied grumbling is not rendered.
- `ky-prices` (minor): number-unit/minor: 二十多年前 means 'more than twenty years ago'; '多' is dropped. wrong-sense/minor: 傍午 means around noon, not late morning, though close. omission/minor: 'copper' (铜钱) is dropped, though 'cash' implies it.
- `gx-road` (minor): omission/minor: "本" (originally) is not rendered, which weakens the sense of an original state before anyone walked there.
- `kr-book` (minor): wrong-sense/minor: 仔细看了半夜 means he studied it carefully for half the night, not all night, and the 'carefully' nuance is dropped. omission/minor: 横竖 ('anyway, in any case') is not conveyed; the sense of 'since I couldn't sleep regardless' is lost.
- `ly-three-checks` (wrong): wrong-sense/major: 日三省吾身 conventionally means examining oneself on three points daily; the candidate reads 三 as a count of times and loses the three-item structure. wrong-sense/minor: 与朋友交而不信 concerns being untrustworthy in dealings with friends, not being 'untrue' (which suggests disloyalty or infidelity). wrong-sense/minor: 忠 here means doing one's utmost or being conscientious; 'unfaithful' suggests betrayal or infidelity.
- `tang-spring-dawn` (minor): register-fluency/minor: "Sleeping through spring" suggests sleeping through the whole season, and "I wake unaware" is awkward; it should say that in spring one sleeps without noticing daybreak. wrong-sense/minor: This turns the wondering question "who knows how many have fallen" into a speculative "must be", which slightly alters the nuance, though the sense of many fallen blossoms is kept.
- `tang-wanderer` (wrong): number-unit/major: 三春 means the three months of spring, not three seasons; spring has only one season, so the reader gets a false picture. omission/minor: 密密 (close, dense stitches) is flattened to 'with care', and the garment is not mentioned. wrong-sense/minor: 暉 means sunlight or warmth, but it is rendered as 'kindness', which drops the metaphor, and the rhetorical 'who says' is only weakly conveyed. addition/minor: 'Tender' is not in the source; 寸草 conveys smallness, not tenderness.

### `final.qwen-app` held-out passages that were not fully correct

- `hlm-jiamu-blind` (wrong): wrong-sense/major: The line is about the girls, not Daiyu. Rendering it as "you" makes Grandmother Jia insult Daiyu, which is the trap named in the key. negation-modality/major: The source says "not an open-eyed blind person, that's all", a modest minimization meaning they are minimally literate. The candidate turns it into a harsh insult that they are as bad as illiterate pe name-mangled/minor: "Master Grandmother" is an odd rendering of 賈母; "Grandmother Jia" would be correct. wrong-sense/minor: "Barely" adds a stronger sense of illiteracy than 不過是認得兩個字 ("just know a few characters") carries.
- `hlm-lifeblood` (minor): wrong-sense/minor: 命根子 (life-root, his very lifeline) is flattened to 'precious talisman', losing the 'life' sense, and 那 becomes 'this'. register-fluency/minor: The conditional 'when you are angry' is turned into an abstract statement, which is slightly awkward but keeps the meaning.
- `hlm-liu-laolao-ask` (minor): omission/minor: The ingratiating smile (陪笑) and Granny Liu as speaker are not conveyed, so the humble tone is lost. wrong-sense/minor: 陪房 means a servant who came with her dowry, and the candidate renders it as a generic retainer, losing that sense. addition/minor: The source says only 太太; the name is supplied from outside the passage, though it is correct.
- `hlm-just-in-time` (minor): wrong-sense/minor: 老太太 is the family matriarch, the Old Lady, and "Grandma" is a slightly off register for maids addressing her, though the meaning is understandable and acceptable by role. omission/minor: 可巧 (by lucky coincidence, right on time) is not rendered; the sense of fortunate timing is weakened.
- `xyj-patriarch-scold` (minor): wrong-sense/minor: 戒尺 is a disciplinary ruler or rod, not a clapper, though the action of holding it is conveyed. wrong-sense/minor: The sense is 'you refuse to learn this way, refuse to learn that way', and the rendering blurs the refusal into a general statement that he learns nothing.
- `xyj-one-opens` (minor): idiom-literal/minor: The proverb is half-literal and muddled: 'opening' is kept but 'essence' is added, and it loses the plain sense that once one point is understood, all the rest follows. addition/minor: 'Diligently' is not in the source, which only says he practiced and refined it himself.
- `xyj-bajie-dates` (minor): wrong-sense/minor: 鍾子 is a small cup, not a bowl. register-fluency/minor: 原來是食腸大大的 means he is a big eater by nature; this wording is a stilted, literal rendering of the appetite. register-fluency/minor: Stilted storyteller phrasing; "Now Bajie..." is more natural, though the meaning is intact. omission/minor: Omits "into his belly", which is minor; "one go" is an addition but acceptable.
- `sg-tripod-plan` (minor): register-fluency/minor: "Make it your home" is slightly awkward; "home base" would be more natural. addition/minor: "Reclaim" adds a nuance not in 圖中原; "seize" or "plan to take" would be more accurate.
- `sg-lu-zhi` (minor): wrong-sense/minor: 中郎將 is the title Palace Attendant-General / General of the Palace Gentlemen; "middle-lance general" is a literal, garbled rendering of the title. addition/minor: "Master" is added to the name, which the source does not have, though the sense of teacher is implied by 師事.
- `sh-zhishen-bianliao` (minor, labeled unverified): omission/minor: The speaker's rough self-reference 洒家/俺 and the closing 便了 ('that'll be that') are not rendered, but the promise of secrecy and the meaning are intact.
- `sh-village-tavern` (minor): name-mangled/minor: The four names are given as bare single characters (Shen, Chong, Chao, Ba), which hides who they are; Lu Zhishen and Lin Chong in particular cannot be identified, and the surnames of the two officers  wrong-sense/minor: 酒保 is the tavern waiter or barman, not the innkeeper, though the sense of a tavern worker is roughly kept.
- `sh-mouth-bland` (minor): idiom-literal/minor: The vulgar intensifier 鳥 ("my mouth is so bland I could spit out birds") is turned into a simile about a bird's mouth, and "dry" is added, so the crude force is lost although the blandness is kept. omission/minor: The 又 ("again") with its implied grumbling is not rendered.
- `ky-prices` (minor): number-unit/minor: 二十多年前 means 'more than twenty years ago'; '多' is dropped. wrong-sense/minor: 傍午 means around noon, not late morning, though close. omission/minor: 'copper' (铜钱) is dropped, though 'cash' implies it.
- `gx-road` (minor): omission/minor: "本" (originally) is not rendered, which weakens the sense of an original state before anyone walked there.
- `kr-book` (minor): wrong-sense/minor: 仔细看了半夜 means he studied it carefully for half the night, not all night, and the 'carefully' nuance is dropped. omission/minor: 横竖 ('anyway, in any case') is not conveyed; the sense of 'since I couldn't sleep regardless' is lost.
- `ly-three-checks` (wrong): wrong-sense/major: 日三省吾身 conventionally means examining oneself on three points daily; the candidate reads 三 as a count of times and loses the three-item structure. wrong-sense/minor: 与朋友交而不信 concerns being untrustworthy in dealings with friends, not being 'untrue' (which suggests disloyalty or infidelity). wrong-sense/minor: 忠 here means doing one's utmost or being conscientious; 'unfaithful' suggests betrayal or infidelity.
- `tang-spring-dawn` (minor): register-fluency/minor: "Sleeping through spring" suggests sleeping through the whole season, and "I wake unaware" is awkward; it should say that in spring one sleeps without noticing daybreak. wrong-sense/minor: This turns the wondering question "who knows how many have fallen" into a speculative "must be", which slightly alters the nuance, though the sense of many fallen blossoms is kept.
- `tang-wanderer` (wrong): number-unit/major: 三春 means the three months of spring, not three seasons; spring has only one season, so the reader gets a false picture. omission/minor: 密密 (close, dense stitches) is flattened to 'with care', and the garment is not mentioned. wrong-sense/minor: 暉 means sunlight or warmth, but it is rendered as 'kindness', which drops the metaphor, and the rhetorical 'who says' is only weakly conveyed. addition/minor: 'Tender' is not in the source; 寸草 conveys smallness, not tenderness.

## Checking the judge

- Each passage's own reference translation, offered as a candidate: 67 of 69 judged fully correct, 0 judged wrong (so the judge's false-alarm rate on a good translation is about 3%, all minor).
- Translations with one seeded error: 38 of 38 caught (24 as major, 34 with the right type). By type: wrong-sense 5/5, name-mangled 5/5, negation-modality 6/6, omission 7/7, addition 7/7, idiom-literal 3/3, number-unit 5/5.
- Judging the same outputs twice with different judge samples moved a configuration's strict pass count by 1 to 2 passages out of 81 to 126, so judge noise is small next to the noise of Claude's own sampling.

_Generated by `node scripts/evaluate-translations.mjs`. Do not edit by hand: edit `scripts/eval/report-notes.md` for the narrative._
