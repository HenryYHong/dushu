// A quick flashcard run over words looked up while reading (a day, or the last week). It does not touch the spaced-repetition
// schedule of saved words: Again puts the word back at the end of this run, Got it moves on, and the star saves the word to
// the flashcards for real review. Keys: Space or Enter shows the answer (then means Got it), 1 Again, 2 Got it, S save, P say it.
import type { AppContext, LookupRow } from '../../types';
import { clear, h } from '../dom';
import { icon } from '../icons';
import { vocabItemFor } from '../popup/saveWord';
import { speak } from '../../speech/tts';
import { contextEl, pinyinEl, scriptView } from './render';

const nodes = (...list: (HTMLElement | null)[]): HTMLElement[] => list.filter((n): n is HTMLElement => n !== null);

const shuffle = <T>(list: T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export function openPractice(ctx: AppContext, words: LookupRow[], title: string): void {
  const opener = document.activeElement as HTMLElement | null;
  let queue = shuffle(words);
  let total = queue.length;
  let done = 0;
  let missed = new Set<string>();
  let shown = false;

  const progress = h('span.prc-progress.muted');
  const body = h('div.prc-body');
  const foot = h('div.prc-foot');
  const closeBtn = h('button.icon-btn.prc-close', { type: 'button', 'aria-label': 'Close practice', onclick: () => close() }, icon('close'));
  const card = h('div.prc-card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Practice: ${title}` },
    h('div.prc-head', null, h('span.prc-title', null, title), progress, closeBtn), body, foot);
  const overlay = h('div.prc-overlay', null, card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);

  function close(): void {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    opener?.focus?.({ preventScroll: true });
  }

  function current(): LookupRow | undefined { return queue[0]; }

  function draw(): void {
    clear(body);
    clear(foot);
    const r = current();
    if (!r) { drawEnd(); return; }
    const s = ctx.settings.get();
    const view = scriptView(s.script, ctx.dictSync());
    const word = view.text(r.word);
    progress.textContent = `${done + 1} of ${total}`;
    body.append(h('div.prc-word.zh', { lang: 'zh' }, word));
    if (shown) {
      body.append(...nodes(
        r.pinyin ? pinyinEl(r.pinyin, s.pinyinStyle, s.toneColors, 'prc-py') : null,
        r.gloss ? h('div.prc-gloss', null, r.gloss) : null,
        r.context?.sentence ? h('div.prc-ctx.zh', { lang: 'zh' }, contextEl(view.text(r.context.sentence), [word, r.word, r.id], 'b', 120)) : null,
        h('div.prc-tools', null,
          h('button.btn.btn-sm', { type: 'button', onclick: () => say(r) }, icon('speaker'), 'Say it'),
          saveButton(r)),
      ));
      foot.append(
        h('button.btn.prc-again', { type: 'button', onclick: () => answer(false) }, 'Again'),
        h('button.btn.btn-primary.prc-got', { type: 'button', onclick: () => answer(true) }, 'Got it'),
      );
    } else {
      foot.append(h('button.btn.btn-primary.prc-show', { type: 'button', onclick: () => { shown = true; draw(); } }, 'Show'));
    }
    (foot.querySelector('.btn-primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function saveButton(r: LookupRow): HTMLElement {
    const saved = ctx.store.vocab.has(r.id);
    return h('button.btn.btn-sm.prc-save', { type: 'button', 'aria-pressed': String(saved), disabled: saved, onclick: () => void save(r) },
      icon('star'), saved ? 'In your flashcards' : 'Save to flashcards');
  }

  async function save(r: LookupRow): Promise<void> {
    if (ctx.store.vocab.has(r.id)) return;
    try {
      const dict = await ctx.dict();
      await ctx.store.vocab.put(vocabItemFor(dict, { word: r.word, syllables: r.pinyin ? r.pinyin.split(' ') : [], context: r.context }));
      ctx.toast(`Saved ${r.id} to your flashcards.`);
      if (overlay.isConnected) draw();
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : 'Could not save the word.');
    }
  }

  function say(r: LookupRow): void {
    const s = ctx.settings.get();
    void speak(r.word, { rate: s.ttsRate, voice: s.ttsVoice, onError: (m) => ctx.toast(m) });
  }

  function answer(gotIt: boolean): void {
    const r = queue.shift();
    if (!r) return;
    if (gotIt) done++;
    else { missed.add(r.id); queue.push(r); }
    shown = false;
    draw();
  }

  function drawEnd(): void {
    progress.textContent = '';
    const missedRows = words.filter((w) => missed.has(w.id));
    body.append(
      h('div.prc-end', null,
        h('h2.prc-end-title', null, 'Done'),
        h('p.muted', null, missed.size
          ? `${total - missed.size} of ${total} on the first try. ${missed.size === 1 ? 'One word needed' : `${missed.size} words needed`} another look.`
          : `All ${total} on the first try.`)),
    );
    foot.append(...nodes(
      missedRows.length ? h('button.btn', { type: 'button', onclick: () => restart(missedRows) }, 'Practice the missed ones') : null,
      h('button.btn.btn-primary', { type: 'button', onclick: () => close() }, 'Finish'),
    ));
    (foot.querySelector('.btn-primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function restart(list: LookupRow[]): void {
    queue = shuffle(list);
    total = queue.length;
    done = 0;
    missed = new Set();
    shown = false;
    draw();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    const r = current();
    if (!r || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if ((e.target as HTMLElement)?.tagName === 'BUTTON') return; // the focused button (Show or Got it) handles it
      e.preventDefault();
      if (shown) answer(true); else { shown = true; draw(); }
    } else if (shown && e.key === '1') { e.preventDefault(); answer(false); }
    else if (shown && e.key === '2') { e.preventDefault(); answer(true); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); void save(r); }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); say(r); }
  }
  document.addEventListener('keydown', onKey, true);
  draw();
}
