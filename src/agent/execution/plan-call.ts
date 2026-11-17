import type { JsonObject } from '../../contracts/messages/json.js';
import type { ToolCall } from '../../contracts/messages/message.js';
import type { McpFailureCode } from '../../contracts/mcp/outcome.js';
import type { RuntimeTool, ToolIndex } from './tool-catalog.js';
import type { ToolRejection } from '../../contracts/state/tool-rejection.js';

export type ArgumentCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly field?: string };

/** Injected JSON Schema validator; the agent layer does not depend on a schema library. */
export interface ToolArgumentValidator {
  validate(schema: JsonObject, args: JsonObject): ArgumentCheck;
}

export type ToolCallDecision = 'execute' | 'requires_approval' | 'reject';

/**
 * Application policy over the resolved tool and arguments. It is not a domain/tool-slug router;
 * richer approval proposals arrive in P03-04/P04-03.
 */
export interface ToolCallPolicy {
  decide(tool: RuntimeTool, call: ToolCall): ToolCallDecision;
  /** Trusted explanation only after `reject`; cannot change admission or bypass validation. */
  rejection?(tool: RuntimeTool, call: ToolCall): ToolRejection | undefined;
}

export interface CallRejection {
  readonly code: McpFailureCode;
  readonly message: string;
  readonly field?: string;
}

export type CallPlan =
  | { readonly kind: 'execute'; readonly call: ToolCall; readonly tool: RuntimeTool }
  | { readonly kind: 'approval'; readonly call: ToolCall; readonly tool: RuntimeTool }
  | { readonly kind: 'rejected'; readonly call: ToolCall; readonly rejection: ToolRejection };

export interface PlanDependencies {
  readonly index: ToolIndex;
  readonly validator: ToolArgumentValidator;
  readonly policy: ToolCallPolicy;
}

function rejected(call: ToolCall, rejection: ToolRejection): CallPlan {
  return Object.freeze({ kind: 'rejected', call, rejection: Object.freeze(rejection) });
}

/** Resolve exact alias, validate arguments, then ask policy. Nothing here dispatches. */
export function planCall(call: ToolCall, deps: PlanDependencies): CallPlan {
  const tool = deps.index.find(call.name);
  if (tool === undefined) return rejected(call, { code: 'not_found', message: `Unknown tool: ${call.name}` });
  const check = deps.validator.validate(tool.definition.inputSchema, call.arguments);
  if (!check.ok) {
    return rejected(call, {
      code: 'invalid_value', message: check.message,
      ...(check.field === undefined ? {} : { field: check.field }),
    });
  }
  const decision = deps.policy.decide(tool, call);
  if (decision === 'reject') return rejected(call, deps.policy.rejection?.(tool, call)
    ?? { code: 'permission', message: 'Tool call not permitted by policy' });
  return Object.freeze({ kind: decision === 'execute' ? 'execute' : 'approval', call, tool });
}
