import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionOptions } from '../server/db.mjs';

const ca = '-----BEGIN CERTIFICATE-----\npublic-ca\n-----END CERTIFICATE-----';

test('database options require verified TLS and ignore URL SSL overrides', () => {
  const options = connectionOptions({
    databaseUrl: 'postgresql://user:pass@example.com/db?sslmode=no-verify&sslrootcert=%2Ftmp%2Fwrong',
    databaseCaCert: ca,
    databaseCaPath: null,
  });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.ca, ca);
  const url = new URL(options.connectionString);
  assert.equal(url.searchParams.has('sslmode'), false);
  assert.equal(url.searchParams.has('sslrootcert'), false);
});

test('database options fail closed without a PEM CA', () => {
  assert.throws(() => connectionOptions({ databaseUrl: 'postgresql://user:pass@example.com/db', databaseCaCert: null, databaseCaPath: null }), /CA certificate/);
});
