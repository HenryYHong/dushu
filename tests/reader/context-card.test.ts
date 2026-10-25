// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closePopup, openPhrasePopup, openWordPopup } from '../../src/ui/popup/popup';
import { anchorRect, makeCtx, stubBrowser } from './helpers';
beforeEach(() => stubBrowser());
afterEach(() => { closePopup(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('uses red, clear and wave as dictionary starting meanings, not surname or country abbreviations', async () => {
  const { ctx } = await makeCtx();
  openPhrasePopup({ ctx, text: '红掌拨清波。', anchor: anchorRect() });
  const gloss = (word: string) => [...document.querySelectorAll('.pp-wbw')]
    .find(row => row.querySelector('.pp-wbw-word')?.textContent === word)?.querySelector('.pp-wbw-gloss')?.textContent;
  expect(gloss('红')).toContain('red');
  expect(gloss('清')).toContain('clear');
  expect(gloss('波')).toContain('wave');
  expect(document.querySelector('.pp-wbw-note')?.textContent).toContain('not context-selected');
});

it('shows the definitions first, then sentence translation, with no duplicate footer action', async () => {
  const { ctx } = await makeCtx();
  openWordPopup({ ctx, word: '浮', anchor: anchorRect(), context: { sentence: '白毛浮绿水。', paragraph: '白毛浮绿水。' } });
  const actions = document.querySelector('.pp-reading-actions')!;
  expect(actions.textContent).toContain('Translate sentence');
  // The owner asked for the meanings at the top of the card; the actions follow them.
  const firstDefs = document.querySelector('.pp-reading')!;
  expect(firstDefs.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([...document.querySelectorAll('button')].filter(b => b.textContent === 'Translate sentence')).toHaveLength(1);
  expect(document.querySelector('.pp-foot')?.textContent ?? '').not.toContain('Translate sentence');
});

it('shows the dictionary sense and exact evidence without an invented AI rationale', async () => {
  const { ctx } = await makeCtx();
  const paragraph = '白毛浮绿水，红掌拨清波。';
  // jsdom lacks the modern signal combinators used by real supported Safari/Chrome.
  vi.stubGlobal('AbortSignal', { any: (signals: AbortSignal[]) => signals[0], timeout: () => new AbortController().signal });
  vi.stubGlobal('location', { hostname: 'localhost' });
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen3.5:9b-q4_K_M' }] }));
    if (url.endsWith('/api/generate')) return new Response(JSON.stringify({ response: JSON.stringify({
      meaning: 'to float', evidence: paragraph, reason: 'The white duck is floating.', confidence: 'high',
    }) }));
    throw new Error('offline');
  });
  openWordPopup({ ctx, word: '浮', anchor: anchorRect(), context: { sentence: paragraph, paragraph } });
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Ask local AI about context')!;
  // Offered once the Mac answers with its model.
  await vi.waitFor(() => expect(button.closest('section')!.hidden).toBe(false));
  button.click();
  await vi.waitFor(() => expect(document.querySelector('.pp-context-result strong')?.textContent).toBe('to float'));
  const text = document.querySelector('.pp-context-result')!.textContent;
  expect(text).toContain(paragraph);
  expect(text).toContain('not a verified definition');
  expect(text).not.toContain('duck');
});

it('does not offer the local AI when the Mac does not answer', async () => {
  const { ctx } = await makeCtx();
  vi.stubGlobal('AbortSignal', { any: (signals: AbortSignal[]) => signals[0], timeout: () => new AbortController().signal });
  vi.stubGlobal('location', { hostname: 'localhost' });
  let asked = false;
  vi.stubGlobal('fetch', async () => { asked = true; throw new TypeError('Load failed'); });
  openWordPopup({ ctx, word: '浮', anchor: anchorRect(), context: { sentence: '白毛浮绿水。', paragraph: '白毛浮绿水。' } });
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Ask local AI about context')!;
  await vi.waitFor(() => expect(asked).toBe(true));
  await new Promise((r) => setTimeout(r, 20));
  expect(button.closest('section')!.hidden).toBe(true);
});
