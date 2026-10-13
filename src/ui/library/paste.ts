// "Paste text" dialog: title, author and a text area; imports on submit.
import type { BookMeta } from '../../types';
import { h } from '../dom';
import { showModal } from './dialogs';

const HAN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{323af}]/u;

export function pasteDialog(submit: (text: string, title: string, author: string) => Promise<BookMeta | null>): Promise<BookMeta | undefined> {
  return showModal<BookMeta>('Paste text', (api) => {
    const title = h('input.input', { type: 'text', placeholder: 'Title (optional)', 'aria-label': 'Title', autocomplete: 'off' }) as HTMLInputElement;
    const author = h('input.input', { type: 'text', placeholder: 'Author (optional)', 'aria-label': 'Author', autocomplete: 'off' }) as HTMLInputElement;
    const text = h('textarea.textarea.lib-paste-text', { placeholder: 'Paste Chinese text here: a chapter, an article, song lyrics…', 'aria-label': 'Text', rows: 10 }) as HTMLTextAreaElement;
    const hint = h('span.lib-paste-hint.muted', null, 'Chapters are detected from headings like 第一章.');
    const go = h('button.btn.btn-primary', { type: 'button' }, 'Add to library') as HTMLButtonElement;
    const sync = () => {
      const has = HAN.test(text.value);
      go.disabled = !has;
      hint.textContent = text.value.trim() && !has ? 'No Chinese characters found in this text.' : 'Chapters are detected from headings like 第一章.';
    };
    text.addEventListener('input', sync);
    sync();
    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = 'Adding…';
      const meta = await submit(text.value, title.value, author.value);
      if (meta) api.close(meta);
      else { go.textContent = 'Add to library'; sync(); }
    });
    return {
      body: h('div.lib-paste', null, h('div.lib-paste-row', null, title, author), text, hint),
      footer: [h('button.btn', { type: 'button', onclick: () => api.close() }, 'Cancel'), go],
      focus: text,
    };
  }, { wide: true });
}
