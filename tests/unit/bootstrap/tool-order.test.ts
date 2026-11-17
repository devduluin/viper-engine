import assert from 'node:assert/strict';
import test from 'node:test';
import { sortByAlias } from '../../../src/bootstrap/mcp-tools.js';

test('catalog order is deterministic code-point order of aliases, independent of discovery order', () => {
  const discovered = [
    { alias: 'workin__hris_employees_search' }, { alias: 'margin__ledger_list' }, { alias: 'workin__hris_attendance_ping' },
    { alias: 'Workin__upper' }, { alias: 'workin__hris_attendance_get_schedule' },
  ];
  const expected = ['Workin__upper', 'margin__ledger_list', 'workin__hris_attendance_get_schedule',
    'workin__hris_attendance_ping', 'workin__hris_employees_search'];
  assert.deepEqual(sortByAlias(discovered).map(tool => tool.alias), expected);
  assert.deepEqual(sortByAlias([...discovered].reverse()).map(tool => tool.alias), expected);
  assert.deepEqual(discovered[0], { alias: 'workin__hris_employees_search' }, 'input is not mutated');
});
