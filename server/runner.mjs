import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { transaction } from './db.mjs';
import { createModelChanges } from './model.mjs';
import { validateChanges } from './validation.mjs';

const outputLimit = 4_000;

export function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || { PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/tmp', LANG: 'C.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-outputLimit); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-outputLimit); });
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs || 30_000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut: signal === 'SIGKILL' });
    });
  });
}

export async function leaseNextRun(pool, leaseSeconds) {
  const leaseToken = randomUUID();
  return transaction(pool, async (client) => {
    const result = await client.query(
      `WITH candidate AS (
         SELECT id FROM skwid.runs
         WHERE status = 'queued' OR (status = 'running' AND lease_expires_at < now())
         ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE skwid.runs r SET status = 'running', lease_token = $1,
         lease_expires_at = now() + ($2::text || ' seconds')::interval,
         started_at = coalesce(started_at, now()), updated_at = now()
       FROM candidate WHERE r.id = candidate.id
       RETURNING r.*`,
      [leaseToken, leaseSeconds],
    );
    if (!result.rowCount) return null;
    return { ...result.rows[0], leaseToken };
  });
}

async function assertNoSymlinks(root, relative) {
  const parts = relative.split('/');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error('Change path contains a symbolic link.');
  }
}

async function applyChanges(worktree, changes) {
  for (const change of changes) {
    const absolute = path.join(worktree, ...change.path.split('/'));
    await assertNoSymlinks(worktree, change.path);
    if (change.operation === 'delete') {
      await fs.rm(absolute, { force: true });
    } else {
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await assertNoSymlinks(worktree, change.path);
      await fs.writeFile(absolute, change.content, { encoding: 'utf8', flag: 'w' });
    }
  }
}

async function runSyntaxChecks(worktree, changes) {
  const checks = [];
  const diff = await execFile('git', ['diff', '--cached', '--check'], { cwd: worktree, timeoutMs: 10_000 });
  checks.push({ name: 'syntax:git-diff-check', scope: 'syntax-only', ok: diff.code === 0, output: (diff.stdout || diff.stderr || '').slice(-outputLimit), timedOut: diff.timedOut });
  if (diff.code !== 0) return { status: 'failed', checks };
  for (const change of changes.filter((item) => item.operation === 'write')) {
    if (/\.(?:m?js|cjs)$/i.test(change.path)) {
      const result = await execFile(process.execPath, ['--check', change.path], { cwd: worktree, timeoutMs: 10_000 });
      checks.push({ name: `syntax:node-check ${change.path}`, scope: 'syntax-only', ok: result.code === 0, output: (result.stdout || result.stderr || '').slice(-outputLimit), timedOut: result.timedOut });
      if (result.code !== 0) return { status: 'failed', checks };
    } else if (/\.json$/i.test(change.path)) {
      try {
        JSON.parse(await fs.readFile(path.join(worktree, ...change.path.split('/')), 'utf8'));
        checks.push({ name: `syntax:json-parse ${change.path}`, scope: 'syntax-only', ok: true, output: '', timedOut: false });
      } catch {
        checks.push({ name: `syntax:json-parse ${change.path}`, scope: 'syntax-only', ok: false, output: 'Invalid JSON.', timedOut: false });
        return { status: 'failed', checks };
      }
    }
  }
  return { status: 'passed', checks };
}

