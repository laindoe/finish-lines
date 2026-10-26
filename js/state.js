// Data model, validation, guarded persistence and pure record transitions.
// Nothing here touches the DOM; storage is injected so it can be unit-tested.

import { isValidTimeZone, describeResult } from './time.js';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'finish-lines:v1';
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_RECORDS = 2000;
export const LIMITS = { title: 120, description: 2000, history: 200 };
const MAX_TS = 253402300799000; // 9999-12-31

export const ALERT_STATUSES = ['pending', 'fired', 'acknowledged', 'skipped', 'missed', 'missed-seen'];

export function defaultSettings() {
  return { defaultTimeZone: 'America/New_York', soundEnabled: true, reducedMotion: null };
}
export function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, records: [], settings: defaultSettings() };
}

/* ---------- Validation ---------- */

const isTs = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_TS;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function fail(msg) { const e = new Error(msg); e.validation = true; throw e; }

function normalizeRecord(r, i) {
  const at = `Record ${i + 1}`;
  if (!isObj(r)) fail(`${at} is not an object.`);
  if (typeof r.id !== 'string' || !r.id || r.id.length > 80) fail(`${at} has no valid id.`);
  if (typeof r.title !== 'string' || !r.title.trim() || r.title.length > LIMITS.title) fail(`${at} has an invalid title.`);
  const description = r.description == null ? '' : r.description;
  if (typeof description !== 'string' || description.length > LIMITS.description) fail(`${at} has an invalid description.`);
  for (const k of ['createdAt', 'startAt', 'deadlineAt', 'originalDeadlineAt']) {
    if (!isTs(r[k])) fail(`${at} has an invalid ${k}.`);
  }
  if (!isValidTimeZone(r.timeZone)) fail(`${at} has an invalid time zone.`);
  if (typeof r.alertEnabled !== 'boolean') fail(`${at} has an invalid alertEnabled flag.`);
  const completedAt = r.completedAt == null ? null : r.completedAt;
  if (completedAt !== null && !isTs(completedAt)) fail(`${at} has an invalid completedAt.`);

  const hist = r.deadlineHistory == null ? [] : r.deadlineHistory;
  if (!Array.isArray(hist) || hist.length > LIMITS.history) fail(`${at} has an invalid deadline history.`);
  const deadlineHistory = hist.map((h) => {
    if (!isObj(h) || !isTs(h.editedAt) || !isTs(h.from) || !isTs(h.to)) fail(`${at} has a malformed history entry.`);
    return { editedAt: h.editedAt, from: h.from, to: h.to };
  });

  const revision = r.deadlineRevision == null ? deadlineHistory.length : r.deadlineRevision;
  if (!Number.isInteger(revision) || revision < 0 || revision > 100000) fail(`${at} has an invalid deadlineRevision.`);

  let alertState = { revision, status: 'skipped' };
  if (r.alertState != null) {
    const a = r.alertState;
    if (!isObj(a) || !Number.isInteger(a.revision) || !ALERT_STATUSES.includes(a.status)) fail(`${at} has invalid alert metadata.`);
    alertState = { revision: a.revision, status: a.status };
  }

  let completion = null;
  if (completedAt !== null) {
    if (isObj(r.completion) && isTs(r.completion.deadlineAt) && Number.isFinite(r.completion.diffMs)) {
      completion = { deadlineAt: r.completion.deadlineAt, diffMs: Math.trunc(r.completion.diffMs) };
    } else {
      completion = { deadlineAt: r.deadlineAt, diffMs: completedAt - r.deadlineAt };
    }
  }
  return {
    id: r.id, title: r.title.trim(), description, createdAt: r.createdAt, startAt: r.startAt,
    deadlineAt: r.deadlineAt, originalDeadlineAt: r.originalDeadlineAt, timeZone: r.timeZone,
    alertEnabled: r.alertEnabled, completedAt, completion, deadlineHistory,
    deadlineRevision: revision, alertState,
  };
}

