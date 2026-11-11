// The highlight of a one-choice control (Settings' segmented controls, the welcome's daily goals) slides from the old choice to
// the new one when the reader picks another, so the eye follows the choice instead of finding it again. One mark per control,
// shown only while it moves: before and after, the chosen button's own style is the highlight, so the control never depends on
// the mark being measured right (a first draw, a hidden row, a resize, a change from another tab). Transforms only, about a
// fifth of a second; nothing moves for a reader who asks for reduced motion or where the browser cannot animate (tests).
import { h } from './dom';
import { EASE_OUT, canMove } from './review/motion';

const GLIDE_MS = 220;

/** A box in the group's own coordinates (from its padding edge), where the mark is positioned. */
export interface GlideBox { x: number; y: number; w: number; h: number }

export interface ChoiceGlide {
  /** Where the highlight is now: on `chosen`, or the mark's place on its way. Read before the choice changes; null when nothing can move. */
  from(chosen: Element | null | undefined): GlideBox | null;
  /** Slides the highlight from `from` to `to`, the button now chosen (and styled so). */
  to(to: Element, from: GlideBox | null): void;
  /** Puts the mark away at once: the chosen button's own highlight shows. */
  stop(): void;
}

/**
 * Adds the mark to `group`, which must be its positioned box. `cls` names the mark (`<cls>-glide`, styled as the chosen state)
 * and the class the group wears while it moves (`<cls>-moving`), which takes the chosen button's own highlight off under it.
 */
export function choiceGlide(group: HTMLElement, cls: string): ChoiceGlide {
  const mark = h(`span.${cls}-glide`, { 'aria-hidden': 'true' });
  group.append(mark);
  let run: Animation | null = null;
  const boxOf = (el: Element): GlideBox | null => {
    const g = group.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || g.width < 1) return null;
    return { x: r.left - g.left - group.clientLeft, y: r.top - g.top - group.clientTop, w: r.width, h: r.height };
  };
  const stop = () => {
    const a = run;
    run = null;
    a?.cancel();
    group.classList.remove(`${cls}-moving`);
  };
  return {
    // A second pick while the mark is still on its way starts from where it is, not from the button it left.
    from: (chosen) => (!canMove(mark) ? null : run ? boxOf(mark) : chosen ? boxOf(chosen) : null),
    to(to, from) {
      const end = from ? boxOf(to) : null;
      stop();
      // Another row of a grid (the welcome's goals): a glide would cross the grid diagonally; the choice's own style shows at once.
      if (!from || !end || (Math.abs(from.x - end.x) < 1 && Math.abs(from.y - end.y) < 1) || Math.abs(from.y - end.y) >= 1) return;
      Object.assign(mark.style, { left: `${end.x}px`, top: `${end.y}px`, width: `${end.w}px`, height: `${end.h}px` });
      group.classList.add(`${cls}-moving`);
      const a = mark.animate([
        { transform: `translate(${from.x - end.x}px, ${from.y - end.y}px) scale(${from.w / end.w}, ${from.h / end.h})` },
        { transform: 'none' },
      ], { duration: GLIDE_MS, easing: EASE_OUT });
      run = a;
      a.onfinish = () => { if (run === a) stop(); };
    },
    stop,
  };
}
