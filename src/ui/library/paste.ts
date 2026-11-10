// "Paste text" dialog: title, author and a text area; imports on submit.
import type { BookMeta } from '../../types';
import { h } from '../dom';
import { showModal } from './dialogs';
import { lang, langId } from '../../lang/active';
import { guessLanguage } from '../../lang/detect';
import { LANGS, isLangId } from '../../lang/registry';
import type { LangId } from '../../lang/types';
import { langName, tt } from '../../i18n';

const HAN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{323af}]/u;
/** Text of the language being read: Han for Chinese, kana or kanji for Japanese, Cyrillic for Russian, Latin letters otherwise. */
const ownText = (): RegExp => {
  const id = langId();
  return id === 'zh' ? HAN : id === 'ja' ? /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u : id === 'ru' ? /\p{Script=Cyrillic}/u : /\p{Script=Latin}/u;
};
const HEADING_EXAMPLE: Record<LangId, string> = { zh: '第一章', ja: '第一章', es: 'Capítulo 1', fr: 'Chapitre 1', de: 'Kapitel 1', it: 'Capitolo 1', pt: 'Capítulo 1', ru: 'Глава 1', en: 'Chapter 1' };

/** The hint under the text box: how chapters are found in the language being read. */
export const headingHint = (id: LangId): string => tt('Chapters are detected from headings like {example}.', { example: HEADING_EXAMPLE[id] });

/**
 * Text that is plainly in another language than the library's: which one, and where it can go instead (lang/detect.ts says the
 * same of a book). Null when it fits, or it cannot tell.
 */
function elsewhere(text: string, here: LangId): string | null {
  const found = guessLanguage(text);
  if (!found || found === here) return null;
  const name = langName(found, isLangId(found) ? LANGS[found].name : found);
  return tt('This text looks like it is in {found}, and this library is {here}. Switch to {found} (in Settings, or the language menu at the top) and add it there.',
    { found: name, here: langName(here, LANGS[here].name) });
}

/**
 * `submit` adds the text: the book added, or `{ twin }` when the same text is in the library already, which the dialog then
 * offers to open instead.
 */
export function pasteDialog(
  submit: (text: string, title: string, author: string) => Promise<BookMeta | { twin: BookMeta } | null>,
  given: { text?: string; title?: string } = {},
): Promise<BookMeta | undefined> {
  return showModal<BookMeta>(tt('Paste text'), (api) => {
    const title = h('input.input', { type: 'text', placeholder: tt('Title (optional)'), 'aria-label': tt('Title'), autocomplete: 'off' }) as HTMLInputElement;
    const author = h('input.input', { type: 'text', placeholder: tt('Author (optional)'), 'aria-label': tt('Author'), autocomplete: 'off' }) as HTMLInputElement;
    const L = lang();
    const name = langName(L.id, L.id === 'zh' ? 'Chinese' : L.name);
    const usual = headingHint(L.id);
    const text = h('textarea.textarea.lib-paste-text', { placeholder: tt('Paste {lang} text here: a chapter, an article, song lyrics…', { lang: name }), 'aria-label': tt('Text'), rows: 10, lang: L.tag }) as HTMLTextAreaElement;
    const hint = h('span.lib-paste-hint.muted', { role: 'status' }, usual);
    const go = h('button.btn.btn-primary', { type: 'button' }, tt('Add to library')) as HTMLButtonElement;
    // The same text already in the library: the button opens that book until the text is changed.
    let twin: BookMeta | null = null;
    const sync = () => {
      twin = null;
      go.textContent = tt('Add to library');
      const has = ownText().test(text.value);
      go.disabled = !has;
      // Another language says which language it sees instead, and where that text can go.
      const other = !has && L.id !== 'zh' && text.value.trim() ? elsewhere(text.value.slice(0, 4000), L.id) : null;
      hint.textContent = other ?? (text.value.trim() && !has
        ? (L.id === 'zh' ? tt('No Chinese characters found in this text.') : tt('No {lang} text found in this text.', { lang: name }))
        : usual);
    };
    // Text shared to the app comes filled in.
    if (given.text) text.value = given.text;
    if (given.title) title.value = given.title;
    text.addEventListener('input', sync);
    sync();
    go.addEventListener('click', async () => {
      if (twin) { api.close(twin); return; }
      go.disabled = true;
      go.textContent = tt('Adding…');
      const got = await submit(text.value, title.value, author.value);
      if (got && 'twin' in got) {
        sync();
        twin = got.twin;
        hint.textContent = tt('This text is already in your library as “{title}”.', { title: got.twin.title });
        go.textContent = tt('Open it');
        go.focus();
      } else if (got) api.close(got);
      else sync();
    });
    return {
      body: h('div.lib-paste', null, h('div.lib-paste-row', null, title, author), text, hint),
      footer: [h('button.btn', { type: 'button', onclick: () => api.close() }, tt('Cancel')), go],
      focus: text,
    };
  }, { wide: true });
}
