import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChanges, validateProposal, validateRunRequest } from '../server/validation.mjs';

const policy = { allowedRoots: ['src/', 'server/', 'tests/'], maxFiles: 3, maxBytes: 100 };

test('proposal validation trims input and rejects the honeypot', () => {
  assert.deepEqual(validateProposal({ title: '  Better docs ', description: ' Explain the flow. ' }), {
    title: 'Better docs', description: 'Explain the flow.',
  });
  assert.throws(() => validateProposal({ title: 'x', description: 'y', website: 'bot' }), /rejected/);
});

test('change validation permits bounded source files', () => {
  assert.deepEqual(validateChanges([{ path: 'src/view.js', operation: 'write', content: 'export {}' }], policy), [
    { path: 'src/view.js', operation: 'write', content: 'export {}' },
  ]);
});

test('change validation blocks traversal, protected paths, duplicates, and oversized content', () => {
  for (const path of ['../src/x.js', '.env', 'server/config/keys.js', 'server/config.mjs', 'server/auth.mjs', 'infrastructure/app.json', '/src/x.js']) {
    assert.throws(() => validateChanges([{ path, operation: 'write', content: 'x' }], policy));
  }
  assert.throws(() => validateChanges([
    { path: 'src/x.js', operation: 'write', content: 'x' },
    { path: 'src/x.js', operation: 'delete' },
  ], policy));
  assert.throws(() => validateChanges([{ path: 'src/x.js', operation: 'write', content: 'x'.repeat(101) }], policy));
  assert.throws(() => validateChanges([{ path: 'src/x.js', operation: 'write', content: 'x', command: 'npm test' }], policy));
});

test('run requests require a frozen full commit hash', () => {
  const valid = validateRunRequest({
    proposalId: '7dd70741-a8da-4d2d-8603-57ad4a324b17',
    baseCommit: 'a'.repeat(40),
    changes: [{ path: 'src/x.js', operation: 'write', content: 'x' }],
  }, policy);
  assert.equal(valid.baseCommit, 'a'.repeat(40));
  assert.throws(() => validateRunRequest({ proposalId: 'x', baseCommit: 'main', changes: null }, policy), /baseCommit/);
});
