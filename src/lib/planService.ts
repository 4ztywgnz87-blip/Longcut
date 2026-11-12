// One shared router for the whole app.
import profileText from '../../brouter/longcut-run.brf?raw';
import { BRouterRouter } from '../core/brouter';
import { planRoutes } from '../core/planner';
import type { LngLat } from '../core/geo';
import type { PlanPrefs, PlanRequest, PlanResult } from '../core/types';

const router = new BRouterRouter({ profileText, maxConcurrent: 4, minIntervalMs: 120 });

export function plan(req: PlanRequest): Promise<PlanResult> {
  return planRoutes(req, router);
}

/**
 * Get ready while the user is still choosing: upload the running profile and fetch the
 * direct route (the planner's first step). Both land in the router's cache.
 */
export function prepare(start: LngLat | null, end: LngLat | null, prefs: PlanPrefs, stop?: LngLat): void {
  router.warm(prefs).then(() => {
    if (!start || !end) return;
    // the planner's first request: start → (stop →) finish
    if (stop) router.route([start, stop, end], prefs).catch(() => {});
    else if (start[0] !== end[0] || start[1] !== end[1]) router.route([start, end], prefs).catch(() => {});
  });
}
