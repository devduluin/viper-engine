import { cursor } from './schema.js';
import { apiRef, idempotencyKey, jsonBody, jsonResponse, operation, parameter, pathId } from './operations.js';

export const RUN_PATHS = {
  '/api/v1/conversations/{conversationId}/runs': {
    post: { ...operation('startRun', 'Enqueue a durable run; idempotent within advertised retention', 'RunAccepted', 202),
      parameters: [pathId('conversationId'), idempotencyKey], requestBody: jsonBody('StartRun'),
    },
  },
  '/api/v1/runs/{runId}': {
    get: { ...operation('getRun', 'Read consistent state and event cursor', 'RunSnapshot'), parameters: [pathId('runId')] },
  },
  '/api/v1/runs/{runId}/inputs': {
    post: { ...operation('submitInput', 'Continue clarification using inputId deduplication and revision', 'RunAccepted', 202),
      parameters: [pathId('runId')], requestBody: jsonBody('SubmitInput'),
    },
  },
  '/api/v1/runs/{runId}/client-results': {
    post: { ...operation('submitClientResult', 'Answer a client_tool.request (e.g. the open page); process-local, best effort', 'ClientToolAccepted'),
      parameters: [pathId('runId')], requestBody: jsonBody('ClientToolResult'),
    },
  },
  '/api/v1/runs/{runId}/cancel': {
    post: { ...operation('cancelRun', 'Record idempotent cancellation intent', 'RunSnapshot', 202),
      parameters: [pathId('runId')], requestBody: jsonBody('CancelRun'),
    },
  },
  '/api/v1/runs/{runId}/events': {
    get: { operationId: 'streamRunEvents', summary: 'Scoped replay; reconnect never starts execution',
      parameters: [pathId('runId'), parameter('cursor', 'query', cursor), parameter('Last-Event-ID', 'header', cursor)],
      responses: {
        200: { description: 'SSE; durable frame id is an opaque cursor; heartbeat is a comment',
          content: { 'text/event-stream': { schema: { type: 'string' },
            'x-durable-event-schema': apiRef('DurableEvent'), 'x-ephemeral-event-schema': apiRef('MessageDelta'),
          } },
        },
        410: jsonResponse('ErrorResponse', 'EVENT_CURSOR_EXPIRED; fetch snapshot and reconnect'),
        default: jsonResponse('ErrorResponse', 'Safe error before opening stream'),
      },
    },
  },
} as const;
