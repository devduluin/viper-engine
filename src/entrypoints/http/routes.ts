import type { ApiOperation } from '../../contracts/api/control.js';

export interface HttpRoute {
  readonly operation: ApiOperation; readonly method: 'GET' | 'POST'; readonly url: string;
  readonly response: string; readonly status: number; readonly body?: string; readonly resource?: string; readonly paged?: boolean;
}
export const HTTP_ROUTES: readonly HttpRoute[] = [
  { operation: 'getCapabilities', method: 'GET', url: '/api/v1/capabilities', response: 'Capabilities', status: 200 },
  { operation: 'createConversation', method: 'POST', url: '/api/v1/conversations', body: 'CreateConversation', response: 'ConversationSnapshot', status: 201 },
  { operation: 'listConversations', method: 'GET', url: '/api/v1/conversations', response: 'ConversationPage', status: 200, paged: true },
  { operation: 'getConversation', method: 'GET', url: '/api/v1/conversations/:conversationId', resource: 'conversationId', response: 'ConversationSnapshot', status: 200, paged: true },
  { operation: 'titleConversation', method: 'POST', url: '/api/v1/conversations/:conversationId/title', resource: 'conversationId', body: 'TitleConversation', response: 'ConversationTitle', status: 200 },
  { operation: 'deleteConversation', method: 'POST', url: '/api/v1/conversations/:conversationId/delete', resource: 'conversationId', body: 'DeleteConversation', response: 'ConversationDeleted', status: 200 },
  { operation: 'startRun', method: 'POST', url: '/api/v1/conversations/:conversationId/runs', resource: 'conversationId', body: 'StartRun', response: 'RunAccepted', status: 202 },
  { operation: 'getRun', method: 'GET', url: '/api/v1/runs/:runId', resource: 'runId', response: 'RunSnapshot', status: 200 },
  { operation: 'listRunAgents', method: 'GET', url: '/api/v1/runs/:runId/agents', resource: 'runId', response: 'RunAgents', status: 200 },
  { operation: 'submitInput', method: 'POST', url: '/api/v1/runs/:runId/inputs', resource: 'runId', body: 'SubmitInput', response: 'RunAccepted', status: 202 },
  { operation: 'steerRun', method: 'POST', url: '/api/v1/runs/:runId/steer', resource: 'runId', body: 'SteerRun', response: 'SteerAccepted', status: 202 },
  { operation: 'submitClientResult', method: 'POST', url: '/api/v1/runs/:runId/client-results', resource: 'runId', body: 'ClientToolResult', response: 'ClientToolAccepted', status: 200 },
  { operation: 'cancelRun', method: 'POST', url: '/api/v1/runs/:runId/cancel', resource: 'runId', body: 'CancelRun', response: 'RunSnapshot', status: 202 },
  { operation: 'decideApproval', method: 'POST', url: '/api/v1/approvals/:approvalId/decision', resource: 'approvalId', body: 'DecideApproval', response: 'ApprovalView', status: 200 },
  { operation: 'createConnection', method: 'POST', url: '/api/v1/mcp/connections', body: 'CreateConnection', response: 'ConnectionView', status: 201 },
  { operation: 'listConnections', method: 'GET', url: '/api/v1/mcp/connections', response: 'ConnectionPage', status: 200, paged: true },
  { operation: 'disconnectConnection', method: 'POST', url: '/api/v1/mcp/connections/:connectionId/disconnect', resource: 'connectionId', body: 'DisconnectConnection', response: 'ConnectionView', status: 200 },
];
