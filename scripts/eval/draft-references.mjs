// One-off helper: asks Claude Sonnet to DRAFT the answer key (reference meaning, checkpoints, traps) for each passage.
// The draft is not trusted: references.json is the draft after a line-by-line check by hand. Usage:
//   node scripts/eval/draft-references.mjs        (writes .cache/eval/references.draft.json)
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { CACHE_DIR, MODELS, callClaude, cached, loadWorld, pool } from './lib.mjs';
import { join } from 'node:path';

const TITLES = { hongloumeng: '紅樓夢 (Dream of the Red Chamber)', xiyouji: '西遊記 (Journey to the West)', sanguo: '三國演義 (Romance of the Three Kingdoms)',
  shuihu: '水滸傳 (Water Margin)', 'kong-yiji': '孔乙己 (Lu Xun)', guxiang: '故鄉 (Lu Xun)', 'kuangren-riji': '狂人日記 (Lu Xun)', 'lunyu-xue-er': '論語·學而 (Analects 1)', 'tang-poems': '唐詩 (Tang poems)' };

const SYSTEM = `You are a bilingual Chinese-English philologist writing an ANSWER KEY used to grade machine translations of passages from Chinese books for an English-speaking reader.
For the passage, return JSON only:
{"reference": "one faithful, natural English translation",
 "checkpoints": ["3 to 6 short, checkable claims about the meaning a correct translation must convey: who does what to whom, negations and modality, numbers and units, the real sense of old or idiomatic words, how names are handled"],
 "traps": ["1 to 4 specific, plausible mistakes a weak translator would make on THIS passage (wrong sense of a word, literal idiom, flipped negation, modern anachronism, invented detail)"]}
Be exact about early-vernacular function words (却说, 只见, 恁地, 便了), classical grammar, and traditional units. Mention nothing you are unsure of; write "uncertain: ..." instead. No other text.`;

const vite = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { passages } = await loadWorld(vite);
  const items = passages.filter(p => p.split !== 'legacy');
  const drafts = await pool(items, 4, async p => {
    const user = JSON.stringify({ book: TITLES[p.book], passage: p.text, paragraph: p.paragraph.slice(0, 900),
      names_known_to_reader: p.terms.filter(t => t.kind === 'name').map(t => `${t.word} ${t.pinyin}`) });
    const result = await cached('reference-draft', { user, SYSTEM }, () => callClaude({ model: MODELS.sonnet, system: SYSTEM, user, effort: 'high', maxTokens: 2500 }));
    let parsed = null;
    try { parsed = JSON.parse(result.text.replace(/^```(?:json)?|```$/g, '').trim()); } catch { /* keep null */ }
    return { id: p.id, split: p.split, text: p.text, ...parsed, raw: parsed ? undefined : result.text };
  });
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, 'references.draft.json'), JSON.stringify(drafts, null, 1));
  console.log(`drafted ${drafts.length}, unparsed ${drafts.filter(d => !d.reference).length}`);
} finally { await vite.close(); }
