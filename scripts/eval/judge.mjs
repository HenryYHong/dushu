// Grading of one candidate translation against its answer key. The judge is Claude Sonnet 5.5 (so a Claude model grades
// Claude and Qwen outputs: the report says so and every judged failure on the held-out set was also read by hand).
// Deterministic screens (leftover Chinese, tone-numbered pinyin, the old require/reject patterns) run beside it.
import { MODELS, callClaude, cached } from './lib.mjs';

export const ERROR_TYPES = ['wrong-sense', 'name-mangled', 'negation-modality', 'omission', 'addition', 'idiom-literal', 'number-unit', 'register-fluency'];

export const JUDGE_SYSTEM = `You grade English translations of Chinese book passages for an English-speaking reader. You are given the source passage, its paragraph, an answer key (a reference translation, checkpoints, known traps) and the CANDIDATE translation. Judge the candidate by meaning, using your own careful bilingual reading of the Chinese as well as the key.

Error types (use exactly these labels):
- wrong-sense: a word, phrase or sentence is given the wrong meaning (wrong word sense, modern sense for an old word, wrong speaker or addressee, wrong who-does-what, a classical construction misread).
- name-mangled: a person or place name is translated as a common phrase, left in tone-numbered pinyin, given an invented or wrong reading, or confused with another name. A standard romanization (pinyin without tones, or a well known older spelling) is fine. For a name that is also a pun or has a meaning, giving the pinyin name is fine.
- negation-modality: a negation, double negation, question or rhetorical question, condition, possibility, necessity or belief-versus-fact is flipped or lost.
- omission: a meaningful part of the source is missing.
- addition: the candidate adds content that is not in the source (invented detail, participant, cause, date, explanation presented as part of the translation).
- idiom-literal: an idiom, proverb or figurative expression is rendered word by word so that the meaning is lost or distorted, or a literal phrase is wrongly treated as an idiom.
- number-unit: a number, quantity, unit, date or ordinal is changed, converted or invented.
- register-fluency: awkward, ungrammatical or unnatural English, wrong register, or unrequested commentary, notes, pinyin or quotation of the Chinese. Meaning is intact.

Severity: "major" when a reader would come away believing something false or would miss a key point; "minor" when the meaning is intact but a careful editor would still change the wording (an inaccurate rendering of a detail, a clumsy or unnatural sentence, an unneeded addition). Use minor for register-fluency unless the English is unintelligible.

Rules:
- Alternative valid renderings are NOT errors. Do not report: near-synonyms; a defensible reading of a phrase that commentators dispute; a nuance of a literary word that English cannot carry in the same space and that does not change what the reader understands (pilfer versus steal, the color of the veins); poetic word choice; translating a title or kinship term by role or keeping it in pinyin; a subject, article or connective that English grammar requires.
- Checkpoints about who the speaker or addressee is count only if the sentence or paragraph supports them; ignore a checkpoint that depends on information found in neither.
- Judge only what the candidate actually says. A correct translation with one short, accurate parenthetical gloss is correct except for a minor register-fluency note.
- Report each real error once. If the translation is right, return no errors. Be exact rather than severe: do not invent faults to look careful.
- If the candidate is empty, refuses, or is mostly Chinese, report omission (major).
Return JSON only, no other text:
{"verdict":"correct"|"minor"|"wrong","errors":[{"type":"<label>","severity":"major"|"minor","evidence":"<short quote from the candidate>","why":"<one short sentence>"}]}
verdict is "correct" with no errors, "minor" when every error is minor, "wrong" when any error is major.`;

export function judgeUser(item, key) {
  return JSON.stringify({
    source: item.text,
    paragraph: item.paragraph.length > 700 ? `${item.paragraph.slice(0, 700)}…` : item.paragraph,
    answer_key: key,
    candidate: item.answer,
  });
}

/** The answer key of a passage: the reviewed reference file, or the hand-written expectation for the older fixtures. */
export function answerKey(passage, references) {
  if (passage.split === 'legacy') return { reference: passage.expect, checkpoints: [passage.expect], traps: [] };
  const key = references[passage.id];
  if (!key) throw new Error(`No reference for ${passage.id}`);
  return key;
}

export function parseJudgement(text) {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  const data = JSON.parse(cleaned.slice(start, end + 1));
  const errors = (Array.isArray(data.errors) ? data.errors : [])
    .filter(e => ERROR_TYPES.includes(e?.type))
    .map(e => ({ type: e.type, severity: e.severity === 'minor' ? 'minor' : 'major', evidence: String(e.evidence ?? '').slice(0, 160), why: String(e.why ?? '').slice(0, 200) }));
  const verdict = !errors.length ? 'correct' : errors.some(e => e.severity === 'major') ? 'wrong' : 'minor';
  return { verdict, errors };
}

/** Judge one output. Cached by the exact judge request; an unreadable judgement is retried once, then recorded as such. */
export async function judge(item, key, { fresh = false, judgeSeed = 0 } = {}) {
  if (!item.answer) return { verdict: 'wrong', errors: [{ type: 'omission', severity: 'major', evidence: '', why: item.error || 'no answer' }] };
  const user = judgeUser(item, key);
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await cached('judge', { user, system: JUDGE_SYSTEM, attempt, seed: judgeSeed || undefined }, () => callClaude({ model: MODELS.sonnet, system: JUDGE_SYSTEM, user, effort: 'medium', maxTokens: 1500 }), { fresh });
    try { return parseJudgement(reply.text); } catch { /* retry once */ }
  }
  return { verdict: 'unjudged', errors: [] };
}

/** Cheap deterministic screens that never need a model. */
export function screens(item, passage) {
  const flags = [];
  const answer = item.answer || '';
  if (/[㐀-鿿]/.test(answer)) flags.push('chinese-left');
  if (/\b[a-züv]{1,6}[1-5]\b(?:\s+[a-züv]{1,6}[1-5]\b)*/i.test(answer) && /\b[a-z]{2,6}[1-5]\b/i.test(answer)) flags.push('tone-numbers');
  if (passage.require && !new RegExp(passage.require, 'i').test(answer)) flags.push('legacy-require-missing');
  if (passage.reject && new RegExp(passage.reject, 'i').test(answer)) flags.push('legacy-reject-hit');
  return flags;
}