async function runChecks(config, worktree, changes) {
  if (config.runner.checkMode === 'syntax') return runSyntaxChecks(worktree, changes);
  if (!config.runner.image || !/@sha256:[0-9a-f]{64}$/i.test(config.runner.image)) {
    return { status: 'unavailable', checks: [{ name: 'runner-image', ok: false, output: 'A digest-pinned runner image is required.' }] };
  }
  if (!Array.isArray(config.runner.fixedChecks) || config.runner.fixedChecks.length === 0) {
    return { status: 'unavailable', checks: [{ name: 'fixed-checks', ok: false, output: 'At least one operator-controlled check is required.' }] };
  }
  const available = await execFile('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 10_000 });
  if (available.code !== 0) return { status: 'unavailable', checks: [{ name: 'container-runtime', ok: false, output: 'Docker runtime unavailable.' }] };
  const checks = [];
  for (const check of config.runner.fixedChecks) {
    if (!Array.isArray(check) || !check.length || check.some((part) => typeof part !== 'string')) throw new Error('Fixed check configuration is invalid.');
    const result = await execFile('docker', [
      'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '512m', '--cpus', '1',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '-v', `${worktree}:/workspace:ro`, '-w', '/workspace',
      config.runner.image, ...check,
    ], { timeoutMs: config.runner.checkTimeoutMs });
    const item = { name: check.join(' '), ok: result.code === 0, output: (result.stdout || result.stderr || '').slice(-outputLimit), timedOut: result.timedOut };
    checks.push(item);
    if (!item.ok) return { status: 'failed', checks };
  }
  return { status: 'passed', checks };
}

async function finishRun(pool, run, fields) {
  return transaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE skwid.runs SET status = $3, candidate_changes = coalesce($4::jsonb, candidate_changes),
         candidate_patch = $5, candidate_commit = $6, check_status = $7, checks = $8::jsonb,
         failure_code = $9, finished_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND lease_token = $2 RETURNING id, proposal_id, status, check_status`,
      [run.id, run.leaseToken, fields.status, fields.changes ? JSON.stringify(fields.changes) : null, fields.patch || null,
        fields.commit || null, fields.checkStatus || null, JSON.stringify(fields.checks || []), fields.failureCode || null],
    );
    if (!result.rowCount) throw new Error('Run lease was lost before completion.');
    const proposalStatus = fields.status === 'review_ready' ? 'review_ready' : 'failed';
    await client.query(`UPDATE skwid.proposals SET status = $2, updated_at = now() WHERE id = $1`, [result.rows[0].proposal_id, proposalStatus]);
    return result.rows[0];
  });
}

export async function processRun({ pool, config, run }) {
  let worktree;
  let changes;
  try {
    const proposalResult = await pool.query(`SELECT title, description FROM skwid.proposals WHERE id = $1`, [run.proposal_id]);
    if (!proposalResult.rowCount) throw new Error('Approved proposal no longer exists.');
    changes = run.candidate_changes
      ? validateChanges(run.candidate_changes, config.runner)
      : await createModelChanges({ config, proposal: proposalResult.rows[0] });
    await fs.mkdir(config.runner.workRoot, { recursive: true });
    worktree = await fs.mkdtemp(path.join(config.runner.workRoot, `run-${run.id}-`));
    await fs.rmdir(worktree);
    const base = await execFile('git', ['rev-parse', '--verify', `${run.base_commit}^{commit}`], { cwd: config.runner.repoRoot, timeoutMs: 10_000 });
    if (base.code !== 0 || base.stdout.trim().toLowerCase() !== run.base_commit.toLowerCase()) throw new Error('Frozen base commit is unavailable.');
    const added = await execFile('git', ['worktree', 'add', '--detach', worktree, run.base_commit], { cwd: config.runner.repoRoot, timeoutMs: 30_000 });
    if (added.code !== 0) throw new Error('Could not create isolated git worktree.');
    const worktreeHead = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree, timeoutMs: 10_000 });
    if (worktreeHead.code !== 0 || worktreeHead.stdout.trim().toLowerCase() !== run.base_commit.toLowerCase()) throw new Error('Isolated worktree does not match the frozen base commit.');
    await applyChanges(worktree, changes);
    const changed = await execFile('git', ['status', '--porcelain=v1', '-z'], { cwd: worktree, timeoutMs: 10_000 });
    if (changed.code !== 0) throw new Error('Could not inspect candidate changes.');
    const changedPaths = changed.stdout.split('\0').filter(Boolean).map((line) => line.slice(3));
    const allowed = new Set(changes.map((change) => change.path));
    if (changedPaths.some((file) => !allowed.has(file))) throw new Error('Candidate modified a path outside its proposal.');
    const add = await execFile('git', ['add', '--', ...changes.map((change) => change.path)], { cwd: worktree, timeoutMs: 10_000 });
    if (add.code !== 0) throw new Error('Could not stage candidate changes.');
    const patchResult = await execFile('git', ['diff', '--cached', '--binary', '--', ...changes.map((change) => change.path)], { cwd: worktree, timeoutMs: 10_000 });
    if (patchResult.code !== 0 || !patchResult.stdout) throw new Error('Candidate produced no reviewable patch.');
    const checkResult = await runChecks(config, worktree, changes);
    if (checkResult.status !== 'passed') {
      return await finishRun(pool, run, { status: 'failed', changes, patch: patchResult.stdout, checkStatus: checkResult.status, checks: checkResult.checks, failureCode: checkResult.status === 'unavailable' ? 'runtime_unavailable' : 'checks_failed' });
    }
    const commit = await execFile('git', ['-c', 'user.name=Skwid Runner', '-c', 'user.email=runner@localhost', 'commit', '-m', `Skwid candidate ${run.id}`], { cwd: worktree, timeoutMs: 30_000 });
    if (commit.code !== 0) throw new Error('Candidate produced no committable changes.');
    const sha = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree, timeoutMs: 10_000 });
    return await finishRun(pool, run, { status: 'review_ready', changes, patch: patchResult.stdout, commit: sha.stdout.trim(), checkStatus: 'passed', checks: checkResult.checks });
  } catch (error) {
    return await finishRun(pool, run, { status: 'failed', changes, checkStatus: 'failed', checks: [], failureCode: error?.code === 'model_unconfigured' ? 'model_unconfigured' : 'runner_failed' });
  } finally {
    if (worktree) {
      await execFile('git', ['worktree', 'remove', '--force', worktree], { cwd: config.runner.repoRoot, timeoutMs: 30_000 }).catch(() => {});
    }
  }
}

export async function runOnce({ pool, config }) {
  const run = await leaseNextRun(pool, config.runner.leaseSeconds);
  if (!run) return null;
  return processRun({ pool, config, run });
}
