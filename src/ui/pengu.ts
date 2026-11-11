// Pengu, LinguPengu's mascot: a baby emperor penguin (gray down, a black cap, a white face) in a vermilion scarf, the app's
// accent. Drawn here from shared parts so every pose is the same bird: standing, waving hello, cheering (both flippers up) and
// reading an open book. The head alone is the app's icon and the brand mark (scripts/make-icons.mjs reads penguMark()).
// Flat shapes, no outlines; the colors are fixed, not the theme's, so Pengu looks the same in light and dark.

export type PenguPose = 'stand' | 'wave' | 'cheer' | 'read';

const INK = '#2b303a';      // the cap and the flippers' dark edge
const INK_HI = '#454c59';   // the light on the cap
const DOWN = '#a9b0b9';     // gray down
const DOWN_DARK = '#8b929c';
const BELLY = '#d9dde2';
const FACE = '#fbfaf7';
const EYE = '#1b1e23';
const BEAK = '#e9a23b';
const FEET = '#e58f2e';
const CHEEK = '#f0a29b';
const SCARF = '#c13616';
const SCARF_DARK = '#99290f';

/** The head: cap, its light, the tuft, the white face, eyes (open, or happy arcs), cheeks and beak. Centered at (60, 46). */
function head(eyes: 'open' | 'happy' | 'down'): string {
  const eye = (x: number) => eyes === 'happy'
    ? `<path d="M${x - 4.2} 51.5 Q${x} 46.5 ${x + 4.2} 51.5" fill="none" stroke="${EYE}" stroke-width="2.6" stroke-linecap="round"/>`
    : eyes === 'down'
      ? `<path d="M${x - 4} 50 Q${x} 53.5 ${x + 4} 50" fill="none" stroke="${EYE}" stroke-width="2.6" stroke-linecap="round"/>`
      : `<circle cx="${x}" cy="50" r="4.4" fill="${EYE}"/><circle cx="${x + 1.5}" cy="48.4" r="1.5" fill="#fff"/>`;
  return `<circle cx="60" cy="46" r="29" fill="${INK}"/>
<path d="M40 30 Q48 20 60 19" fill="none" stroke="${INK_HI}" stroke-width="4" stroke-linecap="round" opacity=".9"/>
<path d="M57 18.5 Q58.5 11.5 64.5 13 Q61 14.5 61.5 18.5 Z" fill="${INK}"/>
<path d="M60 39 C54 34 39 35 37 47 C35.5 57 44 66 60 66 C76 66 84.5 57 83 47 C81 35 66 34 60 39 Z" fill="${FACE}"/>
${eye(50.5)}${eye(69.5)}
<ellipse cx="43.5" cy="57.5" rx="4.2" ry="2.6" fill="${CHEEK}" opacity=".75"/>
<ellipse cx="76.5" cy="57.5" rx="4.2" ry="2.6" fill="${CHEEK}" opacity=".75"/>
<path d="M56 55.5 Q60 53.6 64 55.5 Q62.2 59.8 60 60.8 Q57.8 59.8 56 55.5 Z" fill="${BEAK}"/>`;
}

/** The scarf around the neck, its knot on the right and the end hanging down. */
const SCARF_SVG = `<path d="M33 69 Q60 79 87 69 L88 77 Q60 88 32 77 Z" fill="${SCARF}"/>
<path d="M74 75 L81 97 Q83.5 99.5 86.5 97.5 L84.5 76 Z" fill="${SCARF}"/>
<path d="M78.5 88 L85.5 87.2 M79.6 92 L85.9 91.3" stroke="${SCARF_DARK}" stroke-width="1.6" stroke-linecap="round"/>
<circle cx="80" cy="76.5" r="4.2" fill="${SCARF_DARK}"/>`;

