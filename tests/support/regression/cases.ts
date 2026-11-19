import type { FakeReply } from '../anthropic/fake-api.js';
import { done, toolTurn } from '../../integration/postgres/engine-fixtures.js';
import type { RunStatus } from '../../../src/contracts/state/run-state.js';

export interface EngineCase {
  readonly id: string;
  readonly family: string;
  readonly replies: readonly FakeReply[];
  readonly control?: 'accept' | 'reject' | 'input' | 'cancel';
  readonly unknownWrite?: boolean;
  readonly expected: { readonly status: RunStatus; readonly modelCalls: number; readonly tools: readonly string[];
    readonly writes: number; readonly outcome?: 'success' | 'error' | 'unknown'; readonly data?: object; readonly refusalCode?: string };
}
/** Frozen synthetic decisions, independent of engine output; not a semantic model benchmark. */
export function engineCases(): readonly EngineCase[] {
  return [
    { id: 'ER-001', family: 'final', replies: [done], expected: { status: 'completed', modelCalls: 1, tools: [], writes: 0 } },
    { id: 'ER-002', family: 'dependent-tools', replies: [toolTurn('lookup_item', { id: 'a' }, 'read'), toolTurn('add', { a: 5, b: 3 }, 'sum'), done],
      expected: { status: 'completed', modelCalls: 3, tools: ['lookup_item', 'add'], writes: 0, outcome: 'success', data: { sum: 8 } } },
    { id: 'ER-003', family: 'valid-empty', replies: [toolTurn('empty_rows'), done],
      expected: { status: 'completed', modelCalls: 2, tools: ['empty_rows'], writes: 0, outcome: 'success', data: { rows: [] } } },
    { id: 'ER-004', family: 'exact-approval', replies: [toolTurn('record_write', { count: 5 }), done], control: 'accept',
      expected: { status: 'completed', modelCalls: 2, tools: ['record_write'], writes: 1, outcome: 'success', data: { count: 5 } } },
    { id: 'ER-005', family: 'user-declined', replies: [toolTurn('record_write', { count: 5 }), { blocks: [{ type: 'text', text: 'The write was declined; nothing was sent.' }] }], control: 'reject',
      expected: { status: 'completed', modelCalls: 2, tools: [], writes: 0, outcome: 'error', refusalCode: 'rejected_by_user' } },
    { id: 'ER-006', family: 'tool-error', replies: [toolTurn('lookup_item', { id: 'missing' }), done],
      expected: { status: 'failed', modelCalls: 2, tools: ['lookup_item'], writes: 0, outcome: 'error' } },
    { id: 'ER-007', family: 'schema-refusal', replies: [toolTurn('record_write', { count: 0 }), { blocks: [{ type: 'text', text: 'The count is invalid; nothing was sent.' }] }],
      expected: { status: 'completed', modelCalls: 2, tools: [], writes: 0, outcome: 'error', refusalCode: 'invalid_value' } },
    { id: 'ER-008', family: 'unknown-write', replies: [toolTurn('record_write', { count: 5 }), done], control: 'accept', unknownWrite: true,
      expected: { status: 'partial', modelCalls: 2, tools: ['record_write'], writes: 1, outcome: 'unknown' } },
    { id: 'ER-009', family: 'clarification', replies: [], control: 'input',
      expected: { status: 'completed', modelCalls: 2, tools: [], writes: 0 } },
    { id: 'ER-010', family: 'cancel-before-setup', replies: [], control: 'cancel',
      expected: { status: 'cancelled', modelCalls: 0, tools: [], writes: 0 } },
  ];
}
