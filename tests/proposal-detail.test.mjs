import test from 'node:test';
import assert from 'node:assert/strict';
import { Repository } from '../server/repository.mjs';
import { validateUuid } from '../server/validation.mjs';
import { normalizeProposalId, proposalPath, renderProposal } from '../public/proposal-view.mjs';
import { createApiRouter } from '../server/routes.mjs';

const id = '9B8A7C13-3780-4482-9E10-1AB174270BCF';

test('proposal IDs and permanent URLs are normalized without accepting arbitrary input', () => {
  assert.equal(validateUuid(id, 'Proposal ID'), id.toLowerCase());
  assert.equal(normalizeProposalId(id), id.toLowerCase());
  assert.equal(proposalPath(id), `/lab?proposal=${id.toLowerCase()}`);
  assert.equal(normalizeProposalId('../private'), null);
  assert.throws(() => validateUuid('not-a-uuid', 'Proposal ID'), /must be a UUID/);
});

test('proposal views escape untrusted public fields and keep titles linked', () => {
  const html = renderProposal({
    id,
    title: '<img src=x onerror=alert(1)>',
    description: 'Useful & public <script>alert(1)</script>',
    status: 'pending',
  }, { dateLabel: '7 Oct 2026' });
  assert.match(html, /href="\/lab\?proposal=9b8a7c13-3780-4482-9e10-1ab174270bcf"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Useful &amp; public &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<img/);
});

test('single proposal reads are parameterized and expose only public fields', async () => {
  const pool = { query: async (sql, values) => {
    assert.match(sql, /FROM skwid\.proposals WHERE id = \$1/);
    assert.deepEqual(values, [id.toLowerCase()]);
    return { rowCount: 1, rows: [{
      id: id.toLowerCase(), title: 'Public title', description: 'Public description', status: 'pending',
      created_at: '2026-10-08T00:00:00.000Z', submitter_hash: 'must-not-leak', candidate_changes: ['private'],
    }] };
  } };
  const proposal = await new Repository(pool).getProposal(id.toLowerCase());
  assert.deepEqual(Object.keys(proposal), ['id', 'title', 'description', 'status', 'createdAt']);
  assert.equal(proposal.submitter_hash, undefined);
});

test('single proposal reads return a concise 404 for unknown valid IDs', async () => {
  const repository = new Repository({ query: async () => ({ rowCount: 0, rows: [] }) });
  await assert.rejects(repository.getProposal(id.toLowerCase()), (error) => error.status === 404 && error.message === 'Proposal not found.');
});

test('public proposal detail route validates IDs and returns one public record', async () => {
  const publicRecord = { id: id.toLowerCase(), title: 'Public title', description: 'Public description', status: 'pending', createdAt: '2026-10-08T00:00:00.000Z' };
  const repository = {
    getProposal: async (value) => value === id.toLowerCase() ? publicRecord : null,
  };
  const router = createApiRouter({ config: { adminToken: 'owner-only' }, pool: null, repository });
  const route = router.stack.find((layer) => layer.route?.path === '/proposals/:id').route.stack[0].handle;
  const invoke = (value) => new Promise((resolve) => {
    route({ params: { id: value } }, { json: (body) => resolve({ body }) }, (error) => resolve({ error }));
  });
  const invalid = await invoke('not-a-uuid');
  assert.equal(invalid.error.status, 400);
  assert.equal(invalid.error.message, 'Proposal ID must be a UUID.');
  assert.deepEqual(await invoke(id), { body: publicRecord });
});
