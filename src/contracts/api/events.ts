import { API_ERROR_STATUS } from './errors.js';
import { id, instant, literal, object, ref, revision, text } from './schema.js';
import type { Schema } from './schema.js';

const failure = object({ code: { enum: Object.keys(API_ERROR_STATUS) }, message: text });
const runPayload = (status: string) => object({ status: literal(status), revision });
const toolPayload = { oneOf: [
  object({ outcome: literal('error'), resultMessageId: id, failure }),
  object({ outcome: literal('unknown'), resultMessageId: id,
    failure: object({ code: literal('OUTCOME_UNKNOWN'), message: text }),
  }),
] };

function event(type: string, payload: Schema, correlation: readonly string[] = []): Schema {
  return object({ schemaVersion: literal(1), eventId: id,
    sequence: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    conversationId: id, runId: id, occurredAt: instant, type: literal(type), payload,
    stepId: id, modelCallId: id, toolCallId: id,
  }, ['schemaVersion', 'eventId', 'sequence', 'conversationId', 'runId', 'occurredAt', 'type', 'payload', ...correlation]);
}

export const DURABLE_EVENT_SCHEMAS = {
  'run.queued': event('run.queued', runPayload('queued')),
  'run.started': event('run.started', runPayload('running')),
  'step.started': event('step.started', object({ index: revision }), ['stepId']),
  'tool.started': event('tool.started', object({ tool: ref('McpToolRef'), attempt: revision }), ['stepId', 'toolCallId']),
  'tool.completed': event('tool.completed', object({ outcome: literal('success'), resultMessageId: id }), ['stepId', 'toolCallId']),
  'tool.failed': event('tool.failed', toolPayload, ['stepId', 'toolCallId']),
  'run.input_required': event('run.input_required', object({ question: text, revision })),
  'approval.required': event('approval.required', object({ approval: ref('ApprovalView') }), ['stepId', 'toolCallId']),
  'message.completed': event('message.completed', object({ message: ref('PublicMessage') })),
  'run.completed': event('run.completed', object({ status: literal('completed'), revision, finalMessageId: id })),
  // finalMessageId: present when the run still ended with an answer to the user (e.g. a tool failed and the
  // answer explains it); clients then show that answer instead of a generic error.
  'run.partial': event('run.partial', object({ status: literal('partial'), revision, reason: failure, finalMessageId: id }, ['status', 'revision', 'reason'])),
  'run.failed': event('run.failed', object({ status: literal('failed'), revision, reason: failure, finalMessageId: id }, ['status', 'revision', 'reason'])),
  'run.cancelled': event('run.cancelled', runPayload('cancelled')),
} as const;

export const EVENT_SCHEMAS = {
  DurableEvent: { oneOf: Object.values(DURABLE_EVENT_SCHEMAS) },
  // Ephemeral frames have no durable ID/sequence and cannot advance a replay cursor.
  // Ephemeral: the run waits for the client to run a tool (re-sent until answered; answer via client-results).
  ClientToolRequest: object({ schemaVersion: literal(1), type: literal('client_tool.request'), conversationId: id, runId: id,
    toolCallId: id, name: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,31}$' }, arguments: { type: 'object' }, expiresAt: instant,
  }),
  MessageDelta: object({ schemaVersion: literal(1), type: literal('message.delta'),
    conversationId: id, runId: id, stepId: id, modelCallId: id, messageId: id,
    occurredAt: instant, delta: { type: 'string', maxLength: 16_384 },
  }),
} as const;
