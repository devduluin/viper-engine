import type { MessageId, ToolCallId } from '../identity/ids.js';
import type { ContentBlock } from './content.js';
import type { JsonObject } from './json.js';

export interface ToolCall {
  readonly id: ToolCallId;
  readonly name: string;
  readonly arguments: JsonObject;
}

interface MessageBase {
  readonly id: MessageId;
  readonly content: readonly ContentBlock[];
}

export interface ContextMessage extends MessageBase {
  readonly role: 'system' | 'user';
}

export interface AssistantMessage extends MessageBase {
  readonly role: 'assistant';
  readonly toolCalls?: readonly ToolCall[];
}

export type ToolOutcome = 'success' | 'error' | 'unknown';

export interface ToolResultMessage extends MessageBase {
  readonly role: 'tool';
  readonly toolCallId: ToolCallId;
  readonly outcome: ToolOutcome;
}

export type Message = ContextMessage | AssistantMessage | ToolResultMessage;
