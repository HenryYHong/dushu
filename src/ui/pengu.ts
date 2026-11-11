// Pengu, LinguPengu's mascot: a fluffy emperor penguin chick peeking over an open book in the app's vermilion, a sticker
// (art/pengu-logo.png, made into the app's images by scripts/make-pengu.py). The logo (logo.webp: the sticker on the app's ink
// blue, rounded corners) is the brand mark in the bar and the app icons; the mascot (pengu.webp) is alive around the app:
//
//   penguEl(pose, cls)        Pengu in a span: breathing and swaying gently (CSS, on the picture), a jump when tapped
//   animatePengu(el, move)    a one-off move on that span: pop (arriving), hop, boing, cheer, duck, nod (Web Animations)
//   penguPeek(card)           Pengu peeking over the top edge of a card, hidden behind it below the edge, reacting on cue
//   penguSays(text)           Pengu popping up from the bottom of the screen with a speech bubble (the daily goal reached)
//
// The idle motion is on the picture and the moves on its span, so the two add up instead of replacing each other. Everything
// stops for a reader who asks for reduced motion, and does nothing where the browser cannot animate (tests).
import '../styles/pengu.css';
import penguUrl from './pengu/pengu.webp';
import logoUrl from './pengu/logo.webp';

export type PenguPose = 'stand' | 'wave' | 'cheer' | 'read';
export type PenguMove = 'pop' | 'hop' | 'boing' | 'cheer' | 'duck' | 'nod';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const still = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Starts loading the picture early (main.ts), so Pengu never pops in late. */
export function preloadPengu(): void {
  if (typeof Image === 'function') new Image().src = penguUrl;
}

/** Pengu as an <img> (HTML), breathing gently. `label` names it for screen readers; without one it is decoration, hidden from them. */
export function penguHtml(pose: PenguPose = 'stand', label = ''): string {
  // Each Pengu starts its breath at a different moment, so two on one screen never move in step.
  const delay = `${-(Math.random() * 4).toFixed(2)}s`;
  return `<img class="pengu pengu-${pose} pengu-idle" style="animation-delay:${delay}" src="${penguUrl}" alt="${attr(label)}"${label ? '' : ' aria-hidden="true"'} draggable="false" decoding="async">`;
}

/** The logo (the brand mark): Pengu over its book on the ink blue square, as an <img> (HTML), hidden from screen readers. */
export function penguMark(): string {
  return `<img class="pengu-mark" src="${logoUrl}" alt="" aria-hidden="true" draggable="false" decoding="async">`;
}

