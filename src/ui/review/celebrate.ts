// The end of a review session: a short burst of paper in the four tone inks and the accent, falling from the top of the summary
// card, and the title popping in. About a second and a half, then gone; it takes no taps. With reduced motion asked for, only the
// title fades in. Styled in review.css (.rev-confetti).

const INKS = ['var(--accent)', 'var(--tone-1)', 'var(--tone-2)', 'var(--tone-3)', 'var(--tone-4)', '#d9a521'];
const PIECES = 70;

/** Celebrates over `card` (the summary). Safe where animation is missing (tests, old browsers): it then does nothing. */
export function celebrate(card: HTMLElement): void {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const title = card.querySelector<HTMLElement>('.rev-summary-title');
  if (title && typeof title.animate === 'function') {
    title.animate(reduce
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: reduce ? 300 : 520, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
  if (reduce) return;
  const layer = document.createElement('div');
  layer.className = 'rev-confetti';
  layer.setAttribute('aria-hidden', 'true');
  if (typeof layer.animate !== 'function') return;
  document.body.appendChild(layer);
  const r = card.getBoundingClientRect();
  const x0 = r.left + r.width / 2;
  const y0 = Math.max(0, r.top + 24);
  const fall = Math.max(320, window.innerHeight - y0);
  const ends: Promise<unknown>[] = [];
  for (let i = 0; i < PIECES; i++) {
    const p = document.createElement('span');
    // Spread by index with a little jitter, so every burst looks alike and the pieces never bunch.
    const a = (i / PIECES) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.4;
    const speed = 160 + ((i * 37) % 140);
    const dx = Math.cos(a) * speed * 1.4;
    const up = -Math.abs(Math.sin(a)) * speed - 60;
    const w = 6 + (i % 4) * 2;
    p.style.cssText = `left:${x0}px;top:${y0}px;width:${w}px;height:${w * (i % 3 ? 0.45 : 1)}px;background:${INKS[i % INKS.length]};border-radius:${i % 5 === 0 ? '50%' : '1px'}`;
    layer.appendChild(p);
    const spin = (i % 2 ? 1 : -1) * (360 + (i * 53) % 540);
    const anim = p.animate([
      { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${up}px)) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.3 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${fall * 0.8}px)) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: 1300 + (i % 7) * 60, easing: 'cubic-bezier(.15,.6,.4,1)', delay: (i % 10) * 12, fill: 'forwards' });
    ends.push(anim.finished.catch(() => undefined));
  }
  void Promise.all(ends).then(() => layer.remove());
  // Leaving the screen early takes it away too.
  window.setTimeout(() => layer.remove(), 3000);
}
