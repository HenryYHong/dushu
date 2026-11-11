// Pengu, LinguPengu's mascot: a cute navy penguin sticker (art/pengu-source.jpg, made into the app's images by
// scripts/make-pengu.py). The mascot (pengu.webp: the whole penguin, waving with both flippers) is on the welcome screen, beside
// each walkthrough step, over empty Review and Vocabulary, on About and cheering at the end of a review; the logo (logo.webp:
// its top half peeking out of a pale blue circle) is the brand mark in the bar and, from the same script, the app icons.
// One picture for every pose for now: `pose` only names how it is used, so styles can move it (a hop, a cheer).
import penguUrl from './pengu/pengu.webp';
import logoUrl from './pengu/logo.webp';

export type PenguPose = 'stand' | 'wave' | 'cheer' | 'read';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Pengu as an <img> (HTML). `label` names it for screen readers; without one it is decoration, hidden from them. */
export function penguHtml(pose: PenguPose = 'stand', label = ''): string {
  return `<img class="pengu pengu-${pose}" src="${penguUrl}" alt="${attr(label)}"${label ? '' : ' aria-hidden="true"'} draggable="false" decoding="async">`;
}

/** The logo (the brand mark): Pengu peeking out of its circle, as an <img> (HTML), hidden from screen readers. */
export function penguMark(): string {
  return `<img class="pengu-mark" src="${logoUrl}" alt="" aria-hidden="true" draggable="false" decoding="async">`;
}

/** Pengu in a span with class `cls` (space separated), hidden from screen readers. */
export function penguEl(pose: PenguPose, cls = 'pengu-box'): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = penguHtml(pose);
  return el;
}
