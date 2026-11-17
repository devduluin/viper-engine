import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { JsonObject } from '../../../contracts/messages/json.js';
import type { McpFailureCode } from '../../../contracts/mcp/outcome.js';
import { machineFailureCode } from './classify.js';

/** Documented portable envelope convention: a root/nested error.code, not free-form message text. */
function structuredCode(value: JsonObject, depth = 0): McpFailureCode | undefined {
  if (depth > 4) return undefined;
  const code = machineFailureCode(value['code']);
  if (code) return code;
  const nested = value['error'];
  if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) return undefined;
  return structuredCode(parseJsonObject(nested), depth + 1);
}

function textFailureCode(block: unknown): McpFailureCode | undefined {
  try {
    const value = parseJsonObject(block);
    if (value['type'] !== 'text' || typeof value['text'] !== 'string') return undefined;
    return structuredCode(parseJsonObject(JSON.parse(value['text']) as unknown));
  } catch {
    // Plain/malformed text is still preserved as content, but has no routing authority.
    return undefined;
  }
}

/** Structured content wins. JSON-text fallback is used only when structured content is absent. */
export function toolFailureCode(envelope: JsonObject): McpFailureCode {
  if (Object.hasOwn(envelope, 'structuredContent')) {
    return structuredCode(parseJsonObject(envelope['structuredContent'])) ?? 'unknown';
  }
  const codes = new Set<McpFailureCode>();
  const content = envelope['content'];
  if (!Array.isArray(content)) return 'unknown';
  for (const block of content) {
    const code = textFailureCode(block);
    if (code) codes.add(code);
  }
  return codes.size === 1 ? [...codes][0]! : 'unknown';
}
