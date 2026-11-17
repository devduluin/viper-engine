import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { ApprovalProposal, ApprovalRevision } from '../../../contracts/state/ports.js';
import { toolSnapshotOf } from './rows.js';

/** The approver view and the digest check must observe one immutable request across I/O. */
export function snapshotProposal(input: ApprovalProposal): ApprovalProposal {
  return Object.freeze({ ...input, arguments: parseJsonObject(input.arguments), toolSnapshot: toolSnapshotOf(input.toolSnapshot),
    binding: Object.freeze({ ...input.binding, tool: Object.freeze({ ...input.binding.tool }) }),
    events: Object.freeze([...input.events]),
  });
}

export function snapshotRevision(input: ApprovalRevision): ApprovalRevision {
  return Object.freeze({ ...input, arguments: parseJsonObject(input.arguments), events: Object.freeze([...input.events]) });
}
