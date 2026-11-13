// Pengu, LinguPengu's mascot: a fluffy emperor penguin chick peeking over an open terracotta book, a flat sticker (art/, made
// into the app's images by scripts/make-pengu.py). On a white rounded square it is the logo: the brand mark in the bar
// (logo.webp), the browser tab's icon and the app's icons.
//
// Around the app Pengu is animated like a cartoon, a drawing at a time (drawings made by editing the mascot in ChatGPT): a
// move shows them in turn. A picture is never bent or stretched; the drawings do that. Two sets:
//
//   book   Pengu over its book (most places): it blinks now and then (open, half shut, shut, half shut), and waves hello: its
//          flipper is a cutout of its own (pengu-arm.webp) that comes up from the book and swings from the shoulder, smoothly
//          (swapping drawn wave frames looked stiff)
//   jump   Pengu on its own feet, for good news (a review done, the day's goal, a book finished): it crouches, pushes off, jumps
//          with its flippers in the air and lands. The drawings stand on one ground line and change only the pose; Pengu goes up
//          and down along a smooth arc while they change (`jumpArc`), as high as it was drawn at the top (jump.json).
//
//   penguEl(pose, cls)        Pengu in a span (the 'cheer' pose is the jumping one); a tap makes it wave or jump
//   animatePengu(el, move)    a move on that span: pop (fading in), wave, blink, hop (one jump), cheer (two), boing (a tap)
//   penguPeek(card)           Pengu peeking over the top edge of a card, hidden behind it below the edge
//   penguSays(text)           Pengu jumping for joy at the bottom of the screen with a speech bubble (the daily goal reached; a
//                             book finished)
//
// Every jump for good news throws a small burst of paper from behind Pengu as it leaves the ground (penguConfetti).
//
// Everything stops for a reader who asks for reduced motion, and does nothing where the browser cannot animate (tests).
import '../styles/pengu.css';
import penguUrl from './pengu/pengu.webp';
import blinkHalfUrl from './pengu/pengu-blink-half.webp';
import blinkUrl from './pengu/pengu-blink.webp';
import noflipUrl from './pengu/pengu-noflip.webp';
import armUrl from './pengu/pengu-arm.webp';
import arm from './pengu/arm.json';
import standUrl from './pengu/pengu-stand.webp';
import crouchUrl from './pengu/pengu-crouch.webp';
import riseUrl from './pengu/pengu-rise.webp';
import airUrl from './pengu/pengu-air.webp';
import lifts from './pengu/jump.json';
import logoUrl from './pengu/logo.webp';

export type PenguPose = 'stand' | 'wave' | 'cheer' | 'read';
export type PenguMove = 'pop' | 'wave' | 'blink' | 'hop' | 'cheer' | 'boing';

/** Each set's drawings by name; `rest` is the one shown between moves. */
const SETS = {
  book: { rest: penguUrl, 'blink-half': blinkHalfUrl, blink: blinkUrl, noflip: noflipUrl },
  jump: { rest: standUrl, crouch: crouchUrl, rise: riseUrl, air: airUrl },
} as const;
type Kind = keyof typeof SETS;
/** Good news is the jumping Pengu; every other pose is Pengu over its book. */
const kindOf = (pose: PenguPose): Kind => (pose === 'cheer' ? 'jump' : 'book');

