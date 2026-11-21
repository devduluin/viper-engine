import type { ModelUsage } from '../../contracts/models/usage.js';
import { BudgetExceeded } from './limits.js';

/** Reserve before provider dispatch; an interrupted delivery conservatively retains its reservation. */
export class TokenBudget {
  private charged: number;
  constructor(readonly maximum: number, saved = 0) { this.charged = saved; }
  get enabled() { return this.maximum < Number.MAX_SAFE_INTEGER; }
  get used() { return this.charged; }
  reserve(input: number, requestedOutput: number, unpricedMedia: boolean) {
    if (!this.enabled) return { output: requestedOutput, reserved: 0 };
    if (unpricedMedia) throw new BudgetExceeded('token_limit');
    const prompt = input + 2048; // Explicit framing allowance; input estimates are not a billing guarantee.
    const remaining = this.maximum - this.charged - prompt;
    if (remaining < 1) throw new BudgetExceeded('token_limit');
    const output = Math.min(requestedOutput, remaining);
    const reserved = prompt + output;
    this.charged += reserved;
    return { output, reserved };
  }
  settle(reserved: number, usage: ModelUsage) {
    if (!this.enabled) return;
    const actual = usage.source === 'provider' && usage.inputTokens !== null && usage.outputTokens !== null
      ? usage.inputTokens + usage.outputTokens : reserved;
    this.charged = Math.min(Number.MAX_SAFE_INTEGER, this.charged - reserved + actual);
  }
  assertAvailable() { if (this.enabled && this.charged > this.maximum) throw new BudgetExceeded('token_limit'); }
}
