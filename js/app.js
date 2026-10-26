// Controller: routing, shared clock, sheets, alert engine, actions, service worker.

import { h } from './dom.js';
import { Store, STORAGE_KEY, findRecord, addRecord, updateRecord, completeRecord, undoCompletion,
  deleteRecord, setAlertStatus, alertDecision, alertEventId, parseBackup, exportPayload, exportFilename,
  finishedRecords } from './state.js';
import { Audio } from './audio.js';
import { formatShort } from './time.js';
import { roadView, finishedView, settingsView, detailView, formView, bottomNav,
  alarmSheet, completionSheet, confirmSheet } from './views.js';

const VERSION = '1.0.0';
const params = new URLSearchParams(location.search);
const demo = params.get('demo');
const KEY = demo ? 'finish-lines:demo:v1' : STORAGE_KEY;

const noStorage = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); } };
let storage;
try { storage = window.localStorage; storage.getItem('finish-lines:probe'); } catch { storage = noStorage; }

const store = new Store(storage, KEY);
const reducedMq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

const app = {
  version: VERSION, store, demo: !!demo,
  live: [], sheetLive: [], audioHooks: new Set(), sheetHooks: new Set(),
  now: () => Date.now(),
  go: (hash) => { if (location.hash === hash) render(); else location.hash = hash; },
  reducedMotion: () => (store.data.settings.reducedMotion == null ? reducedMq.matches : store.data.settings.reducedMotion),
  toast, actions: {},
};
app.audio = new Audio(() => { app.audioHooks.forEach((f) => f()); app.sheetHooks.forEach((f) => f()); });
app.audio.enabled = store.data.settings.soundEnabled;

const $ = (id) => document.getElementById(id);
const mainEl = $('main'), navRoot = $('nav-root'), bannerRoot = $('banner-root'), sheetRoot = $('sheet-root'), toastRoot = $('toast-root'), shell = $('shell');

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  toastRoot.textContent = msg; toastRoot.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastRoot.hidden = true; toastRoot.textContent = ''; }, 6000);
}

/* ---------- sheets ---------- */
let sheet = null;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

