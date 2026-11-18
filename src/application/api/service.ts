import { assertTrustedScope } from '../../contracts/identity/scope.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { ApiCall, ApiHandler } from '../../contracts/api/control.js';
import { requireState } from '../../contracts/api/failure.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import type { ApiOptions } from './options.js';
import { startRun } from './start.js';
import { submitInput, decideApproval } from './resume.js';
import { conversation, getRun, cancelRun } from './queries.js';
import { createConnection, listConnections, disconnectConnection } from './connections.js';
import { listConversations } from './conversation-list.js';

export class EngineApi implements ApiHandler {
  constructor(private readonly options: ApiOptions) {}

  async execute(scope: TrustedScope, call: ApiCall): Promise<JsonObject> {
    assertTrustedScope(scope);
    const handlers = { createConversation: () => this.createConversation(scope, call),
      listConversations: () => listConversations(scope, call, this.options),
      getConversation: () => conversation(scope, call, this.options), startRun: () => startRun(scope, call, this.options),
      getRun: () => getRun(scope, call, this.options), submitInput: () => submitInput(scope, call, this.options),
      cancelRun: () => cancelRun(scope, call, this.options), decideApproval: () => decideApproval(scope, call, this.options),
      createConnection: () => createConnection(scope, call, this.options), listConnections: () => listConnections(scope, call, this.options),
      disconnectConnection: () => disconnectConnection(scope, call, this.options), getCapabilities: async () => this.capabilities() };
    return handlers[call.operation]();
  }

  private async createConversation(scope: TrustedScope, call: ApiCall) {
    return this.options.database.transaction(async stores => {
      const record = requireState(await stores.conversations.create(scope, { id: this.options.ids.next('conversation'),
        at: this.options.clock.now(), ...(typeof call.body['title'] === 'string' ? { title: call.body['title'] } : {}) }));
      return { schemaVersion: 1, conversationId: record.id, revision: record.revision,
        createdAt: record.createdAt, updatedAt: record.updatedAt, messages: [],
        ...(record.title === undefined ? {} : { title: record.title }) };
    });
  }

  private capabilities(): JsonObject {
    const o = this.options;
    return { schemaVersion: 1, apiVersion: 'v1', features: { tools: true, resources: o.prepareContext !== undefined,
      prompts: o.prepareContext !== undefined, durableRuns: true, eventReplay: o.eventReplay === true },
    limits: { requestBytes: o.requestBytes, eventBytes: o.eventBytes,
      idempotencyRetentionSeconds: o.idempotencyRetentionSeconds, eventRetentionSeconds: o.eventRetentionSeconds } };
  }
}
