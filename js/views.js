// Screens and sheets. Every view receives the `app` controller (store, audio, actions).
// Views register per-second updaters in app.live; they never create their own timers.

import { h, icon, svgEl } from './dom.js';
import {
  timerStatus, roadGeometry, formatClock, formatDeadline, formatDueDay, formatFull, formatShort,
  formatRange, coarseSpeech, describeResult, localToInstants, parseDateInput, parseTimeInput,
  toDateInput, toTimeInput, zoneOptions, zonedParts, isValidTimeZone, FLAG_POSITION,
} from './time.js';
import { activeRecords, finishedRecords, findRecord, resultOf, LIMITS } from './state.js';

const setText = (n, t) => { if (n.textContent !== t) n.textContent = t; };
const pct = (x) => `${(x * 100).toFixed(3)}%`;

/* ---------- Shell pieces ---------- */

export function pageHeader(app, { title, subtitle = '' }) {
  const [a, ...rest] = title.split(' ');
  return h('header', { class: 'masthead' },
    h('p', { class: 'brand' }, 'Ten Grand + Heart Direction'),
    h('h1', { class: 'wordmark', tabindex: '-1', id: 'page-title' }, h('span', {}, rest.length ? a + ' ' : a), h('span', { class: 'accent' }, rest.join(' '))),
    subtitle ? h('p', { class: 'range' }, h('span', {}, subtitle)) : null,
    soundBell(app),
  );
}

function soundBell(app) {
  const btn = h('a', { class: 'bell', href: '#/settings', 'aria-label': 'Sound and alert settings' });
  const paint = () => {
    const st = app.audio.status;
    btn.replaceChildren(icon(st === 'ready' ? 'bell' : 'bellOff'));
    btn.setAttribute('aria-label', `Sound and alert settings. ${soundStatusText(app.audio).short}`);
    btn.dataset.sound = st;
  };
  paint(); app.audioHooks.add(paint);
  return btn;
}

export function soundStatusText(audio) {
  switch (audio.status) {
    case 'unsupported': return { short: 'Sound unsupported.', long: 'This browser can’t play alert sounds. Visual alerts still work.' };
    case 'disabled': return { short: 'Sound is off.', long: 'Sound is off. Alerts will be visual only.' };
    case 'error': return { short: 'Sound problem.', long: `${audio.error || 'Sound could not start.'} Tap Test sound to try again. Everything else still works.` };
    case 'ready': return { short: 'Sound enabled for this session.', long: 'Sound enabled for this session.' };
    default: return { short: 'Sound not unlocked yet.', long: 'Sound is on but not unlocked yet this session. Tap Test sound to unlock it.' };
  }
}

export function bottomNav(active) {
  const item = (hash, key, label, ic) => h('a', { href: hash, class: 'tab', 'aria-current': active === key ? 'page' : null }, icon(ic), h('span', {}, label));
  return h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    item('#/', 'road', 'Road', 'road'), item('#/finished', 'finished', 'Finished', 'flag'), item('#/settings', 'settings', 'Settings', 'gear'));
}

/* ---------- Billboard + road ---------- */

