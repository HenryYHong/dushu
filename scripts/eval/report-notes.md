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
