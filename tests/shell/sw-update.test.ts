// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { watchServiceWorker } from '../../src/swUpdate';

type Listener = () => void;
class Emitter {
  listeners: Record<string, Listener[]> = {};
  addEventListener(type: string, fn: Listener) { (this.listeners[type] ??= []).push(fn); }
  emit(type: string) { for (const fn of this.listeners[type] ?? []) fn(); }
}
class FakeWorker extends Emitter { state = 'installing'; postMessage = vi.fn(); }
class FakeReg extends Emitter {
  active: FakeWorker | null = null; waiting: FakeWorker | null = null; installing: FakeWorker | null = null;
  update = vi.fn(async () => {});
}

function setup(opts: { controller: boolean; reg?: FakeReg }) {
  const reg = opts.reg ?? new FakeReg();
  const container = Object.assign(new Emitter(), {
    controller: opts.controller ? ({} as ServiceWorker) : null,
    register: async () => reg,
  });
  const toast = vi.fn();
  const reload = vi.fn();
  watchServiceWorker({ toast }, container as unknown as ServiceWorkerContainer, reload);
  const ready = () => new Promise((r) => setTimeout(r, 0));
  return { reg, container, toast, reload, ready };
}

describe('service worker update notice', () => {
  it('stays quiet on a first install even when "installed" arrives after the page was claimed', async () => {
    const t = setup({ controller: false });
    const first = new FakeWorker();
    t.reg.installing = first;
    await t.ready();
    // The worker activates and claims the page before WebKit reports "installed".
    t.reg.installing = null; t.reg.active = first; first.state = 'activated';
    t.container.controller = {} as ServiceWorker;
    t.container.emit('controllerchange');
    first.state = 'installed';
    first.emit('statechange');
    expect(t.toast).not.toHaveBeenCalled();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('stays quiet when the first install is reported through updatefound', async () => {
    const t = setup({ controller: false });
    await t.ready();
    const first = new FakeWorker();
    t.reg.installing = first;
    t.reg.emit('updatefound');
    t.container.controller = {} as ServiceWorker;
    t.reg.active = first;
    first.state = 'installed';
    first.emit('statechange');
    expect(t.toast).not.toHaveBeenCalled();
  });

  it('offers Reload when a new worker waits behind an active one, and reloads once it takes over', async () => {
    const reg = new FakeReg();
    reg.active = new FakeWorker();
    const t = setup({ controller: true, reg });
    await t.ready();
    const next = new FakeWorker();
    reg.installing = next;
    reg.emit('updatefound');
    next.state = 'installed';
    next.emit('statechange');
    expect(t.toast).toHaveBeenCalledTimes(1);
    expect(t.toast.mock.calls[0][0]).toMatch(/new version/i);
    t.toast.mock.calls[0][1].action.run();
    expect(next.postMessage).toHaveBeenCalledWith('SKIP_WAITING');
    t.container.emit('controllerchange');
    t.container.emit('controllerchange');
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('offers a worker that was already waiting when the page opened', async () => {
    const reg = new FakeReg();
    reg.active = new FakeWorker(); reg.waiting = new FakeWorker();
    const t = setup({ controller: true, reg });
    await t.ready();
    expect(t.toast).toHaveBeenCalledTimes(1);
  });

  it('still offers an update later in a session that began with a first install', async () => {
    const t = setup({ controller: false });
    await t.ready();
    const first = new FakeWorker();
    t.reg.installing = first;
    t.reg.emit('updatefound');
    t.reg.installing = null; t.reg.active = first;
    t.container.controller = {} as ServiceWorker;
    t.container.emit('controllerchange');
    const next = new FakeWorker();
    t.reg.installing = next;
    t.reg.emit('updatefound');
    next.state = 'installed';
    next.emit('statechange');
    expect(t.toast).toHaveBeenCalledTimes(1);
    t.container.emit('controllerchange');
    expect(t.reload).toHaveBeenCalledTimes(1);
  });
});
