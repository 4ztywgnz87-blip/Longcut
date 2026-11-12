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
- **How he likes to work** (learned over many sessions):
  - Judge visual work as a critical graphic/UI designer *and* as a plain user; he asks for
    "flawless, smooth" and notices small jumps. Iterate yourself (look → fix → look again,
    up to ~5 rounds) before reporting; measure objectively where you can (see "Verifying").
  - Quality of routes beats speed: never trade route quality for fewer requests without
    measuring (`scripts/quality.ts`).
  - Reports: outcome first, in Dutch, short, honest caveats (what you could not test, e.g.
    Safari). Send images/videos (SendUserFile) for visual changes; MP4 (h264) plays on iPhone.
  - Proposes ideas loosely ("fade it or something, or a better idea"): pick the best
    solution, explain the why in one or two sentences.
  - Warn him before anything that can lose his localStorage data (re-adding the
    home-screen app does).

## Decisions already made (don't reopen without being asked)

- **Routing: BRouter public server** (brouter.de), no key, with our own running profile
  `brouter/longcut-run.brf` (uploaded per option combination). openrouteservice was
  tried and **removed** (200 req/day free limit, no quiet-road data in Belgium).
- **Address search:** Flemish address register (geo.api.vlaanderen.be, fast) + Photon
  (photon.komoot.io, slower, knows POIs) queried in parallel; reverse lookup tries Flanders first.
  The register returns at most 5 matches, alphabetically: a second query adds your own
  municipality ("Grote Markt" → the one nearby first). Its municipality results are a point in
  the middle of the territory and match merged municipalities ("Kemzeke" → "Stekene"): kept
  only when that name was typed and Photon has no town for it. Photon towns/villages matching
  what was typed go on top, labelled "Town" / "Village" / "Station".
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
- App icon: an L-shaped route, proportioned like the logo's L: straight stem leaning 7°,
  tight round bend, flat foot (0.68 × stem height) with a tiny upturn into the finish ring,
  start dot on top, heavy line (W 78 / mark height 364 in a 512 tile). `public/favicon.svg`;
  PNGs rendered from it full-bleed. Generator: parameters in the start screen's R/CORNER.
- Status bar: no `black-translucent` meta (iOS 26 gradient + short-viewport bug). The
  top fade is our own gradient (`.app::before`).

## How the planner works (`src/core/planner.ts`)

1. Shortest route A→B first: if longer than the target (+5%) → "too-short" message
   with a "Plan N km instead" button (plans at once). If it already fits → it is shown at
   once (made exactly long enough) and the search for alternatives goes on behind it with
   the normal budget, no extra (before Nov 2026 it returned only that one route, and
   "New routes" gave the same one again).
2. Via points on an **ellipse with foci A and B** (2- and 3-via templates, left/right);
   loops use a square-ish shape through A. Each template's size is fitted
   (scale/interpolate) until length is within **0…+500 m** (`lengthRules`: ideal 0…+min(500 m, 5%);
   accepted −min(1.5 km, 5%) … +max(500 m, min(1 km, 5%))). Dauwe wants never shorter, a little
   longer is fine (walking out), 1 km longer is too much.
