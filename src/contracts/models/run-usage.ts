/** Audit attempts and aggregate tokens, never a monetary/billing estimate. Unknown fields stay null. */
export interface RunUsage {
  readonly modelCalls: number;
  readonly source: 'provider' | 'estimate' | 'mixed' | 'unavailable';
  readonly inputTokens: number | null; readonly outputTokens: number | null; readonly totalTokens: number | null;
}
