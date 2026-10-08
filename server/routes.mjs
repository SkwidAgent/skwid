import { Router } from 'express';
import { hashRemoteAddress, requireAdmin } from './auth.mjs';
import { observeTreasury, preparePonsCollection, readPonsFeeConfiguration } from './chain.mjs';
import { HttpError } from './errors.mjs';
import { JOURNAL_FEED_CONTENT_TYPE, renderJournalFeed } from './journal-feed.mjs';
import { prepareReleaseRecord, readReleaseRegistry } from './registry.mjs';
import { validateProposal, validateRunRequest } from './validation.mjs';

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function submissionLimiter({ windowMs = 10 * 60_000, limit = 5 } = {}) {
  const buckets = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [address, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(address);
      }
      while (buckets.size > 10_000) buckets.delete(buckets.keys().next().value);
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= limit) return next(new HttpError(429, 'rate_limited', 'Please wait before submitting another idea.'));
    bucket.count += 1;
    next();
  };
}

export function createApiRouter({ config, repository, pool }) {
  const router = Router();
  const owner = requireAdmin(config);

  router.get('/status', asyncRoute(async (_req, res) => {
    const state = await repository.status();
    const observations = await repository.treasury();
    const latest = observations[0] || null;
    const token = config.token.address
      ? { address: config.token.address, explorerUrl: config.token.explorerUrl || null }
      : null;
    res.json({
      name: 'Skwid',
      ticker: '$Swkid',
      chain: { id: config.chain.id, name: config.chain.name },
      token,
      treasury: latest ? { address: latest.address, balanceWei: latest.balanceWei, observedAt: latest.observedAt } : null,
      agent: { status: state.active ? 'running' : 'owner-operated', lastRunAt: state.last_run_at },
      links: config.links,
      counts: { proposals: state.proposals, runs: state.runs, releases: state.releases },
    });
  }));

  router.get('/proposals', asyncRoute(async (_req, res) => res.json({ items: await repository.listProposals() })));
  router.post('/proposals', submissionLimiter(), asyncRoute(async (req, res) => {
    const input = validateProposal(req.body);
    const created = await repository.createProposal({ ...input, ipHash: hashRemoteAddress(req.ip) });
    res.status(201).json(created);
  }));

  router.get('/journal', asyncRoute(async (_req, res) => res.json({ items: await repository.listJournal() })));
  router.get('/journal/feed.xml', asyncRoute(async (_req, res) => {
    const xml = renderJournalFeed(await repository.listJournal());
    res.set({
      'Content-Type': JOURNAL_FEED_CONTENT_TYPE,
      'Cache-Control': 'public, max-age=60',
    }).send(xml);
  }));
  router.get('/journal/:id', asyncRoute(async (req, res) => res.json(await repository.getJournal(req.params.id))));
  router.get('/treasury', asyncRoute(async (_req, res) => res.json({ items: await repository.treasury() })));
  router.get('/fees', asyncRoute(async (_req, res) => {
    if (!config.token.address) return res.json({ configuration: null });
    res.json({ configuration: await readPonsFeeConfiguration(config) });
  }));
  router.get('/registry', asyncRoute(async (_req, res) => {
    if (!config.registry.address) return res.json({ registry: null });
    res.json({ registry: await readReleaseRegistry(config) });
  }));

  router.post('/admin/proposals/:id/approve', owner, asyncRoute(async (req, res) => res.json(await repository.approveProposal(req.params.id))));
  router.post('/admin/runs', owner, asyncRoute(async (req, res) => {
    const input = validateRunRequest(req.body, config.runner);
    const run = await repository.enqueueRun(input);
    res.status(202).json(run);
  }));
  router.post('/admin/runs/:id/reconcile', owner, asyncRoute(async (req, res) => res.json(await repository.reconcileRun(req.params.id, req.body || {}))));
  router.post('/admin/treasury/observe', owner, asyncRoute(async (_req, res) => res.status(201).json(await observeTreasury(config, pool))));
  router.post('/admin/fees/prepare', owner, asyncRoute(async (_req, res) => res.json(await preparePonsCollection(config))));
  router.post('/admin/registry/prepare', owner, asyncRoute(async (req, res) => {
    if (!req.body || typeof req.body.journalId !== 'string' || Object.keys(req.body).some((key) => !['journalId', 'supersedesReleaseHash'].includes(key))) {
      throw new HttpError(400, 'invalid_input', 'journalId is required.');
    }
    const record = await repository.registryRecord(req.body.journalId);
    res.json(await prepareReleaseRecord(config, record, req.body.supersedesReleaseHash));
  }));

  return router;
}