function lampRow() {
  return h('div', { class: 'lamps', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(() => icon('lamp')));
}
function truss() {
  return h('div', { class: 'truss', 'aria-hidden': 'true' },
    h('div', { class: 'beam' }), h('div', { class: 'leg l' }), h('div', { class: 'leg r' }));
}

export function roadEl(rec, app) {
  const fill = h('div', { class: 'fill' });
  const orb = h('div', { class: 'orb' });
  const track = h('div', { class: 'track' }, fill, h('div', { class: 'dashes' }),
    h('div', { class: 'flag', style: `left:${pct(FLAG_POSITION)}` }));
  const el = h('div', { class: 'road', 'aria-hidden': 'true' }, track, h('div', { class: 'lane' }, orb));
  const update = (now) => {
    const done = rec.completedAt !== null;
    const at = done ? rec.completedAt : now;
    const g = roadGeometry(rec.startAt, rec.deadlineAt, at);
    let state;
    if (done) state = resultOf(rec).late ? 'red' : 'cyan';
    else state = timerStatus(rec.deadlineAt, now).state;
    el.dataset.state = state;
    fill.style.width = pct(g.position);
    orb.style.left = pct(g.position);
  };
  update(app.now());
  if (rec.completedAt === null) app.live.push(update);
  return el;
}

/** Billboard board content shared by list cards and the detail view. */
function boardContent(app, rec, { detail }) {
  const done = rec.completedAt !== null;
  const due = h('p', { class: 'due' });
  const title = detail
    ? h('h2', { class: 'title', id: 'page-title', tabindex: '-1' }, rec.title)
    : h('h2', { class: 'title' }, h('a', { href: `#/line/${encodeURIComponent(rec.id)}`, class: 'stretch' }, rec.title));
  const when = h('p', { class: 'when' }, formatDeadline(rec.deadlineAt, rec.timeZone, app.now()));
  const count = h('span', { class: 'count', 'aria-hidden': 'true' });
  const speak = h('span', { class: 'sr-only' });
  const label = h('span', { class: 'count-label' });
  const clock = h('div', { class: 'clock' }, h('div', { class: 'timer', role: 'timer', 'aria-live': 'off' }, count, speak), label);
  const nodes = [due, title];

  if (done) {
    const res = resultOf(rec);
    setText(due, `FINISHED · ${formatDueDay(rec.completion.deadlineAt, rec.timeZone, app.now()).toUpperCase()}`);
    nodes.push(
      detail && rec.description ? h('p', { class: 'desc' }, rec.description) : null,
      h('p', { class: 'when' }, `Completed ${formatShort(rec.completedAt, rec.timeZone)}`),
      h('p', { class: `result ${res.late ? 'late' : 'early'}` }, res.text));
    return { nodes, badge: h('span', { class: 'check-badge', 'aria-hidden': 'true' }, icon('done')), update: null };
  }

  nodes.push(detail && rec.description ? h('p', { class: 'desc' }, rec.description) : null, when);
  const update = (now) => {
    const st = timerStatus(rec.deadlineAt, now);
    clock.dataset.state = st.state;
    setText(count, formatClock(st.seconds, st.overtime));
    setText(speak, coarseSpeech(st));
    setText(label, st.overtime ? 'PAST FINISH LINE' : st.state === 'yellow' ? 'TIME LEFT · FINAL 6 HOURS' : 'TIME LEFT');
    setText(due, st.overtime ? `PAST DUE · ${formatDueDay(rec.deadlineAt, rec.timeZone, now).toUpperCase()}` : `DUE ${formatDueDay(rec.deadlineAt, rec.timeZone, now).toUpperCase()}`);
    due.dataset.state = st.state;
  };
  update(app.now());
  app.live.push(update);
  return { nodes, clock, update };
}

export function billboard(app, rec, { detail = false } = {}) {
  const content = boardContent(app, rec, { detail });
  const foot = h('div', { class: 'board-foot' });
  if (content.clock) foot.append(content.clock);
  if (rec.completedAt === null && !detail) {
    foot.append(h('button', { type: 'button', class: 'btn-mark', 'aria-label': `Mark finished: ${rec.title}`, onClick: () => app.actions.finish(rec.id) }, icon('check')));
  }
  const board = h('div', { class: 'board' }, ...content.nodes, content.badge, foot);
  return h('article', { class: `line${detail ? ' detail' : ''}${rec.completedAt !== null ? ' is-done' : ''}`, 'data-id': rec.id },
    lampRow(), board, truss(), roadEl(rec, app));
}

/* ---------- Road (home) ---------- */

export function roadView(app) {
  const data = app.store.data;
  const recs = activeRecords(data);
  const range = formatRange(recs.map((r) => r.deadlineAt), data.settings.defaultTimeZone);
  const root = h('div', { class: 'view road-view' }, pageHeader(app, { title: 'FINISH LINES', subtitle: range }));

  const chip = h('button', { type: 'button', class: 'sound-chip', hidden: true, onClick: () => app.actions.unlockSound() },
    icon('bellOff'), 'Sound locked this session — tap to enable');
  const paintChip = () => {
    const needs = recs.some((r) => r.alertEnabled) && app.audio.status === 'locked';
    chip.hidden = !needs;
  };
  paintChip(); app.audioHooks.add(paintChip);
  root.append(chip);

  if (!recs.length) {
    root.append(h('section', { class: 'empty', 'aria-labelledby': 'empty-title' },
      h('div', { class: 'road empty-road', 'aria-hidden': 'true' }, h('div', { class: 'track' }, h('div', { class: 'dashes' }), h('div', { class: 'flag', style: `left:${pct(FLAG_POSITION)}` })), h('div', { class: 'lane' }, h('div', { class: 'orb', style: 'left:0%' }))),
      h('h2', { id: 'empty-title' }, 'Set your first finish line'),
      h('p', {}, 'Add a project and a deadline. Watch the road fill as time passes.')));
  } else {
    recs.forEach((r) => root.append(billboard(app, r)));
  }
  root.append(addButton());
  return root;
}

function addButton() {
  return h('a', { href: '#/new', class: 'btn-add' }, icon('flag'), h('span', { class: 'sep', 'aria-hidden': 'true' }), 'Add finish line', icon('plus'));
}

/* ---------- Finished list ---------- */

export function finishedView(app) {
  const recs = finishedRecords(app.store.data);
  const root = h('div', { class: 'view' }, pageHeader(app, { title: 'FINISHED' }));
  if (!recs.length) {
    root.append(h('section', { class: 'empty' }, h('h2', {}, 'Nothing finished yet'),
      h('p', {}, 'Finish lines you mark as finished are saved here with their early or late result.')));
    return root;
  }
  const list = h('ul', { class: 'done-list' });
  recs.forEach((r) => {
    const res = resultOf(r);
    list.append(h('li', {}, h('a', { href: `#/line/${encodeURIComponent(r.id)}`, class: 'done-row' },
      h('span', { class: 'done-check', 'aria-hidden': 'true' }, icon('check')),
      h('span', { class: 'done-main' },
        h('span', { class: 'done-title' }, r.title),
        h('span', { class: 'done-date' }, `Completed ${formatShort(r.completedAt, r.timeZone)}`),
        h('span', { class: `done-result ${res.late ? 'late' : 'early'}` }, res.text)))));
  });
  root.append(list);
  return root;
}

/* ---------- Detail / saved result ---------- */

function alertStatusText(r) {
  if (!r.alertEnabled) return 'Finish Line Alert is off.';
  switch (r.alertState.status) {
    case 'pending': return 'Finish Line Alert is on. It plays while this app is open.';
    case 'fired': return 'Finish Line Alert sounded.';
    case 'acknowledged': return 'Finish Line Alert was dismissed.';
    case 'missed': case 'missed-seen': return 'The deadline passed while the app was closed or asleep, so no alarm played.';
    default: return 'No alert for this deadline (it was already past when set).';
  }
}

function row(ic, label, value, cls = '') {
  return h('div', { class: `info-row ${cls}` }, icon(ic), h('div', {}, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value)));
}

