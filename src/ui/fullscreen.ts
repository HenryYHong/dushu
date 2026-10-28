// Full screen for reading: the Fullscreen API where the browser has it (Safari on an iPad, Chrome and Safari on a Mac), with
// the prefixed WebKit names as a fallback. A Home Screen app on the iPad already has no browser bars; an iPhone has no
// full screen for pages at all, so there the reader is told how to get the bars out of the way instead.
type FsDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = (): FsDocument | null => (typeof document === 'undefined' ? null : (document as FsDocument));

/**
 * Whether Dushu offers full screen here. Not in a Home Screen app: it has no browser bars to hide, and the Fullscreen API
 * there only adds Safari's own X button (the iPad's status bar and home bar stay, whatever a page does).
 */
export function fullscreenSupported(): boolean {
  const d = doc();
  return !!d && !!(d.fullscreenEnabled || d.webkitFullscreenEnabled) && !isStandalone();
}

export function isFullscreen(): boolean {
  const d = doc();
  return !!d && !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Opened from the Home Screen (no browser bars to hide). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

/** A browser on an iPhone or iPad (iPadOS calls itself a Mac, but a Mac has no touch screen): one that can add Dushu to the Home Screen. */
export function onIPhoneOrIPad(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export async function setFullscreen(on: boolean): Promise<void> {
  const d = doc();
  if (!d || on === isFullscreen()) return;
  if (on) {
    const el = d.documentElement as FsElement;
    if (el.requestFullscreen) await el.requestFullscreen();
    else await el.webkitRequestFullscreen?.();
  } else if (d.exitFullscreen) await d.exitFullscreen();
  else await d.webkitExitFullscreen?.();
}

/** Calls `fn` whenever full screen starts or ends (Esc, a swipe, the system's own control). Returns the unsubscribe. */
export function onFullscreenChange(fn: () => void): () => void {
  const d = doc();
  if (!d) return () => {};
  d.addEventListener('fullscreenchange', fn);
  d.addEventListener('webkitfullscreenchange', fn);
  return () => {
    d.removeEventListener('fullscreenchange', fn);
    d.removeEventListener('webkitfullscreenchange', fn);
  };
}
