// Tiny DOM helpers shared by every screen.

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false | Child[];

/**
 * h('button.btn.btn-primary', { onclick: fn, title: 'Save' }, 'Save')
 * Tag may carry .classes and one #id. Attributes starting with "on" become listeners;
 * true booleans become empty attributes; null/undefined/false are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K | string, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const m = /^([a-z0-9-]+)?((?:[.#][^.#]+)*)$/i.exec(tag);
  const name = (m && m[1]) || 'div';
  const el = document.createElement(name) as HTMLElementTagNameMap[K];
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][^.#]+/g) ?? []) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Parse an SVG/HTML string into a single element. */
export function fromHtml<T extends Element = Element>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}
