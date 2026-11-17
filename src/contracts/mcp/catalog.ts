import type { JsonObject } from '../messages/json.js';
import type { McpToolRef } from './identity.js';

/** Server hints only; application policy owns approval, access and retry safety. */
export interface McpToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

export interface McpToolDefinition {
  readonly ref: McpToolRef;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly annotations?: McpToolAnnotations;
}

export interface McpResourceDefinition {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpPromptDefinition {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly arguments?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
}

export interface McpPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor?: string;
}