/** A move: drawings and how long each shows (ms), then back to `rest`. */
type Seq = readonly (readonly [string, number])[];
// A wave, 1.7 s: the flipper comes up off the book, swings out and in from the shoulder three times, and goes back down.
const WAVE_MS = 1700;
const WAVE_SWING: Keyframe[] = [
  { transform: 'rotate(38deg)', opacity: 0, offset: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
  { transform: 'rotate(-4deg)', opacity: 1, offset: 0.13, easing: 'ease-in-out' },
  { transform: 'rotate(18deg)', offset: 0.27, easing: 'ease-in-out' },
  { transform: 'rotate(-10deg)', offset: 0.41, easing: 'ease-in-out' },
  { transform: 'rotate(18deg)', offset: 0.55, easing: 'ease-in-out' },
  { transform: 'rotate(-10deg)', offset: 0.69, easing: 'ease-in-out' },
  { transform: 'rotate(10deg)', offset: 0.81, easing: 'ease-in-out' },
  { transform: 'rotate(0deg)', opacity: 1, offset: 0.88, easing: 'cubic-bezier(.5,0,.8,.4)' },
  { transform: 'rotate(38deg)', opacity: 0, offset: 1 },
];
/** How long the flipper on the book fades out as the cutout one comes up, and back in as it goes down (ms). */
const NUB_MS = 200;

/**
 * Waves with the cutout flipper: the picture without the right flipper shows over the mascot while the mascot's resting flipper
 * fades out (it shows only through where that one is missing), the cutout swings, and the resting flipper fades back in.
 */
function waveArm(stack: HTMLElement, delay: number): void {
  const flip = stack.querySelector<HTMLElement>('.pengu-arm');
  const bare = stack.querySelector<HTMLElement>('.pengu-f[data-f="noflip"]');
  const rest = stack.querySelector<HTMLElement>('.pengu-f[data-f="rest"]');
  if (!flip || !bare || !rest) return;
  stop(stack);
  const timers = [
    window.setTimeout(() => {
      bare.classList.add('on');
      rest.animate([{ opacity: 1 }, { opacity: 0 }], { duration: NUB_MS, fill: 'forwards' });
    }, delay),
    window.setTimeout(() => {
      for (const a of rest.getAnimations()) a.cancel();
      rest.animate([{ opacity: 0 }, { opacity: 1 }], { duration: NUB_MS });
    }, delay + WAVE_MS - NUB_MS),
    window.setTimeout(() => { bare.classList.remove('on'); playing.delete(stack); }, delay + WAVE_MS),
  ];
  playing.set(stack, timers);
  flip.animate(WAVE_SWING, { duration: WAVE_MS, delay });
}
// One jump, 780 ms: down into a crouch, up (pushing off), the top with its flippers in the air, down (the push-off drawing
// again, falling), landing in a crouch. jumpArc moves it along the same times.
const JUMP: Seq = [['crouch', 150], ['rise', 100], ['air', 310], ['rise', 100], ['crouch', 120]];
const JUMP_MS = JUMP.reduce((t, [, ms]) => t + ms, 0);
/** When it leaves the ground, is highest and lands again (ms into the jump). */
const LIFT_OFF = 150;
const PEAK = 390;
const LAND = 660;

/**
 * Pengu's way up and down for `jumps` jumps, as one smooth curve under the drawings: fast off the ground and slowing to the top
 * (as high as the top drawing was drawn), then speeding back down. Transforms only, so nothing is laid out.
 */
function jumpArc(stack: HTMLElement, jumps: number, delay: number): void {
  const at = (ms: number) => ms / JUMP_MS;
  const top = `translateY(-${lifts.air}%)`;
  stack.animate([
    { transform: 'none', offset: 0 },
    { transform: 'none', offset: at(LIFT_OFF), easing: 'cubic-bezier(.25,.75,.45,1)' },
    { transform: top, offset: at(PEAK), easing: 'cubic-bezier(.55,0,.75,.25)' },
    { transform: 'none', offset: at(LAND) },
    { transform: 'none', offset: 1 },
  ], { duration: JUMP_MS, iterations: jumps, delay });
}
// A blink: half shut, shut, half shut, about a fifth of a second.
const BLINK: Seq = [['blink-half', 50], ['blink', 80], ['blink-half', 50]];
const DOUBLE_BLINK: Seq = [...BLINK, ['rest', 110], ...BLINK];
const SEQS: Record<Kind, Partial<Record<PenguMove, Seq>>> = {
  book: { blink: BLINK },
  jump: { wave: JUMP, boing: JUMP, hop: JUMP, cheer: [...JUMP, ...JUMP] },
};
/** How many jumps each move is, for jumpArc. */
const JUMPS: Partial<Record<PenguMove, number>> = { wave: 1, boing: 1, hop: 1, cheer: 2 };

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const still = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Starts loading the drawings early (main.ts), each decoded too, so a frame swapped in is drawn at once and Pengu never pops in
 * late; and starts the blinking.
 */
export function preloadPengu(): void {
  if (typeof Image !== 'function') return;
  for (const url of new Set([...Object.values(SETS).flatMap((set) => Object.values(set)), armUrl])) {
    const img = new Image();
    img.src = url;
    void img.decode?.().catch(() => {});
  }
  startBlinking();
}

/**
 * Pengu as HTML: every drawing of its set stacked in one box, only `rest` showing. `label` names it for screen readers; without
 * one it is decoration, hidden from them.
 */
export function penguHtml(pose: PenguPose = 'stand', label = ''): string {
  const kind = kindOf(pose);
  const imgs = Object.entries(SETS[kind]).map(([name, url]) => {
    const rest = name === 'rest';
    const said = rest && label ? ` alt="${attr(label)}"` : ' alt="" aria-hidden="true"';
    return `<img class="pengu pengu-f${rest ? ' on' : ''}" data-f="${name}" src="${url}"${said} draggable="false" decoding="async">`;
  });
  // Over its book, the waving flipper on a layer of its own, turning from its shoulder (arm.json), unseen until it waves.
  if (kind === 'book') imgs.push(`<img class="pengu pengu-arm" src="${armUrl}" alt="" aria-hidden="true" draggable="false" decoding="async" style="transform-origin:${arm.x}% ${arm.y}%">`);
  return `<span class="pengu-stack" data-kind="${kind}">${imgs.join('')}</span>`;
}

/** The brand mark in the bar: Pengu over its book on a white rounded square, as an <img> (HTML), hidden from screen readers. */
export function penguMark(): string {
  return `<img class="pengu-mark" src="${logoUrl}" alt="" aria-hidden="true" draggable="false" decoding="async">`;
}

/** The stacks playing a move, each with its timers (a new move stops the one playing). */
const playing = new WeakMap<Element, number[]>();
const stackOf = (el: Element): HTMLElement | null => (el.classList.contains('pengu-stack') ? el as HTMLElement : el.querySelector<HTMLElement>('.pengu-stack'));
const showFrame = (stack: Element, name: string) => {
  for (const img of stack.querySelectorAll<HTMLElement>('.pengu-f')) img.classList.toggle('on', img.dataset.f === name);
};
function stop(stack: Element): void {
  for (const t of playing.get(stack) ?? []) window.clearTimeout(t);
  playing.delete(stack);
  for (const a of (stack as HTMLElement).getAnimations?.({ subtree: true }) ?? []) a.cancel();
  showFrame(stack, 'rest');
}
function play(stack: Element, seq: Seq, delay = 0): void {
  stop(stack);
  const timers: number[] = [];
  let at = delay;
  for (const [name, ms] of seq) {
    timers.push(window.setTimeout(() => showFrame(stack, name), at));
    at += ms;
  }
  timers.push(window.setTimeout(() => { showFrame(stack, 'rest'); playing.delete(stack); }, at));
  playing.set(stack, timers);
}

/** Plays `move` on Pengu (a span from penguEl or penguPeek, or a stack from penguHtml); a move already playing gives way to it. */
export function animatePengu(el: Element | null | undefined, move: PenguMove, delay = 0): void {
  if (!el || still() || typeof (el as HTMLElement).animate !== 'function') return;
  if (move === 'pop') {
    // Arriving: a fade, nothing more.
    (el as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out', delay, fill: 'backwards' });
    return;
  }
  const stack = stackOf(el);
  const kind = stack?.dataset.kind as Kind | undefined;
  if (!stack || !kind) return;
  // Over its book, anything but a blink is a wave.
  if (kind === 'book' && move !== 'blink') { waveArm(stack, delay); return; }
  const seq = SEQS[kind][move];
  if (!seq) return;
  play(stack, seq, delay);
  if (kind !== 'jump') return;
  const jumps = JUMPS[move] ?? 1;
  jumpArc(stack, jumps, delay);
  // Good news: a burst of paper from behind Pengu as it leaves the ground, every jump (not for a tap).
  if (move === 'boing') return;
  for (let i = 0; i < jumps; i++) {
    playing.get(stack)?.push(window.setTimeout(() => { if (stack.isConnected) penguConfetti(stack); }, delay + i * JUMP_MS + LIFT_OFF));
  }
}

/** Pengu over its book blinks every few seconds while it is on the screen, now and then twice. */
let blinking = false;
function startBlinking(): void {
  if (blinking || typeof window === 'undefined' || typeof document === 'undefined') return;
  blinking = true;
  const due = new WeakMap<Element, number>();
  window.setInterval(() => {
    if (document.hidden || still()) return;
    const now = Date.now();
    for (const stack of document.querySelectorAll<HTMLElement>('.pengu-stack[data-kind="book"]')) {
      if (playing.has(stack) || typeof stack.animate !== 'function') continue;
      const at = due.get(stack);
      if (at === undefined) { due.set(stack, now + 1500 + Math.random() * 2500); continue; }
      if (now < at) continue;
      due.set(stack, now + 2800 + Math.random() * 4200);
      const r = stack.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > window.innerHeight) continue;
      play(stack, Math.random() < 0.2 ? DOUBLE_BLINK : BLINK);
    }
  }, 250);
}

/** Pengu in a span with class `cls` (space separated), hidden from screen readers. A tap makes it wave or jump (unless `tap: false`). */
export function penguEl(pose: PenguPose, cls = 'pengu-box', opts: { tap?: boolean } = {}): HTMLElement {
  const el = document.createElement('span');
  el.className = `${cls} pengu-span`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = penguHtml(pose);
  if (opts.tap !== false && !still()) {
    el.classList.add('pengu-tappable');
    el.addEventListener('click', (e) => { e.stopPropagation(); animatePengu(el, 'boing'); });
  }
  return el;
}

export interface PenguPeek {
  /** The wrapper to put where the card was: Pengu behind, the card in front. */
  el: HTMLElement;
  /** Puts `card` in front of Pengu (the same Pengu, so it does not arrive again with every card). */
  hold(card: HTMLElement): void;
  react(move: PenguMove): void;
}

/** Pengu peeking over the top edge of a card (the library's first book), its lower half hidden behind it. */
export function penguPeek(card?: HTMLElement, opts: { pop?: boolean } = {}): PenguPeek {
  const pengu = penguEl('read', 'pengu-peek');
  const el = document.createElement('div');
  el.className = 'pengu-peek-host';
  el.append(pengu);
  let held: HTMLElement | null = null;
  const peek: PenguPeek = {
    el,
    hold(c) {
      if (held === c) return;
      held?.remove();
      held = c;
      c.classList.add('pengu-peek-card');
      el.append(c);
    },
    react(move) { animatePengu(pengu, move); },
  };
  if (card) peek.hold(card);
  // It fades in and waves hello.
  if (opts.pop !== false) { animatePengu(pengu, 'pop', 120); animatePengu(pengu, 'wave', 520); }
  return peek;
}

// The paper of Pengu's burst: the four tone inks, the accent and a gold, as in Review's celebration (review/celebrate.ts).
const PAPER = ['var(--accent)', 'var(--tone-1)', 'var(--tone-2)', 'var(--tone-3)', 'var(--tone-4)', '#d9a521'];
const BITS = 26;

/**
 * A small burst of paper from behind Pengu (`from`, its span): up and out in a fan, then drifting down and fading, about a
 * second and a half. Lighter than Review's (about a third of the pieces, from one spot), since it shows over the page of a book.
 * It takes no taps, and does nothing with reduced motion or where the browser cannot animate.
 */
export function penguConfetti(from: Element): void {
  if (still()) return;
  const layer = document.createElement('div');
  layer.className = 'pengu-confetti';
  layer.setAttribute('aria-hidden', 'true');
  if (typeof layer.animate !== 'function') return;
  const r = from.getBoundingClientRect();
  const x0 = r.left + r.width / 2;
  const y0 = r.top + r.height * 0.35;
  document.body.append(layer);
  const ends: Promise<unknown>[] = [];
  for (let i = 0; i < BITS; i++) {
    const p = document.createElement('span');
    // A fan from up-left to up-right, spread by index with a little jitter, so every burst looks alike and none bunch.
    const a = -Math.PI * (0.18 + 0.64 * (i / (BITS - 1))) + Math.sin(i * 12.9898) * 0.12;
    const speed = 120 + ((i * 37) % 110);
    const dx = Math.cos(a) * speed;
    const up = Math.sin(a) * speed - 30;
    const w = 5 + (i % 3) * 2;
    p.style.cssText = `left:${x0}px;top:${y0}px;width:${w}px;height:${(w * (i % 3 ? 0.5 : 1)).toFixed(1)}px;background:${PAPER[i % PAPER.length]};border-radius:${i % 4 === 0 ? '50%' : '1px'}`;
    layer.append(p);
    const spin = (i % 2 ? 1 : -1) * (180 + ((i * 53) % 240));
    ends.push(p.animate([
      { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(dx * 0.7).toFixed(1)}px), calc(-50% + ${up.toFixed(1)}px)) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${(up + 90).toFixed(1)}px)) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: 1250 + (i % 5) * 60, easing: 'cubic-bezier(.2,.6,.35,1)', delay: (i % 6) * 15, fill: 'forwards' }).finished.catch(() => undefined));
  }
  void Promise.all(ends).then(() => layer.remove());
  window.setTimeout(() => layer.remove(), 2500);
}

