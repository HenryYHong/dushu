// Registers the service worker and offers "Reload" when a new version has been downloaded and is waiting.
import type { AppContext } from './types';

/**
 * A worker is an update only when an older one is already active. On a first visit the worker installs, activates and claims
 * the page, and WebKit can deliver "installed" after the claim, so the live controller alone would call the first install an
 * update. `reload` runs when a new worker takes over a page that was already controlled.
 */
export function watchServiceWorker(
  ctx: Pick<AppContext, 'toast'>,
  container: ServiceWorkerContainer = navigator.serviceWorker,
  reload: () => void = () => location.reload(),
): void {
  let updateOffered = false;
  let waitingWorker: ServiceWorker | null = null;
  const offer = (worker: ServiceWorker) => {
    waitingWorker = worker;
    if (updateOffered) return;
    updateOffered = true;
    ctx.toast('A new version of Dushu is ready.', {
      ms: 24 * 3600 * 1000,
      action: { label: 'Reload', run: () => waitingWorker?.postMessage('SKIP_WAITING') },
    });
  };
  let controlled = !!container.controller;
  let reloading = false;
  container.addEventListener('controllerchange', () => {
    // The first install claims the page too; only an update (a previous controller existed) needs a reload.
    if (!controlled) { controlled = true; return; }
    if (reloading) return;
    reloading = true;
    reload();
  });
  container.register(new URL('sw.js', document.baseURI)).then((reg) => {
    // Called when a worker starts installing, while the one it replaces (if any) is still the active one.
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const replaces = !!reg.active && reg.active !== worker;
      worker.addEventListener('statechange', () => { if (worker.state === 'installed' && replaces && container.controller) offer(worker); });
    };
    if (reg.waiting && container.controller) offer(reg.waiting);
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    // An installed app on an iPad can stay open for days: look for a new version whenever it comes back to the front.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}
