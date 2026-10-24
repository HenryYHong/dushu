// Turning pages with a trackpad or a mouse wheel: one turn per swipe.
//
// A trackpad swipe is a stream of wheel events: about 8 ms apart while the fingers move, then 16 ms apart while it coasts
// after they lift, the deltas fading to 1 px over a second or more. The page turns once the swipe has moved far enough, and
// the rest of that swipe is ignored. The stream says nothing about where one swipe ends and the next begins, so this goes by
// speed (px per ms over the last WINDOW_MS, from the events' own time stamps), not by the size of each delta: deltas jump when
// the events space out (when the fingers lift, a jittery frame) and when a busy page gets several events folded into one,
// while the speed holds. Comparing deltas took those jumps for new swipes and turned two to four pages per swipe.
//
// A new swipe is any of:
// - the first event after a pause (no event for GAP_MS), unless it carries as much movement as the coasting would have over
//   that time: then the page was busy and the events were held back, and it is still the same swipe;
// - a delta the other way;
// - the swipe speeding up again after it had slowed well below its top speed, or after it stopped dead: fingers back on
//   the trackpad while it still coasts stop the coasting at once, and the new swipe starts slow. (Coasting only fades, a
//   few per cent a frame, and the speed of a moving finger wobbles, but never falls to a sixth in one event.)
// A mouse wheel gives one event per notch: a pause between notches starts a new turn, a quick spin is one turn. A notch
// counts as a whole turn when the wheel reports lines or pages.

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  timeStamp: number;
}

/** No event for this long: the swipe and its coasting are over. */
export const GAP_MS = 160;
/** How far a swipe moves before the page turns, across and up or down. */
export const TURN_X = 40;
export const TURN_Y = 70;
const LINE_PX = 16;
const PAGE_PX = 800;
/** The speed is the distance over about this much time: events can come in bursts with the same time stamp. */
const WINDOW_MS = 64;
/** One frame: the time a swipe's first event stands for. */
const FRAME_MS = 16;
/** A reversal needs a delta at least this big; the last events of a swipe can wobble by a pixel. */
const REVERSE_PX = 4;
/** An event this much slower than the swipe: fingers landed and stopped the coasting dead. */
const STOP_RATIO = 0.15;

export interface WheelTurns {
  /** Feed every wheel event; returns the direction to turn (1 forward, -1 back) or 0. */
  feed(e: WheelInput): -1 | 0 | 1;
}

export function createWheelTurns(): WheelTurns {
  /** This swipe's events over the last WINDOW_MS, and the one before them: [time, distance]. Events with the same time
   * stamp are one entry (they come in bursts when the browser was busy). */
  let recent: [number, number][] = [];
  /** Speed of the swipe now, px per ms, and as it was before the latest time stamp. */
  let speed = 0;
  let settled = 0;
  /** Distance moved, signed, since the swipe began or the page last turned. */
  let acc = 0;
  /** This swipe has turned the page: ignore the rest of it. */
  let locked = false;
  let dir: -1 | 1 = 1;
  /** Fastest the swipe went since it turned the page, and slowest since then. */
  let peak = 0;
  let trough = 0;
  /** Since it turned the page, the swipe slowed well below its top speed (or stopped dead): speeding up now is a new one. */
  let slowed = false;
  /** When the speed started being measured. Its first event stands for one frame, a guess, so until a window has passed
   * the speed is not trusted as the swipe's top speed. */
  let since = -Infinity;

  /** Distance over time across the last WINDOW_MS; each entry's distance covers the time since the one before it. */
  function speedNow(): number {
    const t = recent[recent.length - 1][0];
    let sum = 0;
    for (let i = recent.length - 1; i > 0; i--) {
      sum += recent[i][1];
      if (t - recent[i - 1][0] >= WINDOW_MS) return sum / (t - recent[i - 1][0]);
    }
    // Less than a window since the swipe began: its first event stands for one frame.
    return (sum + recent[0][1]) / (t - recent[0][0] + FRAME_MS);
  }

  /** The events of the latest time stamp are all in: read the swipe's speed from them. */
  function settle(): void {
    if (locked && recent.length > 1) {
      const [t, m] = recent[recent.length - 1];
      if (m / (t - recent[recent.length - 2][0]) < STOP_RATIO * settled) {
        // Stopped dead: the speed starts over from here, so the new swipe is not measured against the old one's.
        recent = [recent[recent.length - 1]];
        speed = trough = speedNow();
        since = t;
        slowed = true;
      }
      if (t - since >= WINDOW_MS) {
        if (speed > peak && !slowed) peak = trough = speed;
        else if (speed < trough) trough = speed;
        if (trough <= 0.6 * peak) slowed = true;
      }
    }
    settled = speed;
  }

  function begin(): void {
    locked = false;
    acc = 0;
  }

  return {
    feed(e) {
      const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
      const across = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const d = (across ? e.deltaX : e.deltaY) * scale;
      const mag = Math.abs(d);
      const last = recent.length ? recent[recent.length - 1][0] : -Infinity;
      const t = Math.max(e.timeStamp, last);
      const dt = t - last;

      if (dt >= 1) {
        if (recent.length) settle();
        // A pause, unless the event carries as much movement as the swipe would have made in that time: then a busy
        // page held the events back and handed them over folded into this one, and it is the same swipe.
        if (dt > GAP_MS && !(speed >= 0.1 && dt <= 1000 && mag / dt >= 0.4 * speed)) {
          recent = [];
          since = t;
          begin();
        }
        recent.push([t, mag]);
        while (recent.length > 2 && t - recent[1][0] >= WINDOW_MS) recent.shift();
      } else {
        recent[recent.length - 1][1] += mag;
      }
      speed = speedNow();

      if (locked) {
        if (mag >= REVERSE_PX && Math.sign(d) === -dir) {
          // The other way: a new swipe, whatever speed the last one was still coasting at.
          recent = [[t, mag]];
          speed = speedNow();
          since = t;
          begin();
        } else if (slowed && speed >= 1.6 * trough && speed >= 0.3) {
          // It slowed down, then sped up again: fingers back on the trackpad for another swipe.
          begin();
        } else {
          return 0;
        }
      }

      const need = across ? TURN_X : TURN_Y;
      // Lines and pages come from a mouse wheel (Firefox; trackpads report pixels): a notch turns the page however few
      // lines it scrolls (3 lines is 48 px, short of TURN_Y).
      acc += e.deltaMode && d ? Math.sign(d) * Math.max(mag, need) : d;
      if (Math.abs(acc) < need) return 0;
      dir = acc > 0 ? 1 : -1;
      locked = true;
      acc = 0;
      peak = trough = t - since >= WINDOW_MS ? speed : 0;
      slowed = false;
      return dir;
    },
  };
}
