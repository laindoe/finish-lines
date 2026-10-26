# Finish Lines

Ten Grand + Heart Direction. A static, offline-capable web app for iPhone Safari (and any modern browser) where every project gets its own billboard and its own road. A glowing thermal orb travels left to right as the deadline approaches; past the checkered flag the road turns red and the counter keeps counting overtime.

Plain HTML, CSS and ES modules. No backend, login, API keys, analytics or build step.

## Run locally

```sh
node tests/serve.mjs 8080          # or: npm run serve
# open http://127.0.0.1:8080/finish-lines/
```

The dev server mounts the repo at `/finish-lines/`, exactly like a GitHub Pages project site, so base-path bugs show up locally. (`python3 -m http.server` also works but serves at `/`.) Everything uses relative paths and hash routes (`#/`, `#/finished`, `#/settings`, `#/new`, `#/edit/<id>`, `#/line/<id>`), so refreshing never 404s.

## Deploy to GitHub Pages

The app is the repository root; there is nothing to build.

1. Merge to your default branch.
2. GitHub → **Settings → Pages → Build and deployment → Deploy from a branch**.
3. Branch: your default branch, folder **/ (root)**. Save.
4. The site appears at `https://<owner>.github.io/finish-lines/`.

`.nojekyll` is included so files are served as-is.

## Install on iPhone

1. Open the Pages URL in **Safari**.
2. Tap **Share → Add to Home Screen → Add**. It is named *Finish Lines*.
3. Launch from the Home Screen. After one successful online visit the app shell loads offline.

## Data, backups, privacy

- Data lives in this browser's `localStorage` under `finish-lines:v1` (schema-versioned). Nothing is sent anywhere.
- It is **local to this browser installation**. Clearing website data, or moving between Safari and the Home Screen app (separate storage on iOS), can make it unavailable. There is no sync.
- **Settings → Export backup** writes `finish-lines-backup-YYYY-MM-DD.json`. **Import backup** validates the file (≤ 2 MB), shows how many finish lines it contains, offers to export current data first, and only then replaces. An invalid file changes nothing.
- If stored data can't be parsed the app does **not** reset it: it shows a banner, blocks writes, and lets you download the raw text or start fresh (a copy is kept under `finish-lines:v1:unreadable-copy`).
- If a save fails (storage full/blocked), the change is not applied, an error is shown, and form input is kept.

## Alarm limitations (important)

This is a static page. **No alarm or push notification is promised while Safari is suspended, the app is closed, or the phone is locked.** The service worker only caches the app shell; it is not a scheduler.

- A *Finish Line Alert* plays a short Web Audio chime (repeating, max 20 s) **only while the app is open and visible**, and only after sound has been unlocked by a tap (Enable sound / Test sound / turning the alert on / saving with the alert on). After a reload sound is locked again until your first tap anywhere in the app (it unlocks quietly); Settings states the real status.
- Each alert fires once per record + deadline revision. Refreshing doesn't repeat it; editing the deadline cancels the old event; past deadlines never ring retroactively; simultaneous deadlines queue instead of overlapping.
- If the deadline passed while the app was away, you get a quiet banner once and the counter shows accurate overtime.
- iPhone's Ring/Silent switch silences Web Audio. Keep the screen awake.
- Web Push for Home Screen apps needs external infrastructure and is not part of this version.

## Behavior reference

- Colors (always with text labels): green > 6 h left; yellow ≤ 6 h (*TIME LEFT · FINAL 6 HOURS*); red at/after the deadline (*PAST FINISH LINE*). Threshold is fixed.
- Road fill = clamp((now − startAt) / (deadline − startAt)); time, not task progress. `startAt` is the creation instant. After the flag, overtime maps into a bounded runway (6 h) so the orb never leaves the screen while the counter keeps going.
- Deadlines are entered in an IANA time zone (default America/New_York, editable) and stored as UTC instants plus the zone. DST gaps ("02:30 on spring-forward day") are rejected; DST overlaps ask which occurrence you mean.
- Finishing freezes `completedAt` and the early/late result; Undo restores the finish line without changing its start or deadline and without a retroactive alarm.

## Testing

```sh
npm install            # dev only (Playwright); a global Playwright also works
npm run test:unit      # pure time/zone/road/state logic (node:test)
npm run test:e2e       # Chromium end-to-end under /finish-lines/, incl. offline; refreshes docs/design/screenshots/
```

**Demo / short-deadline testing.** Normal storage is never seeded. Append `?demo=1` for an isolated, empty store (`finish-lines:demo:v1`) or `?demo=seed` for sample records relative to *now* (overdue, yellow, green). A banner marks demo mode. To test an alarm in the real app, add a finish line due in about a minute, keep the screen on, and tap **Test sound** first.

## Real-iPhone checklist (not covered by desktop automation)

- [ ] Safari launch; Add to Home Screen; Home Screen launch; offline launch in Airplane mode
- [ ] Date and time pickers (check whether the time wheel keeps seconds), keyboard doesn't hide Save
- [ ] Tap Test sound → chime heard; Silent switch behavior
- [ ] Alert while visible rings once and shows the sheet; Dismiss, then Mark finished
- [ ] Lock phone past a deadline, unlock: overtime correct, quiet notice, no replay
- [ ] Export backup (file saved/shared) and Import it back; safe-area insets, landscape, larger Dynamic Type
- [ ] Delete and reinstall the Home Screen app: confirm data is gone and import restores it

## Layout

```
index.html  manifest.webmanifest  sw.js  .nojekyll
css/styles.css
js/{app,state,time,audio,views,dom}.js
assets/{fonts,icons}/        Barlow + Barlow Condensed (SIL OFL 1.1, assets/fonts/OFL-Barlow.txt)
tests/                       unit, e2e, dev server
docs/design/                 reference mockups + generated screenshots
```

Updating: bump `VERSION` in `sw.js` (and the file list if assets change). Existing users see "Reload to update"; the new version never replaces files under a running page, and only this app's old caches are removed.
