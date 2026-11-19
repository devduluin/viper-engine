import { parseJsonObject } from '../../../src/contracts/messages/json.js';
import type { JsonObject, JsonValue } from '../../../src/contracts/messages/json.js';
import { ENGINE_IDS } from './types.js';
import type { ComparisonEvidence, ComparisonTask, ComparisonTrial, Conditions } from './types.js';

export function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4096) throw new Error('Expected bounded comparison text'); return value;
}
export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid comparison counter'); return value;
}
function numeric(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid comparison measure'); return value;
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('Expected comparison boolean'); return value; }
function fingerprint(value: unknown) { const result = text(value); if (!/^[0-9a-f]{64}$/.test(result)) throw new Error('Expected condition SHA256'); return result; }
export function member<T extends string>(value: unknown, choices: readonly T[]): T {
  const result = choices.find(choice => choice === value); if (result === undefined) throw new Error('Invalid comparison enum'); return result;
}
export function array(value: unknown): readonly JsonValue[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Expected bounded comparison array'); return value;
}
function closed(value: unknown, fields: readonly string[]) {
  const input = parseJsonObject(value); if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('Unknown comparison field'); return input;
}
function conditions(value: unknown): Conditions {
  const input = closed(value, ['dataset', 'rubric', 'tools', 'budget', 'model', 'environment', 'latency', 'generation']);
  return { dataset: fingerprint(input['dataset']), rubric: fingerprint(input['rubric']), tools: fingerprint(input['tools']), budget: fingerprint(input['budget']),
    model: fingerprint(input['model']), environment: fingerprint(input['environment']), latency: text(input['latency']), generation: member(input['generation'], ['scripted', 'live']) };
}
function trial(value: unknown): ComparisonTrial {
  const input = closed(value, ['repeat', 'mode', 'passed', 'criticalFailure', 'latencyMs', 'modelCalls', 'toolCalls', 'costUsd', 'costProvenance']);
  const cost = input['costUsd']; const provenance = member(input['costProvenance'], ['unavailable', 'billed', 'estimate']);
  if ((cost === null) !== (provenance === 'unavailable')) throw new Error('Cost value/provenance mismatch');
  const passed = bool(input['passed']); const criticalFailure = bool(input['criticalFailure']);
  if (passed && criticalFailure) throw new Error('Critical failure cannot pass a trial');
  return { repeat: integer(input['repeat']), mode: member(input['mode'], ['cold', 'warm']), passed,
    criticalFailure, latencyMs: numeric(input['latencyMs']), modelCalls: integer(input['modelCalls']),
    toolCalls: integer(input['toolCalls']), costUsd: cost === null ? null : numeric(cost), costProvenance: provenance };
}
function task(value: unknown): ComparisonTask {
  const input = closed(value, ['id', 'family', 'split', 'status', 'reason', 'trials']);
  const status = member(input['status'], ['measured', 'unsupported', 'not_measured']);
  const trials = array(input['trials']).map(trial);
  if ((status === 'measured') !== (trials.length > 0) || trials.length > 100) throw new Error('Measured task requires1..100 trials; other statuses require none');
  if (new Set(trials.map(item => `${item.repeat}/${item.mode}`)).size !== trials.length) throw new Error('Duplicate comparison trial');
  return { id: text(input['id']), family: text(input['family']), split: member(input['split'], ['development', 'evaluation', 'holdout']),
    status, reason: text(input['reason']), trials };
}
export function parseComparisonEvidence(value: unknown): ComparisonEvidence {
  const input = closed(value, ['schemaVersion', 'engine', 'version', 'datasetVersion', 'conditions', 'tasks', 'capabilities', 'provenance']);
  if (input['schemaVersion'] !== 1) throw new Error('Unsupported comparison schema');
  const tasks = array(input['tasks']).map(task);
  if (tasks.length === 0 || new Set(tasks.map(item => item.id)).size !== tasks.length) throw new Error('Missing/duplicate comparison task');
  const capabilities = array(input['capabilities']).map(value => { const row = closed(value, ['id', 'status', 'reason']);
    return { id: text(row['id']), status: member(row['status'], ['pass', 'fail', 'unsupported', 'not_measured']), reason: text(row['reason']) }; });
  if (new Set(capabilities.map(item => item.id)).size !== capabilities.length) throw new Error('Duplicate capability');
  return { schemaVersion: 1, engine: member(input['engine'], ENGINE_IDS), version: text(input['version']), datasetVersion: text(input['datasetVersion']),
    conditions: conditions(input['conditions']), tasks, capabilities, provenance: text(input['provenance']) };
}
export function object(value: unknown): JsonObject { return parseJsonObject(value); }
