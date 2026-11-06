# LONGCUT: project guide for Claude

*The opposite of a shortcut.* A web app (PWA) for runners: pick a start, a finish (or a
loop) and a distance; LONGCUT plans a route of exactly that length over quiet roads and
exports it to a Garmin watch.

- **Live app:** https://4ztywgnz87-blip.github.io/Longcut/
- **Repo:** github.com/4ztywgnz87-blip/Longcut (public; GitHub Pages)
- Original plan and requirements (Dutch): `docs/plan.md`, `docs/antwoorden.md`, `docs/vragenlijst.md`

## The user

- Dauwe, runner from Nieuwkerken-Waas (Belgium), runs ~4×/week from a training plan,
  usually 15–40 km (up to 100). iPhone 15 + Garmin Forerunner 970.
- Main use case: "I must run 25 km today and I'm going to my parents (10 km away)":
  plan an A→B route of the training distance. Loops must work too.
- Can read code but barely write it. Hobby project for him, friends and family.
- **Talk to him in Dutch.** The app UI is **English**.
- He tests on his iPhone as a home-screen web app (and in Safari). He cares a lot about
  feel and polish (smooth panel, clean look). Show results, keep explanations short.
- Always test changes yourself (Playwright, phone-sized) before reporting; then commit,
  push to `main` and wait for the deploy to finish.

## Decisions already made (don't reopen without being asked)

- **Routing: BRouter public server** (brouter.de), no key, with our own running profile
  `brouter/longcut-run.brf` (uploaded per option combination). openrouteservice was
  tried and **removed** (200 req/day free limit, no quiet-road data in Belgium).
- **Address search:** Flemish address register (geo.api.vlaanderen.be, fast) + Photon
  (photon.komoot.io, slower, knows POIs) queried in parallel; reverse lookup tries Flanders first.
- **Map:** MapLibre GL + OpenFreeMap **dark** style. Attribution must stay (OSM licence);
  it is styled as a small muted (i).
- **Dark theme only.** A light theme was built and **removed** on request.
- **Garmin:** "Send to Garmin" **downloads a FIT course** (Garmin FIT SDK, lazy-loaded).
  Garmin Connect does not appear when sharing directly from a web page; user flow is
  download → open file → Share → Connect. GPX export link was removed (gpx.ts still
  holds `routeFileName`). Direct sync like Komoot needs Garmin's Courses API
  (business approval only), not feasible now.
- No accounts: favourites, recent places, saved routes and settings live in
  localStorage (`src/lib/storage.ts`). Re-adding the home-screen app can lose them.
- Accent colour volt `#D7FF3A` on near-black `#111113`; fonts Barlow / Barlow Condensed.
- App icon: route curving into an "L", end curling slightly up (`public/favicon.svg`,
  PNGs generated from it).
- Status bar: no `black-translucent` meta (iOS 26 gradient + short-viewport bug). The
  top fade is our own gradient (`.app::before`).

## How the planner works (`src/core/planner.ts`)

1. Shortest route A→B first: if longer than the target (+5%) → "too-short" message
   with a "Use N km" button; if it already fits → return it.
2. Via points on an **ellipse with foci A and B** (2- and 3-via templates, left/right);
   loops use a square-ish shape through A. Each template's size is fitted
   (scale/interpolate) until length is within **0…+500 m** (`lengthRules`: ideal 0…+min(500 m, 5%);
   accepted −min(1.5 km, 5%) … +max(500 m, min(1 km, 5%))). Dauwe wants never shorter, a little
   longer is fine (walking out), 1 km longer is too much.
3. Stuck or "jumpy" lengths (via flips across a railway/motorway) → shift the via
   angles (`variant`). Extra **rounds** of fresh variants until 3 good, different
   routes (similarity ≤ 70%). **Time budget 30 s**; returns the best found so far.
4. Out-and-back spurs are removed (`removeSpurs`). Score (lower = better): km too long
   (beyond +500 m) ×0.5, km short ×0.25 (+ its run-twice share), run-twice ×4, busy roads ×3,
   noisy (next to motorways) ×1.5, unpaved ×0.5 (only when "Mostly paved").
   Routes that are a little short get an **out-and-back at the finish** (`padToTarget`: past the
   finish and back via one extra BRouter call; fallback: back along the route) → `extraM`,
   shown as "Includes N m out and back at the finish".
5. "New routes" = `variation + 1` (shifts the via angles). Each set is kept: results show
   "Earlier / Set n of m / Later". `PlanRequest.signal` lets the Cancel button stop a search.