export function detailView(app, id) {
  const r = findRecord(app.store.data, id);
  if (!r) return missingView('That finish line doesn’t exist (it may have been deleted).');
  const done = r.completedAt !== null;
  const root = h('div', { class: 'view detail-view' },
    h('div', { class: 'topbar' }, h('a', { href: done ? '#/finished' : '#/', class: 'back' }, icon('back'), 'Back'),
      h('span', { class: 'topbar-title' }, done ? 'Saved result' : 'Finish line')));
  root.append(billboard(app, r, { detail: true }));

  if (!done) {
    root.append(
      h('div', { class: 'info' },
        row('calendar', 'Deadline', formatFull(r.deadlineAt, r.timeZone)),
        row('globe', 'Time zone', r.timeZone),
        row('bell', 'Alert', alertStatusText(r))),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', onClick: () => app.actions.finish(r.id) }, icon('check'), 'Mark finished'),
        h('a', { class: 'btn', href: `#/edit/${encodeURIComponent(r.id)}` }, 'Edit')));
  } else {
    const res = resultOf(r);
    const c = r.completion;
    const revised = r.deadlineHistory.length > 0 && r.originalDeadlineAt !== c.deadlineAt;
    const info = h('div', { class: 'info' },
      row('trophy', 'Result', res.text, res.late ? 'late' : 'early'),
      row('calendar', 'Original deadline', formatFull(r.originalDeadlineAt, r.timeZone)));
    if (revised) info.append(row('calendar', 'Deadline when finished (revised)', formatFull(c.deadlineAt, r.timeZone)));
    info.append(
      row('clock', 'Completed', formatFull(r.completedAt, r.timeZone)),
      row('clock', 'Time difference', `${res.signed} (${res.text})`));
    root.append(info);
    if (revised) {
      const vsOrig = describeResult(r.completedAt - r.originalDeadlineAt);
      root.append(h('p', { class: 'note' }, `This result is measured against the revised deadline. Against the original deadline it was ${vsOrig.text.toLowerCase()}.`));
    }
    root.append(h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn primary', onClick: () => app.actions.undo(r.id) }, icon('undo'), 'Undo completion')));
  }

  if (r.deadlineHistory.length) {
    const list = h('ol', { class: 'history' });
    r.deadlineHistory.forEach((e) => list.append(h('li', {},
      h('span', { class: 'k' }, `Edited ${formatShort(e.editedAt, r.timeZone)}`),
      h('span', { class: 'v' }, `${formatShort(e.from, r.timeZone)} → ${formatShort(e.to, r.timeZone)}`))));
    root.append(h('section', { class: 'card' }, h('h3', {}, 'Deadline history'), list));
  }
  root.append(h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn danger', onClick: () => app.actions.remove(r.id) }, icon('trash'), 'Delete')));
  return root;
}

export function missingView(msg) {
  return h('div', { class: 'view' },
    h('div', { class: 'topbar' }, h('a', { href: '#/', class: 'back' }, icon('back'), 'Back')),
    h('section', { class: 'empty' }, h('h2', { id: 'page-title', tabindex: '-1' }, 'Not found'), h('p', {}, msg)));
}

/* ---------- Add / edit form ---------- */

export function formView(app, id) {
  const editing = id != null;
  const rec = editing ? findRecord(app.store.data, id) : null;
  if (editing && (!rec || rec.completedAt !== null)) return missingView('That finish line can’t be edited. It may have been deleted or finished.');
  const settings = app.store.data.settings;
  const now = app.now();
  const tz0 = rec ? rec.timeZone : settings.defaultTimeZone;

  const title = h('input', { id: 'f-title', name: 'title', type: 'text', maxlength: LIMITS.title, autocomplete: 'off', enterkeyhint: 'next', required: true, value: rec ? rec.title : '', 'aria-describedby': 'e-title' });
  const desc = h('textarea', { id: 'f-desc', name: 'description', rows: 3, maxlength: LIMITS.description }, '');
  desc.value = rec ? rec.description : '';
  const date = h('input', { id: 'f-date', name: 'date', type: 'date', required: true, value: rec ? toDateInput(rec.deadlineAt, tz0) : toDateInput(now, tz0), 'aria-describedby': 'e-date' });
  const time = h('input', { id: 'f-time', name: 'time', type: 'time', step: '1', required: true, value: rec ? toTimeInput(rec.deadlineAt, tz0) : '23:59:59', 'aria-describedby': 'e-time' });
  const zone = h('select', { id: 'f-zone', name: 'zone' });
  zoneOptions([tz0, settings.defaultTimeZone]).forEach((z) => zone.append(h('option', { value: z }, z.replace(/_/g, ' '))));
  zone.value = tz0;
  const alert = h('input', { id: 'f-alert', name: 'alert', type: 'checkbox', role: 'switch', class: 'switch', checked: rec ? rec.alertEnabled : true, 'aria-describedby': 'h-alert' });
  const soundNote = h('p', { class: 'field-note', id: 'n-sound', role: 'status' });

  const err = (idv) => h('p', { class: 'field-error', id: idv, hidden: true });
  const eTitle = err('e-title'), eDate = err('e-date'), eTime = err('e-time');
  const summary = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const ambig = h('fieldset', { class: 'ambig', hidden: true });

  const showErr = (el, input, msg) => { el.hidden = !msg; el.textContent = msg || ''; if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); };
  const clearAmbig = () => { ambig.hidden = true; ambig.replaceChildren(); };
  [date, time, zone].forEach((el) => el.addEventListener('change', clearAmbig));

  alert.addEventListener('change', async () => {
    if (!alert.checked) { soundNote.textContent = ''; return; }
    if (!app.audio.enabled) { soundNote.textContent = 'Sound is off in Settings. You’ll still see the alert.'; return; }
    const ok = await app.audio.unlock();
    soundNote.textContent = ok ? 'Sound enabled for this session.' : 'Sound isn’t available right now. You’ll still see the alert.';
  });

  const submit = h('button', { type: 'submit', class: 'btn primary save' }, icon('flag'), 'Save finish line');

  const form = h('form', { class: 'form', novalidate: true, onSubmit: (ev) => {
    ev.preventDefault();
    showErr(eTitle, title, ''); showErr(eDate, date, ''); showErr(eTime, time, ''); summary.hidden = true;
    let bad = null;
    const t = title.value.trim();
    if (!t) { showErr(eTitle, title, 'Enter a title.'); bad = bad || title; }
    const dp = parseDateInput(date.value);
    if (!dp) { showErr(eDate, date, 'Choose a valid date.'); bad = bad || date; }
    const tp = parseTimeInput(time.value);
    if (!tp) { showErr(eTime, time, 'Choose a valid time.'); bad = bad || time; }
    if (!isValidTimeZone(zone.value)) { summary.hidden = false; summary.textContent = 'Choose a valid time zone.'; bad = bad || zone; }
    let deadlineAt = null;
    if (dp && tp && isValidTimeZone(zone.value)) {
      const conv = localToInstants({ ...dp, ...tp }, zone.value);
      if (conv.kind === 'gap') {
        showErr(eTime, time, `${time.value} doesn’t exist on that date in ${zone.value} — clocks skip forward. Choose a different time.`); bad = bad || time;
      } else if (conv.kind === 'ambiguous') {
        const picked = ambig.querySelector('input:checked');
        if (!picked) {
          ambig.hidden = false; ambig.replaceChildren(
            h('legend', {}, 'This time happens twice that day (clocks go back). Which one?'),
            ...conv.instants.map((ms, i) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'which', value: String(i) }), i === 0 ? 'First' : 'Second', ` — ${formatFull(ms, zone.value)}`)));
          summary.hidden = false; summary.textContent = 'Pick which occurrence of that time you mean.';
          ambig.querySelector('input').focus();
          return;
        }
        deadlineAt = conv.instants[Number(picked.value)];
      } else deadlineAt = conv.instants[0];
    }
    if (bad || deadlineAt == null) { (bad || title).focus(); return; }

    if (alert.checked && app.audio.enabled) app.audio.unlock(); // user gesture

    const res = app.actions.saveRecord(rec ? rec.id : null, {
      title: t, description: desc.value, deadlineAt, timeZone: zone.value, alertEnabled: alert.checked,
    });
    if (!res.ok) { summary.hidden = false; summary.textContent = res.message; return; }
    app.go(rec ? `#/line/${encodeURIComponent(rec.id)}` : '#/');
  } },
    h('div', { class: 'field' }, h('label', { for: 'f-title' }, 'Title ', h('span', { class: 'req', 'aria-label': 'required' }, '*')), title, eTitle),
    h('div', { class: 'field' }, h('label', { for: 'f-desc' }, 'Definition of Done ', h('span', { class: 'opt' }, '(optional)')), desc),
    h('div', { class: 'field inline' }, icon('calendar'), h('label', { for: 'f-date' }, 'Date ', h('span', { class: 'req', 'aria-label': 'required' }, '*')), date, eDate),
    h('div', { class: 'field inline' }, icon('clock'), h('label', { for: 'f-time' }, 'Time ', h('span', { class: 'req', 'aria-label': 'required' }, '*')), time, eTime),
    h('div', { class: 'field inline' }, icon('globe'), h('label', { for: 'f-zone' }, 'Timezone'), zone),
    ambig,
    h('div', { class: 'toggle-row' }, icon('bell'),
      h('div', { class: 'grow' }, h('label', { for: 'f-alert', class: 'toggle-label' }, 'Finish Line Alert'), h('p', { id: 'h-alert', class: 'helper' }, 'Play an alarm while this app is open.')),
      alert),
    soundNote, summary, submit);

  return h('div', { class: 'view form-view' },
    h('div', { class: 'topbar' },
      h('button', { type: 'button', class: 'back', onClick: () => app.go(rec ? `#/line/${encodeURIComponent(rec.id)}` : '#/') }, 'Cancel'),
      h('h1', { class: 'topbar-title', id: 'page-title', tabindex: '-1' }, editing ? 'EDIT FINISH LINE' : 'ADD FINISH LINE')),
    form);
}

