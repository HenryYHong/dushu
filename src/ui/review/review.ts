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
import { celebrate } from './celebrate';
import { penguEl } from '../pengu';
import { describeNextDue, ReviewSession } from './queue';
import { reviewCards, reviewParts } from './learning';
import { num, tt, ttm, ttn, ttx } from '../../i18n';

const GRADES: { grade: Grade; key: 'again' | 'hard' | 'good' | 'easy'; label: string }[] = [
  { grade: 0, key: 'again', label: ttm('Again') },
  { grade: 1, key: 'hard', label: ttm('Hard') },
  { grade: 2, key: 'good', label: ttm('Good') },
  { grade: 3, key: 'easy', label: ttm('Easy') },
];

/** The simple buttons (Settings › Flashcard buttons): Forgot is Again, Got it is Good. No times, keys 1 and 2. */
const SIMPLE: { grade: Grade; key: 'again' | 'good'; label: () => string }[] = [
  { grade: 0, key: 'again', label: () => tt('Forgot') },
  // "Got it" as in "I remembered it", not the button that puts a tip away.
  { grade: 2, key: 'good', label: () => ttx('Got it', 'remembered') },
];

const pct = (x: number) => tt('{n}%', { n: num(Math.round(x * 100)) });
/** "Your next card is due in 3 hours." */
const nextDueLine = (next: number) => tt('Your next card is due {when}.', { when: describeNextDue(next, Date.now()) });

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
  const head = () => h('div.page-head.rev-head', null, h('div', null, pageTitle('review', tt('Review'))));

  const nextDueAmongAll = async (): Promise<number | undefined> => {
    const now = Date.now();
    const later = (await store.vocab.list()).map((i) => i.srs.due).filter((d) => d > now);
    return later.length ? Math.min(...later) : undefined;
  };

  /** `focus`: a session started from a button here (Keep going), so focus goes to its first card. */
  async function start(focus = false): Promise<void> {
    clear(screen);
    let due: VocabItem[];
    try {
      const cards = await reviewCards(store, ctx.dict, Date.now());
      unsaved = new Map(cards.fresh.map((v) => [v.id, v]));
      due = [...cards.due, ...cards.fresh];
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : tt('Could not read your vocabulary.'));
      return;
    }
    if (!alive) return;
    if (!due.length) { await showEmpty(); return; }
    session = new ReviewSession(due);
    revealed = false;
    showCard(focus);
  }

  // ------------------------------------------------------------ empty ---
  async function showEmpty(): Promise<void> {
    const next = await nextDueAmongAll();
    const total = (await store.vocab.list()).length;
    if (!alive) return;
    clear(screen);
    const msg = total === 0
      ? [h('h2.rev-empty-title', null, tt('No cards yet')),
         h('p', null, tt('Words you look up or star while reading turn up here as flashcards.')),
         h('a.btn', { href: '#/' }, icon('book'), tt('Open the library'))]
      : [h('h2.rev-empty-title', null, tt('Nothing due right now')),
         h('p', null, next ? nextDueLine(next) : tt('You are all caught up.')),
         h('a.btn', { href: '#/vocab' }, icon('list'), tt('See your words'))];
    // Pengu: waving at someone with no cards yet, cheering someone who is all caught up.
    screen.append(head(), h('div.card.rev-empty', null, penguEl(total === 0 ? 'wave' : 'cheer', 'rev-pengu'), ...msg));
  }

  // -------------------------------------------------------------- card ---
  /**
   * Draws the current card. `moveFocus` after a grade (or Keep going): focus goes to the new card, so a screen reader reads it
   * and the keyboard carries on from it, unless focus was somewhere else on the page. A redraw (the dictionary loaded) keeps
   * focus on the card when it was there, and the first card never takes it.
   */
  function showCard(moveFocus = false): void {
    if (!session) return;
    const cur = session.current;
    if (!cur) { void showSummary(); return; }
    const was = document.activeElement;
    const take = moveFocus
      ? !was || was === document.body || screen.contains(was)
      : !!was && !!screen.querySelector('.rev-card')?.contains(was);
    clear(screen);

    const view = scriptView(settings.script, ctx.dictSync());
    const word = view.word(cur);
    const ta = textAttrs(word === cur.trad && cur.trad !== cur.simp);
    const lang = ta.lang;
    const len = [...word].length;
    const progress = h('div.rev-progress', {
      role: 'progressbar', 'aria-label': tt('Review progress'), 'aria-valuemin': 0, 'aria-valuemax': session.total, 'aria-valuenow': session.done,
      'aria-valuetext': tt('{done} of {total} done', { done: session.done, total: session.total }),
    },
      h('div.rev-progress-fill', { style: `width:${(session.done / session.total) * 100}%` }));
    const top = h('div.rev-top', null,
      h('a.rev-exit', { href: '#/vocab' }, icon('arrowLeft'), tt('Words')),
      h('span.rev-counter', null, tt('{done} of {total} done', { done: session.done, total: session.total })),
      h('span.rev-left.muted', null, tt('{n} left', { n: session.remaining })),
    );

    const front = h('div.rev-front', null,
      h('div', { class: `rev-word ${ta.cls}${len > (isChinese() ? 4 : 12) ? ' rev-word-long' : len > (isChinese() ? 2 : 7) ? ' rev-word-mid' : ''}`, lang }, word),
      cur.context?.sentence
        ? h('p', { class: `rev-ctx ${ta.cls}`, lang }, contextEl(view.text(cur.context.sentence), [cur.simp, cur.trad], 'mark', 70, cur.id))
        : null,
    );
    // Focus lands on the answer when it is shown (never on Again: a second Enter would grade the card).
    const back = h('div.rev-back', { hidden: !revealed, tabindex: -1, role: 'group', 'aria-label': tt('Answer') },
      h('div.rev-answer', null,
        pinyinEl(cur.pinyin, settings.pinyinStyle, settings.toneColors, 'rev-py'),
        canSpeak() ? h('button.icon-btn.rev-speak', { type: 'button', title: tt('Play audio (P)'), 'aria-label': tt('Play audio'), onclick: (e: Event) => { e.stopPropagation(); speakNow(); } }, icon('speaker')) : null,
      ),
      h('p.rev-gloss', null, cur.gloss),
      cur.context?.bookTitle ? h('p.rev-source.muted', null, tt('From {title}', { title: view.text(cur.context.bookTitle) })) : null,
    );
    const reveal = h('button.btn.btn-primary.rev-reveal', { type: 'button', hidden: revealed, onclick: (e: Event) => { e.stopPropagation(); reveal_(); } },
      tt('Show answer'), h('span.kbd', null, tt('Space')));

    const iv = nextIntervals(cur.srs, Date.now());
    const simple = settings.reviewButtons !== 'detailed';
    const grades = h(simple ? 'div.rev-grades.rev-grades-simple' : 'div.rev-grades', { hidden: !revealed, role: 'group', 'aria-label': tt('How well did you remember it?') },
      simple
        ? SIMPLE.map((g, i) => h('button', { type: 'button', class: `rev-grade rev-grade-${g.key}`, onclick: (e: Event) => { e.stopPropagation(); void grade(g.grade); } },
          h('span.rev-grade-label', null, g.label()),
          h('span.rev-grade-key.kbd', null, String(i + 1))))
        : GRADES.map((g) => h('button', { type: 'button', class: `rev-grade rev-grade-${g.key}`, onclick: (e: Event) => { e.stopPropagation(); void grade(g.grade); } },
          h('span.rev-grade-label', null, tt(g.label)),
          h('span.rev-grade-iv', null, iv[g.key]),
          h('span.rev-grade-key.kbd', null, String(g.grade + 1)))));

    const card = h('div.card.rev-card', {
      tabindex: -1, role: 'group', 'aria-label': tt('Card {n} of {total}', { n: session.done + 1, total: session.total }),
      onclick: () => { if (!revealed) reveal_(); },
    }, front, back);
    // The screen's title, for screen readers: a session shows only the card.
    screen.append(pageTitle('review', tt('Review'), 'h1', 'rev-sr'), top, progress, card, reveal, grades);
    if (take) (revealed ? back : card).focus({ preventScroll: true });

    function reveal_(): void {
      if (revealed) return;
      // Show answer hides itself: focus would fall to the page, so it goes to the answer instead (when it was on the card,
      // the button, or nowhere).
      const a = document.activeElement;
      const takeFocus = !a || a === reveal || a === document.body || card.contains(a);
      revealed = true;
      back.hidden = false;
      reveal.hidden = true;
      grades.hidden = false;
      card.classList.add('rev-card-revealed');
      if (takeFocus) back.focus({ preventScroll: true });
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
      ctx.toast(tt('Could not save that review. Skipping this card.'));
      session.skip();
    } finally {
      busy = false;
    }
    if (!alive) return;
    revealed = false;
    showCard(true);
  }

  // ----------------------------------------------------------- summary ---
  async function showSummary(): Promise<void> {
    if (!session) return;
    const s = session.summary();
    const next = await nextDueAmongAll();
    const parts = await reviewParts(store);
    const dueNow = parts.due + parts.fresh;
    if (!alive) return;
    clear(screen);
    const stat = (value: string, label: string) => h('div.rev-stat', null, h('div.rev-stat-value', null, value), h('div.rev-stat-label', null, label));
    const summary = h('div.card.rev-summary', null,
      penguEl('cheer', 'rev-pengu rev-pengu-cheer'),
      h('h2.rev-summary-title', null, tt('Session complete')),
      h('p.muted', null, tt('{a}, {b}', { a: ttn(s.cards, '{n} card', '{n} cards'), b: ttn(s.reviews, '{n} answer', '{n} answers') })),
      h('div.rev-stats', null,
        stat(pct(s.recall), tt('Remembered')),
        ...(settings.reviewButtons !== 'detailed'
          ? [stat(String(s.grades[0]), SIMPLE[0].label()), stat(String(s.grades[1] + s.grades[2] + s.grades[3]), SIMPLE[1].label())]
          : GRADES.map((g) => stat(String(s.grades[g.grade]), tt(g.label)))),
      ),
      // Looked-up words are new cards, not due ones: said apart, as Vocabulary says them.
      h('p.rev-next', null, parts.due && parts.fresh
        ? ttn(parts.due, '{n} more card due now, and {fresh} new from words you looked up.', '{n} more cards due now, and {fresh} new from words you looked up.', { fresh: num(parts.fresh) })
        : parts.due ? ttn(parts.due, '{n} more card due now.', '{n} more cards due now.')
        : parts.fresh ? ttn(parts.fresh, '{n} new card from words you looked up.', '{n} new cards from words you looked up.')
        : next ? nextDueLine(next) : tt('All your cards are scheduled.')),
      h('div.rev-summary-actions', null,
        dueNow ? h('button.btn.btn-primary', { type: 'button', onclick: () => void start(true) }, tt('Keep going')) : null,
        h('a.btn', { href: '#/vocab' }, icon('list'), tt('Back to words')),
        h('a.btn.btn-ghost', { href: '#/' }, tt('Library')),
      ),
    );
    screen.append(head(), summary);
    // A session finished: a short celebration (celebrate.ts).
    if (s.reviews > 0) celebrate(summary);
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
    // Simple: 1 is Forgot, and 2 (or Anki's 3 and 4) Got it.
    const simple = settings.reviewButtons !== 'detailed';
    if (e.key >= '1' && e.key <= '4') {
      if (!revealed) return;
      e.preventDefault();
      void grade(simple ? (e.key === '1' ? SIMPLE[0].grade : SIMPLE[1].grade) : (Number(e.key) - 1) as Grade);
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
