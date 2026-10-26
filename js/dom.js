// Tiny DOM helpers. User text only ever goes through textContent / text nodes.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}

// Static, trusted SVG markup only (never interpolate user text here).
const tpl = document.createElement('template');
export function svgEl(markup) {
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild.cloneNode(true);
}

const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  road: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M11 5 4 27M21 5l7 22M16 6v3M16 14v4M16 23v4"/></svg>`,
  flag: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M7 4v24"/><path d="M7 5h18v13H7z"/><path d="M7 11.5h18M13 5v13M19 5v13" /></svg>`,
  gear: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><circle cx="16" cy="16" r="4.5"/><path d="M16 3.5v3.2M16 25.3v3.2M3.5 16h3.2M25.3 16h3.2M7.2 7.2l2.3 2.3M22.5 22.5l2.3 2.3M7.2 24.8l2.3-2.3M22.5 9.5l2.3-2.3"/></svg>`,
  bell: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M8 22V15a8 8 0 0 1 16 0v7l2 2H6z"/><path d="M13 27a3 3 0 0 0 6 0"/></svg>`,
  bellOff: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M8 22V15a8 8 0 0 1 16 0v7l2 2H6z"/><path d="M13 27a3 3 0 0 0 6 0"/><path d="M4 4l24 24"/></svg>`,
  check: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M7 17l6 6 12-14"/></svg>`,
  plus: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M16 6v20M6 16h20"/></svg>`,
  back: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M20 6 9 16l11 10"/></svg>`,
  undo: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M9 12h11a6 6 0 0 1 0 12h-6"/><path d="M13 7l-5 5 5 5"/></svg>`,
  trophy: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M10 5h12v8a6 6 0 0 1-12 0zM10 8H5c0 5 2 7 5 7M22 8h5c0 5-2 7-5 7M16 19v5M11 27h10"/></svg>`,
  clock: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><circle cx="16" cy="16" r="11"/><path d="M16 9v7l5 3"/></svg>`,
  calendar: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><rect x="5" y="7" width="22" height="20" rx="2"/><path d="M5 13h22M11 4v5M21 4v5"/></svg>`,
  globe: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><circle cx="16" cy="16" r="11"/><path d="M5 16h22M16 5c-5 5-5 17 0 22M16 5c5 5 5 17 0 22"/></svg>`,
  play: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M10 7l15 9-15 9z"/></svg>`,
  trash: `<svg viewBox="0 0 32 32" ${S} aria-hidden="true"><path d="M6 9h20M12 9V5h8v4M9 9l1 18h12l1-18"/></svg>`,
  lamp: `<svg viewBox="0 0 34 26" ${S} aria-hidden="true"><path d="M5 5h16l-3-4H8zM12 5l7 18"/></svg>`,
  alarm: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 44V30a12 12 0 0 1 24 0v14l4 4H16z"/><path d="M27 53a5 5 0 0 0 10 0"/><path class="wave" d="M10 28q-3 7 0 14M54 28q3 7 0 14M4 24q-5 11 0 22M60 24q5 11 0 22" stroke="#ff2a2a"/></svg>`,
  done: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 33l12 12 23-26"/></svg>`,
};
export const icon = (name) => svgEl(ICONS[name]);
