import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiRouter } from '../server/routes.mjs';
import { formatWei, observationTime, renderTreasuryObservation } from '../public/treasury-observation.mjs';

test('wei formatting preserves recorded zero and precision without coercing invalid values', () => {
  assert.equal(formatWei('0'), '0.000000');
  assert.equal(formatWei('1234567890123456789'), '1.234567');
  for (const value of [null, undefined, false, true, 0, 1, '', ' 0', '-1', '1.2', 'not-a-number']) assert.equal(formatWei(value), null);
});

test('observation timing reports exact UTC time and age without labeling invalid or future values', () => {
  const now = Date.parse('2026-10-08T08:10:00.000Z');
  assert.deepEqual(observationTime('2026-10-08T08:09:40.000Z', now), {
    iso: '2026-10-08T08:09:40.000Z', label: '2026-10-08 08:09:40 UTC', age: 'less than a minute ago',
  });
  assert.equal(observationTime('2026-10-08T06:05:00.000Z', now).age, '2 hours ago');
  assert.equal(observationTime('2026-10-05T08:10:00.000Z', now).age, '3 days ago');
  for (const value of [null, undefined, '', 'invalid', '2026-10-08T08:10:01.000Z']) assert.equal(observationTime(value, now), null);
});

test('treasury renderer shows truthful missing state and safely renders recorded provenance', () => {
  assert.match(renderTreasuryObservation(null), /No treasury observation has been recorded/);
  const html = renderTreasuryObservation({
    address: '<treasury>', balanceWei: null, observedAt: 'invalid', blockNumber: '<block>',
  });
  assert.match(html, /&lt;treasury&gt;/);
  assert.match(html, /Unavailable/);
  assert.match(html, /Timing unavailable/);
  assert.match(html, /SOURCE BLOCK[\s\S]*Not recorded/);
  assert.doesNotMatch(html, /<treasury>|<block>/);
});

test('status route projects the stored source block without changing the observation', async () => {
  const latest = { address: '0x123', balanceWei: '0', observedAt: '2026-10-08T08:00:00.000Z', blockNumber: '456' };
  const repository = {
    status: async () => ({ proposals: 1, runs: 1, releases: 1, last_run_at: null, active: false }),
    treasury: async () => [latest],
  };
  const config = { adminToken: 'owner', chain: { id: 4663, name: 'Robinhood Chain' }, token: {}, links: {} };
  const router = createApiRouter({ config, repository, pool: null });
  const route = router.stack.find((layer) => layer.route?.path === '/status').route.stack[0].handle;
  const response = await new Promise((resolve) => route({}, { json: resolve }, (error) => { throw error; }));
  assert.deepEqual(response.treasury, latest);
});
