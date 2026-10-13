// A small confirm dialog built on <dialog class="modal">.
import { h } from '../dom';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}

/** Resolves true on confirm, false on cancel, Esc or backdrop click. */
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const dlg = h('dialog', { class: 'modal voc-dialog' });
    const cancel = h('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel');
    const ok = h('button.btn', { type: 'button', class: o.danger ? 'btn-danger' : 'btn-primary', onclick: () => { result = true; dlg.close(); } }, o.confirmLabel);
    dlg.append(
      h('div.voc-dialog-body', null, h('h2.voc-dialog-title', null, o.title), h('p.voc-dialog-text', null, o.body)),
      h('div.voc-dialog-actions', null, cancel, ok),
    );
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    cancel.focus();
  });
}