BRouter client (`src/core/brouter.ts`): max 4 parallel, 120 ms spacing, in-session
response cache, on 403 "retry later" → short retries (1.5–4.5 s) and 2 parallel for a
minute; throws `RouterError(busy)` → app shows a neutral "taking longer than usual".

Running profile options: `avoid_unpaved` (Surface), `prefer_green` (Scenery),
`prefer_lit` (Light: "Lit streets"; lit=yes data is sparse, mostly avoids dark tracks).
Costs: busy roads by type + `estimated_traffic_class`, `estimated_noise_class` penalty.

## UI (`src/App.tsx`, `src/styles.css`)

- Full-screen map; floating LONGCUT pill + "Saved" pill; my-location button (blue dot
  + accuracy circle, watchPosition) that sits 12 px above the panel and moves with it.
- **Bottom sheet** (`src/components/useBottomSheet.ts`): one panel that slides with the
  finger between open and collapsed (collapsed shows only the top strip marked
  `data-peek`: summary row on edit screen, route tabs on results). Rubber-band
  resistance past either end, bouncy spring back, flick detection (projected position).
  Drag moves the DOM directly (no React re-render per move). Panel extends 120 px below
  the screen. Phones only; desktop shows a left panel.
- Map re-fits when routes/points change or the panel resizes **only if a route or both
  start and finish are set** (never with a single point → no jumping).
- Edit panel: Start / Finish (search, current location, pick on map, favourites ★,
  recent places), loop toggle, distance stepper, collapsible **Options** row
  (Surface / Scenery / Light segmented controls).
- Results and saved routes share one view (`routeBody` in App.tsx): big km, stats (Busy /
  Unpaved / Twice / Climb, tap one for an explanation), elevation sparkline, Send to Garmin,
  Maps (Google/Apple approximation), New routes; results add Save, saved routes add Delete
  (with confirm). Saved list: swipe a row left to delete (`SwipeRow`). Saved routes store
  stats and road/unpaved runs (`toRuns`); older ones lack them. Loops are named "Loop · street".
- Distance − / +: hold to repeat (`useHold`). Loop toggle shows a track icon + "LOOP".
- Messages (toast) belong to the screen they were shown on.
- Logo: Barlow Condensed 900 italic, tight. Fonts are self-hosted (@fontsource, latin only).
  Map: active route volt, alternatives grey, busy stretches red, unpaved dashed.
- Glass panels: `rgba(17,17,19,0.3)` + `blur(6px)`. UI text is not selectable (inputs are).
- Planning screen: animated route drawing + step text.

## Commands

```bash
npm run dev                 # local dev server
npm run build               # type-check + build (must pass before pushing)
npx vitest run              # unit tests (src/core/planner.test.ts)
npx vite preview --port 4173 --host 127.0.0.1   # serve the build for Playwright
node scripts/e2e.cjs [url]  # phone-sized end-to-end test (screens in eval/out/e2e)
```

Scripts that call real services need the proxy env in this sandbox:
`NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_NO_WARNINGS=1 npx tsx scripts/…`
- `scripts/eval.ts`: 30 real trips → `eval/out/results.json` (cached in `.cache/`);
  `scripts/screenshots.ts` + `scripts/report.ts` build the HTML test report.
- `scripts/burst.ts`: several plans back to back (speed/rate-limit check).
- `scripts/why.ts`: debug trace of every candidate for one trip.
- `scripts/fit-check.ts`: writes and decodes a FIT course.
Be gentle with the public BRouter server (it rate-limits under load).

Playwright: `require('playwright')` works globally; launch Chromium with
`proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' }`.
`window.__longcutMap` exposes the map for tests.

## Deploy

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) runs tests, builds and
publishes to GitHub Pages (~1–2 min). Check with
`gh api repos/4ztywgnz87-blip/Longcut/actions/runs --jq '.workflow_runs[0]'`.
`vite.config.ts` uses `base: './'` and bundles the MapLibre worker (`?worker&url`).
MapView is lazy-loaded (panel shows before the map code). `public/sw.js` is a small service
worker (production only): page network-first, `/assets/` cache-first, OpenFreeMap style/fonts
stale-while-revalidate. Bump `VERSION` in sw.js if caching rules change.

## Ideas not done yet (only if asked)

Backup/restore of saved routes; time-based distance (pace × time) and run-time estimate;
water/toilets along long routes; "not via here" (exclude a stretch); intermediate stops;
drag to edit a route; wind and sunset hints; plan a week ahead; cycling profile; Dutch
UI; share a route link; second routing server as fallback.