let opening = false;
function openSheet({ el, focus, onEscape }) {
  opening = true; if (sheet) closeSheet(false); opening = false;
  const opener = document.activeElement;
  const backdrop = h('div', { class: 'backdrop', onClick: () => onEscape() });
  sheetRoot.replaceChildren(backdrop, el);
  sheetRoot.hidden = false;
  shell.inert = true; shell.setAttribute('aria-hidden', 'true');
  sheet = { el, onEscape, opener };
  requestAnimationFrame(() => focus && focus.focus());
}
function closeSheet(restore = true) {
  if (!sheet) return;
  const { opener } = sheet;
  sheet = null;
  sheetRoot.replaceChildren(); sheetRoot.hidden = true;
  shell.inert = false; shell.removeAttribute('aria-hidden');
  app.sheetLive.length = 0; app.sheetHooks.clear();
  if (!opening) queueMicrotask(pump); // a queued alarm waits for any other sheet to close
  if (restore) {
    const target = opener && opener.isConnected ? opener : $('page-title');
    if (target) target.focus({ preventScroll: true });
  }
}
document.addEventListener('keydown', (e) => {
  if (!sheet) return;
  if (e.key === 'Escape') { e.preventDefault(); sheet.onEscape(); return; }
  if (e.key === 'Tab') {
    const items = [...sheet.el.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!sheet.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* ---------- alert engine ---------- */
const queue = [];
let active = null;            // { id, rev }
const sessionFired = new Set(); // guards against re-firing if persisting failed

function enqueue(id, rev) {
  if (active && active.id === id && active.rev === rev) return;
  if (!queue.some((q) => q.id === id && q.rev === rev)) queue.push({ id, rev });
  pump(true); // a new alert preempts any other sheet
}
function pump(force = false) {
  if (active || (sheet && !force)) return;
  while (queue.length) {
    const { id, rev } = queue.shift();
    const rec = findRecord(store.data, id);
    if (!rec || rec.completedAt !== null || rec.deadlineRevision !== rev || !rec.alertEnabled) continue;
    active = { id, rev };
    const ui = alarmSheet(app, rec, { onDismiss: dismissAlarm, onFinish: () => { const i = id; stopActive(); app.actions.finish(i); } });
    openSheet({ ...ui, onEscape: dismissAlarm });
    if (app.audio.enabled) app.audio.startAlarm();
    return;
  }
}
function stopActive() { app.audio.stopAlarm(); active = null; closeSheet(false); }
function dismissAlarm() {
  if (!active) return;
  const { id, rev } = active;
  stopActive();
  store.commit((d) => { const r = findRecord(d, id); if (r && r.alertState.status === 'fired') setAlertStatus(d, id, rev, 'acknowledged'); });
  restoreFocus();
  pump();
}
function restoreFocus() { const t = $('page-title'); if (t && !sheet) t.focus({ preventScroll: true }); }
function cancelAlarmFor(id) {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id === id) queue.splice(i, 1);
  if (active && active.id === id) { stopActive(); restoreFocus(); pump(); }
}
function reconcileAlarms() {
  if (active) {
    const r = findRecord(store.data, active.id);
    if (!r || r.completedAt !== null || r.deadlineRevision !== active.rev || !r.alertEnabled) cancelAlarmFor(active.id);
  }
}

function checkAlerts(now) {
  if (store.loadError) return;
  const visible = document.visibilityState === 'visible';
  const pending = store.data.records.some((r) => alertDecision(r, now, { visible }) && !sessionFired.has(alertEventId(r)));
  if (!pending) return;
  // Re-read storage first so another open tab's claim wins.
  store.load();
  const fire = [], missed = [];
  for (const r of store.data.records) {
    if (sessionFired.has(alertEventId(r))) continue;
    const d = alertDecision(r, now, { visible });
    if (d === 'fire') fire.push(r); else if (d === 'missed') missed.push(r);
  }
  fire.sort((a, b) => a.deadlineAt - b.deadlineAt);
  const res = store.commit((d) => {
    fire.forEach((r) => setAlertStatus(d, r.id, r.deadlineRevision, 'fired'));
    missed.forEach((r) => setAlertStatus(d, r.id, r.deadlineRevision, 'missed'));
  });
  if (!res.ok) fire.concat(missed).forEach((r) => sessionFired.add(alertEventId(r)));
  fire.forEach((r) => { sessionFired.add(alertEventId(r)); enqueue(r.id, r.deadlineRevision); });
}

/* ---------- actions ---------- */
const A = app.actions;

function failToast(res) { if (!res.ok) toast(res.message || 'Something went wrong.'); return res.ok; }

A.saveRecord = (id, input) => {
  let info = null;
  const res = store.commit((d) => {
    if (id) info = updateRecord(d, id, input, app.now());
    else addRecord(d, input, app.now());
  });
  if (res.ok && id && info && info.alertCancelled) cancelAlarmFor(id);
  return res;
};

A.finish = (id) => {
  const rec0 = findRecord(store.data, id);
  if (!rec0) return;
  if (!failToast(store.commit((d) => completeRecord(d, id, app.now())))) return;
  cancelAlarmFor(id);
  const rec = findRecord(store.data, id);
  const close = () => { closeSheet(false); app.go('#/'); restoreFocus(); };
  const ui = completionSheet(app, rec, { onClose: close, onUndo: () => A.undo(id) });
  openSheet({ ...ui, onEscape: close });
};

A.undo = (id) => {
  if (!failToast(store.commit((d) => undoCompletion(d, id, app.now())))) return;
  if (sheet) closeSheet(false);
  const r = findRecord(store.data, id);
  toast(`“${r ? r.title : 'Finish line'}” is back on the road.`);
  render();
  restoreFocus();
};

A.remove = (id) => {
  const rec = findRecord(store.data, id);
  if (!rec) return;
  const ui = confirmSheet({
    title: 'Delete this finish line?',
    body: `“${rec.title}” and its history will be permanently removed from this device.`,
    confirmLabel: 'Delete', danger: true,
    onCancel: () => closeSheet(),
    onConfirm: () => {
      if (!failToast(store.commit((d) => deleteRecord(d, id)))) return;
      cancelAlarmFor(id);
      closeSheet(false);
      toast(`Deleted “${rec.title}”.`);
      app.go('#/'); restoreFocus();
    },
  });
  openSheet({ ...ui, onEscape: () => closeSheet() });
};

A.setSettings = (partial) => {
  const res = store.commit((d) => Object.assign(d.settings, partial));
  if (!res.ok) { failToast(res); return res; }
  if ('soundEnabled' in partial) app.audio.setEnabled(partial.soundEnabled);
  applyMotion();
  return res;
};

A.unlockSound = async () => {
  const ok = await app.audio.unlock();
  toast(ok ? 'Sound enabled for this session.' : 'Sound is still blocked. Try Test sound in Settings.');
};

A.exportBackup = () => {
  try {
    const blob = new Blob([exportPayload(store.data, app.now())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: exportFilename(app.now()) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Backup file created.');
  } catch { toast('Couldn’t create the backup file.'); }
};

A.importFile = async (file) => {
  let text;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('size');
    text = await file.text();
  } catch { toast(file.size > 2 * 1024 * 1024 ? 'That file is too large to be a Finish Lines backup (limit 2 MB).' : 'Couldn’t read that file.'); return; }
  const parsed = parseBackup(text, file.size);
  if (!parsed.ok) { toast(`Import failed: ${parsed.error} Your current data was not changed.`); return; }
  const inc = parsed.data;
  const done = finishedRecords(inc).length;
  const ui = confirmSheet({
    title: 'Replace your finish lines?',
    body: `This backup has ${inc.records.length} finish line${inc.records.length === 1 ? '' : 's'} (${done} finished). Importing replaces the ${store.data.records.length} currently on this device.`,
    confirmLabel: 'Replace with backup',
    extra: h('button', { type: 'button', class: 'btn', onClick: () => A.exportBackup() }, 'Export current data first'),
    onCancel: () => closeSheet(),
    onConfirm: () => {
      const now = app.now();
      inc.records.forEach((r) => { if (r.alertState.status === 'pending' && r.deadlineAt <= now) r.alertState.status = 'skipped'; });
      if (store.loadError) { const f = store.startFresh(); if (!f.ok) { toast(f.message); return; } }
      if (!failToast(store.replaceAll(inc))) return;
      app.audio.setEnabled(store.data.settings.soundEnabled);
      active && cancelAlarmFor(active.id);
      closeSheet(false);
      toast(`Imported ${inc.records.length} finish line${inc.records.length === 1 ? '' : 's'}.`);
      app.go('#/'); render(); restoreFocus();
    },
  });
  openSheet({ ...ui, onEscape: () => closeSheet() });
};

/* ---------- banners ---------- */
let updateWorker = null;
function renderBanners() {
  const out = [];
  if (demo) out.push(h('div', { class: 'banner' }, h('span', {}, 'Demo mode: sample data, kept separate from your real finish lines. '), h('a', { href: location.pathname }, 'Exit demo')));
  if (store.loadError) {
    const e = store.loadError;
    const btns = [];
    if (e.raw != null) {
      btns.push(h('button', { type: 'button', class: 'btn small', onClick: () => {
        const blob = new Blob([e.raw], { type: 'application/json' }); const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: 'finish-lines-unreadable-data.json' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      } }, 'Download unreadable data'));
      btns.push(h('button', { type: 'button', class: 'btn small', onClick: () => {
        const ui = confirmSheet({ title: 'Start fresh?', body: 'A copy of the unreadable data stays in browser storage, but the app will start empty. Download it first if you want to keep it.', confirmLabel: 'Start fresh', danger: true,
          onCancel: () => closeSheet(), onConfirm: () => { const r = store.startFresh(); closeSheet(false); if (!r.ok) toast(r.message); render(); } });
        openSheet({ ...ui, onEscape: () => closeSheet() });
      } }, 'Start fresh'));
    }
    out.push(h('div', { class: 'banner bad', role: 'alert' }, h('strong', {}, 'Your saved data can’t be used. '), h('span', {}, `${e.message} Nothing has been overwritten. `), h('div', { class: 'row' }, ...btns)));
  }
  if (updateWorker) out.push(h('div', { class: 'banner' }, h('span', {}, 'A new version is ready. '), h('button', { type: 'button', class: 'btn small', onClick: () => updateWorker.postMessage('SKIP_WAITING') }, 'Reload to update')));
  store.data.records.filter((r) => r.completedAt === null && r.alertState.status === 'missed').forEach((r) => {
    out.push(h('div', { class: 'banner' }, h('span', {}, `“${r.title}” passed its finish line (${formatShort(r.deadlineAt, r.timeZone)}) while the app was closed or asleep. No alarm played. `),
      h('button', { type: 'button', class: 'btn small', onClick: () => store.commit((d) => setAlertStatus(d, r.id, r.deadlineRevision, 'missed-seen')) }, 'Dismiss')));
  });
  bannerRoot.replaceChildren(...out);
}

/* ---------- routing / render ---------- */
function parseRoute() {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  const id = b ? decodeURIComponent(b) : null;
  switch (a) {
    case 'finished': return { name: 'finished' };
    case 'settings': return { name: 'settings' };
    case 'new': return { name: 'new' };
    case 'edit': return id ? { name: 'edit', id } : { name: 'road' };
    case 'line': return id ? { name: 'line', id } : { name: 'road' };
    default: return { name: 'road' };
  }
}
let lastKey = null;

function render({ force = false } = {}) {
  const route = parseRoute();
  const key = `${route.name}:${route.id || ''}`;
  const routeChanged = key !== lastKey;
  lastKey = key;
  app.live.length = 0; app.audioHooks.clear();
  let view, tab = null, title = 'Finish Lines';
  switch (route.name) {
    case 'finished': view = finishedView(app); tab = 'finished'; title = 'Finished · Finish Lines'; break;
    case 'settings': view = settingsView(app); tab = 'settings'; title = 'Settings · Finish Lines'; break;
    case 'new': view = formView(app, null); title = 'Add finish line · Finish Lines'; break;
    case 'edit': view = formView(app, route.id); title = 'Edit finish line · Finish Lines'; break;
    case 'line': {
      const r = findRecord(store.data, route.id);
      view = detailView(app, route.id); tab = r && r.completedAt !== null ? 'finished' : 'road';
      title = r ? `${r.title} · Finish Lines` : title; break;
    }
    default: view = roadView(app); tab = 'road';
  }
  mainEl.replaceChildren(view);
  navRoot.replaceChildren(...(tab ? [bottomNav(tab)] : []));
  document.body.classList.toggle('no-nav', !tab);
  document.title = title;
  renderBanners();
  tickNow();
  if (routeChanged || force) {
    window.scrollTo(0, 0);
    const t = $('page-title');
    if (t && !sheet && lastRendered) t.focus({ preventScroll: true });
  }
  lastRendered = true;
}
let lastRendered = false;

function applyMotion() { document.documentElement.classList.toggle('reduce-motion', app.reducedMotion()); }

/* ---------- shared clock ---------- */
let timer = null;
function tickNow() {
  const now = app.now();
  app.live.forEach((f) => f(now));
  app.sheetLive.forEach((f) => f(now));
}
function tick() {
  clearTimeout(timer);
  tickNow();
  checkAlerts(app.now());
  if (document.visibilityState !== 'hidden') timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 15);
}

store.subscribe(() => {
  reconcileAlarms();
  const r = parseRoute().name;
  if (r === 'new' || r === 'edit' || r === 'settings') renderBanners(); else render();
  if (r === 'settings') renderBanners();
});

window.addEventListener('hashchange', () => render());
window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) { store.reload(); } });
document.addEventListener('visibilitychange', tick);
window.addEventListener('pageshow', tick);
window.addEventListener('focus', tick);
reducedMq.addEventListener && reducedMq.addEventListener('change', applyMotion);

