// Every configuration the evaluation can run. `baseline.*` reproduce the app as it was before tuning (frozen prompts);
// the rest are the levers that were tried and the shipped pipeline. Each `run(passage, ctx)` returns { text, firstMs, ... }.
import { MODELS } from './lib.mjs';
import { OLD_CLAUDE_SYSTEM, oldClaudeUser, oldQwenPrompt } from './baseline.mjs';

const req = p => ({ text: p.text, context: p.context, terms: p.terms });


/** The evidence-based 酒店 sense (if any) as message hints and as an extra check, the way the shipped translators use it. */
function senseSupport(p, ctx) {
  const hint = ctx.world.app.sense.wordSenseHint(p.text, p.context);
  return {
    hints: hint ? { [hint.word]: hint.sense } : undefined,
    extra: hint ? answer => {
      const issue = ctx.world.app.local.translationIssue(answer, hint.kind === 'tavern', [], hint.kind === 'lodging');
      return issue ? [{ code: 'sense', message: issue }] : [];
    } : undefined,
  };
}

/** The same 酒店 sense detection the old local translator used, kept only for the frozen Qwen baseline. */
function oldQwenSenses(p, world) {
  const ctx = p.context || p.text;
  const wineShop = p.text.includes('酒店') && !!world.app.sense.dictionaryContextMeaning('酒店', ctx, ['hotel', 'wine shop']);
  const lodging = !wineShop && p.text.includes('酒店') && /[订訂][^。！？\n]{0,8}(?:客房|房[间間])|酒店[^。！？\n]{0,12}客房[^。！？\n]{0,12}住满/u.test(ctx);
  return { wineShop, lodging };
}

export function baselineConfigs() {
  const claude = (id, model, label) => ({ id, label, provider: 'claude', model,
    note: 'Frozen pre-tuning prompt (old claude.ts), effort low, server-side fallback on Sonnet.',
    run: (p, ctx) => ctx.claude({ model, system: OLD_CLAUDE_SYSTEM, user: oldClaudeUser(req(p)), effort: 'low' }) });
  return [
    claude('baseline.sonnet', MODELS.sonnet, 'Sonnet 5.5, old prompt'),
    claude('baseline.haiku', MODELS.haiku, 'Haiku 5.5, old prompt'),
    { id: 'baseline.qwen-raw', label: 'Qwen3.5 9B, old prompt, raw model', provider: 'ollama', model: MODELS.qwen,
      note: 'Frozen pre-tuning system and JSON prompt exactly as the old local translator sent them, temperature 0, think off, no post-check.',
      run: (p, ctx) => {
        const { sense, system, prompt } = oldQwenPrompt({ ...req(p), context: ctx.world.app.local.contextWindow(p.context || p.text, p.text) }, oldQwenSenses(p, ctx.world));
        return ctx.ollama({ model: MODELS.qwen, system, prompt, think: false, temperature: 0 });
      } },
  ];
}

/** The old app pipeline end to end (prompt, bridge, correction and withholding). Must be run BEFORE the source changes. */
export function oldAppConfig() {
  return { id: 'baseline.qwen-app', label: 'Qwen3.5 9B, old app pipeline (bridge on :4317)', provider: 'app', model: MODELS.qwen, sequential: true,
    note: 'createLocalTranslator() as shipped before tuning, through the production bridge: includes the 酒店 hints and one corrective retry.',
    run: async (p, ctx) => appRun(p, ctx) };
}

/** Calls the current source createLocalTranslator() through the production bridge and times it. */
export async function appRun(p, ctx, { tagged = false } = {}) {
  const translator = ctx.world.app.local.createLocalTranslator();
  const start = Date.now();
  let first = null;
  try {
    let note = null;
    const text = await translator.translate({ text: p.text, context: p.context, terms: tagged ? p.termsTagged : p.terms, mode: 'translate' },
      { onDelta: () => { first ??= Date.now() - start; }, onNote: n => { note = n; } });
    return { text, firstMs: first, totalMs: Date.now() - start, unverified: !!note };
  } catch (error) {
    return { text: '', error: String(error.message).slice(0, 140), firstMs: first, totalMs: Date.now() - start };
  }
}

// ---------------------------------------------------------------- Claude ---

/**
 * A Claude configuration built from lever settings. `checks` runs the shipped generate, check, one corrective retry loop.
 * Without `checks` it is a single call, so each lever's effect can be read on its own.
 */
