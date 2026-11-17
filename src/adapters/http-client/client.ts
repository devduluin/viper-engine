import type { EngineClientPort, ClientRead, ClientPage } from '../../contracts/client/ports.js';
import type { StartRunView, SubmitInputView, DecideApprovalView } from '../../contracts/client/requests.js';
import { EngineClientFailure } from '../../contracts/client/failure.js';
import { parseId } from '../../contracts/identity/ids.js';
import type { ClientTransport } from './transport.js';
import { clientEvents } from './events.js';

function id(value: string): string {
  if (value === '.' || value === '..') throw new EngineClientFailure('INVALID_REQUEST');
  try { return encodeURIComponent(parseId('api_resource', value)); } catch { throw new EngineClientFailure('INVALID_REQUEST'); }
}
function page(options: ClientPage): string {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new EngineClientFailure('INVALID_REQUEST');
    query.set('limit', String(options.limit));
  }
  if (options.cursor !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(options.cursor)) throw new EngineClientFailure('INVALID_CURSOR'); query.set('cursor', options.cursor);
  }
  return query.size === 0 ? '' : `?${query}`;
}

/** HTTP-only integration helper; no model/DB/desktop access and no automatic mutation retries. */
export class EngineHttpClient implements EngineClientPort {
  constructor(private readonly transport: ClientTransport) {}
  async capabilities(options: ClientRead = {}) {
    const view = await this.transport.request('/api/v1/capabilities', 'Capabilities', 200, undefined, options);
    this.transport.requestBytes = Math.min(this.transport.config.requestBytes, view.limits.requestBytes);
    this.transport.eventBytes = Math.min(this.transport.config.eventBytes, view.limits.eventBytes); return view;
  }
  createConversation(body: { readonly title?: string } = {}, options: ClientRead = {}) {
    return this.transport.request('/api/v1/conversations', 'ConversationSnapshot', 201, this.transport.codec.request('CreateConversation', body), options);
  }
  conversation(value: string, options: ClientPage = {}) {
    return this.transport.request(`/api/v1/conversations/${id(value)}${page(options)}`, 'ConversationSnapshot', 200, undefined, options);
  }
  startRun(conversation: string, body: StartRunView, key: string, options: ClientRead = {}) {
    if (!/^[!-~]{1,128}$/.test(key)) throw new EngineClientFailure('INVALID_REQUEST');
    return this.transport.request(`/api/v1/conversations/${id(conversation)}/runs`, 'RunAccepted', 202,
      this.transport.codec.request('StartRun', body), options, { 'idempotency-key': key });
  }
  async run(value: string, options: ClientRead = {}) {
    const view = await this.transport.request(`/api/v1/runs/${id(value)}`, 'RunSnapshot', 200, undefined, options);
    if (view.runId !== value) throw new EngineClientFailure('INVALID_RESPONSE'); return view;
  }
  submitInput(run: string, body: SubmitInputView, options: ClientRead = {}) {
    return this.transport.request(`/api/v1/runs/${id(run)}/inputs`, 'RunAccepted', 202, this.transport.codec.request('SubmitInput', body), options);
  }
  cancel(run: string, options: ClientRead = {}) { return this.transport.request(`/api/v1/runs/${id(run)}/cancel`, 'RunSnapshot', 202, '{}', options); }
  decideApproval(value: string, body: DecideApprovalView, options: ClientRead = {}) {
    return this.transport.request(`/api/v1/approvals/${id(value)}/decision`, 'ApprovalView', 200, this.transport.codec.request('DecideApproval', body), options);
  }
  createConnection(serverId: string, options: ClientRead = {}) {
    return this.transport.request('/api/v1/mcp/connections', 'ConnectionView', 201, this.transport.codec.request('CreateConnection', { serverId }), options);
  }
  connections(options: ClientPage = {}) { return this.transport.request(`/api/v1/mcp/connections${page(options)}`, 'ConnectionPage', 200, undefined, options); }
  disconnect(value: string, expectedRevision: number, options: ClientRead = {}) {
    return this.transport.request(`/api/v1/mcp/connections/${id(value)}/disconnect`, 'ConnectionView', 200,
      this.transport.codec.request('DisconnectConnection', { expectedRevision }), options);
  }
  events(runId: string, options: ClientRead & { readonly cursor?: string } = {}) {
    return clientEvents(this.transport, runId, `/api/v1/runs/${id(runId)}/events`, options);
  }
}
