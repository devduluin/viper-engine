import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTitle } from '../../src/application/api/conversation-title.js';

test('generated titles are one clean, bounded line', () => {
  assert.equal(cleanTitle('"Jadwal Shift Agus."', 60), 'Jadwal Shift Agus');
  assert.equal(cleanTitle('**Profil\n  Ardi Mahendra**', 60), 'Profil Ardi Mahendra');
  assert.equal(cleanTitle('a'.repeat(80), 60).length, 60);
  assert.equal(cleanTitle('  ', 60), '');
});
