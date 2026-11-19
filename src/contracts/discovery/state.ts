import type { Message, AssistantMessage, ToolResultMessage } from '../messages/message.js';
import { parseMessage } from '../messages/parse-message.js';
import { parseJsonObject } from '../messages/json.js';
import { parseId } from '../identity/ids.js';
import type { MessageId } from '../identity/ids.js';
import { resolveToolDiscovery } from './config.js';
import type { ToolDiscoveryConfig } from './config.js';

export const TOOL_SEARCH_NAME = 'viper__search_tools';
export interface DiscoveryExchange {
  readonly afterMessageId: MessageId; readonly assistant: AssistantMessage; readonly result: ToolResultMessage;
}
export interface ToolDiscoveryState {
  readonly version: 1; readonly ownerKey: string; readonly runId: string;
  readonly settings: ToolDiscoveryConfig; readonly enabled: boolean; readonly searches: number;
  readonly active: readonly { readonly alias: string; readonly key: string }[];
  readonly exchanges: readonly DiscoveryExchange[];
}
function text(value: unknown, maximum = 512): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) throw new Error('Invalid discovery text'); return value;
}
function exchange(value: unknown): DiscoveryExchange {
  const data = parseJsonObject(value); const assistant = parseMessage(data['assistant']); const result = parseMessage(data['result']);
  if (assistant.role !== 'assistant' || assistant.toolCalls?.length !== 1 || assistant.toolCalls[0]?.name !== TOOL_SEARCH_NAME) throw new Error('Invalid discovery assistant');
  if (result.role !== 'tool' || result.toolCallId !== assistant.toolCalls[0].id || result.outcome !== 'success') throw new Error('Invalid discovery result');
  return Object.freeze({ afterMessageId: parseId('message', data['afterMessageId']), assistant, result });
}
export function parseToolDiscoveryState(value: unknown): ToolDiscoveryState {
  const input = parseJsonObject(value); const settings = resolveToolDiscovery(parseJsonObject(input['settings']));
  const searches = searchCount(input['searches'], settings);
  if (input['version'] !== 1 || typeof input['enabled'] !== 'boolean') throw new Error('Invalid discovery state');
  validateMode(settings, input['enabled']);
  const active = boundedArray(input['active'], settings.searchTopK * settings.maxSearchCalls);
  const exchanges = boundedArray(input['exchanges'], Math.min(settings.maxSearchCalls, searches));
  const entries = active.map(value => { const row = parseJsonObject(value); return Object.freeze({ alias: text(row['alias']), key: text(row['key'], 2048) }); });
  if (new Set(entries.map(item => item.alias)).size !== entries.length) throw new Error('Duplicate active tool');
  const parsed = exchanges.map(exchange); const messages: Message[] = parsed.flatMap(item => [item.assistant, item.result]);
  if (new Set(messages.map(item => item.id)).size !== messages.length) throw new Error('Duplicate discovery message');
  if (new Set(parsed.map(item => item.result.toolCallId)).size !== parsed.length) throw new Error('Duplicate discovery call');
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 262144) throw new RangeError('Discovery transcript too large');
  return Object.freeze({ version: 1, ownerKey: text(input['ownerKey'], 64), runId: text(input['runId'], 128), settings,
    enabled: input['enabled'], searches, active: Object.freeze(entries), exchanges: Object.freeze(parsed) });
}

function searchCount(value: unknown, settings: ToolDiscoveryConfig): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > settings.maxSearchCalls) throw new Error('Invalid discovery counter');
  return value;
}

function boundedArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid discovery array');
  return value;
}

function validateMode(settings: ToolDiscoveryConfig, enabled: boolean): void {
  if (settings.mode === 'off' && enabled) throw new Error('Off discovery state cannot be enabled');
  if (settings.mode === 'on' && !enabled) throw new Error('On discovery state cannot be disabled');
}