/* ---------- Settings ---------- */

export function settingsView(app) {
  const s = app.store.data.settings;
  const root = h('div', { class: 'view settings-view' }, pageHeader(app, { title: 'SETTINGS' }));

  const status = h('p', { class: 'status-line', role: 'status' });
  const paint = () => { status.textContent = soundStatusText(app.audio).long; status.dataset.sound = app.audio.status; };
  paint(); app.audioHooks.add(paint);

  const sound = h('input', { id: 's-sound', type: 'checkbox', role: 'switch', class: 'switch', checked: s.soundEnabled,
    onChange: async (e) => { app.actions.setSettings({ soundEnabled: e.target.checked }); if (e.target.checked) await app.audio.unlock(); paint(); } });
  const test = h('button', { type: 'button', class: 'btn', onClick: async () => {
    if (!app.audio.enabled) { app.toast('Sound is off. Turn it on first.'); return; }
    const ok = await app.audio.test(); paint();
    if (!ok) app.toast('Couldn’t play sound. Check that your iPhone isn’t on Silent, then try again.');
  } }, icon('play'), 'Test sound');

  const zone = h('select', { id: 's-zone', onChange: (e) => app.actions.setSettings({ defaultTimeZone: e.target.value }) });
  zoneOptions([s.defaultTimeZone]).forEach((z) => zone.append(h('option', { value: z }, z.replace(/_/g, ' '))));
  zone.value = s.defaultTimeZone;

  const reduce = h('input', { id: 's-motion', type: 'checkbox', role: 'switch', class: 'switch', checked: app.reducedMotion(),
    onChange: (e) => app.actions.setSettings({ reducedMotion: e.target.checked }) });
  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 's-file', tabindex: '-1',
    onChange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) app.actions.importFile(f); } });

  root.append(
    h('section', { class: 'card' }, h('h2', {}, 'Sound'),
      h('div', { class: 'toggle-row' }, icon('bell'), h('div', { class: 'grow' }, h('label', { for: 's-sound', class: 'toggle-label' }, 'Sound alerts'), h('p', { class: 'helper' }, 'A short chime when a Finish Line Alert fires.')), sound),
      test, status,
      h('p', { class: 'note' }, 'For the alarm, keep Finish Lines open and your screen awake. Closed-app alarms aren’t supported in this version.'),
      h('p', { class: 'note' }, 'On iPhone, sounds are silenced by the Ring/Silent switch.')),
    h('section', { class: 'card' }, h('h2', {}, 'Preferences'),
      h('div', { class: 'field inline' }, icon('globe'), h('label', { for: 's-zone' }, 'Default timezone'), zone),
      h('div', { class: 'toggle-row' }, icon('clock'), h('div', { class: 'grow' }, h('label', { for: 's-motion', class: 'toggle-label' }, 'Reduced motion'), h('p', { class: 'helper' }, 'Turns off glows and slide-in animation.')), reduce),
      h('p', { class: 'note' }, 'Yellow warning: the final 6 hours (fixed).')),
    h('section', { class: 'card' }, h('h2', {}, 'Backup'),
      h('p', { class: 'note' }, 'Your finish lines live only in this browser on this device. Clearing website data, or switching between Safari and the Home Screen app, can make them disappear. There is no automatic sync, so export a backup now and then.'),
      h('div', { class: 'actions row' },
        h('button', { type: 'button', class: 'btn', onClick: () => app.actions.exportBackup() }, 'Export backup'),
        h('button', { type: 'button', class: 'btn', onClick: () => file.click() }, 'Import backup'), file)),
    h('section', { class: 'card' }, h('h2', {}, 'Install on iPhone'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Open this page in Safari.'),
        h('li', {}, 'Tap the Share button.'),
        h('li', {}, 'Choose “Add to Home Screen”, then tap Add.'),
        h('li', {}, 'Open it from the Home Screen. It works offline after the first load.')),
      h('p', { class: 'note' }, 'The Home Screen app keeps its own storage, separate from Safari. Export from one and import into the other to move data.')),
    h('p', { class: 'fineprint' }, 'No accounts, no analytics, nothing leaves your device. Finish Lines v', app.version));
  return root;
}

