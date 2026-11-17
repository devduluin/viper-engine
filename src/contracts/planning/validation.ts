import type { JsonObject } from '../messages/json.js';
import { parseJsonObject } from '../messages/json.js';
import { parseId } from '../identity/ids.js';
import { parseRevision } from '../state/result.js';
import { PLAN_LIMITS } from './plan.js';
import type { ContextPlan, ContextPlanStep } from './plan.js';

function closed(value: unknown, keys: readonly string[]): JsonObject {
  const input = parseJsonObject(value);
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('Unexpected plan field');
  return input;
}
function planId(value: unknown): string {
  const id = parseId('context_plan', value);
  if (id.length > 64) throw new Error('Plan identifier exceeds 64 characters');
  return id;
}
function planText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || new TextEncoder().encode(value).byteLength > PLAN_LIMITS.textBytes) throw new Error('Plan text requires 1..512 UTF8 bytes');
  if (/\u0000|[\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid plan Unicode text');
  return value;
}
function stepOf(value: unknown, previous: Set<string>): ContextPlanStep {
  const input = closed(value, ['id', 'goal', 'evidence', 'dependsOn']); const id = planId(input['id']);
  if (previous.has(id)) throw new Error('Duplicate plan step');
  const raw = input['dependsOn']; if (!Array.isArray(raw) || raw.length > PLAN_LIMITS.steps) throw new Error('Invalid plan dependencies');
  const dependsOn = raw.map(planId);
  if (new Set(dependsOn).size !== dependsOn.length || dependsOn.some(key => !previous.has(key))) throw new Error('Plan dependencies must refer to distinct earlier steps');
  previous.add(id);
  return Object.freeze({ id, goal: planText(input['goal']), evidence: planText(input['evidence']), dependsOn: Object.freeze(dependsOn) });
}
export function parseContextPlan(value: unknown): ContextPlan {
  const input = closed(value, ['schemaVersion', 'planId', 'revision', 'objective', 'steps']);
  if (input['schemaVersion'] !== 1) throw new Error('Unsupported context plan version');
  const raw = input['steps'];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > PLAN_LIMITS.steps) throw new Error('Context plan requires 1..8 steps');
  const previous = new Set<string>();
  const plan: ContextPlan = Object.freeze({ schemaVersion: 1, planId: planId(input['planId']), revision: parseRevision(input['revision']),
    objective: planText(input['objective']), steps: Object.freeze(raw.map(item => stepOf(item, previous))) });
  if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > PLAN_LIMITS.planBytes) throw new RangeError('Context plan exceeds byte limit');
  return plan;
}
