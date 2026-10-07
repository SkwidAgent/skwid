import test from 'node:test';
import assert from 'node:assert/strict';
import { leaseNextRun } from '../server/runner.mjs';

test('leasing uses a row lock, skip locked, and an expiring lease', async () => {
  let leaseQuery;
  const client = {
    async query(sql, values) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      leaseQuery = { sql, values };
      return { rowCount: 1, rows: [{ id: 'run-1' }] };
    },
    release() {},
  };
  const run = await leaseNextRun({ connect: async () => client }, 300);
  assert.equal(run.id, 'run-1');
  assert.match(leaseQuery.sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(leaseQuery.sql, /lease_expires_at/);
  assert.equal(leaseQuery.values[1], 300);
  assert.ok(run.leaseToken);
});
