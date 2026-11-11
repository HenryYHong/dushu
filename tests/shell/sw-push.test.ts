// Review reminders as notifications (public/sw.js): a push from the sync server shows its title and line, and a tap opens the
// review in the app's own window, or a new one. Nothing else the worker does changes.
import { describe, expect, it } from 'vitest';
import { loadWorker } from './swHarness';

const message = (o: Record<string, unknown>) => JSON.stringify(o);

describe('a push', () => {
  it('shows the message the server sent, with the app’s icon, and keeps where a tap goes', async () => {
    const w = loadWorker({ online: true });
    await w.push(message({ title: 'LinguPengu', body: '7 words are ready to review.', url: 'https://app.test/#/review', tag: 'review' }));
    expect(w.shown).toEqual([{ title: 'LinguPengu', options: {
      body: '7 words are ready to review.', tag: 'review', icon: 'https://app.test/icons/icon-192.png', data: { url: 'https://app.test/#/review' },
    } }]);
  });

  it('still shows something for a push with no message, or one that is not JSON', async () => {
    const w = loadWorker({ online: true });
    await w.push();
    await w.push('not json');
    expect(w.shown.map((n) => [n.title, n.options.tag, n.options.data?.url])).toEqual([
      ['LinguPengu', 'review', 'https://app.test/#/review'],
      ['LinguPengu', 'review', 'https://app.test/#/review'],
    ]);
  });

  it('never links anywhere but this app: another address keeps only its #/route, here', async () => {
    const w = loadWorker({ online: true });
    await w.push(message({ title: 'LinguPengu', body: 'x', url: 'https://henryyhong.com/dushu/#/review' }));
    await w.push(message({ title: 'LinguPengu', body: 'x', url: 'javascript:alert(1)' }));
    expect(w.shown.map((n) => n.options.data?.url)).toEqual(['https://app.test/#/review', 'https://app.test/#/review']);
  });
});

describe('a tap on the notification', () => {
  it('brings the app’s open window to the front at the review', async () => {
    const win = { url: 'https://app.test/#/library' };
    const w = loadWorker({ online: true, windows: [{ url: 'https://elsewhere.test/' }, win] });
    await w.push(message({ title: 'LinguPengu', body: 'x', url: 'https://app.test/#/review' }));
    expect(await w.click(w.shown[0])).toBe(true);
    expect(win).toMatchObject({ focused: true, navigated: ['https://app.test/#/review'] });
    expect(w.opened).toEqual([]);
  });

  it('opens a window at the review when none is open', async () => {
    const w = loadWorker({ online: true, windows: [] });
    await w.push(message({ title: 'LinguPengu', body: 'x', url: 'https://app.test/#/review' }));
    await w.click(w.shown[0]);
    expect(w.opened).toEqual(['https://app.test/#/review']);
  });

  it('still brings a window it does not control to the front', async () => {
    const win = { url: 'https://app.test/#/', controlled: false };
    const w = loadWorker({ online: true, windows: [win] });
    await w.push(message({ title: 'LinguPengu', body: 'x', url: 'https://app.test/#/review' }));
    await w.click(w.shown[0]);
    expect(win).toMatchObject({ focused: true });
    expect(w.opened).toEqual([]);
  });
});
