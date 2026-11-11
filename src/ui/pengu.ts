// Pengu, LinguPengu's mascot: a round baby penguin drawn like a sticker, in chunky shapes with a dark navy outline: a gray body,
// a big white face and belly, large shiny eyes, a small orange beak and a tuft of three feathers. Drawn here from shared parts so
// every pose is the same bird: standing, waving hello, cheering (both flippers up) and reading an open book. The logo is Pengu's
// top half waving on a pale blue circle (penguMark), which scripts/make-icons.mjs turns into the app icons.
// The colors are fixed, not the theme's, so Pengu looks the same in light and dark.

export type PenguPose = 'stand' | 'wave' | 'cheer' | 'read';

const LINE = '#1f2a5c';      // the outline
const BODY = '#7f8596';      // gray feathers
const BODY_HI = '#a3a8b6';   // the light on the head
const BODY_SHADE = '#6b7181'; // the far side of a flipper
const WHITE = '#ffffff';
const EYE = '#1f2a5c';
const SHINE = '#6f86d6';
const BEAK = '#f6b13d';
const MOUTH = '#f27d86';
const CHEEK = '#f7a8b8';
const FEET = '#f6a23b';
const SKY = '#8fb2f4';       // the logo's circle

const stroke = `stroke="${LINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

/** Eyes, cheeks and beak, centered on x = 60 with the eyes at `y`: open and shiny, happy arcs, or looking down at a page. */
function face(y: number, eyes: 'open' | 'happy' | 'down'): string {
  const eye = (x: number) => eyes === 'happy'
    ? `<path d="M${x - 5} ${y + 1.5} Q${x} ${y - 5} ${x + 5} ${y + 1.5}" fill="none" ${stroke} stroke-width="3.2"/>`
    : eyes === 'down'
      ? `<path d="M${x - 5} ${y - 0.5} Q${x} ${y + 4.5} ${x + 5} ${y - 0.5}" fill="none" ${stroke} stroke-width="3.2"/>`
      : `<ellipse cx="${x}" cy="${y}" rx="6.2" ry="6.8" fill="${EYE}"/>
<circle cx="${x + 1.9}" cy="${y - 2.4}" r="2.4" fill="#fff"/><circle cx="${x - 2.4}" cy="${y + 2.8}" r="1.2" fill="${SHINE}"/>`;
  return `${eye(49)}${eye(71)}
<ellipse cx="41.5" cy="${y + 8}" rx="4.4" ry="2.6" fill="${CHEEK}" opacity=".85"/>
<ellipse cx="78.5" cy="${y + 8}" rx="4.4" ry="2.6" fill="${CHEEK}" opacity=".85"/>
<path d="M53.5 ${y + 5.5} Q60 ${y + 2} 66.5 ${y + 5.5} Q65.5 ${y + 12} 60 ${y + 13} Q54.5 ${y + 12} 53.5 ${y + 5.5} Z" fill="${BEAK}" ${stroke} stroke-width="2.6"/>
<path d="M56.5 ${y + 8.6} Q60 ${y + 7.4} 63.5 ${y + 8.6} Q62 ${y + 11.2} 60 ${y + 11.4} Q58 ${y + 11.2} 56.5 ${y + 8.6} Z" fill="${MOUTH}"/>`;
}

/** The tuft: three rounded feathers on top of the head at (60, y). */
const tuft = (y: number) => `<path d="M53 ${y + 3} Q51.5 ${y - 5} 57 ${y - 3} Q59.5 ${y - 9} 63 ${y - 3} Q68.5 ${y - 5} 67 ${y + 3} Z" fill="${BODY}" ${stroke}/>`;

/**
 * A flipper from the shoulder at (x, y): hanging at the side (0), raised (negative angle: up and out) or folded in (positive:
 * toward the middle). SVG turns clockwise for a positive angle, so the left one rises outward clockwise, the right one the other way.
 */
function flipper(side: 'left' | 'right', angle: number, x: number, y: number): string {
  const dir = side === 'left' ? -1 : 1;
  const tilt = side === 'left' ? 18 - angle : -18 + angle;
  const w = 8.5 * dir;
  return `<g transform="rotate(${tilt} ${x} ${y})"><path d="M${x} ${y - 3} Q${x + w * 1.6} ${y + 6} ${x + w * 0.9} ${y + 24} Q${x + w * 0.2} ${y + 30} ${x - w * 0.5} ${y + 22} Q${x - w * 0.6} ${y + 8} ${x} ${y - 3} Z" fill="${BODY}" ${stroke}/>
