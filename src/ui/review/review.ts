// Flashcard review: due cards one at a time, reveal, grade with buttons or keys 1-4. The cards are the saved words that are
// due and the words looked up while reading that are not saved or known yet (learning.ts): grading one of those saves it.
import '../../styles/review.css';
import { nextIntervals } from '../../core/srs';
import { canSpeak, speak, stopSpeaking } from '../../speech/tts';
import type { Grade, MountFn, VocabItem } from '../../types';
import { clear, h } from '../dom';
import { icon } from '../icons';
import { contextEl, pinyinEl, scriptView, textAttrs } from '../vocab/render';
import { isChinese } from '../../lang/active';
import { pageTitle } from '../pageHead';
import { describeNextDue, ReviewSession } from './queue';
import { reviewCards, reviewCount } from './learning';

const GRADES: { grade: Grade; key: 'again' | 'hard' | 'good' | 'easy'; label: string }[] = [
  { grade: 0, key: 'again', label: 'Again' },
  { grade: 1, key: 'hard', label: 'Hard' },
  { grade: 2, key: 'good', label: 'Good' },
  { grade: 3, key: 'easy', label: 'Easy' },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const count = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export const mount: MountFn = (root, _params, ctx) => {
  const { store } = ctx;
  let alive = true;
  let session: ReviewSession | null = null;
  let revealed = false;
  let busy = false;
  let settings = ctx.settings.get();
  /** The looked-up words in this session, not saved yet: each is saved when it is first graded. */
  let unsaved = new Map<string, VocabItem>();

  const screen = h('div.page.rev-page');
  root.appendChild(screen);

  /** The screen's title over the empty state and the summary (a session in progress shows only the card). */
  const head = () => h('div.page-head.rev-head', null, h('div', null, pageTitle('review', 'Review')));

  const nextDueAmongAll = async (): Promise<number | undefined> => {
    const now = Date.now();
    const later = (await store.vocab.list()).map((i) => i.srs.due).filter((d) => d > now);
    return later.length ? Math.min(...later) : undefined;
  };

  async function start(): Promise<void> {
    clear(screen);
    let due: VocabItem[];
    try {
      const cards = await reviewCards(store, ctx.dict, Date.now());
      unsaved = new Map(cards.fresh.map((v) => [v.id, v]));
      due = [...cards.due, ...cards.fresh];
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : 'Could not read your vocabulary.');
      return;
    }
    if (!alive) return;
    if (!due.length) { await showEmpty(); return; }
    session = new ReviewSession(due);
    revealed = false;
    showCard();
  }

  // ------------------------------------------------------------ empty ---
  async function showEmpty(): Promise<void> {
    const next = await nextDueAmongAll();
    const total = (await store.vocab.list()).length;
    if (!alive) return;
    clear(screen);
    const msg = total === 0
      ? [h('h2.rev-empty-title', null, 'No cards yet'),
         h('p', null, 'Words you look up or star while reading turn up here as flashcards.'),
         h('a.btn', { href: '#/' }, icon('book'), 'Open the library')]
      : [h('h2.rev-empty-title', null, 'Nothing due right now'),
         h('p', null, next ? `Your next card is due ${describeNextDue(next, Date.now())}.` : 'You are all caught up.'),
         h('a.btn', { href: '#/vocab' }, icon('list'), 'See your words')];
    screen.append(head(), h('div.card.rev-empty', null, ...msg));
  }

  // -------------------------------------------------------------- card ---
  function showCard(): void {
    if (!session) return;
    const cur = session.current;
    if (!cur) { void showSummary(); return; }
    clear(screen);

    const view = scriptView(settings.script, ctx.dictSync());
    const word = view.word(cur);
    const ta = textAttrs(word === cur.trad && cur.trad !== cur.simp);
    const lang = ta.lang;
    const len = [...word].length;
    const progress = h('div.rev-progress', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': session.total, 'aria-valuenow': session.done },
      h('div.rev-progress-fill', { style: `width:${(session.done / session.total) * 100}%` }));
    const top = h('div.rev-top', null,
      h('a.rev-exit', { href: '#/vocab' }, icon('arrowLeft'), 'Words'),
      h('span.rev-counter', null, `${session.done} of ${session.total} done`),
      h('span.rev-left.muted', null, `${session.remaining} left`),
    );

    const front = h('div.rev-front', null,
      h('div', { class: `rev-word ${ta.cls}${len > (isChinese() ? 4 : 12) ? ' rev-word-long' : len > (isChinese() ? 2 : 7) ? ' rev-word-mid' : ''}`, lang }, word),
      cur.context?.sentence
        ? h('p', { class: `rev-ctx ${ta.cls}`, lang }, contextEl(view.text(cur.context.sentence), [cur.simp, cur.trad], 'mark', 70))
        : null,
    );
    const back = h('div.rev-back', { hidden: !revealed },
      h('div.rev-answer', null,
        pinyinEl(cur.pinyin, settings.pinyinStyle, settings.toneColors, 'rev-py'),
        canSpeak() ? h('button.icon-btn.rev-speak', { type: 'button', title: 'Play audio (P)', 'aria-label': 'Play audio', onclick: (e: Event) => { e.stopPropagation(); speakNow(); } }, icon('speaker')) : null,
      ),
      h('p.rev-gloss', null, cur.gloss),
      cur.context?.bookTitle ? h('p.rev-source.muted', null, `From ${view.text(cur.context.bookTitle)}`) : null,
    );
    const reveal = h('button.btn.btn-primary.rev-reveal', { type: 'button', hidden: revealed, onclick: (e: Event) => { e.stopPropagation(); reveal_(); } },
      'Show answer', h('span.kbd', null, 'Space'));

    const iv = nextIntervals(cur.srs, Date.now());
    const grades = h('div.rev-grades', { hidden: !revealed, role: 'group', 'aria-label': 'How well did you remember it?' },
      GRADES.map((g) => h('button', { type: 'button', class: `rev-grade rev-grade-${g.key}`, onclick: (e: Event) => { e.stopPropagation(); void grade(g.grade); } },
        h('span.rev-grade-label', null, g.label),
        h('span.rev-grade-iv', null, iv[g.key]),
        h('span.rev-grade-key.kbd', null, String(g.grade + 1)))));

    const card = h('div.card.rev-card', { onclick: () => { if (!revealed) reveal_(); } }, front, back);
    screen.append(top, progress, card, reveal, grades);

    function reveal_(): void {
      if (revealed) return;
      revealed = true;
      back.hidden = false;
      reveal.hidden = true;
      grades.hidden = false;
      card.classList.add('rev-card-revealed');
    }
    // Used by the key handler through the DOM so it always acts on the card on screen.
    screen.dataset.state = revealed ? 'back' : 'front';
    revealCurrent = reveal_;
  }

  let revealCurrent: () => void = () => {};

  function speakNow(): void {
    const cur = session?.current;
    if (!cur) return;
    void speak(cur.simp, { rate: settings.ttsRate, voice: settings.ttsVoice || undefined });
  }

  async function grade(g: Grade): Promise<void> {
    if (!session || !session.current || busy || !revealed) return;
    busy = true;
    stopSpeaking();
    const cur = session.current;
    const now = Date.now();
    try {
      // A looked-up word joins the saved words the first time it is graded (unless it was saved meanwhile).
      const fresh = unsaved.get(cur.id);
      if (fresh) {
        if (!store.vocab.has(cur.id)) await store.vocab.put({ ...fresh, addedAt: now });
        unsaved.delete(cur.id);
      }
      const updated = await store.vocab.review(cur.id, g, now);
      session.answer(g, updated, now);
    } catch (e) {
      // The word was probably removed in another tab; skip it rather than get stuck.
      console.error(e);
      ctx.toast('Could not save that review. Skipping this card.');
      session.skip();
    } finally {
      busy = false;
    }
    if (!alive) return;
    revealed = false;
    showCard();
  }

  // ----------------------------------------------------------- summary ---
  async function showSummary(): Promise<void> {
    if (!session) return;
    const s = session.summary();
    const next = await nextDueAmongAll();
    const dueNow = await reviewCount(store);
    if (!alive) return;
    clear(screen);
    const stat = (value: string, label: string) => h('div.rev-stat', null, h('div.rev-stat-value', null, value), h('div.rev-stat-label', null, label));
    screen.append(head(), h('div.card.rev-summary', null,
      h('h2.rev-summary-title', null, 'Session complete'),
      h('p.muted', null, `${count(s.cards, 'card')}, ${count(s.reviews, 'answer')}`),
      h('div.rev-stats', null,
        stat(pct(s.recall), 'Remembered'),
        ...GRADES.map((g) => stat(String(s.grades[g.grade]), g.label)),
      ),
      h('p.rev-next', null, dueNow
        ? `${count(dueNow, 'more card')} due now.`
        : next ? `Your next card is due ${describeNextDue(next, Date.now())}.` : 'All your cards are scheduled.'),
      h('div.rev-summary-actions', null,
        dueNow ? h('button.btn.btn-primary', { type: 'button', onclick: () => void start() }, 'Keep going') : null,
        h('a.btn', { href: '#/vocab' }, icon('list'), 'Back to words'),
        h('a.btn.btn-ghost', { href: '#/' }, 'Library'),
      ),
    ));
    session = null;
  }

  // -------------------------------------------------------------- keys ---
  function onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!session?.current) return;
    const onControl = !!t && /^(BUTTON|A)$/.test(t.tagName);
    if ((e.key === ' ' || e.key === 'Enter') && !onControl) {
      e.preventDefault();
      if (!revealed) revealCurrent();
      return;
    }
    if (e.key >= '1' && e.key <= '4') {
      if (!revealed) return;
      e.preventDefault();
      void grade((Number(e.key) - 1) as Grade);
    } else if (e.key === 'p' || e.key === 'P') {
      speakNow();
    }
  }
  document.addEventListener('keydown', onKey);
  const offSettings = ctx.settings.subscribe((s) => { settings = s; });

  void start();
  // Sentences follow the reader's script, which needs the dictionary: draw the card again once it has loaded.
  if (settings.script !== 'original' && !ctx.dictSync()) void ctx.dict().then(() => { if (alive && session?.current) showCard(); }, () => {});
  return () => {
    alive = false;
    document.removeEventListener('keydown', onKey);
    offSettings();
    stopSpeaking();
  };
};
