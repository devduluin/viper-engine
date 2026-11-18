import { array, digest, id, literal, object, ref, revision, text, uri } from './schema.js';

export const REQUEST_SCHEMAS = {
  CreateConversation: object({ title: { type: 'string', minLength: 1, maxLength: 200 } }, []),
  ResourceSelection: object({ connectionId: id, uri }),
  PromptSelection: object({ connectionId: id, name: text,
    arguments: { type: 'object', maxProperties: 32, additionalProperties: { type: 'string', maxLength: 4096 } },
  }, ['connectionId', 'name']),
  ContextSelection: object({ resources: array(ref('ResourceSelection'), 16),
    prompts: array(ref('PromptSelection'), 16),
  }, []),
  StartRun: object({ input: ref('UserInput'), context: ref('ContextSelection'),
    options: object({ effort: { enum: ['low', 'medium', 'high'] } }, []) }, ['input']),
  SubmitInput: object({ inputId: id, expectedRevision: revision, input: ref('UserInput') }),
  CancelRun: object({}),
  DeleteConversation: object({}),
  McpToolRef: object({ connectionId: id, serverId: id, name: text,
    definitionVersion: { type: 'string', minLength: 1, maxLength: 256 },
  }),
  ApprovalBinding: object({ runId: id, toolCallId: id, tool: ref('McpToolRef'), argumentsDigest: digest }),
  DecideApproval: object({ expectedRevision: revision, proposal: ref('ApprovalBinding'),
    decision: { enum: ['accept', 'reject'] },
  }),
  // Server definitions/transports are operator-configured; no client-provided secret/command/URL.
  CreateConnection: object({ serverId: id }),
  DisconnectConnection: object({ expectedRevision: revision }),
  SchemaVersion: literal(1),
} as const;
