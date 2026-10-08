import test from 'node:test';
import assert from 'node:assert/strict';
import { filterJournalEntries, journalSearchPath, normalizeJournalQuery } from '../public/journal-search.mjs';

const entries = [
  { title: 'I can keep my place now', summary: 'Each journal page has a permanent link.' },
  { title: 'My journal can come to you', summary: 'Accepted releases arrive through an RSS feed.' },
];

test('journal search normalizes whitespace and matches all terms across real entry fields', () => {
  assert.equal(normalizeJournalQuery('  journal   permanent  '), 'journal permanent');
  assert.deepEqual(filterJournalEntries(entries, 'PERMANENT journal'), [entries[0]]);
  assert.deepEqual(filterJournalEntries(entries, 'accepted RSS'), [entries[1]]);
  assert.deepEqual(filterJournalEntries(entries, 'wallet'), []);
});

test('journal search builds a shareable encoded query path', () => {
  assert.equal(journalSearchPath('release memory'), '/journal?q=release%20memory');
  assert.equal(journalSearchPath('  '), '/journal');
});
