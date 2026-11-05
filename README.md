# LONGCUT

*The opposite of a shortcut.* A route planner for runners: pick a start, a finish and how many kilometers you want to run. LONGCUT makes the detour and exports it as GPX for your Garmin.

See [`docs/plan.md`](docs/plan.md) for the full plan (Dutch).

## Development

```bash
npm install
npm run dev        # run the app locally
npx vitest run     # unit tests
```

The routing engine lives in `src/core/` and has no UI dependencies.

### Testing on real routes

Routes come from the public [BRouter](https://brouter.de) server with LONGCUT's own
running profile (`brouter/longcut-run.brf`). No API key needed.

```bash
npx tsx scripts/eval.ts            # all test trips
npx tsx scripts/eval.ts Lokeren    # only trips matching "Lokeren"
```

Responses are cached in `.cache/`, so re-runs don't hit the server again.
