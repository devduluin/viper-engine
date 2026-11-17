import type { ToolCallReport } from '../execution/dispatch.js';
import type { RunStop, RunStopReason } from './types.js';

export function guardedStop(reason: RunStopReason, reports: readonly ToolCallReport[]): RunStop {
  if (reason === 'cancelled') return { status: 'cancelled', reason };
  const uncertain = reports.some(report => report.status === 'unknown');
  return { status: uncertain ? 'partial' : 'failed', reason };
}