/**
 * Pengu coming up from the bottom of the screen with `text` in a speech bubble, jumping for joy, for a few seconds. It waits while something is
 * being looked at (a word card or a reader menu open, or a flashcard in Review), so it never covers the thing in hand, and gives
 * up after a few minutes. Only Pengu and the bubble take taps (a tap puts it away), Escape puts it away too, and screen readers
 * hear the text once: the bubble is filled after the live region is on the page. Its jumps throw the paper.
 */
export function penguSays(text: string, ms = 6000): void {
  const busy = () => !!document.querySelector('.pp-pop, .rd-pop')
    || (document.body.dataset.route === 'review' && !!document.querySelector('.rev-card'));
  const started = Date.now();
  const tryShow = () => {
    if (!busy()) { show(); return; }
    if (Date.now() - started < SAYS_WAIT_MS) window.setTimeout(tryShow, 700);
  };
  const show = () => {
    document.querySelector('.pengu-says')?.remove();
    const bubble = document.createElement('div');
    bubble.className = 'pengu-says-bubble';
    const pengu = penguEl('cheer', 'pengu-says-pengu', { tap: false });
    const box = document.createElement('div');
    box.className = 'pengu-says';
    box.setAttribute('role', 'status');
    box.append(pengu, bubble);
    let gone = false;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') away(); };
    const away = () => {
      if (gone) return;
      gone = true;
      document.removeEventListener('keydown', onKey);
      box.classList.remove('on');
      window.setTimeout(() => box.remove(), still() ? 0 : 420);
    };
    pengu.addEventListener('click', away);
    bubble.addEventListener('click', away);
    document.addEventListener('keydown', onKey);
    document.body.append(box);
    // On the next frame: the slide up from below is drawn, and the live region exists before its text arrives.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bubble.textContent = text;
      box.classList.add('on');
      // Up from below, it jumps for joy twice.
      animatePengu(pengu, 'cheer', 360);
    }));
    window.setTimeout(away, ms);
  };
  tryShow();
}

/** How long a message waits for a word card or a flashcard to be put away before it is dropped. */
const SAYS_WAIT_MS = 3 * 60_000;
