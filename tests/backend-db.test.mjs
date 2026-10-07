import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPool } from '../server/db.mjs';
import { loadConfig } from '../server/config.mjs';

test('Postgres roundtrip persists and reads a proposal when DATABASE_URL is supplied', { skip: !process.env.DATABASE_URL }, async () => {
  const pool = createPool(loadConfig());
  const client = await pool.connect();
  const id = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO skwid.proposals (id, title, description, submitter_hash) VALUES ($1, $2, $3, $4)`,
      [id, 'Database verification', 'Temporary transaction-scoped record.', 'test'],
    );
    const result = await client.query(`SELECT title, status FROM skwid.proposals WHERE id = $1`, [id]);
    assert.deepEqual(result.rows[0], { title: 'Database verification', status: 'pending' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
