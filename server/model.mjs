import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './errors.mjs';
import { validateChanges } from './validation.mjs';

const SECRET_FILE = /(^|\/)(?:\.env(?:\..*)?|.*(?:secret|credential|private[-_]?key).*)$/i;

async function readContextFile(repoRoot, relative, allowedRoots, remaining) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0')) return null;
  const normalized = path.posix.normalize(relative);
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) return null;
  if (SECRET_FILE.test(normalized)) return null;
  const absolute = path.resolve(repoRoot, normalized);
  const root = `${path.resolve(repoRoot)}${path.sep}`;
  if (!absolute.startsWith(root)) return null;
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > remaining) return null;
  return { path: normalized, content: await fs.readFile(absolute, 'utf8') };
}

export async function loadBoundedContext(config) {
  const maxContextBytes = Math.min(config.runner.maxBytes, 80_000);
  let remaining = maxContextBytes;
  const files = [];
  for (const relative of config.runner.contextFiles) {
    const item = await readContextFile(config.runner.repoRoot, relative, config.runner.allowedRoots, remaining).catch(() => null);
    if (!item) continue;
    remaining -= Buffer.byteLength(item.content, 'utf8');
    files.push(item);
  }
  return files;
}

export async function createModelChanges({ config, proposal }) {
  if (!config.model.apiKey || !config.model.model) throw new HttpError(503, 'model_unconfigured', 'The optional model adapter is not configured.');
  const context = await loadBoundedContext(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.model.timeoutMs);
  let response;
  try {
    response = await fetch(`${config.model.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.model.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return JSON only: {"changes":[{"path":"...","operation":"write|delete","content":"..."}]}. Make the smallest change addressing the approved proposal. Never include commands, secrets, environment files, auth, deployment, lockfiles, or paths outside the supplied allowed roots.' },
          { role: 'user', content: JSON.stringify({ proposal, allowedRoots: config.runner.allowedRoots, limits: { maxFiles: config.runner.maxFiles, maxBytes: config.runner.maxBytes }, context }) },
        ],
      }),
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new HttpError(502, 'model_failed', `Model request failed with status ${response.status}.`);
  const envelope = await response.json();
  const text = envelope?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new HttpError(502, 'model_failed', 'Model response did not contain a proposal.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new HttpError(502, 'model_failed', 'Model response was not valid JSON.'); }
  if (!parsed || Object.keys(parsed).some((key) => key !== 'changes')) throw new HttpError(502, 'model_failed', 'Model response contained unsupported fields.');
  return validateChanges(parsed.changes, config.runner);
}
