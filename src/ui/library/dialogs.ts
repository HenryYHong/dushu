// Small modal helpers on top of <dialog class="modal">. Used by the library and settings screens.
import '../../styles/library.css';
import { h } from '../dom';
import { icon } from '../icons';

export interface ModalApi<T> {
  close(result?: T): void;
  el: HTMLDialogElement;
}

/**
 * Opens a modal and resolves with whatever close() was given (undefined if the user cancelled with Esc,
 * the close button or a click on the backdrop). build() returns the body, the footer and an optional
 * element to focus first.
 */
export function showModal<T>(
  title: string,
  build: (api: ModalApi<T>) => { body: Node; footer?: Node | Node[]; focus?: HTMLElement },
  opts: { wide?: boolean } = {},
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const dlg = h('dialog.modal.lib-dlg', { 'aria-label': title }) as HTMLDialogElement;
    let done = false;
    const close = (result?: T) => {
      if (done) return;
      done = true;
      if (typeof dlg.close === 'function' && dlg.open) dlg.close();
      dlg.remove();
      resolve(result);
    };
    const api: ModalApi<T> = { close, el: dlg };
    const parts = build(api);
    if (opts.wide) dlg.classList.add('lib-dlg-wide');
    dlg.append(
      h('div.lib-dlg-head', null,
        h('h2.lib-dlg-title', null, title),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('div.lib-dlg-body', null, parts.body),
    );
    if (parts.footer) dlg.append(h('div.lib-dlg-foot', null, parts.footer));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) close(); });
    document.body.appendChild(dlg);
    // jsdom has no showModal; a plain open attribute is enough there.
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    (parts.focus ?? dlg.querySelector<HTMLElement>('input, textarea, button.btn'))?.focus();
  });
}

export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  return showModal<boolean>(opts.title, (api) => {
    const ok = h('button.btn.btn-primary', { type: 'button', onclick: () => api.close(true) }, opts.confirmLabel);
    return {
      body: h('p.lib-dlg-text', null, opts.message),
      footer: [h('button.btn', { type: 'button', onclick: () => api.close(false) }, 'Cancel'), ok],
      focus: opts.danger ? undefined : ok,
    };
  }).then((v) => v === true);
}

export interface FieldSpec {
  name: string;
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
}

/** A small form. Resolves with the trimmed values, or null if cancelled. */
export function formDialog(opts: {
  title: string;
  fields: FieldSpec[];
  submitLabel: string;
  intro?: string;
}): Promise<Record<string, string> | null> {
  return showModal<Record<string, string>>(opts.title, (api) => {
    const inputs = opts.fields.map((f) =>
      h('input.input', { type: 'text', name: f.name, value: f.value, placeholder: f.placeholder ?? '', required: !!f.required, autocomplete: 'off' }) as HTMLInputElement);
    const form = h('form.lib-dlg-form', {
      onsubmit: (e: Event) => {
        e.preventDefault();
        const out: Record<string, string> = {};
        opts.fields.forEach((f, i) => { out[f.name] = inputs[i].value.trim(); });
        if (opts.fields.some((f, i) => f.required && !out[f.name])) { inputs[opts.fields.findIndex((f, i) => f.required && !out[f.name])].focus(); return; }
        api.close(out);
      },
    },
      opts.intro ? h('p.lib-dlg-text', null, opts.intro) : null,
      opts.fields.map((f, i) => h('label.lib-dlg-field', null, h('span', null, f.label), inputs[i])),
      h('div.lib-dlg-foot-inline', null,
        h('button.btn', { type: 'button', onclick: () => api.close() }, 'Cancel'),
        h('button.btn.btn-primary', { type: 'submit' }, opts.submitLabel)),
    );
    inputs[0].select?.();
    return { body: form, focus: inputs[0] };
  }).then((v) => v ?? null);
}
