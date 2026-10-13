# Translation evaluation

One command runs everything and rewrites `report.md`:

    node scripts/evaluate-translations.mjs

It needs the Anthropic key in `~/.config/dushu/anthropic-api-key` (read from Node at request time, never printed), Ollama
with `qwen3.5:9b-q4_K_M`, and, for the `*-app` configurations, the production server on `127.0.0.1:4317`. Model calls are
cached in `.cache/eval`, so a rerun with nothing changed costs nothing and takes seconds.

## Options

| Option | Meaning |
|---|---|
| `--list` | print every configuration id |
| `--configs a,b` | run only these (default: the baselines and the shipped `final.*` set) |
| `--split dev\|held\|all` | which passages (the older fixtures are always included unless `--no-legacy`) |
| `--reps N` | N samples per Claude passage (Claude cannot run at temperature 0, so one sample is noisy) |
| `--fresh` | ignore the cache for model calls |
| `--judge-seed N` | re-judge the same outputs with a new judge sample (measures judge noise) |
| `--no-judge`, `--no-report`, `--no-legacy`, `--limit N`, `--concurrency N` | what they say |

## What is in here

- `passages.json`: 69 passages from the public-domain texts in `public/samples` (红楼梦, 西游记, 三国, 水浒, three Lu Xun stories,
  the Analects, Tang poems), each located by an exact string in its book. Text and paragraph context are read from the book at run
  time. `split` is `dev` (tuning) or `held` (never used for tuning), about 60/40, with both in every large book.
- `references.json`: the answer key per passage: a reference translation, 3 to 6 checkable meaning points and the traps to watch
  for. Sonnet drafted them (`draft-references.mjs`), then every one was read against the Chinese and fixed by hand.
- `legacy.json`: the 25 hand-made fixtures the app was tuned on before this round. A regression set, not part of the numbers.
- `baseline.mjs`: the prompts the app shipped before tuning, frozen so the "before" numbers can be reproduced.
- `configs.mjs`, `all-configs.mjs`: every configuration, one lever at a time, and the shipped `final.*` ones.
- `judge.mjs`: the grading prompt, error types and deterministic screens. `run.mjs`: running, scoring. `report.mjs`: the report.
- `results/`: one JSON file per configuration with every output, its judgement and timing.
- `report-notes.md`: the hand-written narrative that `report.md` starts with.

## Grading

Each output is graded by Claude Sonnet 5.5 against the answer key and recorded with error types: wrong-sense, name-mangled,
negation-modality, omission, addition, idiom-literal, number-unit, register-fluency, each major or minor. A passage is
**strict pass** with no error, **lenient pass** with no major error. The judge is a Claude model grading Claude and Qwen output;
the held-out failures were also read by hand. See the limits at the top of `report.md`.