3. Stuck or "jumpy" lengths (via flips across a railway/motorway) → shift the via
   angles (`variant`). Max 7 tries per template; aim = target + 350 m (`extraOk*0.7`); a
   template's best try counts short as twice as bad. The first template calibrates the
   size→length ratio, the others wait for it (≤2.5 s). Templates stop early only when 3
   non-short routes all score ≤ 0.15 (`GOOD_SCORE`); stopping on length alone lost good routes.
   **Every try of an acceptable length is a candidate** (`consider`), not only each template's
   closest one. With 3 routes in, one more round runs only while a route scores worse than
   `FAIR_SCORE` 0.25 and ≥ 8 requests are left ("polishing"; stops as soon as all three are
   ≤ 0.25). Target < 1.3 × the direct route (`slight`): two 1-via templates are added and two
   routes are enough (no extra budget). Extra **rounds** of fresh variants until 3 different routes
   (similarity ≤ 70%) with **at most 1 short** (2 only if nothing better). **Request budget
   40 per plan** (+20 once if fewer than 3 routes; a busy server doesn't end the search): brouter.de answers "Please, retry later!"
   (403, from its front end, not BRouter itself) after ~35 quick requests from one IP.
   **Time budget 30 s**; returns the best found so far. Don't probe that limit on purpose.
4. Out-and-back spurs are removed (`removeSpurs`). Score (lower = better): km too long
   (beyond +500 m) ×0.5, km short ×0.25 (+ its run-twice share), run-twice ×4, busy roads ×3,
   noisy (next to motorways) ×1.5, unpaved ×0.5 (only when "Mostly paved").
   Routes that are a little short get an **out-and-back at the finish** (`padToTarget`: past the
   finish and back via one extra BRouter call; fallback, and always under 20 m: back along the
   route; nothing is ever shown shorter than asked) → `extraM`,
   shown as "Includes N m out and back at the finish".
5. **Early result:** the first route that is non-short and scores ≤ `GOOD_SCORE` (or, at the
   end of a round, ≤ `SHOW_SCORE` 0.2: it keeps tab 1, so never a mediocre one) is sent via
   `PlanRequest.onProgress` and shown at once (other tabs show pulsing dots, `pending` in App);
   the final choice is made as before and that route (or the most similar chosen one) keeps
   tab 1. Run-to-run variance in which routes are found exists anyway (budget is shared in
   the order the server answers). `prepare()` (planService) uploads the profile and fetches
   the direct route while start/finish are being chosen, so Plan skips those waits.
   No second public BRouter server was found (Nov 2026); own server = the real fix.
6. **Stop** (`PlanRequest.stop`, optional): one place to pass on the way, sent as a fixed
   waypoint in the same request (A → vias → stop → vias → B), so no extra requests. Its own
   templates (`stopTemplates`) share the extra distance out differently: spread over both legs
   (by leg length), all before the stop, or all after it (left/right each); the best routes win,
   so the tabs usually put the stop at different km ("Stop at km X" per route; Dauwe asked how to
   split, this lets him pick). A stop next to start/finish (< 250 m) puts all detours on the other
   leg; one next to both is ignored. Loop + stop = out to the stop, back another way.
   `clean()` removes spurs on each side of the stop separately, so a stop up a dead-end street
   is still reached. `stopM` = meters to the stop; the FIT file gets a course point there.
7. "New routes" = `variation + 1` (shifts the via angles). Each set is kept: results show
   "Earlier / Set n of m / Later". `PlanRequest.signal` lets the Cancel button stop a search.

A dropped connection mid-search keeps the routes found so far (error only when there are
none). Measured Nov 2026 on the 19 quality trips, old → new: average score 0.160 → 0.145,
worst of the three 0.215 → 0.194, noisy 3.5 → 2.9 %, twice 0.34 → 0.28 %, routes within
0…+500 m 47 → 50 of 56, requests 28.5 → 30.3 per plan; real time 4–6 s as before.

BRouter client (`src/core/brouter.ts`): max 4 parallel, 120 ms spacing, a failed fetch is
retried once (mobile data), in-session response cache, on 403 "retry later" → **all** requests pause (`pauseUntil`), short retries
(1.5–4.5 s) and 2 parallel for a minute; throws `RouterError(busy)` → app shows a neutral
"taking longer than usual". "operation killed" (server overloaded) → same request retried.

Surfaces (profile + `isUnpaved` in brouter.ts): paved (asphalt, concrete, sett…), **half-paved
counts as good** (compacted, fine_gravel, gravel = steenslag/dolomiet; Dauwe agreed), unpaved =
soft (dirt, grass, sand, mud, rough tracks) or path/track with no known surface ("Mostly paved":
soft +0.35/+0.6, unknown +0.15).
Surface choice in the app: **Paved / Mixed / Trail** (`surface` setting; Paved = avoid_unpaved,
Mixed = unpaved fine, Trail = `prefer_trail`: soft −0.3, unknown −0.25, half-paved −0.2, other
tracks/paths −0.1, paved roads +0.9). Near Nieuwkerken Trail gives ~13 % unpaved on a 12 km loop
vs 0–4 % (few trails there), ~28 % on a 20 km A→B; trail loops are jumpier (use the full budget).

Map camera: never `setPadding(0)` on its own (the view jumps); MapView clears padding with a
`jumpTo` that keeps the screen middle, then `fitBounds`. Loop on/off does not refit.

Running profile options: `avoid_unpaved` + `prefer_trail` (Surface), `prefer_green` (Scenery),
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
- Edit panel: Start / (Stop) / Finish (search, current location, pick on map, favourites ★,
  recent places), loop toggle, distance stepper, collapsible **Options** row
  (Surface Paved/Mixed/Trail, Scenery Any/Green, Light Daylight/Lit streets; short
  one-line labels on purpose, long ones wrapped on phones). "Green" = BRouter's
  `estimated_forest_class` (forest/wood around the way; parks are not in that data).
  Tapping Finish opens search even with Loop on (choosing a place turns Loop off).
  **Stop:** a small round + in the middle of the line between Start and Finish (Dauwe chose the
  spot; the line stops just before and after it) slides in an empty Stop row ("Choose stop");
  tapping that row opens search (Dauwe wanted it in two steps). The row's × folds it away
  (grid-rows transition). One stop max.
  Map: stop = small volt dot with a dark ring. Saved routes keep `stop` + `stopM`.
- Distance input: invalid while typing → Plan button disabled "Distance: 1–100 km".
- Opening Options or a message scrolls the panel so the Plan button stays in view (small
  screens, Safari with its bars). `.app` uses `overflow: clip` so nothing can shift the app.
- After "Send to Garmin" the next steps stay on screen under the button (`exported`).
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
- Start screen: inline in `index.html` (shows before any JS). The icon's route draws itself,
  moves as a whole onto the L slot (affine map: start→stem top, icon corner→corner, end of the flat foot line→foot end;
  the finish upturn flattens while the ring shrinks,
  gaining the letter's weight), then bends into a **soft twin** of the L: round ends and bend,
  one line weight (165 units), lying just inside the real glyph. Hand-over is a **cross-fade
  in the same timeline** (no masks, no sharpening): the text L fades in over the drawing
  (1300–1540 ms; the word gets z-index above the SVG from then), then the drawing fades out
  (1420–1660). Measured per 10 ms: no spikes. Dots/ring shrink gently (inOut). Letters are revealed by a sliding cover (transform; the letters themselves don't slide, or they'd overlap the L), bg fades via opacity, word
  flies into the logo (transform): all compositor-safe. The **map is only built after the
  shape is done** (`window.__longcutSplash.shapeDone`, App `mapOn`), because MapLibre's main-
  thread work made the morph stutter; its style is preloaded. Font: animation holds before the
  morph until Barlow Condensed 900 italic is in (≤2.5 s). Reduced motion: word only. Max 4 s.

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
- `scripts/e2e-stop.cjs [url]`: phone flow with a stop (add, plan, export, save, remove).
- `scripts/trace.ts` takes an optional 5th argument: a stop `lon,lat`.
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
stale-while-revalidate. Bump `VERSION` in sw.js if caching rules change. On a first visit the
page tells the worker which files it already loaded (`keep` message), so the app also starts
offline after one visit; cache lookups ignore `Vary`.

## Verifying changes (tools that worked)

- **Phone e2e:** `node scripts/e2e.cjs http://127.0.0.1:4173/` (waits until all route tabs
  are in; the first route shows early). An `errors:` line with 403s usually means the route
  server was refusing because of parallel test load: rerun once before worrying.
- **Route quality:** `scripts/quality.ts` (19 real trips, fixed coordinates; `compare` mode).
  Compare against an older commit via `git worktree add`. Repeat single trips to tell variance
  from real change. Its slow request spacing makes an uncached run hit the 30 s time budget:
  **run each version twice and compare the second (cached) runs.** `scripts/trace.ts
  <lon,lat> <lon,lat> <km> [repoDir]` prints every try of one trip. Trips "only a little
  longer than direct" worth checking by hand from Nieuwkerken (4.178,51.1934): Kemzeke 10,
  Temse 10, Lokeren 19, Stekene 13, Beveren 9.
- photon.komoot.io is flaky through this sandbox's proxy (often refused): search tests may
  show only Flemish results.
- **Start screen frames:** temporarily patch `index.html` (never commit it) so time can be
  frozen: `var slow = 1, freeze = new URLSearchParams(location.search).get('splashfreeze');`,
  `var raw = freeze ? +freeze : (now - t0) / slow, …`, after `measure(); measured = true;`
  add `if (freeze) { held = 0; t = raw; }`, keep the rAF loop running while `freeze`, and make
  `maybeLeave` return when `freeze`. Then screenshot `?splashfreeze=1400` etc. (DPR 3–4 for
  detail). CSS transitions (letter cover, flight) don't freeze: check those on video.
- **Smoothness metric:** screenshots every 10 ms of the L area (frozen time) or the frames
  of a real-time Playwright video (`recordVideo`, then `ffmpeg` to PNGs); sum of absolute
  pixel change per step. A jump = a spike vs its neighbours.
- **Hand-over exactness:** at the end time compare the drawing alone vs the text L alone
  (pixel diff); it was 0 differing pixels when the twin was exact.
- **Main-thread stalls:** `PerformanceObserver({ type: 'longtask' })` in an init script;
  there must be none during the morph (MapLibre is the usual cause; headless Chromium
  renders WebGL in software, so it exaggerates).
- **Not available here:** WebKit/Safari (don't install Playwright browsers), real iPhone,
  GPU. Tell Dauwe when a result depends on Safari.
- **Glyph data:** the L outline and metrics of Barlow Condensed 900 italic were read with
  `fontTools` (pip) from `node_modules/@fontsource/barlow-condensed/files/*900-italic.woff`:
  cap height 700, stem 181 thick leaning 7° (x = 183.1 − 0.1219·(700 − y) at the centre),
  foot 161 thick, advance 433, UPM 1000.
- **App icon PNGs:** render `public/favicon.svg` without the rounded rect (full-bleed) at
  512/192/180 with Playwright `setContent`, save as RGB.

## Open questions / possible next steps

- **Own BRouter server** (Docker image `saesh/brouter-server` or official BRouter on a ~€4–5
  per month VPS, Belgium segments only) would remove the public server's rate limit and make
  planning much faster. Needs Dauwe to create/pay an account; he hasn't decided.
- Safari rendering of the start screen is untested here (the cross-fade should hide small
  differences).

## Ideas not done yet (only if asked)

Backup/restore of saved routes; time-based distance (pace × time) and run-time estimate;
water/toilets along long routes; "not via here" (exclude a stretch); more than one stop or
choosing where the stop falls (km);
drag to edit a route; wind and sunset hints; plan a week ahead; cycling profile; Dutch
UI; share a route link; second routing server as fallback (no other public BRouter found).
