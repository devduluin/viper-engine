import { EngineSetupError } from '../mcp-tools.js';
import { DeadlineExceededError } from '../../shared/async/errors.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import type { WorkerFailureCode } from '../../contracts/worker/control.js';

/** No free-form SDK/SQL text, secret values or arbitrary error.code in worker health/events. */
export function workerFailureCode(error: unknown): WorkerFailureCode {
  if (error instanceof EngineSetupError) {
    if (error.code === 'authentication_required') return 'authentication_required';
    return error.code === 'connection_unavailable' ? 'connection_unavailable' : 'invalid_configuration';
  }
  if (error instanceof DeadlineExceededError) return 'connection_unavailable';
  if (error instanceof ApiFailure && error.code === 'AUTHENTICATION_REQUIRED') return 'authentication_required';
  return 'execution_failure';
}
