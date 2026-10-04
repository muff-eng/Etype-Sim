type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, any> & { class?: string; style?: string | Partial<CSSStyleDeclaration> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: HTMLElement) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function holdButton(label: string, down: () => void, up: () => void, cls = '', disabled = false) {
  const b = h('button', { class: cls, disabled }, label);
  let held = false;
  const release = () => { if (held) { held = false; up(); } };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); held = true; b.setPointerCapture(e.pointerId); down(); });
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('lostpointercapture', release);
  return b;
}

export function fmtTime(t: number) {
  const day = Math.floor(t / 86400) + 1;
  const s = t % 86400;
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
  return `Day ${day} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