export function claudeConfig({ id, label, model, effort = 'low', prompt = {}, oldMessage = false, oldSystem = false, checks = false, tagged = false, note = '' }) {
  return { id, label, provider: 'claude', model, note, run: async (p, ctx) => {
    const P = ctx.world.app.prompt;
    const request = { text: p.text, context: p.context, terms: tagged ? p.termsTagged : p.terms, mode: 'translate' };
    const calls = [];
    const generate = async (system, user) => {
      const out = await ctx.claude({ model, system, user, effort });
      calls.push(out);
      if (out.error) throw new Error(out.error);
      return out.text;
    };
    const { hints, extra } = senseSupport(p, ctx);
    let text, issues = [];
    if (checks) {
      ({ text, issues } = await P.translateChecked(request, generate, { target: 'claude', prompt, hints, extra }));
    } else {
      const system = oldSystem ? OLD_CLAUDE_SYSTEM : P.translationSystem('translate', 'claude', prompt);
      text = await generate(system, oldMessage ? oldClaudeUser(request) : P.translationMessage(request, { ...prompt, hints }));
    }
    return { text, firstMs: calls[0]?.firstMs ?? null, totalMs: calls.reduce((s, c) => s + (c.totalMs ?? 0), 0), calls: calls.length,
      unverified: issues.length > 0, flags: issues.map(i => i.code), first: calls.length > 1 ? undefined : undefined };
  } };
}

/** The lever chain, one change at a time, for one Claude model. */
export function claudeLevers(short, model) {
  const name = text => `${short}.${text}`;
  return [
    claudeConfig({ id: name('rules'), label: `${short}: new instructions only`, model, oldMessage: true,
      note: 'Lever 1. The new instruction set (faithful, negation, numbers, idioms, names, vernacular, register, data); the old message layout and glossary.' }),
    claudeConfig({ id: name('glossary'), label: `${short}: + new message and name spellings`, model,
      note: 'Lever 2. Adds the new message: glossary limited to the sentence, names with the exact spelling to write, paragraph window.' }),
    claudeConfig({ id: name('nospell'), label: `${short}: new message, names as plain pinyin`, model, prompt: { spelling: false },
      note: 'Ablation of lever 2: the new message layout, but name glossary lines carry only the numbered pinyin, not a ready spelling.' }),
    claudeConfig({ id: name('senses'), label: `${short}: + dictionary senses of older words`, model, tagged: true,
      note: 'Lever 2b. As lever 2, and the glossary also carries words the dictionary marks archaic, literary, storytelling or dialect (卻說, 洒家, 俺).' }),
    claudeConfig({ id: name('prev'), label: `${short}: previous sentence only`, model, prompt: { context: 'previous' },
      note: 'Lever 2c. The sentence before the selected one instead of the whole paragraph.' }),
    claudeConfig({ id: name('examples'), label: `${short}: + worked examples`, model, prompt: { examples: true },
      note: 'Lever 3. Adds four worked examples from public-domain books.' }),
    claudeConfig({ id: name('noctx'), label: `${short}: no paragraph context`, model, prompt: { context: 'none' },
      note: 'Ablation of lever 2: the sentence alone, no paragraph.' }),
    claudeConfig({ id: name('medium'), label: `${short}: effort medium`, model, effort: 'medium',
      note: 'Lever 4. As lever 2 with output_config.effort medium instead of low.' }),
    claudeConfig({ id: name('checks'), label: `${short}: + checks and one corrective retry`, model, checks: true,
      note: 'Lever 5. As lever 2 with the mechanical checks (names, negation, numbers, units, leftover Chinese, commentary, length) and one retry.' }),
  ];
}

// ------------------------------------------------------------------ Qwen ---

/** A Qwen configuration (raw Ollama call, same options the bridge forces unless a lever changes them). */
export function qwenConfig({ id, label, prompt = {}, oldMessage = false, think = false, temperature = 0, checks = false, tagged = false, numCtx = 4096, numPredict = 1400, options = {}, note = '' }) {
  return { id, label, provider: 'ollama', model: MODELS.qwen, note, run: async (p, ctx) => {
    const P = ctx.world.app.prompt;
    const request = { text: p.text, context: p.context, terms: tagged ? p.termsTagged : p.terms, mode: 'translate' };
    const calls = [];
    const call = async (system, user) => {
      const out = await ctx.ollama({ model: MODELS.qwen, system, prompt: user, think, temperature, numCtx, numPredict, extra: options });
      calls.push(out);
      if (out.error || !out.text) throw new Error(out.error || 'empty answer');
      return out.text;
    };
    const { hints, extra } = senseSupport(p, ctx);
    let text, issues = [];
    if (checks) {
      ({ text, issues } = await P.translateChecked(request, call, { target: 'local', prompt, hints, extra }));
    } else if (oldMessage) {
      const { sense, prompt: user } = oldQwenPrompt({ ...req(p), context: ctx.world.app.local.contextWindow(p.context || p.text, p.text) }, oldQwenSenses(p, ctx.world));
      text = await call(P.translationSystem('translate', 'local', prompt) + (sense ? `\nFor this passage only, 酒店 must use this source-supported sense: ${sense}.` : ''), user);
    } else {
      text = await call(P.translationSystem('translate', 'local', prompt), P.translationMessage(request, { ...prompt, hints }));
    }
    return { text, firstMs: calls[0]?.firstMs ?? null, totalMs: calls.reduce((s, c) => s + (c.totalMs ?? 0), 0), calls: calls.length,
      unverified: issues.length > 0, flags: issues.map(i => i.code) };
  } };
}