/* ---------- demo fixtures (explicit demo mode only) ---------- */
function seedDemo() {
  if (demo !== 'seed' || store.loadError || store.data.records.length) return;
  const now = app.now(), H = 3600000, D = 24 * H, tz = store.data.settings.defaultTimeZone;
  const mk = (title, start, dl, desc = '') => ({ title, description: desc, deadlineAt: dl, timeZone: tz, alertEnabled: false, start });
  const items = [
    mk('Grand Scheme Blueprint', now - 3 * D, now - (42 * 60 + 9) * 1000, 'Blueprint on the website.'),
    mk('Websites Ready', now - D, now + 6 * D + 23 * H + 17 * 60000 + 51000),
    mk('Publishing Rhythm Ready', now - D, now + 13 * D + 23 * H + 17 * 60000 + 51000),
    mk('A Very Long Project Title That Must Wrap Instead Of Being Cut Off Or Shrunk', now - 2 * D, now + 3 * H + 24 * 60000 + 18000),
  ];
  store.commit((d) => items.forEach((it) => { const r = addRecord(d, it, it.start); r.createdAt = r.startAt = it.start; }));
}

/* ---------- service worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && updateWorker) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    const flag = (w) => { if (w && navigator.serviceWorker.controller) { updateWorker = w; renderBanners(); } };
    flag(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') flag(w); });
    });
  }).catch(() => { /* offline support unavailable; the app itself still works */ });
}

/* ---------- boot ---------- */
applyMotion();
seedDemo();
render();
tick();
registerSW();
if (demo) window.__FL = { app, store, audio: app.audio, queue, get active() { return active; } };
