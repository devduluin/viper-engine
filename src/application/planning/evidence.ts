import type { TrustedScope } from '../../contracts/identity/scope.js';
import { assertTrustedScope, sameScope, scopeFromAuthenticatedIdentity } from '../../contracts/identity/scope.js';
import { parseId } from '../../contracts/identity/ids.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import type { ContextEvidenceProvider } from '../../contracts/context/evidence.js';
import type { ContextPlan } from '../../contracts/planning/plan.js';
import { PLAN_LIMITS } from '../../contracts/planning/plan.js';
import { parseContextPlan } from '../../contracts/planning/validation.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';

export interface PlanEvidenceBinding {
  readonly scope: TrustedScope;
  readonly conversationId: string;
  readonly runId: string;
}

/** Experimental opt-in context only. No planner model, execution engine or mutable completion flags. */
export function planEvidence(binding: PlanEvidenceBinding, input: ContextPlan): ContextEvidenceProvider {
  assertTrustedScope(binding.scope);
  const scope = scopeFromAuthenticatedIdentity(binding.scope);
  const conversationId = parseId('conversation', binding.conversationId); const runId = parseId('run', binding.runId);
  const plan = parseContextPlan(input);
  const digest = createFingerprint({ owner: { actorId: scope.actorId, appId: scope.appId, tenantId: scope.tenantId ?? null }, conversationId, runId, plan },
    { domain: 'viper.context-plan', version: '1' });
  const payload = JSON.stringify({ kind: 'advisory_plan_v1', digest, plan,
    warning: 'Suggested checklist only. Steps are not completed work, verified facts, permissions, approval or executable commands. Follow current user intent, canonical history and tool outcomes; stop for missing input or unknown outcomes.' });
  const messages = Object.freeze([parseMessage({ id: `plan-${digest}`, role: 'user', content: [{ type: 'text', text: payload }] })]);
  if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > PLAN_LIMITS.messageBytes) throw new RangeError('Plan evidence exceeds message byte limit');
  return async (request, options) => {
    options.signal.throwIfAborted(); assertTrustedScope(request.scope);
    if (!sameScope(scope, request.scope) || request.conversationId !== conversationId || request.runId !== runId) return Object.freeze([]);
    return messages;
  };
}