const MOVES: Record<PenguMove, { frames: Keyframe[]; ms: number; easing: string }> = {
  // Arriving: from small and low, a springy overshoot, then settled.
  pop: { ms: 640, easing: 'cubic-bezier(.2,.9,.3,1)', frames: [
    { transform: 'translateY(16%) scale(.55)', opacity: 0 },
    { transform: 'translateY(-5%) scale(1.07)', opacity: 1, offset: 0.55 },
    { transform: 'translateY(1%) scale(.97)', offset: 0.78 },
    { transform: 'none', opacity: 1 }] },
  // A happy hop: a squash to push off, a stretch in the air, a squash on landing.
  hop: { ms: 620, easing: 'ease-out', frames: [
    { transform: 'none' },
    { transform: 'translateY(3%) scale(1.07,.9)', offset: 0.14 },
    { transform: 'translateY(-24%) scale(.95,1.06)', offset: 0.45 },
    { transform: 'translateY(0) scale(1.07,.92)', offset: 0.7 },
    { transform: 'scale(.98,1.02)', offset: 0.85 },
    { transform: 'none' }] },
  // Tapped: a bigger jump with a wiggle in the air.
  boing: { ms: 820, easing: 'ease-out', frames: [
    { transform: 'none' },
    { transform: 'translateY(4%) scale(1.1,.86)', offset: 0.12 },
    { transform: 'translateY(-34%) scale(.93,1.08) rotate(-7deg)', offset: 0.4 },
    { transform: 'translateY(-30%) scale(.95,1.06) rotate(6deg)', offset: 0.55 },
    { transform: 'translateY(0) scale(1.1,.88) rotate(0)', offset: 0.75 },
    { transform: 'scale(.97,1.03)', offset: 0.88 },
    { transform: 'none' }] },
  // A whole celebration: two jumps, leaning one way then the other.
  cheer: { ms: 1500, easing: 'ease-in-out', frames: [
    { transform: 'none' },
    { transform: 'translateY(3%) scale(1.08,.9)', offset: 0.08 },
    { transform: 'translateY(-30%) scale(.94,1.07) rotate(-8deg)', offset: 0.26 },
    { transform: 'translateY(0) scale(1.08,.9) rotate(0)', offset: 0.44 },
    { transform: 'translateY(-26%) scale(.95,1.06) rotate(8deg)', offset: 0.64 },
    { transform: 'translateY(0) scale(1.07,.92) rotate(0)', offset: 0.82 },
    { transform: 'scale(.98,1.02)', offset: 0.92 },
    { transform: 'none' }] },
  // Oops: ducking down out of sight a little, then peeking back up.
  duck: { ms: 900, easing: 'ease-in-out', frames: [
    { transform: 'none' },
    { transform: 'translateY(26%) scale(1.03,.97)', offset: 0.3 },
    { transform: 'translateY(26%) rotate(-3deg)', offset: 0.55 },
    { transform: 'translateY(6%) rotate(2deg)', offset: 0.8 },
    { transform: 'none' }] },
  // Interested: a small tilt of the head, one way and back.
  nod: { ms: 560, easing: 'ease-in-out', frames: [
    { transform: 'none' },
    { transform: 'translateY(-4%) rotate(-6deg)', offset: 0.35 },
    { transform: 'translateY(-2%) rotate(4deg)', offset: 0.7 },
    { transform: 'none' }] },
};

/** Plays `move` on Pengu's span (from penguEl or penguPeek); a move already playing gives way to the new one. */
export function animatePengu(el: Element | null | undefined, move: PenguMove, delay = 0): void {
  if (!el || still() || typeof (el as HTMLElement).animate !== 'function') return;
  const m = MOVES[move];
  for (const a of (el as HTMLElement).getAnimations?.() ?? []) a.cancel();
  (el as HTMLElement).animate(m.frames, { duration: m.ms, easing: m.easing, delay, fill: 'backwards' });
}

/** Pengu in a span with class `cls` (space separated), hidden from screen readers. A tap makes it jump (unless `tap: false`). */
export function penguEl(pose: PenguPose, cls = 'pengu-box', opts: { tap?: boolean } = {}): HTMLElement {
  const el = document.createElement('span');
  el.className = `${cls} pengu-span`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = penguHtml(pose);
  if (opts.tap !== false) {
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

/** Pengu peeking over the top edge of a card (Review's flashcard, the library's first book), its lower half hidden behind it. */
export function penguPeek(card?: HTMLElement): PenguPeek {
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
  animatePengu(pengu, 'pop', 120);
  return peek;
}

/** Pengu popping up from the bottom of the screen with `text` in a speech bubble, for a few seconds; a tap puts it away. */
export function penguSays(text: string, ms = 6000): void {
  document.querySelector('.pengu-says')?.remove();
  const bubble = document.createElement('div');
  bubble.className = 'pengu-says-bubble';
  bubble.textContent = text;
  const pengu = penguEl('cheer', 'pengu-says-pengu', { tap: false });
  const box = document.createElement('div');
  box.className = 'pengu-says';
  box.setAttribute('role', 'status');
  box.append(pengu, bubble);
  let gone = false;
  const away = () => {
    if (gone) return;
    gone = true;
    box.classList.remove('on');
    window.setTimeout(() => box.remove(), still() ? 0 : 420);
  };
  box.addEventListener('click', away);
  document.body.append(box);
  // On the next frame, so the slide up from below is drawn.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    box.classList.add('on');
    animatePengu(pengu, 'cheer', 260);
  }));
  window.setTimeout(away, ms);
}
