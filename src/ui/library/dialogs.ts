// Small modal helpers on top of <dialog class="modal">. Used by the library and settings screens.
import '../../styles/library.css';
import { h } from '../dom';
import { icon } from '../icons';

export interface ModalApi<T> {
  close(result?: T): void;
  el: HTMLDialogElement;
}

/**
 * iPadOS and iOS do not shrink the page when the on-screen keyboard opens; only the visual viewport shrinks, so a
 * centered dialog can end up with its buttons behind the keyboard. While the keyboard covers part of the window, pin the
 * dialog to the top of the visible area and cap its height there (its body scrolls, its footer stays). Returns the cleanup.
 * Headless browsers have no keyboard, so this is checked by shrinking the visual viewport in a test, not on a real iPad.
 */
export function keepAboveKeyboard(dlg: HTMLElement, vv: VisualViewport | null = typeof window !== 'undefined' ? window.visualViewport : null): () => void {
  if (!vv) return () => {};
  const props = ['max-height', 'inset-block-start', 'inset-block-end', 'margin-block'];
  const fit = () => {
    const hidden = window.innerHeight - vv.height - vv.offsetTop;
    if (hidden > 80) {
      dlg.style.setProperty('max-height', `${Math.max(220, vv.height - 24)}px`);
      dlg.style.setProperty('inset-block-start', `${vv.offsetTop + 12}px`);
      dlg.style.setProperty('inset-block-end', 'auto');
      dlg.style.setProperty('margin-block', '0');
    } else {
      for (const p of props) dlg.style.removeProperty(p);
    }
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
  return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); };
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
    const dlg = h('dialog.modal.lib-dlg', { 'aria-label': title, tabindex: -1 }) as HTMLDialogElement;
    let done = false;
    let stopKeyboardWatch = () => {};
    const close = (result?: T) => {
      if (done) return;
      done = true;
      stopKeyboardWatch();
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
    stopKeyboardWatch = keepAboveKeyboard(dlg);
    // A field to type in gets focus; a plain question focuses the dialog itself, so no button starts with a ring.
    (parts.focus ?? dlg).focus({ preventScroll: true });
  });
}

export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  return showModal<boolean>(opts.title, (api) => {
    const ok = h('button.btn' + (opts.danger ? '.btn-danger-solid' : '.btn-primary'), { type: 'button', onclick: () => api.close(true) }, opts.confirmLabel);
    return {
      body: h('p.lib-dlg-text', null, opts.message),
      footer: [h('button.btn', { type: 'button', onclick: () => api.close(false) }, 'Cancel'), ok],
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
