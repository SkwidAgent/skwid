import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin } from '../server/auth.mjs';

const invoke = (configured, header) => new Promise((resolve) => {
  const middleware = requireAdmin({ adminToken: configured });
  middleware({ get: () => header }, {}, (error) => resolve(error || null));
});

test('admin middleware accepts only the configured bearer token', async () => {
  assert.equal(await invoke('correct-horse', 'Bearer correct-horse'), null);
  assert.equal((await invoke('correct-horse', 'Bearer wrong')).status, 401);
  assert.equal((await invoke(null, 'Bearer correct-horse')).status, 401);
  assert.equal((await invoke('correct-horse', '')).status, 401);
});
