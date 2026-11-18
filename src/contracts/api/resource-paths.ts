import { jsonBody, operation, pageParameters, pathId } from './operations.js';

export const RESOURCE_PATHS = {
  '/api/v1/capabilities': { get: operation('getCapabilities', 'Read features and configured bounds', 'Capabilities') },
  '/api/v1/conversations': {
    post: { ...operation('createConversation', 'Create a scoped conversation', 'ConversationSnapshot', 201),
      requestBody: jsonBody('CreateConversation'),
    },
    get: { ...operation('listConversations', 'List the caller non-empty conversations, newest first (no messages)', 'ConversationPage'),
      parameters: pageParameters,
    },
  },
  '/api/v1/conversations/{conversationId}': {
    get: { ...operation('getConversation', 'Read a bounded public message page', 'ConversationSnapshot'),
      parameters: [pathId('conversationId'), ...pageParameters],
    },
  },
  '/api/v1/approvals/{approvalId}/decision': {
    post: { ...operation('decideApproval', 'Accept/reject an exact server-owned proposal; does not dispatch a tool', 'ApprovalView'),
      parameters: [pathId('approvalId')], requestBody: jsonBody('DecideApproval'),
    },
  },
  '/api/v1/mcp/connections': {
    post: { ...operation('createConnection', 'Connect an operator-configured authorized MCP server', 'ConnectionView', 201),
      requestBody: jsonBody('CreateConnection'),
    },
    get: { ...operation('listConnections', 'List public connection state without credentials', 'ConnectionPage'),
      parameters: pageParameters,
    },
  },
  '/api/v1/mcp/connections/{connectionId}/disconnect': {
    post: { ...operation('disconnectConnection', 'Revoke connection and invalidate future dispatch', 'ConnectionView'),
      parameters: [pathId('connectionId')], requestBody: jsonBody('DisconnectConnection'),
    },
  },
} as const;
