# Universal Dependencies Chinese test sets (word segmentation gate)

`tests/corpus/ud.test.ts` cuts every sentence of these two test sets through the reader's path and scores the cut against the
treebank's words: F1 of exact words, and the crossing rate (the share of the reader's words that are wrong under any granularity).
`baseline.json` holds the numbers recorded on 2026-11-03; the test fails when crossing rises more than 0.03 points or F1 falls more
than 0.3 below them (the tolerances of the plan for unseen books). Record new numbers with
`UPDATE_ZH_BASELINE=1 npx vitest run tests/corpus/ud.test.ts` when a change is meant to move them.

| File | Treebank | Text | Sentences | Words |
|---|---|---|---:|---:|
| `zh_gsdsimp-ud-test.words.txt` | [UD_Chinese-GSDSimp](https://github.com/UniversalDependencies/UD_Chinese-GSDSimp/tree/r2.18), release r2.18, test set | Wikipedia, simplified (converted from UD_Chinese-GSD with manual corrections) | 500 | 12,010 |
| `zh_hk-ud-test.words.txt` | [UD_Chinese-HK](https://github.com/UniversalDependencies/UD_Chinese-HK/tree/r2.18), release r2.18, test set | Film subtitles and Legislative Council proceedings of Hong Kong, traditional | 1,004 | 9,874 |

**License.** Both treebanks are released under the Creative Commons Attribution-ShareAlike 4.0 International license
(`LICENSE.txt`, as the treebanks ship it; full text at https://creativecommons.org/licenses/by-sa/4.0/legalcode). These files are
adapted from them and are under the same license.

**What was changed.** Only the word forms are kept: the FORM column of each sentence's word lines, in order, one sentence per line
and the words separated by one space (multiword-token and empty-node lines dropped, spaces inside a form removed). Lemmas, tags,
features, dependencies and comments are left out. Nothing else was altered.

**Attribution.**

- UD_Chinese-GSDSimp: contributors Peng Qi and Koichi Yasuoka; a simplified-script version of UD_Chinese-GSD (Google's Chinese
  treebank as converted for Universal Dependencies; Google gave permission to drop the original NC restriction on the annotations).
- UD_Chinese-HK: annotated by Herman H. M. Leung and Tak-sum Wong at City University of Hong Kong; contributors Kim Gerdes, John Lee,
  Herman Leung and Tak-sum Wong. Cite: Tak-sum Wong, Kim Gerdes, Herman Leung and John Lee, "Quantitative Comparative Syntax on the
  Cantonese-Mandarin Parallel Dependency Treebank", Depling 2017, pp. 266–275; Herman Leung, Rafaël Poiret, Tak-sum Wong, Xinying Chen,
  Kim Gerdes and John Lee, "Developing Universal Dependencies for Mandarin Chinese", ALR12, 2016, pp. 20–29.
- Universal Dependencies: https://universaldependencies.org/