function normalizeSettings(s) {
  const d = defaultSettings();
  if (s == null) return d;
  if (!isObj(s)) fail('Settings are malformed.');
  const defaultTimeZone = s.defaultTimeZone == null ? d.defaultTimeZone : s.defaultTimeZone;
  if (!isValidTimeZone(defaultTimeZone)) fail('Settings have an invalid default time zone.');
  const soundEnabled = s.soundEnabled == null ? d.soundEnabled : s.soundEnabled;
  if (typeof soundEnabled !== 'boolean') fail('Settings have an invalid sound preference.');
  const reducedMotion = s.reducedMotion == null ? null : s.reducedMotion;
  if (reducedMotion !== null && typeof reducedMotion !== 'boolean') fail('Settings have an invalid reduced-motion preference.');
  return { defaultTimeZone, soundEnabled, reducedMotion };
}

/** Validate and normalise a whole data document. Never mutates input; throws nothing. */
export function validateData(raw) {
  try {
    if (!isObj(raw)) fail('The file is not a Finish Lines backup.');
    if (!Number.isInteger(raw.schemaVersion)) fail('Missing schema version.');
    if (raw.schemaVersion > SCHEMA_VERSION) fail(`Saved with a newer version of Finish Lines (schema ${raw.schemaVersion}).`);
    if (raw.schemaVersion < 1) fail('Unsupported schema version.');
    if (!Array.isArray(raw.records)) fail('Records are missing.');
    if (raw.records.length > MAX_RECORDS) fail('Too many records.');
    const records = raw.records.map(normalizeRecord);
    if (new Set(records.map((r) => r.id)).size !== records.length) fail('Duplicate record ids.');
    return { ok: true, data: { schemaVersion: SCHEMA_VERSION, records, settings: normalizeSettings(raw.settings) } };
  } catch (e) {
    if (e.validation) return { ok: false, error: e.message };
    return { ok: false, error: 'The data could not be read.' };
  }
}

export function parseBackup(text, byteLength = text.length) {
  if (byteLength > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is too large to be a Finish Lines backup (limit 2 MB).' };
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'That file is not valid JSON.' }; }
  return validateData(raw);
}

