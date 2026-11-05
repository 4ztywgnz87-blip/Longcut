// One shared router for the whole app.
import profileText from '../../brouter/longcut-run.brf?raw';
import { BRouterRouter } from '../core/brouter';
import { planRoutes } from '../core/planner';
import type { PlanRequest, PlanResult } from '../core/types';

const router = new BRouterRouter({ profileText, maxConcurrent: 4, minIntervalMs: 120 });

export function plan(req: PlanRequest): Promise<PlanResult> {
  return planRoutes(req, router);
}
