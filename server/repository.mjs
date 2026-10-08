import { createHash, randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { HttpError } from './errors.mjs';

const proposalView = (row) => ({ id: row.id, title: row.title, description: row.description, status: row.status, createdAt: row.created_at });
const journalView = (row, detailed = false) => {
  const item = { id: row.id, title: row.title, summary: row.summary, createdAt: row.created_at, commit: row.commit_sha, checks: row.checks };
  if (detailed) {
    item.details = row.details;
    item.neighbors = {
      newer: row.newer_id ? { id: row.newer_id, title: row.newer_title } : null,
      older: row.older_id ? { id: row.older_id, title: row.older_title } : null,
    };
  }
  return item;
};

export class Repository {
  constructor(pool) {
    this.pool = pool;
  }

  async createProposal({ title, description, ipHash }) {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO skwid.proposals (id, title, description, submitter_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, status`,
      [id, title, description, ipHash],
    );
    return result.rows[0];
  }

  async listProposals() {
    const result = await this.pool.query(
      `SELECT id, title, description, status, created_at
       FROM skwid.proposals ORDER BY created_at DESC LIMIT 100`,
    );
    return result.rows.map(proposalView);
  }

  async getProposal(id) {
    const result = await this.pool.query(
      `SELECT id, title, description, status, created_at
       FROM skwid.proposals WHERE id = $1`,
      [id],
    );
    if (!result.rowCount) throw new HttpError(404, 'not_found', 'Proposal not found.');
    return proposalView(result.rows[0]);
  }

  async approveProposal(id) {
    const result = await this.pool.query(
      `UPDATE skwid.proposals SET status = 'approved', approved_at = now(), updated_at = now()
       WHERE id = $1 AND status IN ('pending','failed') RETURNING id, status`,
      [id],
    );
    if (!result.rowCount) throw new HttpError(409, 'invalid_state', 'Only pending or failed proposals can be approved.');
    return result.rows[0];
  }

  async enqueueRun({ proposalId, baseCommit, changes }) {
    return transaction(this.pool, async (client) => {
      const proposal = await client.query(
        `SELECT id FROM skwid.proposals WHERE id = $1 AND status = 'approved' FOR UPDATE`,
        [proposalId],
      );
      if (!proposal.rowCount) throw new HttpError(409, 'invalid_state', 'The proposal must be approved before a run is queued.');
      const existing = await client.query(
        `SELECT id FROM skwid.runs WHERE proposal_id = $1 AND status IN ('queued','running','review_ready')`,
        [proposalId],
      );
      if (existing.rowCount) throw new HttpError(409, 'invalid_state', 'This proposal already has an active run.');
      const result = await client.query(
        `INSERT INTO skwid.runs (id, proposal_id, base_commit, status, input_source, candidate_changes)
         VALUES ($1, $2, $3, 'queued', $4, $5::jsonb) RETURNING id, status`,
        [randomUUID(), proposalId, baseCommit, changes ? 'owner' : 'model', changes ? JSON.stringify(changes) : null],
      );
      await client.query(`UPDATE skwid.proposals SET status = 'queued', updated_at = now() WHERE id = $1`, [proposalId]);
      return result.rows[0];
    });
  }

  async status() {
    const result = await this.pool.query(
      `SELECT
         (SELECT count(*)::int FROM skwid.proposals) AS proposals,
         (SELECT count(*)::int FROM skwid.runs) AS runs,
         (SELECT count(*)::int FROM skwid.releases) AS releases,
         (SELECT max(finished_at) FROM skwid.runs) AS last_run_at,
         EXISTS (SELECT 1 FROM skwid.runs WHERE status IN ('queued','running')) AS active`,
    );
    return result.rows[0];
  }

  async treasury() {
    const result = await this.pool.query(
      `SELECT address, balance_wei, observed_at, block_number
       FROM skwid.treasury_observations ORDER BY observed_at DESC LIMIT 100`,
    );
    return result.rows.map((row) => ({
      address: row.address,
      balanceWei: row.balance_wei,
      observedAt: row.observed_at,
      blockNumber: row.block_number == null ? null : String(row.block_number),
    }));
  }

  async listJournal() {
    const result = await this.pool.query(
      `SELECT id, title, summary, created_at, commit_sha, checks
       FROM skwid.journal ORDER BY created_at DESC, id DESC LIMIT 100`,
    );
    return result.rows.map((row) => journalView(row));
  }

  async getJournal(id) {
    const result = await this.pool.query(
      `WITH current AS (
         SELECT id, title, summary, created_at, commit_sha, checks, details
         FROM skwid.journal WHERE id = $1
       )
       SELECT current.*,
         newer.id AS newer_id, newer.title AS newer_title,
         older.id AS older_id, older.title AS older_title
       FROM current
       LEFT JOIN LATERAL (
         SELECT id, title FROM skwid.journal
         WHERE (created_at, id) > (current.created_at, current.id)
         ORDER BY created_at ASC, id ASC LIMIT 1
       ) newer ON true
       LEFT JOIN LATERAL (
         SELECT id, title FROM skwid.journal
         WHERE (created_at, id) < (current.created_at, current.id)
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) older ON true`,
      [id],
    );
    if (!result.rowCount) throw new HttpError(404, 'not_found', 'Journal entry not found.');
    return journalView(result.rows[0], true);
  }

  async registryRecord(id) {
    const result = await this.pool.query(
      `SELECT j.id AS journal_id, j.run_id, j.commit_sha, j.checks,
              j.details->>'patchSha256' AS patch_sha256
       FROM skwid.journal j
       JOIN skwid.releases rel ON rel.run_id = j.run_id
       WHERE j.id = $1`,
      [id],
    );
    if (!result.rowCount) throw new HttpError(404, 'not_found', 'Published journal record not found.');
    return result.rows[0];
  }

  async reconcileRun(id, input) {
    if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !['decision', 'title', 'summary'].includes(key))) {
      throw new HttpError(400, 'invalid_input', 'Reconciliation contains unsupported fields.');
    }
    if (!['publish', 'reject'].includes(input.decision)) throw new HttpError(400, 'invalid_input', 'decision must be publish or reject.');
    return transaction(this.pool, async (client) => {
      const runResult = await client.query(
        `SELECT r.*, p.title AS proposal_title, p.description AS proposal_description
         FROM skwid.runs r JOIN skwid.proposals p ON p.id = r.proposal_id
         WHERE r.id = $1 FOR UPDATE OF r`,
        [id],
      );
      if (!runResult.rowCount) throw new HttpError(404, 'not_found', 'Run not found.');
      const run = runResult.rows[0];
      if (input.decision === 'reject') {
        if (!['review_ready', 'failed'].includes(run.status)) throw new HttpError(409, 'invalid_state', 'This run is not ready for reconciliation.');
        await client.query(`UPDATE skwid.runs SET status = 'rejected', finished_at = coalesce(finished_at, now()), updated_at = now() WHERE id = $1`, [id]);
        await client.query(`UPDATE skwid.proposals SET status = 'rejected', updated_at = now() WHERE id = $1`, [run.proposal_id]);
        return { id, status: 'rejected' };
      }
      const checks = Array.isArray(run.checks) ? run.checks : [];
      const receiptValid = checks.length > 0 && checks.every((check) => check && check.ok === true && typeof check.name === 'string');
      if (run.status !== 'review_ready' || run.check_status !== 'passed' || !receiptValid || !/^[0-9a-f]{40,64}$/i.test(run.candidate_commit || '') || !run.candidate_patch) {
        throw new HttpError(409, 'invalid_state', 'Only a checked review-ready run can be published to the journal.');
      }
      const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 140) : run.proposal_title;
      const summary = typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim().slice(0, 2000) : run.proposal_description;
      const releaseId = randomUUID();
      const journalId = randomUUID();
      const patchSha256 = createHash('sha256').update(run.candidate_patch).digest('hex');
      await client.query(
        `INSERT INTO skwid.releases (id, run_id, commit_sha, evidence) VALUES ($1, $2, $3, $4::jsonb)`,
        [releaseId, id, run.candidate_commit, JSON.stringify({ checks, patchSha256, ownerReviewed: true })],
      );
      await client.query(
        `INSERT INTO skwid.journal (id, run_id, title, summary, commit_sha, checks, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [journalId, id, title, summary, run.candidate_commit, JSON.stringify(checks), JSON.stringify({
          proposalId: run.proposal_id,
          runId: id,
          inputSource: run.input_source,
          patchSha256,
        })],
      );
      await client.query(`UPDATE skwid.runs SET status = 'published', updated_at = now() WHERE id = $1`, [id]);
      await client.query(`UPDATE skwid.proposals SET status = 'published', updated_at = now() WHERE id = $1`, [run.proposal_id]);
      return { id, status: 'published', journalId, releaseId };
    });
  }
}
