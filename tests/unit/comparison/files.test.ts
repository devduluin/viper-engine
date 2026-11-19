import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest, evidenceBytes, verifyFiles } from '../../support/comparison/files.js';
import { importEvidence } from '../../support/comparison/import.js';
import { capture } from './fixtures.js';

test('external evidence is data-only and refuses path traversal, raw tampering, or unpinned source fields', () => {
  const prefix = path.join(os.tmpdir(), 'viper-comparison-'); const root = mkdtempSync(prefix);
  try {
    const payload = JSON.stringify({ source: 'SYNTHETIC UNIT ONLY, no external engine run' });
    writeFileSync(path.join(root, 'raw.json'), payload);
    const artifacts = { 'raw.json': digest(payload) };
    const envelope = { schemaVersion: 1, evidence: capture('hermes'), artifacts };
    writeFileSync(path.join(root, 'comparison-evidence.json'), JSON.stringify(envelope));
    assert.equal(importEvidence(root).evidence.engine, 'hermes');
    assert.equal(verifyFiles(root, artifacts)['raw.json'], digest(payload));
    for (const name of ['../raw.json', '.env', '/raw.json', 'nested/raw.json']) assert.throws(() => evidenceBytes(root, name));
    writeFileSync(path.join(root, 'raw.json'), 'tampered'); assert.throws(() => importEvidence(root), /checksum mismatch/);
    writeFileSync(path.join(root, 'raw.json'), payload);
    writeFileSync(path.join(root, 'comparison-evidence.json'), JSON.stringify({ ...envelope, command: 'never execute' }));
    assert.throws(() => importEvidence(root), /Unknown capture/);
  } finally { assert.ok(root.startsWith(prefix)); rmSync(root, { recursive: true, force: true }); }
});
