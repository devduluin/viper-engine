import { parseJsonObject } from '../../../contracts/messages/json.js';
import { parseMcpToolOutcome } from '../../../contracts/mcp/parse-outcome.js';
import type { McpToolOutcome } from '../../../contracts/mcp/outcome.js';
import { normalizedFailure, transportFailureCode } from './classify.js';
import type { TransportEvidence } from './classify.js';
import { projectToolPayload } from './payload.js';
import { toolFailureCode } from './signals.js';

/** Normalize a received wire CallToolResult; malformed replies remain uncertain, never success. */
export function normalizeMcpToolResult(value: unknown, evidence: TransportEvidence = {}): McpToolOutcome {
  try {
    const envelope = parseJsonObject(value);
    if (Object.hasOwn(envelope, 'isError') && typeof envelope['isError'] !== 'boolean') throw new Error('Invalid isError flag');
    const output = projectToolPayload(envelope);
    const transport = transportFailureCode(evidence);
    if (transport) return parseMcpToolOutcome({ status: 'unknown', ...output, error: normalizedFailure(transport) });
    if (envelope['isError'] !== true) return parseMcpToolOutcome({ status: 'success', ...output });
    return parseMcpToolOutcome({ status: 'error', ...output, error: normalizedFailure(toolFailureCode(envelope)) });
  } catch {
    return parseMcpToolOutcome({ status: 'unknown', content: [], error: normalizedFailure(transportFailureCode(evidence) ?? 'unknown') });
  }
}

export interface TransportFailureContext {
  readonly dispatchState: 'not_sent' | 'sent' | 'unknown';
  readonly evidence?: TransportEvidence;
}

/** No message/body sniffing. The transport explicitly supplies evidence and dispatch certainty. */
export function normalizeMcpTransportFailure(context: TransportFailureContext): McpToolOutcome {
  const code = transportFailureCode(context.evidence ?? {}) ?? 'unknown';
  return parseMcpToolOutcome({
    status: context.dispatchState === 'not_sent' ? 'error' : 'unknown',
    content: [], error: normalizedFailure(code),
  });
}
