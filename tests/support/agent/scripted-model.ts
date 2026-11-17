import type { Clock } from '../../../src/contracts/identity/ports.js';
import type {
  ModelCallOptions, ModelCapabilities, ModelGateway, ModelRequest, ModelResult,
} from '../../../src/contracts/models/gateway.js';
import { assertModelCallOptions, assertModelRequest } from '../../../src/contracts/models/request-validation.js';
import { parseModelDecision } from '../../../src/contracts/models/decision.js';
import { parseModelUsage } from '../../../src/contracts/models/usage.js';

export interface ModelFrame {
  readonly result: ModelResult;
  readonly expect?: (request: ModelRequest) => void;
}

export const SCRIPTED_CAPABILITIES: ModelCapabilities = Object.freeze({
  toolCalling: true, streaming: false, structuredOutput: true,
  contentTypes: Object.freeze(['text', 'json', 'image', 'audio'] as const),
});

/** Strict finite script: unexpected calls fail instead of inventing a successful response. */
export class ScriptedModel implements ModelGateway {
  readonly capabilities = SCRIPTED_CAPABILITIES;
  private readonly frames: readonly ModelFrame[];
  private readonly recorded: ModelRequest[] = [];
  private cursor = 0;

  constructor(frames: readonly ModelFrame[], private readonly clock: Clock) {
    this.frames = frames.map(frame => Object.freeze({ ...frame, result: snapshotResult(frame.result) }));
  }

  get requests(): readonly ModelRequest[] { return Object.freeze([...this.recorded]); }
  get remaining(): number { return this.frames.length - this.cursor; }

  async generate(request: ModelRequest, options: ModelCallOptions = {}): Promise<ModelResult> {
    assertModelCallOptions(this.capabilities, options);
    assertModelRequest(request, this.capabilities, this.clock.now());
    const frame = this.frames[this.cursor];
    if (frame === undefined) throw new Error('Scripted model exhausted');
    frame.expect?.(request);
    this.cursor += 1;
    this.recorded.push(request);
    return frame.result;
  }
}

function snapshotResult(result: ModelResult): ModelResult {
  const usage = parseModelUsage(result.usage);
  return result.ok
    ? Object.freeze({ ok: true, decision: parseModelDecision(result.decision), usage })
    : Object.freeze({ ok: false, error: Object.freeze({ ...result.error }), usage });
}
