import { APPROVAL_STATUSES } from '../state/approval-state.js';
import { RUN_STATUSES } from '../state/run-state.js';
import { array, cursor, id, instant, literal, object, ref, revision, sequence, text } from './schema.js';

const stamps = { createdAt: instant, updatedAt: instant };
const version = { schemaVersion: literal(1) };
const tokens = { type: ['integer', 'null'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER };

export const RESPONSE_SCHEMAS = {
  ContextReport: object({ inputMessages: sequence, selectedMessages: sequence, omittedMessages: sequence,
    beforeTokens: sequence, afterTokens: sequence, inputBytes: sequence,
    approximate: { const: true }, hasUnpricedMedia: { type: 'boolean' }, excludesProviderFraming: { const: true } }),
  RunUsage: object({ modelCalls: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    source: { enum: ['provider', 'estimate', 'mixed', 'unavailable'] }, inputTokens: tokens, outputTokens: tokens, totalTokens: tokens }),
  RunStatus: { enum: RUN_STATUSES },
  ApprovalView: object({ ...version, approvalId: id, revision, status: { enum: APPROVAL_STATUSES },
    proposal: ref('ApprovalBinding'), arguments: { type: 'object' }, expiresAt: instant,
  }),
  ConversationSnapshot: object({ ...version, conversationId: id, revision, ...stamps,
    title: { type: 'string', minLength: 1, maxLength: 200 }, messages: array(ref('PublicMessage')),
    nextCursor: cursor,
  }, ['schemaVersion', 'conversationId', 'revision', 'createdAt', 'updatedAt', 'messages']),
  RunAccepted: object({ ...version, runId: id, conversationId: id, status: ref('RunStatus'),
    revision, snapshotUrl: { type: 'string', pattern: '^/api/v1/runs/[^/]+$', maxLength: 512 },
  }),
  RunSnapshot: object({ ...version, runId: id, conversationId: id, status: ref('RunStatus'),
    revision, ...stamps, eventCursor: cursor, lastEventSequence: sequence,
    cancelRequestedAt: instant, inputQuestion: text, pendingApprovals: array(ref('ApprovalView'), 32),
    finalMessage: ref('FinalMessage'), usage: ref('RunUsage'), context: ref('ContextReport'),
  }, ['schemaVersion', 'runId', 'conversationId', 'status', 'revision', 'createdAt', 'updatedAt', 'eventCursor', 'lastEventSequence']),
  ConnectionView: object({ ...version, connectionId: id, serverId: id, revision,
    authState: { enum: ['ready', 'authentication_required', 'revoked'] }, ...stamps,
  }),
  ConnectionPage: object({ ...version, items: array(ref('ConnectionView')), nextCursor: cursor }, ['schemaVersion', 'items']),
  Capabilities: object({ ...version, apiVersion: literal('v1'),
    features: object({ tools: { type: 'boolean' }, resources: { type: 'boolean' }, prompts: { type: 'boolean' },
      durableRuns: { type: 'boolean' }, eventReplay: { type: 'boolean' },
    }),
    limits: object({ requestBytes: { type: 'integer', minimum: 1, maximum: 1_048_576 },
      eventBytes: { type: 'integer', minimum: 1, maximum: 1_048_576 },
      idempotencyRetentionSeconds: revision, eventRetentionSeconds: revision,
    }),
  }),
} as const;
