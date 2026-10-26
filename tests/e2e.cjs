// End-to-end checks in Chromium against the repo served under /finish-lines/.
// Run: node tests/e2e.cjs   (needs Playwright; see README). Writes screenshots to docs/design/screenshots/.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SHOTS = path.join(__dirname, '..', 'docs', 'design', 'screenshots');
const T0 = Date.parse('2026-10-26T16:00:00Z'); // 12:00:00 EDT
let passed = 0;
const step = async (name, fn) => {
  try { await fn(); passed++; console.log('ok  -', name); } catch (e) { console.error('FAIL -', name, '\n', e); process.exitCode = 1; }
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { start } = await import('./serve.mjs');
  const srv = await start(8124);
  const base = 'http://127.0.0.1:8124/finish-lines/';
  const browser = await chromium.launch();
  const errors = [];

  async function open(opts = {}, url = base + '?demo=1') {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install({ time: T0 });
    await page.goto(url);
    await page.waitForSelector('#main .view');
    return { ctx, page };
  }
  const shot = async (page, name, full = false) => { await page.waitForTimeout(450); return page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full }); };
  const nyTime = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour12: false });

  async function addLine(page, { title, time, date = '2026-10-26', alert = true, desc = '' }) {
    await page.click('a.btn-add');
    await page.fill('#f-title', title);
    if (desc) await page.fill('#f-desc', desc);
    await page.fill('#f-date', date);
    await page.fill('#f-time', time);
    if (alert !== (await page.isChecked('#f-alert'))) await page.click('#f-alert');
    await page.click('button.save');
  }
  const addIn = async (page, title, seconds, extra = {}) => {
    const now = await page.evaluate(() => Date.now());
    return addLine(page, { title, time: nyTime(Math.ceil((now + seconds * 1000) / 1000) * 1000), ...extra });
  };

  /* ---------- empty state + layout ---------- */
  await step('empty state, brand, no horizontal scroll at 320/390/430', async () => {
    for (const w of [320, 390, 430]) {
      const { ctx, page } = await open({ viewport: { width: w, height: 800 } });
      assert.equal(await page.textContent('h1'), 'FINISH LINES');
      assert.ok(await page.isVisible('text=Set your first finish line'));
      assert.ok(await page.isVisible('a.btn-add'));
      assert.equal(await page.locator('.range').count(), 0, 'no hard-coded date range');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${w}`);
      if (w === 390) await shot(page, '01-empty');
      await ctx.close();
    }
  });

  /* ---------- form ---------- */
  const { ctx, page } = await open();

  await step('form: no yellow box, correct alert wording, defaults', async () => {
    await page.click('a.btn-add');
    assert.equal(await page.inputValue('#f-time'), '23:59:59');
    assert.equal(await page.inputValue('#f-zone'), 'America/New_York');
    const text = await page.textContent('.form');
    assert.ok(text.includes('Finish Line Alert') && text.includes('Play an alarm while this app is open.'));
    assert.ok(!/Last 6 hours|Deadline Alert|Notify me/.test(text));
    await shot(page, '02-form');
  });

  await step('form: empty title rejected, input kept; cancel changes nothing', async () => {
    await page.fill('#f-desc', 'keep me');
    await page.click('button.save');
    assert.ok(await page.isVisible('#e-title'));
    assert.equal(await page.inputValue('#f-desc'), 'keep me');
    await page.click('button.back');
    await page.waitForSelector('text=Set your first finish line');
    assert.equal(await page.evaluate(() => __FL.store.data.records.length), 0);
  });

  await step('form: nonexistent DST time is rejected (2027-03-14 02:30 ET)', async () => {
    await page.click('a.btn-add');
    await page.fill('#f-title', 'DST');
    await page.fill('#f-date', '2027-03-14'); await page.fill('#f-time', '02:30:00');
    await page.click('button.save');
    assert.match(await page.textContent('#e-time'), /doesn.t exist/);
    await page.click('button.back');
    await page.waitForSelector('.empty');
  });

  await step('form: ambiguous DST time asks which occurrence (2026-11-01 01:30 ET)', async () => {
    await page.click('a.btn-add');
    await page.fill('#f-title', 'Twice'); await page.fill('#f-date', '2026-11-01'); await page.fill('#f-time', '01:30:00');
    await page.click('button.save');
    assert.equal(await page.locator('.ambig input[type=radio]').count(), 2);
    await page.locator('.ambig input[type=radio]').nth(1).check();
    await page.click('button.save');
    await page.waitForSelector('.line');
    const rec = await page.evaluate(() => __FL.store.data.records[0]);
    assert.equal(new Date(rec.deadlineAt).toISOString(), '2026-11-01T06:30:00.000Z');
    await page.click('.line a.stretch'); await page.click('button.danger'); await page.click('.sheet button.danger');
    await page.waitForSelector('text=Set your first finish line');
  });

  /* ---------- timers + alert ---------- */
  await step('add short finish line; persists across reload; startAt = creation', async () => {
    await addIn(page, 'Short one', 60, { desc: 'Ship <b>it</b>' });
    await page.waitForSelector('.line');
    assert.match(await page.textContent('.count'), /^00:0[01]:\d\d$/);
    assert.equal(await page.textContent('.clock .count-label'), 'TIME LEFT · FINAL 6 HOURS');
    const rec = await page.evaluate(() => __FL.store.data.records[0]);
    assert.ok(rec.startAt >= T0 && rec.startAt < T0 + 30000);
    assert.ok(rec.deadlineAt - rec.startAt >= 40000 && rec.deadlineAt - rec.startAt <= 61000);
    await page.reload(); await page.waitForSelector('.line');
    assert.equal(await page.locator('.line').count(), 1);
    await shot(page, '03-yellow');
  });

  await step('alert fires once in-session, sheet shown, overtime continues, refresh does not repeat', async () => {
    assert.equal(await page.locator('.sound-chip').count(), 0, 'no lock warning');
    await page.click('h1');                          // any tap unlocks sound quietly
    await page.waitForFunction(() => __FL.audio.status === 'ready');
    assert.equal(await page.evaluate(() => __FL.audio.status), 'ready');
    await page.clock.runFor(61_000);
    await page.waitForSelector('.sheet.alarm');
    assert.match(await page.textContent('.sheet.alarm .big-count'), /^\+\d\d:\d\d:\d\d$/);
    const st = await page.evaluate(() => __FL.audio.stats);
    assert.equal(st.alarmsStarted, 1); assert.ok(st.chimes >= 1, 'chime played');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Dismiss alarm');
    await shot(page, '04-alarm');
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => !!document.activeElement.closest('.sheet')), 'focus trapped'); }
    await page.clock.runFor(30_000);
    const chimes = await page.evaluate(() => __FL.audio.stats.chimes);
    await page.clock.runFor(10_000);
    assert.equal(await page.evaluate(() => __FL.audio.stats.chimes), chimes, 'sound bounded to 20 s');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.sheet').count(), 0);
    assert.equal(await page.evaluate(() => __FL.store.data.records[0].alertState.status), 'acknowledged');
    assert.match(await page.textContent('.count'), /^\+00:\d\d:\d\d$/);
    assert.equal(await page.textContent('.clock .count-label'), 'PAST FINISH LINE');
    await page.reload(); await page.waitForSelector('.line');
    await page.clock.runFor(3000);
    assert.equal(await page.locator('.sheet').count(), 0, 'no repeat after refresh');
    await shot(page, '05-overdue');
  });

  await step('suspension: accurate overtime, quiet notice, no alarm replay', async () => {
    await addIn(page, 'Missed me', 300);
    await page.waitForSelector('.line >> nth=1');
    const startAlarms = await page.evaluate(() => __FL.audio.stats.alarmsStarted);
    await page.clock.fastForward(30 * 60_000); // simulates a suspended page
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForSelector('.banner:has-text("Missed me")');
    assert.equal(await page.locator('.sheet').count(), 0);
    assert.equal(await page.evaluate(() => __FL.audio.stats.alarmsStarted), startAlarms);
    const txt = await page.locator('.line', { hasText: 'Missed me' }).locator('.count').textContent();
    assert.match(txt, /^\+00:2[0-9]:\d\d$/, txt);
    await page.click('.banner button');
    assert.equal(await page.locator('.banner:has-text("Missed me")').count(), 0);
  });

  await step('ordering: unfinished by deadline ascending incl. overdue', async () => {
    assert.deepEqual(await page.locator('.line .title').allTextContents(), ['Short one', 'Missed me']);
  });

  await step('two simultaneous deadlines never overlap; completion stops sound; queued one rings next', async () => {
    const now = await page.evaluate(() => Date.now());
    const hhmm = nyTime(Math.ceil((now + 120_000) / 60_000) * 60_000);
    await addLine(page, { title: 'Twin A', time: hhmm }); await page.waitForSelector('.line >> nth=2');
    await addLine(page, { title: 'Twin B', time: hhmm }); await page.waitForSelector('.line >> nth=3');
    const before = await page.evaluate(() => __FL.audio.stats.alarmsStarted);
    await page.clock.runFor(190_000);
    await page.waitForSelector('.sheet.alarm');
    assert.equal(await page.locator('.sheet').count(), 1);
    assert.equal(await page.evaluate(() => __FL.audio.stats.alarmsStarted), before + 1, 'only one alarm active');
    assert.equal(await page.evaluate(() => __FL.queue.length), 1, 'second one queued');
    const first = await page.textContent('.sheet .sheet-project');
    await page.click('.sheet button[aria-label^="Mark finished"]');
    await page.waitForSelector('.sheet.done');
    assert.equal(await page.evaluate(() => __FL.audio.alarming), false, 'sound stopped on completion');
    await shot(page, '06-finished-sheet');
    await page.click('.sheet.done >> text=Back to road');
    await page.waitForSelector('.sheet.alarm');
    assert.notEqual(await page.textContent('.sheet .sheet-project'), first);
    assert.equal(await page.evaluate(() => __FL.audio.stats.alarmsStarted), before + 2);
    await page.click('.sheet >> text=Dismiss alarm');
  });

  await step('finished list, saved result, undo restores without retroactive alarm', async () => {
    await page.click('a.tab >> text=Finished');
    await page.waitForSelector('.done-row');
    assert.equal(await page.locator('.done-row').count(), 1);
    assert.match(await page.textContent('.done-result'), /past finish line|before finish line/);
    await shot(page, '07-finished-list');
    await page.click('.done-row');
    await page.waitForSelector('text=Time difference');
    await shot(page, '08-saved-result', true);
    const before = await page.evaluate(() => __FL.audio.stats.alarmsStarted);
    await page.click('text=Undo completion');
    await page.waitForSelector('button[aria-label^="Mark finished"]');
    await page.clock.runFor(5000);
    assert.equal(await page.locator('.sheet').count(), 0);
    assert.equal(await page.evaluate(() => __FL.audio.stats.alarmsStarted), before);
    assert.equal(await page.evaluate(() => __FL.store.data.records.filter((r) => r.completedAt).length), 0);
  });

  /* ---------- edit / delete ---------- */
  await step('edit: history recorded, start/original unchanged; cancel leaves data alone', async () => {
    await page.goto(base + '?demo=1#/'); await page.waitForSelector('.line');
    const id = await page.evaluate(() => __FL.store.data.records[0].id);
    const before = await page.evaluate(() => JSON.stringify(__FL.store.data.records));
    await page.goto(base + '?demo=1#/edit/' + id); await page.waitForSelector('form.form');
    await page.fill('#f-title', 'zzz'); await page.click('button.back');
    assert.equal(await page.evaluate(() => JSON.stringify(__FL.store.data.records)), before);
    await page.goto(base + '?demo=1#/edit/' + id); await page.waitForSelector('form.form');
    await page.fill('#f-date', '2026-12-01'); await page.fill('#f-time', '09:00:00'); await page.click('button.save');
    await page.waitForSelector('.detail');
    const r = await page.evaluate((i) => __FL.store.data.records.find((x) => x.id === i), id);
    const old = JSON.parse(before).find((x) => x.id === id);
    assert.equal(r.deadlineHistory.length, 1); assert.equal(r.deadlineHistory[0].to, Date.parse('2026-12-01T14:00:00Z'));
    assert.equal(r.originalDeadlineAt, old.originalDeadlineAt); assert.equal(r.startAt, old.startAt); assert.equal(r.createdAt, old.createdAt);
    assert.equal(r.alertState.status, 'pending', 'new revision re-armed');
    assert.ok(await page.isVisible('text=Deadline history'));
    await shot(page, '09-detail', true);
  });

  await step('delete asks by name and removes', async () => {
    const n = await page.evaluate(() => __FL.store.data.records.length);
    await page.click('button.danger');
    assert.match(await page.textContent('.sheet'), /“.+”/);
    await page.click('.sheet >> text=Cancel');
    assert.equal(await page.evaluate(() => __FL.store.data.records.length), n);
    await page.click('button.danger'); await page.click('.sheet button.danger');
    await page.waitForSelector('.road-view');
    assert.equal(await page.evaluate(() => __FL.store.data.records.length), n - 1);
  });

  /* ---------- settings + backup ---------- */
  await step('settings, backup export/import round trip, invalid/oversized import rejected', async () => {
    await page.click('a.tab >> text=Settings');
    await page.waitForSelector('.settings-view');
    assert.ok(await page.isVisible('text=Closed-app alarms aren’t supported in this version.'));
    await shot(page, '10-settings', true);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export backup')]);
    assert.match(dl.suggestedFilename(), /^finish-lines-backup-\d{4}-\d\d-\d\d\.json$/);
    const file = path.join(os.tmpdir(), 'fl-backup.json'); await dl.saveAs(file);
    const before = await page.evaluate(() => JSON.stringify(__FL.store.data));
    const count = await page.evaluate(() => __FL.store.data.records.length);
    fs.writeFileSync(file + '.bad.json', '{"schemaVersion":1,"records":[{"id":"x"}]}');
    await page.setInputFiles('#s-file', file + '.bad.json');
    await page.waitForFunction(() => /Import failed/.test(document.querySelector('.toast').textContent));
    fs.writeFileSync(file + '.big.json', ' '.repeat(2 * 1024 * 1024 + 10));
    await page.setInputFiles('#s-file', file + '.big.json');
    await page.waitForFunction(() => /too large/.test(document.querySelector('.toast').textContent));
    assert.equal(await page.evaluate(() => JSON.stringify(__FL.store.data)), before);
    await page.evaluate(() => __FL.store.commit((d) => { d.records.length = 0; }));
    await page.setInputFiles('#s-file', file);
    await page.waitForSelector('.sheet.confirm');
    assert.match(await page.textContent('.sheet'), new RegExp(`${count} finish line`));
    await shot(page, '11-import-confirm');
    await page.click('.sheet >> text=Replace with backup');
    await page.waitForSelector('.road-view');
    assert.equal(await page.evaluate(() => __FL.store.data.records.length), count);
  });

  await step('storage write failure is surfaced and keeps form input', async () => {
    const n = await page.evaluate(() => __FL.store.data.records.length);
    await page.click('a.btn-add');
    await page.fill('#f-title', 'Will not save'); await page.fill('#f-date', '2026-12-25');
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    await page.click('button.save');
    assert.match(await page.textContent('.form-error'), /Could not save/);
    assert.equal(await page.inputValue('#f-title'), 'Will not save');
    assert.equal(await page.evaluate(() => __FL.store.data.records.length), n);
  });

  await step('audio disabled/blocked is represented honestly; app still works', async () => {
    await page.goto(base + '?demo=1#/settings'); await page.reload(); await page.waitForSelector('.settings-view');
    await page.click('#s-sound');
    assert.match(await page.textContent('.status-line'), /Sound is off/);
    await page.click('#s-sound');
    await page.click('text=Test sound');
    assert.match(await page.textContent('.status-line'), /Sound enabled for this session|not unlocked|problem|blocked/i);
  });

  /* ---------- layout ---------- */
  await step('long title wraps; small/landscape/large-text have no overflow; touch targets ≥ 44px', async () => {
    await page.goto(base + '?demo=1#/'); await page.waitForSelector('.line');
    await page.evaluate(() => __FL.store.commit((d) => { d.records[0].title = 'Supercalifragilisticexpialidocious_unbroken_title ' + 'word '.repeat(10); }));
    for (const vp of [{ width: 320, height: 700 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(vp);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${vp.width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const el of await page.locator('button, a.btn, a.btn-add, .tab, .bell').all()) {
      if (!(await el.isVisible())) continue;
      const bb = await el.boundingBox(); assert.ok(bb.height >= 43.5 && bb.width >= 43.5, 'touch target ' + (await el.textContent()));
    }
    await page.addStyleTag({ content: 'html{font-size:150% !important} body{font-size:26px !important}' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'large text overflow');
  });

  await ctx.close();

  /* ---------- offline + base path ---------- */
  await step('manifest, icons, service worker; works offline under /finish-lines/', async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    const bad = []; p.on('response', (r) => { if (r.status() >= 400) bad.push(r.url()); });
    await p.goto(base);
    await p.waitForSelector('.view');
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload(); await p.waitForSelector('.view');
    await p.waitForFunction(() => !!navigator.serviceWorker.controller);
    const man = await (await p.request.get(base + 'manifest.webmanifest')).json();
    assert.equal(man.short_name, 'Finish Lines'); assert.equal(man.start_url, './'); assert.equal(man.scope, './');
    for (const i of man.icons) assert.equal((await p.request.get(base + i.src)).status(), 200);
    assert.equal((await p.request.get(base + 'assets/icons/apple-touch-icon.png')).status(), 200);
    await p.goto(base + '#/settings'); await p.waitForSelector('.settings-view');
    await c.setOffline(true);
    await p.reload(); await p.waitForSelector('.settings-view');
    assert.equal(await p.textContent('h1'), 'SETTINGS');
    await p.goto(base + '#/'); await p.reload(); await p.waitForSelector('.road-view');
    const fontOk = await p.evaluate(async () => { await document.fonts.ready; return document.fonts.check('700 20px "Barlow Condensed"'); });
    assert.ok(fontOk, 'local font loads offline');
    assert.deepEqual(bad, [], 'no failing requests');
    await c.setOffline(false); await c.close();
  });

  await browser.close(); srv.close();
  console.log(`\n${passed} steps passed; page errors: ${errors.length}`);
  if (errors.length) { console.error(errors); process.exitCode = 1; }
})();