<path d="M${x + w * 0.2} ${y + 4} Q${x + w * 0.8} ${y + 12} ${x + w * 0.45} ${y + 21}" fill="none" stroke="${BODY_SHADE}" stroke-width="3" stroke-linecap="round"/></g>`;
}

/** An open book held in front of the belly, in the outline style. */
const BOOK = `<path d="M33 84 Q46.5 78 60 84 Q73.5 78 87 84 L87 102 Q73.5 96.5 60 102 Q46.5 96.5 33 102 Z" fill="#e2574c" ${stroke}/>
<path d="M36.5 83.5 Q48 79 59 83.5 L59 98.5 Q48 94 36.5 98.5 Z" fill="#fffdf7" ${stroke} stroke-width="2.2"/>
<path d="M61 83.5 Q72 79 83.5 83.5 L83.5 98.5 Q72 94 61 98.5 Z" fill="#f3efe6" ${stroke} stroke-width="2.2"/>
<path d="M41 87.5 Q48 85 54.5 87.5 M41 91.5 Q48 89 54.5 91.5 M65.5 87.5 Q72 85 79 87.5 M65.5 91.5 Q72 89 79 91.5" stroke="#c8c1b3" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;

/** Pengu in `pose`, as an SVG string (viewBox 0 0 120 120). `label` names it for screen readers; without one it is hidden. */
export function penguSvg(pose: PenguPose = 'stand', label = ''): string {
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  const f = (side: 'left' | 'right', a: number) => flipper(side, a, side === 'left' ? 31 : 89, 66);
  const arms = pose === 'cheer' ? f('left', -125) + f('right', -125)
    : pose === 'wave' ? f('left', 0) + f('right', -130)
    : pose === 'read' ? f('left', 48) + f('right', 48)
    : f('left', 0) + f('right', 0);
  return `<svg class="pengu pengu-${pose}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" ${a11y}>
<ellipse cx="60" cy="113" rx="27" ry="3.6" fill="#1f2a5c" opacity=".12"/>
<ellipse cx="48" cy="108" rx="9" ry="4.6" fill="${FEET}" ${stroke} stroke-width="2.6"/>
<ellipse cx="72" cy="108" rx="9" ry="4.6" fill="${FEET}" ${stroke} stroke-width="2.6"/>
${pose === 'read' ? '' : arms}
${tuft(19)}
<path d="M60 18 C83 18 93 40 93 66 C93 94 80 108 60 108 C40 108 27 94 27 66 C27 40 37 18 60 18 Z" fill="${BODY}" ${stroke}/>
<path d="M41 28 Q50 21.5 61 21.5" fill="none" stroke="${BODY_HI}" stroke-width="4" stroke-linecap="round"/>
<path d="M60 43 C55 35 41 36 38 49 C34 64 33.5 85 39.5 97 C45 105.5 75 105.5 80.5 97 C86.5 85 86 64 82 49 C79 36 65 35 60 43 Z" fill="${WHITE}" ${stroke}/>
${face(53, pose === 'cheer' ? 'happy' : pose === 'read' ? 'down' : 'open')}
${pose === 'read' ? arms + BOOK : ''}
</svg>`;
}

/**
 * The logo: Pengu's top half, waving, on a pale blue circle (or a full square, for icons a platform rounds or masks itself).
 * `scale` shrinks Pengu toward the middle (a maskable icon keeps it inside the central 80 percent). viewBox 0 0 120 120.
 */
export function penguMark(opts: { bg?: 'circle' | 'square' | 'none'; scale?: number } = {}): string {
  const bg = opts.bg ?? 'circle';
  const k = opts.scale ?? 1;
  const ground = bg === 'square' ? `<rect width="120" height="120" fill="${SKY}"/>` : bg === 'circle' ? `<circle cx="60" cy="60" r="57" fill="${SKY}"/>` : '';
  // Inside a circle the body is cut by it; the waving flipper may reach past its edge, as a sticker's does.
  const clip = bg === 'circle' ? 'clip-path="url(#pengu-mark-clip)"' : '';
  const bust = `<path d="M24 132 C22 92 27 56 38 44 C46 35 53 33 60 33 C67 33 74 35 82 44 C93 56 98 92 96 132 Z" fill="${BODY}" ${stroke}/>
<path d="M42 45 Q50 39 61 38.5" fill="none" stroke="${BODY_HI}" stroke-width="4" stroke-linecap="round"/>
<path d="M60 60 C55 51 40 52 37 66 C33 82 32 108 34 132 L86 132 C88 108 87 82 83 66 C80 52 65 51 60 60 Z" fill="${WHITE}" ${stroke}/>
${face(70, 'open')}`;
  return `<svg class="pengu-mark" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
<defs><clipPath id="pengu-mark-clip"><circle cx="60" cy="60" r="57"/></clipPath></defs>
${ground}
<g transform="translate(60 60) scale(${k}) translate(-60 -60)">
<g ${clip}><g transform="translate(60 62) scale(1.22) translate(-60 -70)">${flipper('right', 6, 92, 92)}${tuft(35)}${bust}</g></g>
<g transform="translate(60 62) scale(1.22) translate(-60 -70)">${flipper('left', -112, 36, 88)}</g>
</g>
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
