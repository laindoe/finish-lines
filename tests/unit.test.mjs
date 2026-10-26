import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/time.js';
import * as S from '../js/state.js';

const { HOUR, SIX_HOURS, DAY } = T;

/* ---------- status boundaries ---------- */
test('timer status boundaries', () => {
  const dl = 1_000_000_000_000;
  assert.equal(T.timerStatus(dl, dl - SIX_HOURS - 1000).state, 'green');   // 6h + 1s
  assert.equal(T.timerStatus(dl, dl - SIX_HOURS).state, 'yellow');          // exactly 6h
  assert.equal(T.timerStatus(dl, dl - 1000).state, 'yellow');               // 1s left
  const at0 = T.timerStatus(dl, dl);
  assert.equal(at0.state, 'red'); assert.equal(at0.overtime, true);
  assert.equal(T.formatClock(at0.seconds, at0.overtime), '+00:00:00');
  const over1 = T.timerStatus(dl, dl + 1000);
  assert.equal(T.formatClock(over1.seconds, true), '+00:00:01');
  assert.equal(T.formatClock(T.timerStatus(dl, dl - 1000).seconds), '00:00:01');
});

test('ceil remaining / floor elapsed, no negative zero', () => {
  const dl = 5_000_000;
  assert.equal(T.timerStatus(dl, dl - 1).seconds, 1);          // 1ms left -> 1s
  assert.equal(T.timerStatus(dl, dl + 999).seconds, 0);        // <1s over -> 0
  assert.equal(T.formatClock(-0), '00:00:00');
  assert.ok(!Object.is(T.timerStatus(dl, dl + 500).seconds, -0));
});

test('days formatting', () => {
  assert.equal(T.formatClock(6 * 86400 + 23 * 3600 + 17 * 60 + 51), '6d 23:17:51');
  assert.equal(T.formatClock(86400), '1d 00:00:00');
  assert.equal(T.formatClock(2 * 86400 + 3 * 3600, true), '+2d 03:00:00');
  assert.equal(T.formatClock(86399), '23:59:59');
});

/* ---------- road ---------- */
test('road fraction and bounded overtime', () => {
  const start = 0, dl = 10 * HOUR;
  assert.equal(T.roadGeometry(start, dl, -5).fraction, 0);
  assert.equal(T.roadGeometry(start, dl, 5 * HOUR).fraction, 0.5);
  const atDl = T.roadGeometry(start, dl, dl);
  assert.equal(atDl.fraction, 1); assert.equal(atDl.overtime, 0);
  assert.ok(Math.abs(atDl.position - T.FLAG_POSITION) < 1e-12);
  const mid = T.roadGeometry(start, dl, dl + 3 * HOUR);
  assert.ok(mid.position > T.FLAG_POSITION && mid.position < 1);
  assert.equal(T.roadGeometry(start, dl, dl + 6 * HOUR).position, 1);
  assert.equal(T.roadGeometry(start, dl, dl + 400 * DAY).position, 1);   // orb stays put
});

test('zero / negative duration does not divide by zero', () => {
  for (const [s, d] of [[100, 100], [200, 100]]) {
    const g = T.roadGeometry(s, d, 250);
    assert.ok(Number.isFinite(g.position)); assert.equal(g.fraction, 1);
    assert.equal(T.roadGeometry(s, d, d - 1).fraction, 0);
  }
});

test('completion freezes the orb at the actual elapsed fraction', () => {
  const g = T.roadGeometry(0, 100 * HOUR, 25 * HOUR);
  assert.equal(g.fraction, 0.25); assert.equal(g.overtime, 0);
});

/* ---------- time zones ---------- */
const NY = 'America/New_York';
const iso = (ms) => new Date(ms).toISOString();

