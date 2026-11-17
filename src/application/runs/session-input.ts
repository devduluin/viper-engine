import { parseId } from '../../contracts/identity/ids.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import { parseContent } from '../../contracts/messages/parse-content.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';
import { appendRuntimeMessages, driveAgentLoop } from '../../agent/runtime/run-loop.js';
import { indexTools } from '../../agent/execution/tool-catalog.js';
import { activateSession } from './session-lifecycle.js';
import type { InputAction, SessionState } from './session-state.js';
import { SessionError } from './session-state.js';

export function inputFingerprint(action: InputAction): string {
  parseId('input', action.inputId);
  return createFingerprint(parseContent(action.content), { domain: 'run-input', version: 'v1' });
}

export async function submitSessionInput(state: SessionState, action: InputAction): Promise<void> {
  if (state.result.status !== 'waiting_for_input') throw new SessionError('invalid_state');
  const content = parseContent(action.content);
  const message = parseMessage({ id: state.deps.ids.next('message'), role: 'user', content });
  const index = indexTools(await state.deps.refreshTools(state.context.input.scope), state.context.input.scope);
  state.context = { ...state.context, index };
  await activateSession(state, async () => {
    await appendRuntimeMessages(state.context, [message]);
    return driveAgentLoop(state.context);
  });
}
