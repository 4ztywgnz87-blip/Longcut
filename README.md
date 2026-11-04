# LONGCUT

*The opposite of a shortcut.* A route planner for runners: pick a start, a finish and how many kilometers you want to run. LONGCUT makes the detour and exports it as GPX for your Garmin.

See [`docs/plan.md`](docs/plan.md) for the full plan (Dutch).

## Development

```bash
npm install
npm run dev        # app (coming in phase 2)
npx vitest run     # unit tests
```

The routing engine lives in `src/core/` and has no UI dependencies.

### Testing on real routes

Needs a free [openrouteservice](https://openrouteservice.org) key.

```bash
ORS_KEY=... npx tsx scripts/eval.ts            # all test trips
ORS_KEY=... npx tsx scripts/eval.ts Lokeren    # only trips matching "Lokeren"
```

API responses are cached in `.cache/`, so re-runs don't use up the daily quota.