export function qwenLevers() {
  return [
    qwenConfig({ id: 'qwen.rules', label: 'qwen: new instructions only', oldMessage: true,
      note: 'Lever 1. The new instruction set with the old JSON message (and the old 酒店 hint).' }),
    qwenConfig({ id: 'qwen.glossary', label: 'qwen: + new message and name spellings',
      note: 'Lever 2. Adds the tagged message: glossary limited to the sentence with name spellings, paragraph window.' }),
    qwenConfig({ id: 'qwen.nospell', label: 'qwen: new message, names as plain pinyin', prompt: { spelling: false },
      note: 'Ablation of lever 2: the tagged message, but names carry only the numbered pinyin.' }),
    qwenConfig({ id: 'qwen.senses', label: 'qwen: + dictionary senses of older words', tagged: true,
      note: 'Lever 2b. As lever 2, and the glossary also carries words the dictionary marks archaic, literary, storytelling or dialect.' }),
    qwenConfig({ id: 'qwen.prev', label: 'qwen: previous sentence only', prompt: { context: 'previous' },
      note: 'Lever 2c. The sentence before the selected one instead of the whole paragraph.' }),
    qwenConfig({ id: 'qwen.examples', label: 'qwen: + worked examples', prompt: { examples: true },
      note: 'Lever 3. Adds four worked examples.' }),
    qwenConfig({ id: 'qwen.noctx', label: 'qwen: no paragraph context', prompt: { context: 'none' },
      note: 'Ablation: the sentence alone.' }),
    qwenConfig({ id: 'qwen.temp3', label: 'qwen: temperature 0.3', temperature: 0.3,
      note: 'Lever 4a. As lever 2 at temperature 0.3 (the bridge forces 0).' }),
    qwenConfig({ id: 'qwen.nopenalty', label: 'qwen: presence penalty 0', options: { presence_penalty: 0 },
      note: 'Lever 4c. As lever 2 with the presence penalty of 1.5 that the model file sets by default turned off (the bridge does not send it).' }),
    qwenConfig({ id: 'qwen.think', label: 'qwen: thinking on', think: true, numCtx: 8192, numPredict: 4000,
      note: 'Lever 4b. As lever 2 with thinking on (the bridge forces it off; needs a bigger context and output budget).' }),
    qwenConfig({ id: 'qwen.checks', label: 'qwen: + checks and one corrective retry', checks: true,
      note: 'Lever 5. As lever 2 with the mechanical checks and one corrective retry.' }),
  ];
}

// ----------------------------------------------------------------- final ---

/** What ships for Claude: tagged dictionary senses, name spellings, paragraph context, the checks and one retry. */
export function finalClaudeConfigs() {
  const note = 'The shipped prompt (src/translate/prompt.ts), glossary with dictionary senses of older words, effort low, mechanical checks and one corrective retry.';
  return [
    claudeConfig({ id: 'final.sonnet', label: 'Sonnet 5.5, shipped prompt', model: MODELS.sonnet, tagged: true, checks: true, note }),
    claudeConfig({ id: 'final.haiku', label: 'Haiku 5.5, shipped prompt', model: MODELS.haiku, tagged: true, checks: true, note }),
    // The same pipelines, run one request at a time with the cache bypassed, so the timings are not inflated by parallel requests.
    claudeConfig({ id: 'latency.sonnet', label: 'Sonnet 5.5, shipped prompt, one request at a time', model: MODELS.sonnet, tagged: true, checks: true,
      note: 'Latency run: dev passages, sequential, fresh calls (run with --fresh --concurrency 1).' }),
    claudeConfig({ id: 'latency.haiku', label: 'Haiku 5.5, shipped prompt, one request at a time', model: MODELS.haiku, tagged: true, checks: true,
      note: 'Latency run: dev passages, sequential, fresh calls (run with --fresh --concurrency 1).' }),
  ];
}

/** What ships for the local model: the raw pipeline, and the real translator through the production bridge. */
export function finalQwenConfigs() {
  return [
    qwenConfig({ id: 'final.qwen-raw', label: 'Qwen3.5 9B, shipped prompt, raw model', tagged: true, checks: true,
      note: 'The shipped prompt and checks sent straight to Ollama with the bridge options (temperature 0, think off, 4096 context).' }),
    { id: 'final.qwen-app', label: 'Qwen3.5 9B, shipped app pipeline (bridge on :4317)', provider: 'app', model: MODELS.qwen, sequential: true,
      note: 'createLocalTranslator() as shipped now, through the production bridge: prompt, checks, one corrective retry, unverified label.',
      run: (p, ctx) => appRun(p, ctx, { tagged: true }) },
  ];
}