export function exportPayload(data, now) {
  return JSON.stringify({ app: 'finish-lines', exportedAt: new Date(now).toISOString(), ...data }, null, 2);
}
export function exportFilename(now) {
  return `finish-lines-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/* ---------- Guarded store ---------- */

export class Store {
  constructor(storage, key = STORAGE_KEY) {
    this.storage = storage; this.key = key;
    this.data = emptyData();
    this.loadError = null; // { message, raw } when stored data could not be read
    this.listeners = new Set();
    this.load();
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn()); }

  load() {
    this.loadError = null;
    let raw = null;
    try { raw = this.storage.getItem(this.key); } catch {
      this.data = emptyData();
      this.loadError = { message: 'Browser storage is unavailable, so nothing can be saved.', raw: null, unavailable: true };
      return;
    }
    if (raw == null) { this.data = emptyData(); return; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
    const v = parsed === undefined ? { ok: false, error: 'Saved data is not valid JSON.' } : validateData(parsed);
    if (v.ok) this.data = v.data;
    else { this.data = emptyData(); this.loadError = { message: v.error, raw }; }
  }

  /** Re-read storage (another tab wrote) and notify. */
  reload() { this.load(); this.emit(); }

  persist(data) {
    try { this.storage.setItem(this.key, JSON.stringify(data)); return true; } catch { return false; }
  }

  /** Apply `mutator` to a copy; commit only if it saves. Returns { ok, error?, message? }. */
  commit(mutator) {
    if (this.loadError) return { ok: false, error: 'blocked', message: this.loadError.message };
    const next = structuredClone(this.data);
    try { mutator(next); } catch (e) {
      if (e.validation) return { ok: false, error: 'invalid', message: e.message };
      throw e;
    }
    if (!this.persist(next)) {
      return { ok: false, error: 'storage', message: 'Could not save: browser storage is full or blocked. Nothing was changed. Export a backup, then free up space.' };
    }
    this.data = next;
    this.emit();
    return { ok: true };
  }

  /** Replace everything with validated data (import). */
  replaceAll(data) { return this.commit((d) => { d.records = data.records; d.settings = data.settings; }); }

  /** After a load error: keep a copy of the unreadable text, then start empty. */
  startFresh() {
    if (this.loadError && this.loadError.raw != null) {
      try { this.storage.setItem(`${this.key}:unreadable-copy`, this.loadError.raw); } catch { /* best effort */ }
    }
    const fresh = emptyData();
    if (!this.persist(fresh)) return { ok: false, message: 'Could not write to browser storage.' };
    this.data = fresh; this.loadError = null; this.emit();
    return { ok: true };
  }
}

/* ---------- Record transitions (operate on a data draft) ---------- */

export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `fl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function findRecord(data, id) { return data.records.find((r) => r.id === id) || null; }

export function addRecord(data, input, now) {
  const rec = {
    id: newId(), title: input.title.trim(), description: input.description.trim(),
    createdAt: now, startAt: now, deadlineAt: input.deadlineAt, originalDeadlineAt: input.deadlineAt,
    timeZone: input.timeZone, alertEnabled: !!input.alertEnabled, completedAt: null, completion: null,
    deadlineHistory: [], deadlineRevision: 0,
    // A deadline that is already past never rings retroactively.
    alertState: { revision: 0, status: input.deadlineAt > now ? 'pending' : 'skipped' },
  };
  data.records.push(rec);
  return rec;
}

/** Returns { deadlineChanged, alertCancelled } so the app can cancel a live alarm. */
export function updateRecord(data, id, input, now) {
  const r = findRecord(data, id);
  if (!r) fail('That finish line no longer exists.');
  if (r.completedAt !== null) fail('Undo completion before editing this finish line.');
  const deadlineChanged = input.deadlineAt !== r.deadlineAt;
  r.title = input.title.trim();
  r.description = input.description.trim();
  r.timeZone = input.timeZone;
  const wasEnabled = r.alertEnabled;
  r.alertEnabled = !!input.alertEnabled;
  if (deadlineChanged) {
    if (r.deadlineHistory.length >= LIMITS.history) r.deadlineHistory.shift();
    r.deadlineHistory.push({ editedAt: now, from: r.deadlineAt, to: input.deadlineAt });
    r.deadlineAt = input.deadlineAt;
    r.deadlineRevision += 1;
    r.alertState = { revision: r.deadlineRevision, status: r.deadlineAt > now ? 'pending' : 'skipped' };
  } else if (r.alertEnabled && !wasEnabled && r.alertState.status === 'skipped' && r.deadlineAt > now) {
    r.alertState = { revision: r.deadlineRevision, status: 'pending' };
  }
  return { deadlineChanged, alertCancelled: deadlineChanged || (wasEnabled && !r.alertEnabled) };
}

export function completeRecord(data, id, now) {
  const r = findRecord(data, id);
  if (!r) fail('That finish line no longer exists.');
  if (r.completedAt !== null) return r; // completedAt is saved once
  r.completedAt = now;
  r.completion = { deadlineAt: r.deadlineAt, diffMs: now - r.deadlineAt };
  return r;
}

export function undoCompletion(data, id, now) {
  const r = findRecord(data, id);
  if (!r) fail('That finish line no longer exists.');
  r.completedAt = null;
  r.completion = null;
  // Coming back overdue must not ring a retroactive alarm.
  if (r.deadlineAt <= now && r.alertState.status === 'pending') r.alertState = { revision: r.deadlineRevision, status: 'skipped' };
  return r;
}

export function deleteRecord(data, id) {
  const i = data.records.findIndex((r) => r.id === id);
  if (i < 0) fail('That finish line no longer exists.');
  return data.records.splice(i, 1)[0];
}

export function setAlertStatus(data, id, revision, status) {
  const r = findRecord(data, id);
  if (!r || r.deadlineRevision !== revision) return false;
  r.alertState = { revision, status };
  return true;
}

export const alertEventId = (r) => `${r.id}:${r.deadlineRevision}`;

/** What should the alert engine do for this record right now? */
export function alertDecision(r, now, { visible = true, graceMs = 10000 } = {}) {
  if (r.completedAt !== null || !r.alertEnabled) return null;
  if (r.alertState.status !== 'pending' || r.alertState.revision !== r.deadlineRevision) return null;
  if (now < r.deadlineAt) return null;
  if (now - r.deadlineAt > graceMs) return 'missed';
  return visible ? 'fire' : null;
}

/* ---------- Derived lists ---------- */

export const activeRecords = (data) => data.records.filter((r) => r.completedAt === null)
  .sort((a, b) => a.deadlineAt - b.deadlineAt || a.createdAt - b.createdAt);
export const finishedRecords = (data) => data.records.filter((r) => r.completedAt !== null)
  .sort((a, b) => b.completedAt - a.completedAt);

export function resultOf(r) {
  return describeResult(r.completion ? r.completion.diffMs : r.completedAt - r.deadlineAt);
}
