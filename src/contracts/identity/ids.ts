declare const entityIdBrand: unique symbol;

/** Validated opaque identifier; no UUID or provider-specific format is required. */
export type EntityId<Kind extends string> = string & { readonly [entityIdBrand]: Kind };

export type ActorId = EntityId<'actor'>;
export type AppId = EntityId<'app'>;
export type TenantId = EntityId<'tenant'>;
export type ConversationId = EntityId<'conversation'>;
export type RunId = EntityId<'run'>;
export type StepId = EntityId<'step'>;
export type ModelCallId = EntityId<'model_call'>;
export type ToolCallId = EntityId<'tool_call'>;
export type MessageId = EntityId<'message'>;

export function parseId<Kind extends string>(kind: Kind, value: unknown): EntityId<Kind> {
  if (typeof kind !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(kind)) throw new Error('Invalid identifier kind');
  if (typeof value !== 'string') throw new Error(`Invalid ${kind} identifier`);
  if (value.length === 0 || value.length > 256 || /[\p{Cc}\p{Cf}\s]/u.test(value)) {
    throw new Error(`Invalid ${kind} identifier`);
  }
  return value as EntityId<Kind>;
}
