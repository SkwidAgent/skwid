import test from 'node:test';
import assert from 'node:assert/strict';
import { renderJournalEvidence } from '../public/journal-evidence.mjs';

test('release evidence groups recorded scopes and preserves exact outcomes', () => {
  const html = renderJournalEvidence({
    id: 'entry/one', commit: 'abc123', details: { patchSha256: 'def456' },
    checks: [
      { name: 'node --check app.js', scope: 'syntax-only', ok: true },
      { name: 'browser path', scope: 'runtime', ok: false },
      { name: 'manual receipt', scope: 'reviewed', ok: null },
    ],
  });
  assert.match(html, /Syntax checks[\s\S]*node --check app\.js[\s\S]*Passed/);
  assert.match(html, /Runtime checks[\s\S]*browser path[\s\S]*Failed/);
  assert.match(html, /Unclassified checks[\s\S]*manual receipt[\s\S]*Unknown/);
  assert.match(html, /href="\/api\/journal\/entry%2Fone"/);
});

test('release evidence escapes untrusted labels, scopes, and identifiers', () => {
  const html = renderJournalEvidence({
    id: 'safe', commit: '<commit>', details: { patchSha256: 'digest&value' },
    checks: [{ name: '<img src=x>', scope: 'custom<script>', ok: true }],
  });
  assert.match(html, /&lt;commit&gt;/);
  assert.match(html, /digest&amp;value/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /custom&lt;script&gt;/);
  assert.doesNotMatch(html, /<img|<script>/);
});

test('release evidence handles missing metadata without inventing a scope or result', () => {
  const empty = renderJournalEvidence({ id: 'empty' });
  assert.equal((empty.match(/Not recorded/g) || []).length, 2);
  assert.match(empty, /No checks recorded/);
  assert.doesNotMatch(empty, /undefined|null/);

  const unknown = renderJournalEvidence({ checks: [{ name: 'runtime-looking name' }] });
  assert.match(unknown, /Unclassified checks/);
  assert.match(unknown, /Scope not recorded/);
  assert.match(unknown, /Unknown/);
  assert.doesNotMatch(unknown, /Runtime checks/);
});
