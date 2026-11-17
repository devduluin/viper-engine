import { Ajv2020 } from 'ajv/dist/2020.js';
import { API_SCHEMA_DOCUMENT, API_SCHEMA_ID } from '../../contracts/api/schemas.js';
import { parseJsonValue } from '../../contracts/messages/json.js';
import { EngineClientFailure } from '../../contracts/client/failure.js';
import type { ClientErrorView } from '../../contracts/client/failure.js';
import type { ConversationView, CapabilitiesView, RunAcceptedView, RunSnapshotView, ApprovalView,
  ConnectionView, ConnectionPageView, DurableEventView } from '../../contracts/client/views.js';
import { futureResponseSchema } from './future-schema.js';
import type { JsonObject } from '../../contracts/messages/json.js';

export interface Responses {
  ConversationSnapshot: ConversationView; Capabilities: CapabilitiesView; RunAccepted: RunAcceptedView;
  RunSnapshot: RunSnapshotView; ApprovalView: ApprovalView; ConnectionView: ConnectionView;
  ConnectionPage: ConnectionPageView; DurableEvent: DurableEventView; MessageDelta: JsonObject; ErrorResponse: ClientErrorView;
}
export class ClientCodec {
  private readonly requests = new Ajv2020({ strict: true, logger: false });
  private readonly responses = new Ajv2020({ strict: true, logger: false });
  constructor() { this.requests.addSchema(API_SCHEMA_DOCUMENT); this.responses.addSchema(futureResponseSchema()); }

  request(name: string, value: unknown): string {
    try {
      const json = parseJsonValue(value); const validate = this.requests.getSchema(`${API_SCHEMA_ID}#/$defs/${name}`);
      if (validate === undefined || !validate(json)) throw new EngineClientFailure('INVALID_REQUEST');
      return JSON.stringify(json);
    } catch (error) { if (error instanceof EngineClientFailure) throw error; throw new EngineClientFailure('INVALID_REQUEST'); }
  }

  response<K extends keyof Responses>(name: K, value: unknown): Responses[K] {
    try {
      const json: unknown = parseJsonValue(value);
      const validate = this.responses.getSchema<Responses[K]>(`${API_SCHEMA_ID}#/$defs/${name}`);
      if (validate === undefined || '$async' in validate) throw new EngineClientFailure('INVALID_RESPONSE');
      if (!validate(json)) throw new EngineClientFailure('INVALID_RESPONSE');
      return json;
    } catch { throw new EngineClientFailure('INVALID_RESPONSE'); }
  }
}
