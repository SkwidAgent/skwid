import path from 'node:path';
import { HttpError } from './errors.mjs';

const BLOCKED_SEGMENTS = new Set(['.git', '.github', '.env', 'auth', 'config', 'deploy', 'deployment', 'infrastructure']);
const BLOCKED_FILES = /(^|\/)(?:\.env(?:\..*)?|dockerfile|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|heroku\.yml|procfile)$/i;
const BLOCKED_CONTROL_PATHS = /(^|\/)(?:auth|config|deploy)(?:[._/-]|$)/i;

export function cleanText(value, field, max) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_input', `${field} must be text.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max) throw new HttpError(400, 'invalid_input', `${field} must be 1-${max} characters.`);
  return cleaned;
}

export function validateProposal(body = {}) {
  if (body.website) throw new HttpError(400, 'submission_rejected', 'Submission rejected.');
  return { title: cleanText(body.title, 'title', 100), description: cleanText(body.description, 'description', 3000) };
}

export function validateUuid(value, field = 'id') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'invalid_input', `${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

export function safeRelativePath(input, allowedRoots) {
  if (typeof input !== 'string' || !input || input.includes('\\') || input.includes('\0')) {
    throw new HttpError(400, 'invalid_change', 'A change path is invalid.');
  }
  const normalized = path.posix.normalize(input);
  const segments = normalized.toLowerCase().split('/');
  if (path.posix.isAbsolute(normalized) || normalized.startsWith('../') || normalized === '..' || BLOCKED_FILES.test(normalized) || BLOCKED_CONTROL_PATHS.test(normalized) || segments.some((part) => BLOCKED_SEGMENTS.has(part))) {
    throw new HttpError(400, 'invalid_change', 'A change path is outside the permitted source area.');
  }
  const roots = allowedRoots.map((root) => `${path.posix.normalize(root).replace(/^\.\//, '').replace(/\/?$/, '/')}`);
  if (!roots.some((root) => normalized.startsWith(root))) {
    throw new HttpError(400, 'invalid_change', 'A change path is outside the permitted source area.');
  }
  return normalized;
}

export function validateChanges(raw, runner) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > runner.maxFiles) {
    throw new HttpError(400, 'invalid_change', `changes must contain 1-${runner.maxFiles} files.`);
  }
  let bytes = 0;
  const seen = new Set();
  const changes = raw.map((change) => {
    if (!change || typeof change !== 'object') throw new HttpError(400, 'invalid_change', 'Each change must be an object.');
    if (Object.keys(change).some((key) => !['path', 'operation', 'content'].includes(key))) throw new HttpError(400, 'invalid_change', 'A change contains unsupported fields.');
    const filePath = safeRelativePath(change.path, runner.allowedRoots);
    if (seen.has(filePath)) throw new HttpError(400, 'invalid_change', 'Duplicate change path.');
    seen.add(filePath);
    if (!['write', 'delete'].includes(change.operation)) throw new HttpError(400, 'invalid_change', 'operation must be write or delete.');
    const content = change.operation === 'write' ? change.content : null;
    if (change.operation === 'write' && typeof content !== 'string') throw new HttpError(400, 'invalid_change', 'write changes require text content.');
    bytes += Buffer.byteLength(content || '', 'utf8');
    return { path: filePath, operation: change.operation, content };
  });
  if (bytes > runner.maxBytes) throw new HttpError(400, 'invalid_change', `Change content exceeds ${runner.maxBytes} bytes.`);
  return changes;
}

export function validateRunRequest(body = {}, runner) {
  const baseCommit = cleanText(body.baseCommit, 'baseCommit', 64);
  if (!/^[0-9a-f]{40,64}$/i.test(baseCommit)) throw new HttpError(400, 'invalid_input', 'baseCommit must be a full Git commit hash.');
  return {
    proposalId: cleanText(body.proposalId, 'proposalId', 64),
    baseCommit: baseCommit.toLowerCase(),
    changes: body.changes == null ? null : validateChanges(body.changes, runner),
  };
}