test('NY conversion: EDT vs EST', () => {
  const edt = T.localToInstants({ year: 2026, month: 10, day: 25, hour: 23, minute: 59, second: 59 }, NY);
  assert.equal(edt.kind, 'ok'); assert.equal(iso(edt.instants[0]), '2026-10-26T03:59:59.000Z');
  const est = T.localToInstants({ year: 2026, month: 11, day: 8, hour: 23, minute: 59, second: 59 }, NY);
  assert.equal(est.kind, 'ok'); assert.equal(iso(est.instants[0]), '2026-11-09T04:59:59.000Z');
});

test('NY spring-forward gap is reported, not guessed (2026-03-08 02:30)', () => {
  const r = T.localToInstants({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, NY);
  assert.equal(r.kind, 'gap'); assert.equal(r.instants.length, 0);
  const ok = T.localToInstants({ year: 2026, month: 3, day: 8, hour: 3, minute: 0, second: 0 }, NY);
  assert.equal(iso(ok.instants[0]), '2026-03-08T07:00:00.000Z');
});

test('NY fall-back overlap is ambiguous (2026-11-01 01:30)', () => {
  const r = T.localToInstants({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, NY);
  assert.equal(r.kind, 'ambiguous');
  assert.deepEqual(r.instants.map(iso), ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
});

test('other zones: Sydney, Kolkata, UTC, Phoenix', () => {
  const syd = T.localToInstants({ year: 2026, month: 1, day: 15, hour: 12, minute: 0, second: 0 }, 'Australia/Sydney');
  assert.equal(iso(syd.instants[0]), '2026-01-15T01:00:00.000Z');          // AEDT +11
  const sydWinter = T.localToInstants({ year: 2026, month: 7, day: 15, hour: 12, minute: 0, second: 0 }, 'Australia/Sydney');
  assert.equal(iso(sydWinter.instants[0]), '2026-07-15T02:00:00.000Z');    // AEST +10
  const kol = T.localToInstants({ year: 2026, month: 6, day: 1, hour: 0, minute: 0, second: 0 }, 'Asia/Kolkata');
  assert.equal(iso(kol.instants[0]), '2026-05-31T18:30:00.000Z');
  assert.equal(iso(T.localToInstants({ year: 2026, month: 6, day: 1, hour: 9, minute: 5, second: 7 }, 'UTC').instants[0]), '2026-06-01T09:05:07.000Z');
  assert.equal(iso(T.localToInstants({ year: 2026, month: 7, day: 1, hour: 0, minute: 0, second: 0 }, 'America/Phoenix').instants[0]), '2026-07-01T07:00:00.000Z');
});

test('round trip: instant -> input strings -> instant', () => {
  for (const tz of [NY, 'Europe/London', 'Asia/Tokyo', 'Pacific/Auckland']) {
    const ms = Date.UTC(2026, 9, 26, 3, 59, 59);
    const d = T.parseDateInput(T.toDateInput(ms, tz)), t = T.parseTimeInput(T.toTimeInput(ms, tz));
    assert.ok(T.localToInstants({ ...d, ...t }, tz).instants.includes(ms), tz);
  }
});

test('input parsing', () => {
  assert.equal(T.parseDateInput('2026-02-30'), null);
  assert.equal(T.parseDateInput('nope'), null);
  assert.deepEqual(T.parseDateInput('2026-02-28'), { year: 2026, month: 2, day: 28 });
  assert.equal(T.parseTimeInput('24:00'), null);
  assert.deepEqual(T.parseTimeInput('23:59'), { hour: 23, minute: 59, second: 0 });
  assert.deepEqual(T.parseTimeInput('23:59:59'), { hour: 23, minute: 59, second: 59 });
  assert.equal(T.isValidTimeZone('Mars/Base'), false);
});

test('formatting', () => {
  const ms = Date.UTC(2026, 9, 26, 3, 59, 59);
  assert.equal(T.formatDeadline(ms, NY, ms), 'Oct 25 • 11:59:59 PM EDT');
  assert.equal(T.formatDueDay(ms, NY, ms), 'October 25');
  assert.equal(T.formatRange([ms, ms + 14 * DAY], NY), 'OCTOBER–NOVEMBER 2026');
  assert.equal(T.formatRange([], NY), '');
  assert.equal(T.describeResult(42 * 60000).text, '42 minutes past finish line');
  assert.equal(T.describeResult(-(3 * HOUR + 5 * 60000)).text, '3 hours 5 minutes before finish line');
  assert.equal(T.describeResult(0).onTime, true);
  assert.equal(T.describeResult(42 * 60000 + 9000).signed, '+00:42:09');
});

/* ---------- state ---------- */
class MemStorage {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); this.fail = false; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { if (this.fail) throw new Error('quota'); this.m.set(k, v); }
}
const input = (over = {}) => ({ title: 'Ship it', description: '', deadlineAt: 10_000, timeZone: NY, alertEnabled: true, ...over });

test('add: startAt = creation instant; past deadline starts overdue without a pending alert', () => {
  const d = S.emptyData();
  const a = S.addRecord(d, input({ deadlineAt: 50_000 }), 1000);
  assert.equal(a.startAt, 1000); assert.equal(a.originalDeadlineAt, 50_000); assert.equal(a.alertState.status, 'pending');
  const b = S.addRecord(d, input({ deadlineAt: 500 }), 1000);
  assert.equal(b.alertState.status, 'skipped');
  assert.equal(S.alertDecision(b, 100_000), null);
});

test('edit: keeps created/start/original, records history, new revision cancels old event', () => {
  const d = S.emptyData();
  const r = S.addRecord(d, input({ deadlineAt: 50_000 }), 1000);
  const oldEvent = S.alertEventId(r);
  const info = S.updateRecord(d, r.id, input({ deadlineAt: 80_000, title: 'New' }), 2000);
  assert.equal(info.deadlineChanged, true); assert.equal(info.alertCancelled, true);
  assert.equal(r.createdAt, 1000); assert.equal(r.startAt, 1000); assert.equal(r.originalDeadlineAt, 50_000);
  assert.deepEqual(r.deadlineHistory, [{ editedAt: 2000, from: 50_000, to: 80_000 }]);
  assert.notEqual(S.alertEventId(r), oldEvent);
  // editing to an already-past deadline must not ring retroactively
  S.updateRecord(d, r.id, input({ deadlineAt: 1500 }), 3000);
  assert.equal(r.alertState.status, 'skipped');
});

test('alert decision: fires once in-session, missed after grace, hidden waits, completed/disabled never', () => {
  const d = S.emptyData();
  const r = S.addRecord(d, input({ deadlineAt: 100_000 }), 1000);
  assert.equal(S.alertDecision(r, 99_999), null);
  assert.equal(S.alertDecision(r, 100_000), 'fire');
  assert.equal(S.alertDecision(r, 100_500, { visible: false }), null);
  assert.equal(S.alertDecision(r, 100_000 + 10_001), 'missed');
  S.setAlertStatus(d, r.id, r.deadlineRevision, 'fired');
  assert.equal(S.alertDecision(r, 100_100), null);                // refresh does not repeat
  const r2 = S.addRecord(d, input({ deadlineAt: 100_000, alertEnabled: false }), 1000);
  assert.equal(S.alertDecision(r2, 100_000), null);
  const r3 = S.addRecord(d, input({ deadlineAt: 100_000 }), 1000);
  S.completeRecord(d, r3.id, 90_000);
  assert.equal(S.alertDecision(r3, 100_000), null);
});

test('complete once, undo clears it, overdue undo does not re-arm the alarm', () => {
  const d = S.emptyData();
  const r = S.addRecord(d, input({ deadlineAt: 100_000 }), 1000);
  S.completeRecord(d, r.id, 120_000);
  assert.equal(r.completion.diffMs, 20_000);
  S.completeRecord(d, r.id, 999_999);
  assert.equal(r.completedAt, 120_000);                           // saved once
  S.undoCompletion(d, r.id, 130_000);
  assert.equal(r.completedAt, null); assert.equal(r.startAt, 1000); assert.equal(r.deadlineAt, 100_000);
  assert.equal(r.alertState.status, 'skipped');
});

test('validation: rejects bad data, never mutates, accepts good data', () => {
  const d = S.emptyData(); S.addRecord(d, input({ deadlineAt: 99_999 }), 1000);
  const good = JSON.parse(JSON.stringify(d));
  assert.equal(S.validateData(good).ok, true);
  const bads = [
    (x) => { x.schemaVersion = 99; }, (x) => { delete x.records; }, (x) => { x.records[0].title = '  '; },
    (x) => { x.records[0].timeZone = 'Mars/Base'; }, (x) => { x.records[0].deadlineAt = 'soon'; },
    (x) => { x.records[0].alertEnabled = 'yes'; }, (x) => { x.records.push(x.records[0]); },
    (x) => { x.settings.defaultTimeZone = 'Nope'; }, (x) => { x.records[0].title = 'x'.repeat(500); },
  ];
  for (const mutate of bads) { const x = JSON.parse(JSON.stringify(good)); mutate(x); assert.equal(S.validateData(x).ok, false); }
  assert.equal(S.parseBackup('not json').ok, false);
  assert.equal(S.parseBackup('{}', S.MAX_IMPORT_BYTES + 1).ok, false);
});

test('backup round trip', () => {
  const st = new S.Store(new MemStorage());
  st.commit((d) => { S.addRecord(d, input({ title: '<b>x</b>', description: 'multi\nline' }), 1000); d.settings.defaultTimeZone = 'Europe/London'; });
  const text = S.exportPayload(st.data, 5000);
  const parsed = S.parseBackup(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.records, st.data.records); assert.equal(parsed.data.settings.defaultTimeZone, 'Europe/London');
  assert.match(S.exportFilename(Date.UTC(2026, 9, 26)), /^finish-lines-backup-2026-10-26\.json$/);
});

test('store: persists, reloads, and a failed write changes nothing', () => {
  const mem = new MemStorage();
  const st = new S.Store(mem);
  assert.equal(st.commit((d) => S.addRecord(d, input(), 1000)).ok, true);
  assert.equal(new S.Store(mem).data.records.length, 1);
  mem.fail = true;
  const res = st.commit((d) => S.addRecord(d, input({ title: 'two' }), 2000));
  assert.equal(res.ok, false); assert.equal(res.error, 'storage');
  assert.equal(st.data.records.length, 1);
  mem.fail = false;
  assert.equal(new S.Store(mem).data.records.length, 1);
});

test('store: corrupt data is never silently reset', () => {
  const mem = new MemStorage({ [S.STORAGE_KEY]: '{"schemaVersion":1,"records":[{"id":"a"}]}' });
  const st = new S.Store(mem);
  assert.ok(st.loadError); assert.equal(st.commit((d) => S.addRecord(d, input(), 1)).ok, false);
  assert.equal(mem.getItem(S.STORAGE_KEY), '{"schemaVersion":1,"records":[{"id":"a"}]}');   // untouched
  assert.equal(st.startFresh().ok, true);
  assert.ok(mem.getItem(S.STORAGE_KEY + ':unreadable-copy'));
  assert.equal(st.loadError, null);
  const junk = new S.Store(new MemStorage({ [S.STORAGE_KEY]: '{{{' }));
  assert.ok(junk.loadError);
});

test('active ordering by deadline including overdue; finished newest first', () => {
  const d = S.emptyData();
  const a = S.addRecord(d, input({ title: 'late', deadlineAt: 9000 }), 1);
  const b = S.addRecord(d, input({ title: 'overdue', deadlineAt: 500 }), 1);
  const c = S.addRecord(d, input({ title: 'mid', deadlineAt: 5000 }), 1);
  assert.deepEqual(S.activeRecords(d).map((r) => r.title), ['overdue', 'mid', 'late']);
  S.completeRecord(d, a.id, 100); S.completeRecord(d, c.id, 200);
  assert.deepEqual(S.finishedRecords(d).map((r) => r.title), ['mid', 'late']);
  void b;
});
