// Pure time, timezone and road math. No DOM, no storage, no clocks of its own.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const SIX_HOURS = 6 * HOUR;

/** Where the checkered flag sits along the road (0..1). The rest is overtime runway. */
export const FLAG_POSITION = 0.93;

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pad = (n, w = 2) => String(n).padStart(w, '0');

/* ---------- Time zones ---------- */

const dtfCache = new Map();
function partsFormatter(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric',
      day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 80) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(ms, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  out.hour %= 24; // some engines report midnight as 24
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}

/** UTC offset (ms, east positive) of a zone at an instant. */
export function offsetAt(ms, tz) {
  const p = zonedParts(ms, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * Convert a wall-clock time in a zone to instants.
 * kind 'ok' → exactly one instant; 'ambiguous' → two (DST fall-back, earlier first);
 * 'gap' → none (DST spring-forward skipped this time).
 */
export function localToInstants(parts, tz) {
  const { year, month, day, hour, minute, second } = parts;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const found = new Set();
  for (const o of new Set([offsetAt(wall - DAY, tz), offsetAt(wall + DAY, tz)])) {
    const t = wall - o;
    if (offsetAt(t, tz) === o) found.add(t);
  }
  const instants = [...found].sort((a, b) => a - b);
  const kind = instants.length === 1 ? 'ok' : instants.length === 0 ? 'gap' : 'ambiguous';
  return { kind, instants };
}

/* ---------- Input parsing ---------- */

export function parseDateInput(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1971 || year > 9999) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function parseTimeInput(s) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  if (!m) return null;
  const [hour, minute, second] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

export function toDateInput(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}
export function toTimeInput(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/* ---------- Formatting ---------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m) => MONTHS[m - 1];

export function zoneAbbrev(ms, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms));
    return (p.find((x) => x.type === 'timeZoneName') || {}).value || tz;
  } catch { return tz; }
}

function clock12(p, seconds = true) {
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${pad(p.minute)}${seconds ? ':' + pad(p.second) : ''} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

/** "Oct 25 • 11:59:59 PM EDT" (year added when it is not the current year). */
export function formatDeadline(ms, tz, now = ms) {
  const p = zonedParts(ms, tz);
  const cur = zonedParts(now, tz).year;
  const date = `${MONTHS[p.month - 1].slice(0, 3)} ${p.day}${p.year !== cur ? ', ' + p.year : ''}`;
  return `${date} • ${clock12(p)} ${zoneAbbrev(ms, tz)}`;
}

/** "DUE OCTOBER 25" */
export function formatDueDay(ms, tz, now = ms) {
  const p = zonedParts(ms, tz);
  const cur = zonedParts(now, tz).year;
  return `${MONTHS[p.month - 1]} ${p.day}${p.year !== cur ? ', ' + p.year : ''}`;
}

/** "Oct 26, 2026 • 12:42:08 AM EDT" */
export function formatFull(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${MONTHS[p.month - 1].slice(0, 3)} ${p.day}, ${p.year} • ${clock12(p)} ${zoneAbbrev(ms, tz)}`;
}

/** "Oct 26, 2026 • 12:42 AM" */
export function formatShort(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${MONTHS[p.month - 1].slice(0, 3)} ${p.day}, ${p.year} • ${clock12(p, false)}`;
}

/** Counter text for whole seconds: "6d 23:17:51" / "+00:42:09". */
export function formatClock(totalSeconds, overtime = false) {
  const s = Math.max(0, Math.floor(totalSeconds)) || 0; // `|| 0` removes -0
  const days = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${overtime ? '+' : ''}${days ? days + 'd ' : ''}${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function unit(n, name) { return `${n} ${name}${n === 1 ? '' : 's'}`; }

/** Spoken-style duration, two largest units: "1 day 2 hours", "42 minutes". */
export function formatDuration(ms) {
  let s = Math.floor(Math.abs(ms) / 1000);
  if (s < 60) return unit(s, 'second');
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  const bits = [];
  if (d) bits.push(unit(d, 'day'));
  if (h) bits.push(unit(h, 'hour'));
  if (m) bits.push(unit(m, 'minute'));
  if (!d && !h && s) bits.push(unit(s, 'second'));
  return bits.slice(0, 2).join(' ');
}

/** Signed difference text against a deadline: diff = completedAt - deadlineAt. */
export function describeResult(diffMs) {
  const secs = diffMs < 0 ? -Math.floor(-diffMs / 1000) : Math.floor(diffMs / 1000);
  if (secs === 0) return { late: false, onTime: true, text: 'Exactly on the finish line', signed: '+00:00:00' };
  const late = secs > 0;
  const body = formatClock(Math.abs(secs));
  return {
    late, onTime: false,
    text: `${formatDuration(diffMs)} ${late ? 'past' : 'before'} finish line`,
    signed: `${late ? '+' : '-'}${body}`,
  };
}

/** Month/year range subtitle for a set of instants, or '' when there are none. */
export function formatRange(instants, tz) {
  if (!instants.length) return '';
  const a = zonedParts(Math.min(...instants), tz);
  const b = zonedParts(Math.max(...instants), tz);
  const A = MONTHS[a.month - 1].toUpperCase();
  const B = MONTHS[b.month - 1].toUpperCase();
  if (a.year === b.year && a.month === b.month) return `${A} ${a.year}`;
  if (a.year === b.year) return `${A}–${B} ${a.year}`;
  return `${A} ${a.year}–${B} ${b.year}`;
}

/* ---------- Status and road ---------- */

/** State of an unfinished record at `now`. */
export function timerStatus(deadlineAt, now) {
  const delta = deadlineAt - now;
  if (delta > SIX_HOURS) return { state: 'green', overtime: false, seconds: Math.ceil(delta / 1000), delta };
  if (delta > 0) return { state: 'yellow', overtime: false, seconds: Math.ceil(delta / 1000), delta };
  return { state: 'red', overtime: true, seconds: Math.floor(-delta / 1000), delta };
}

/**
 * Road geometry at instant `at` (now for active records, completedAt for finished).
 * position: 0..1 along the whole road including the post-flag overtime runway.
 */
export function roadGeometry(startAt, deadlineAt, at) {
  const duration = deadlineAt - startAt;
  let fraction;
  if (!(duration > 0)) fraction = at >= deadlineAt ? 1 : 0; // zero/negative span: no division
  else fraction = clamp((at - startAt) / duration, 0, 1);
  const overtime = at > deadlineAt ? clamp((at - deadlineAt) / SIX_HOURS, 0, 1) : 0;
  const position = FLAG_POSITION * fraction + (1 - FLAG_POSITION) * overtime;
  return { fraction, overtime, position: clamp(position, 0, 1) };
}

/** Coarse text for screen readers; changes at most once a minute. */
export function coarseSpeech(status) {
  const mins = Math.floor(status.seconds / 60);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const bits = [];
  if (d) bits.push(unit(d, 'day'));
  if (h) bits.push(unit(h, 'hour'));
  if (m || !bits.length) bits.push(unit(m, 'minute'));
  return `${bits.join(' ')} ${status.overtime ? 'past the finish line' : 'left'}`;
}

export const COMMON_ZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
  'America/Sao_Paulo', 'UTC', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Athens', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
];

export function zoneOptions(extra = []) {
  let all = [];
  try { if (Intl.supportedValuesOf) all = Intl.supportedValuesOf('timeZone'); } catch { /* ignore */ }
  const set = new Set([...COMMON_ZONES, ...extra.filter(isValidTimeZone), ...all]);
  return [...set];
}
