import { randomUUID } from 'node:crypto';
import { parseId } from '../contracts/identity/ids.js';
import { assertTimerDuration } from '../shared/async/delay.js';
import { resolveRunLimits } from '../agent/policies/limits.js';
import type { ViperEngineOptions } from './engine-types.js';
import { resolveContextBudget } from '../contracts/context/budget.js';
import { resolveToolDiscovery } from '../contracts/discovery/config.js';

function positive(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid engine ${name}`);
  return value;
}

function timeouts(options: ViperEngineOptions) {
  const connectTimeoutMs = positive('connect timeout', options.connectTimeoutMs ?? 20000);
  const requestTimeoutMs = positive('request timeout', options.requestTimeoutMs ?? 10000);
  const timeoutMs = positive('discovery timeout', options.discoveryTimeoutMs ?? 30000);
  for (const value of [connectTimeoutMs, requestTimeoutMs, timeoutMs]) assertTimerDuration('engine timeout', value);
  return { connectTimeoutMs, requestTimeoutMs, timeoutMs };
}

export function engineSettings(options: ViperEngineOptions) {
  const clock = options.clock ?? Object.freeze({ now: () => Date.now() });
  const ids = options.ids ?? Object.freeze({ next: <K extends string>(kind: K) => parseId(kind, `${kind}-${randomUUID()}`) });
  const toolDiscovery = resolveToolDiscovery(options.toolDiscovery);
  return Object.freeze({ clock, ids, ...timeouts(options), limits: resolveRunLimits(options.limits),
    context: resolveContextBudget(options.context), toolDiscovery,
    model: Object.freeze({ ...options.model }),
    maxModelCalls: positive('model call limit', options.maxModelCalls ?? 8),
    maxOutputTokens: positive('model output limit', options.maxOutputTokens ?? 4096),
    maxConnections: positive('connection limit', options.maxConnections ?? 32),
    maxPages: positive('page limit', options.maxPages ?? 20), maxTools: positive('tool limit', options.maxTools ?? toolDiscovery.catalogMaxTools),
  });
}
