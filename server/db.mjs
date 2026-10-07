import pg from 'pg';
import fs from 'node:fs';

const { Pool } = pg;

export function connectionOptions(config) {
  if (!config.databaseUrl) return null;
  const url = new URL(config.databaseUrl);
  const queryCaPath = url.searchParams.get('sslrootcert');
  const caPath = config.databaseCaPath || queryCaPath;
  const ca = config.databaseCaCert || (caPath ? fs.readFileSync(caPath, 'utf8') : null);
  if (!ca || !/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(ca)) {
    throw new Error('A PEM database CA certificate is required for verified TLS.');
  }
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true },
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 8_000,
  };
}

export function createPool(config) {
  const options = connectionOptions(config);
  return options ? new Pool(options) : null;
}

export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseReady(pool) {
  if (!pool) return false;
  try {
    const result = await pool.query("SELECT to_regclass('skwid.proposals') AS proposals");
    return result.rows[0]?.proposals === 'skwid.proposals';
  } catch {
    return false;
  }
}