/* ---------- Sheets ---------- */

function checkerTop() { return h('div', { class: 'checker-top', 'aria-hidden': 'true' }); }

export function alarmSheet(app, rec, { onDismiss, onFinish }) {
  const count = h('div', { class: 'big-count', 'aria-hidden': 'true' });
  const speak = h('span', { class: 'sr-only' }, `${rec.title}: your finish line has passed.`);
  const note = h('p', { class: 'sheet-note' });
  const update = (now) => { const st = timerStatus(rec.deadlineAt, now); setText(count, formatClock(Math.max(0, Math.floor((now - rec.deadlineAt) / 1000)), true)); void st; };
  update(app.now()); app.sheetLive.push(update);
  const paint = () => {
    const st = app.audio.status;
    note.textContent = st === 'ready' ? '' : st === 'disabled' ? 'Sound is off, so this is a visual alert only.' : 'Sound is blocked right now, so this is a visual alert only.';
    note.hidden = st === 'ready';
  };
  paint(); app.sheetHooks.add(paint);
  const dismiss = h('button', { type: 'button', class: 'btn primary', onClick: onDismiss }, 'Dismiss alarm');
  const el = h('div', { class: 'sheet alarm', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title', 'aria-describedby': 'sheet-desc' },
    checkerTop(),
    h('div', { class: 'sheet-icon red' }, icon('alarm')),
    h('h2', { id: 'sheet-title', class: 'sheet-h' }, 'FINISH LINE REACHED'),
    h('p', { class: 'sheet-project' }, rec.title),
    h('div', { class: 'sheet-rule' }),
    h('p', { class: 'overtime-label' }, 'OVERTIME'),
    count, speak,
    h('p', { id: 'sheet-desc', class: 'sheet-sub' }, 'Your finish line has passed.'),
    note,
    dismiss,
    h('button', { type: 'button', class: 'btn', onClick: onFinish }, 'Mark finished'));
  return { el, focus: dismiss };
}

export function completionSheet(app, rec, { onClose, onUndo }) {
  const res = resultOf(rec);
  const back = h('button', { type: 'button', class: 'btn primary', onClick: onClose }, 'Back to road');
  const el = h('div', { class: 'sheet done', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    checkerTop(),
    h('div', { class: 'sheet-icon ring' }, icon('done')),
    h('h2', { id: 'sheet-title', class: 'sheet-h' }, 'FINISHED'),
    h('p', { class: 'sheet-project' }, rec.title),
    h('div', { class: 'sheet-rule' }),
    h('p', { class: `sheet-result ${res.late ? 'late' : 'early'}` }, res.onTime ? `${res.text}.` : res.text.replace(/finish line$/, 'your finish line.')),
    h('p', { class: 'sheet-sub' }, formatFull(rec.completedAt, rec.timeZone)),
    back,
    h('button', { type: 'button', class: 'btn', onClick: onUndo }, 'Undo completion'));
  return { el, focus: back };
}

export function confirmSheet({ title, body, confirmLabel, danger, onConfirm, onCancel, extra }) {
  const cancel = h('button', { type: 'button', class: 'btn primary', onClick: onCancel }, 'Cancel');
  const el = h('div', { class: 'sheet confirm', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title', 'aria-describedby': 'sheet-desc' },
    checkerTop(),
    h('h2', { id: 'sheet-title', class: 'sheet-h small' }, title),
    h('p', { id: 'sheet-desc', class: 'sheet-sub' }, body),
    extra || null,
    h('button', { type: 'button', class: `btn ${danger ? 'danger' : ''}`, onClick: onConfirm }, confirmLabel),
    cancel);
  return { el, focus: cancel };
}

export { svgEl };
