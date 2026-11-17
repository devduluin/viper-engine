import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { APPROVAL_STATUSES, APPROVAL_TRANSITIONS } from '../../../src/contracts/state/approval-state.js';
import { RUN_STATUSES, RUN_TRANSITIONS } from '../../../src/contracts/state/run-state.js';
import { TOOL_CALL_STATUSES, TOOL_CALL_TRANSITIONS } from '../../../src/contracts/state/tool-call-state.js';

const spec = readFileSync(new URL('../../../docs/schema/state-transitions.md', import.meta.url), 'utf8');

/** Parses `| \`from\` | \`to\` (evidence), ... |` rows under one `## heading`. */
function section(heading: string): Map<string, string[]> {
  const start = spec.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `missing section ${heading}`);
  const end = spec.indexOf('\n## ', start + 1);
  const rows = new Map<string, string[]>();
  for (const line of spec.slice(start, end < 0 ? undefined : end).split(/\r?\n/)) {
    const match = /^\| `(\w+)` \| (.+) \|$/.exec(line);
    if (match === null) continue;
    const [, from, targets] = match as unknown as [string, string, string];
    const parsed = targets === 'terminal' ? [] : targets.split(', ').map(target => {
      const cell = /^`(\w+)`(?: \((\w+)\))?$/.exec(target);
      assert.ok(cell, `unparseable target ${target}`);
      return cell[2] === undefined ? `${cell[1]}` : `${cell[1]}:${cell[2]}`;
    });
    rows.set(from, parsed);
  }
  return rows;
}

function assertMirror(doc: Map<string, string[]>, statuses: readonly string[], code: (from: string) => string[]): void {
  assert.deepEqual([...doc.keys()].sort(), [...statuses].sort());
  for (const status of statuses) assert.deepEqual(doc.get(status)?.sort(), code(status).sort(), status);
}

test('run transition table in docs matches the contract', () => {
  assertMirror(section('Run transitions'), RUN_STATUSES, from => [...RUN_TRANSITIONS[from as keyof typeof RUN_TRANSITIONS]]);
});

test('tool call transition table in docs matches the contract including evidence', () => {
  assertMirror(section('Tool call transitions'), TOOL_CALL_STATUSES, from =>
    TOOL_CALL_TRANSITIONS[from as keyof typeof TOOL_CALL_TRANSITIONS].map(rule =>
      rule.requires === 'none' ? rule.to : `${rule.to}:${rule.requires}`));
});

test('approval transition table in docs matches the contract', () => {
  assertMirror(section('Approval transitions'), APPROVAL_STATUSES, from =>
    [...APPROVAL_TRANSITIONS[from as keyof typeof APPROVAL_TRANSITIONS]]);
});
