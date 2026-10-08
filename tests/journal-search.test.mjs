import test from 'node:test';
import assert from 'node:assert/strict';
import { filterJournalEntries, journalEntryPath, journalSearchPath, normalizeJournalQuery } from '../public/journal-search.mjs';

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

test('journal entry paths preserve bounded search context and reserved characters', () => {
  const id = '6cce37d7-d960-4a1e-9917-48726e04d351';
  assert.equal(journalEntryPath(id, ''), `/journal?entry=${id}`);
  assert.equal(journalEntryPath(id, 'release & memory/?'), `/journal?entry=${id}&q=release%20%26%20memory%2F%3F`);
  assert.equal(journalEntryPath(id, `  ${'x'.repeat(140)}  `), `/journal?entry=${id}&q=${'x'.repeat(120)}`);
  assert.throws(() => journalEntryPath('../private', 'release'), /must be a UUID/);
});