/** A flipper hanging (0°), raised (negative: up and out) or folded in (positive: toward the middle), pivoting at the shoulder. */
function flipper(side: 'left' | 'right', angle: number): string {
  const x = side === 'left' ? 33 : 87;
  // SVG turns clockwise for a positive angle: the left flipper rises outward clockwise, the right one counterclockwise.
  const tilt = side === 'left' ? 16 - angle : -16 + angle;
  return `<g transform="rotate(${tilt} ${x} 76)"><ellipse cx="${x}" cy="90" rx="7" ry="16" fill="${DOWN_DARK}"/></g>`;
}

/** An open book held in front: two pages on a vermilion cover. */
const BOOK = `<path d="M34 86 Q47 81 60 86 Q73 81 86 86 L86 104 Q73 99 60 104 Q47 99 34 104 Z" fill="${SCARF}"/>
<path d="M36.5 85 Q48 80.5 59 85 L59 101 Q48 96.5 36.5 101 Z" fill="#fffdf8"/>
<path d="M61 85 Q72 80.5 83.5 85 L83.5 101 Q72 96.5 61 101 Z" fill="#f3efe6"/>
<path d="M41 88.5 Q48 86 55 88.5 M41 92.5 Q48 90 55 92.5 M65 88.5 Q72 86 79 88.5 M65 92.5 Q72 90 79 92.5" stroke="#cfc8ba" stroke-width="1.3" fill="none" stroke-linecap="round"/>`;

/** Pengu in `pose`, as an SVG string (viewBox 0 0 120 120). `label` names it for screen readers; without one it is hidden. */
export function penguSvg(pose: PenguPose = 'stand', label = ''): string {
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  const arms = pose === 'cheer' ? flipper('left', -118) + flipper('right', -118)
    : pose === 'wave' ? flipper('left', 0) + flipper('right', -120)
    : pose === 'read' ? flipper('left', 42) + flipper('right', 42)
    : flipper('left', 0) + flipper('right', 0);
  return `<svg class="pengu pengu-${pose}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" ${a11y}>
<ellipse cx="60" cy="112.5" rx="27" ry="3.6" fill="#000" opacity=".12"/>
<ellipse cx="49" cy="108" rx="8" ry="4" fill="${FEET}"/><ellipse cx="71" cy="108" rx="8" ry="4" fill="${FEET}"/>
${pose === 'read' ? '' : arms}
<ellipse cx="60" cy="83" rx="31" ry="27" fill="${DOWN}"/>
<ellipse cx="60" cy="88" rx="20.5" ry="19.5" fill="${BELLY}"/>
${SCARF_SVG}
${head(pose === 'cheer' ? 'happy' : pose === 'read' ? 'down' : 'open')}
${pose === 'read' ? arms + BOOK : ''}
</svg>`;
}

/** Pengu in `pose` in a span with class `cls` (space separated), hidden from screen readers. */
export function penguEl(pose: PenguPose, cls = 'pengu-box'): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = penguSvg(pose);
  return el;
}

/** The head and scarf alone on a vermilion square: the app icon and the brand mark (viewBox 0 0 120 120). */
export function penguMark(opts: { square?: boolean; rounded?: number; scale?: number } = {}): string {
  const bg = opts.square === false ? '' : `<rect width="120" height="120" rx="${opts.rounded ?? 26}" fill="${SCARF}"/>`;
  // The bust a little lower and larger than in the full bird; the scarf is a darker red here, so it shows on the red square.
  // `scale` shrinks it toward the middle (a maskable icon keeps it in the central 80 percent).
  const k = 1.32 * (opts.scale ?? 1);
  return `<svg class="pengu-mark" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
${bg}
<g transform="translate(60 ${60 + 6 * (opts.scale ?? 1)}) scale(${k}) translate(-60 -52)">
<ellipse cx="60" cy="86" rx="31" ry="22" fill="${DOWN}"/>
<path d="M33 69 Q60 79 87 69 L88 77 Q60 88 32 77 Z" fill="${opts.square === false ? SCARF : SCARF_DARK}"/>
${head('open')}
</g>
</svg>`;
}
