import test from 'node:test';
import assert from 'node:assert/strict';
import { Repository } from '../server/repository.mjs';
import { createApiRouter } from '../server/routes.mjs';
import { renderJournalNeighbors } from '../public/journal-neighbors.mjs';

const currentId = '22222222-2222-4222-8222-222222222222';
const newerId = '33333333-3333-4333-8333-333333333333';
const olderId = '11111111-1111-4111-8111-111111111111';

test('journal queries use deterministic timestamp and ID ordering across the full table', async () => {
  const queries = [];
  const pool = { query: async (sql) => {
    queries.push(sql);
    if (sql.includes('WITH current')) return { rowCount: 1, rows: [{
      id: currentId, title: 'Current', summary: 'Summary', created_at: '2026-10-08T00:00:00Z',
      commit_sha: 'abc', checks: [], details: {}, newer_id: newerId, newer_title: 'Newer', older_id: olderId, older_title: 'Older',
    }] };
    return { rows: [] };
  } };
  const repository = new Repository(pool);
  await repository.listJournal();
  const entry = await repository.getJournal(currentId);
  assert.match(queries[0], /ORDER BY created_at DESC, id DESC LIMIT 100/);
  assert.match(queries[1], /\(created_at, id\) > \(current\.created_at, current\.id\)[\s\S]*ORDER BY created_at ASC, id ASC LIMIT 1/);
  assert.match(queries[1], /\(created_at, id\) < \(current\.created_at, current\.id\)[\s\S]*ORDER BY created_at DESC, id DESC LIMIT 1/);
  assert.deepEqual(entry.neighbors, { newer: { id: newerId, title: 'Newer' }, older: { id: olderId, title: 'Older' } });
});

test('journal detail maps first, last, and single-entry boundaries to null without wrapping', async () => {
  for (const [newer, older] of [[newerId, null], [null, olderId], [null, null]]) {
    const row = { id: currentId, title: 'Current', summary: '', created_at: new Date(), commit_sha: 'abc', checks: [], details: {}, newer_id: newer, newer_title: 'Newer', older_id: older, older_title: 'Older' };
    const entry = await new Repository({ query: async () => ({ rowCount: 1, rows: [row] }) }).getJournal(currentId);
    assert.equal(entry.neighbors.newer?.id || null, newer);
    assert.equal(entry.neighbors.older?.id || null, older);
  }
});

test('neighbor renderer uses ordinary safe permalinks and escapes untrusted titles', () => {
  const html = renderJournalNeighbors({ newer: { id: newerId.toUpperCase(), title: '<Newer & next>' }, older: null });
  assert.match(html, new RegExp(`/journal\\?entry=${newerId}`));
  assert.match(html, /&lt;Newer &amp; next&gt;/);
  assert.match(html, /All entries/);
  assert.doesNotMatch(html, /Older entry|<Newer/);
  assert.doesNotMatch(renderJournalNeighbors({ newer: { id: '../private', title: 'Unsafe' } }), /Unsafe/);
});

test('neighbor and All entries links retain normalized search context', () => {
  const html = renderJournalNeighbors({ newer: { id: newerId, title: 'Newer' }, older: { id: olderId, title: 'Older' } }, '  release & memory/?  ');
  assert.match(html, new RegExp(`/journal\\?entry=${newerId}&q=release%20%26%20memory%2F%3F`));
  assert.match(html, new RegExp(`/journal\\?entry=${olderId}&q=release%20%26%20memory%2F%3F`));
  assert.match(html, /href="\/journal\?q=release%20%26%20memory%2F%3F">All entries/);
  assert.doesNotMatch(renderJournalNeighbors({ newer: { id: newerId, title: 'Newer' } }, ''), /&q=/);
});

test('journal detail route rejects invalid IDs before repository access', async () => {
  let called = false;
  const repository = { getJournal: async () => { called = true; } };
  const router = createApiRouter({ config: { adminToken: 'owner' }, repository, pool: null });
  const route = router.stack.find((layer) => layer.route?.path === '/journal/:id').route.stack[0].handle;
  const error = await new Promise((resolve) => route({ params: { id: 'not-a-uuid' } }, { json: () => resolve(null) }, resolve));
  assert.equal(error.status, 400);
  assert.equal(error.message, 'Journal ID must be a UUID.');
  assert.equal(called, false);
});
