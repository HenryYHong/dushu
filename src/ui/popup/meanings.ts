// A word card's meanings in the reader's language (translate/meanings.ts). The card opens at once with the dictionary; each sense
// line it shows then gets its translation on top, marked as the reader's language, with the dictionary's own words kept under it
// in smaller type (they are the authority: a one-word gloss can be put into the wrong sense). Translations kept from before fill
// in at once; the rest come from the translator by themselves when it is free and on this device, or from a button on the card.
// Senses behind "N more" are translated when they are shown, not before.
import type { AppContext } from '../../types';
import { h, clear } from '../dom';
import { icon } from '../icons';
import { glossLanguage } from '../../lang/labels';
import {
  cachedAny, dictionaryLanguage, meaningOrder, meaningProvider, meaningsTarget, pickMeaningProvider, translateMeanings,
  type MeaningPick, type MeaningProvider, type MeaningProviderId,
} from '../../translate/meanings';
import { targetLanguage } from '../../translate/targets';
import { langName, num, tt, uiLocale } from '../../i18n';

export interface CardMeanings {
  /**
   * A sense line of the card: `li` holds the dictionary's words in a `.pp-def-src` (the part of speech, if any, before it), and
   * `text` is them as plain text, what is translated. `shown`: false for a line behind "N more".
   */
  sense(li: HTMLElement, text: string, shown?: boolean): void;
  /** Lines a "more" button has just shown. */
  reveal(lis: readonly HTMLElement[]): void;
  /** The line under the meanings (progress, the button, the note), or null when the card shows the dictionary as it is. */
  readonly el: HTMLElement | null;
  /** Begins, once the card is built: kept translations at once, then the translator. */
  start(): void;
  dispose(): void;
}

const NONE: CardMeanings = { sense() {}, reveal() {}, el: null, start() {}, dispose() {} };

interface Line { text: string; shown: boolean; done: boolean }

export function cardMeanings(ctx: AppContext, changed: () => void): CardMeanings {
  const settings = () => ctx.settings.get();
  const from = dictionaryLanguage();
  const to = meaningsTarget(settings());
  const target = to ? targetLanguage(to) : undefined;
  if (!to || !target) return NONE;
  const language = langName(target.code === 'zh' ? 'zh-Hans' : target.code, target.name);
  const lines = new Map<HTMLElement, Line>();
  const note = h('p.pp-mt-note', { hidden: true });
  const action = h('div.pp-mt-action', { hidden: true });
  const el = h('div.pp-mt', { 'aria-live': 'polite', hidden: true }, note, action);
  const ctl = new AbortController();
  /** The translators the lines on the card came from, for the note. */
  const used = new Set<MeaningProviderId>();
  let pick: Promise<MeaningPick | null> | null = null;
  /** The reader pressed the button: the senses they show next are translated too, without asking again. */
  let asked: MeaningProvider | null = null;
  let running = false;
  let again = false;
  let disposed = false;

  const pending = () => [...lines].filter(([, l]) => l.shown && !l.done).map(([li]) => li);
  const textOf = (li: HTMLElement) => lines.get(li)!.text;

  function fill(li: HTMLElement, translated: string | undefined, id: MeaningProviderId): void {
    const line = lines.get(li);
    if (!line || line.done || !translated) return;
    line.done = true;
    used.add(id);
    const tl = h('span.pp-def-tl', { lang: target!.code, dir: target!.rtl ? 'rtl' : null, title: tt('Machine translation') }, translated);
    const src = li.querySelector(':scope > .pp-def-src');
    if (src) li.insertBefore(tl, src); else li.appendChild(tl);
    li.classList.add('pp-def-tl-on');
  }

  function drawNote(): void {
    if (!used.size) { note.hidden = true; return; }
    const names = [...used].map((id) => meaningProvider(id, settings(), from, to!).label);
    note.textContent = tt('Machine translation into {language} by {provider}. The dictionary’s {original} is under each meaning.', {
      language, provider: new Intl.ListFormat(uiLocale(), { type: 'conjunction' }).format(names), original: glossLanguage() });
    note.hidden = false;
  }

  function show(...nodes: (Node | string)[]): void {
    clear(action);
    action.append(...nodes);
    action.hidden = !nodes.length;
    drawNote();
    el.hidden = note.hidden && action.hidden;
    changed();
  }

  /** Translations any translator gave before: free to show again. */
  function fromCache(): void {
    const todo = pending();
    if (!todo.length) return;
    const hits = cachedAny(todo.map(textOf), from, to!, meaningOrder(settings()));
    for (const li of todo) { const hit = hits.get(textOf(li)); if (hit) fill(li, hit.text, hit.id); }
  }

  function offer(p: MeaningPick): void {
    const btn = h('button.btn.btn-sm.pp-mt-btn', { type: 'button', title: tt('Translate the meanings with {provider}', { provider: p.provider.label }) },
      icon('translate'), tt('Meanings in {language}', { language })) as HTMLButtonElement;
    btn.addEventListener('click', () => { asked = p.provider; void run(p.provider, true); });
    show(btn);
  }

  async function run(provider: MeaningProvider, click = false): Promise<void> {
    if (disposed) return;
    if (running) { again = true; return; }
    const todo = pending();
    if (!todo.length) { show(); return; }
    running = true;
    const status = h('span.pp-muted', null, tt('Translating the meanings into {language}…', { language }));
    show(h('span.app-spinner'), status);
    try {
      // Chrome's model for this pair is downloaded once, and only from a click.
      if (click && provider.prepare && (await provider.availability()) === 'download') {
        status.textContent = tt('Downloading…');
        await provider.prepare((f) => { status.textContent = tt('Downloading {percent}%', { percent: num(Math.round(f * 100)) }); });
        status.textContent = tt('Translating the meanings into {language}…', { language });
      }
      const texts = await translateMeanings(provider, todo.map(textOf), from, to!, ctl.signal);
      if (disposed) return;
      todo.forEach((li, i) => fill(li, texts[i], provider.id));
      show();
    } catch (e) {
      if (disposed || (e as { name?: string })?.name === 'AbortError') return;
      const retry = h('button.btn.btn-sm', { type: 'button', onclick: () => { asked = provider; void run(provider, true); } }, icon('refresh'), tt('Try again'));
      show(h('span.pp-mt-error', null, (e as Error)?.message || tt('Translation failed.')), retry);
    } finally {
      running = false;
    }
    if (again && !disposed) { again = false; void proceed(); }
  }

  /** Kept translations first, then what the setting allows for the rest: the translator at once, or its button. */
  async function proceed(): Promise<void> {
    if (disposed) return;
    if (running) { again = true; return; }
    fromCache();
    if (!pending().length) { show(); return; }
    if (asked) { void run(asked); return; }
    const p = await (pick ??= pickMeaningProvider(settings(), from, to!).catch(() => null));
    if (disposed) return;
    if (!p) { show(); return; }
    if (p.auto) void run(p.provider);
    else offer(p);
  }

  return {
    el,
    sense(li, text, shown = true) {
      const t = text.trim();
      if (t) lines.set(li, { text: t, shown, done: false });
    },
    reveal(lis) {
      let any = false;
      for (const li of lis) { const l = lines.get(li); if (l && !l.shown) { l.shown = true; any = true; } }
      // Kept ones at once, the rest as the setting says: by themselves, after a click already made on this card, or the button.
      if (any) void proceed();
    },
    start() {
      if (!lines.size) return;
      void proceed();
    },
    dispose() {
      disposed = true;
      ctl.abort();
    },
  };
}
