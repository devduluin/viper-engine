export const ENGINE_IDS = ['viper-engine', 'viper-v4', 'hermes'] as const;
export type EngineId = typeof ENGINE_IDS[number];
export type CoverageStatus = 'measured' | 'unsupported' | 'not_measured';
export interface Conditions {
  readonly dataset: string; readonly rubric: string; readonly tools: string; readonly budget: string;
  readonly model: string; readonly environment: string; readonly latency: string;
  readonly generation: 'scripted' | 'live';
}
export interface ComparisonTrial {
  readonly repeat: number; readonly mode: 'cold' | 'warm'; readonly passed: boolean;
  readonly criticalFailure: boolean; readonly latencyMs: number; readonly modelCalls: number;
  readonly toolCalls: number; readonly costUsd: number | null;
  readonly costProvenance: 'unavailable' | 'billed' | 'estimate';
}
export interface ComparisonTask {
  readonly id: string; readonly family: string; readonly status: CoverageStatus;
  readonly split: 'development' | 'evaluation' | 'holdout';
  readonly reason: string; readonly trials: readonly ComparisonTrial[];
}
export interface ComparisonEvidence {
  readonly schemaVersion: 1; readonly engine: EngineId; readonly version: string;
  readonly datasetVersion: string; readonly conditions: Conditions;
  readonly tasks: readonly ComparisonTask[];
  readonly capabilities: readonly { readonly id: string; readonly status: 'pass' | 'fail' | 'unsupported' | 'not_measured'; readonly reason: string }[];
  readonly provenance: string;
}
export interface InputReceipt {
  readonly directory: string; readonly hashes: Readonly<Record<string, string>>;
}
