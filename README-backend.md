# Skwid backend

Skwid accepts public improvement ideas and turns only owner-approved ideas into bounded, reviewable candidate changes. PostgreSQL is the source of truth. The web process serves public reads and owner routes; `scripts/runner.mjs` leases one queued job and evaluates it in an isolated container. It never modifies the main checkout, merges, deploys, signs a chain transaction, or publishes a journal entry on its own.

## Runtime

Use Node 22 and PostgreSQL. Copy `.env.example` into the deployment's secret configuration rather than committing an `.env` file. At minimum the web process needs `DATABASE_URL`, a strong `SKWID_ADMIN_TOKEN`, and the database's public CA through `SUPABASE_CA_CERT`/`DATABASE_SSL_ROOT_CERT` or `PGSSLROOTCERT`/`DATABASE_CA_PATH`. The client strips URL SSL overrides and always uses `rejectUnauthorized: true`; startup fails closed without a PEM CA. Run:

```sh
npm run migrate
npm start
```

Run one owner-triggered queued job with:

```sh
npm run worker
```

The worker needs a Git checkout at `SKWID_REPO_ROOT`. `SKWID_CHECK_MODE=docker` additionally requires a working Docker daemon and a digest-pinned `SKWID_RUNNER_IMAGE` such as `repository/image@sha256:<64 hex characters>`. Docker receives a read-only checkout, no network, no host secrets, a read-only root filesystem, dropped capabilities, and fixed resource limits. Checks come from the operator-controlled `SKWID_FIXED_CHECKS`; proposal text and model output cannot add commands. If Docker or a pinned image is unavailable, the candidate change is retained in the run record with an unavailable check result and cannot be published.

For an owner-operated host without Docker, explicitly set `SKWID_CHECK_MODE=syntax`. This lane never invokes npm, project scripts, model commands, or changed application code. It runs only `git diff --check`, `node --check` on changed `.js`/`.mjs`/`.cjs` files, and `JSON.parse` on changed JSON. Every receipt is labeled `scope: syntax-only`; passing means the patch is syntactically parseable, not functionally or runtime verified. Owner review remains required before journal publication.

The default worker is owner-operated. `POST /api/admin/runs` accepts explicit validated `changes`, so no model credential is needed. Omitting `changes` requests the optional OpenAI-compatible adapter and requires `SKWID_MODEL_API_KEY` and `SKWID_MODEL`. Model context is limited to `SKWID_CONTEXT_FILES`; secret-like files, symbolic links, and files over the context budget are skipped. Model output must be strict JSON containing only bounded `write` or `delete` changes under `SKWID_ALLOWED_ROOTS`.

## HTTP API

Public endpoints:

- `GET /health` reports that the process is alive.
- `GET /ready` reports whether the database and `skwid` schema are reachable.
- `GET /api/status` returns brand, chain, configured token or `null`, latest observed treasury balance or `null`, owner-operated agent state, links, and database-derived counts.
- `GET /api/proposals` and `POST /api/proposals` list and submit ideas. `GET /api/proposals/:id` validates a UUID and reads one public record independently of the list limit, returning 404 for an unknown valid ID. Titles are limited to 100 characters; descriptions to 3,000. Requests have a 128 KiB body limit, and public intake adds a per-process IP rate limit plus a `website` honeypot field.
- `GET /api/journal`, `GET /api/journal/:id`, and `GET /api/treasury` expose only persisted records.
- `GET /api/journal/feed.xml` renders those same journal rows as RSS 2.0 with canonical item links in the form `https://skwid.fun/journal?entry=<id>`. An empty journal produces an empty channel rather than sample entries.
- `GET /api/fees` performs block-tagged Pons configuration reads only when a real token is configured.
- `GET /api/registry` performs block-tagged reads from the deployed `SkwidReleaseRegistry` configured by `SKWID_RELEASE_REGISTRY_ADDRESS`, or returns `registry: null` before deployment.

Owner routes require `Authorization: Bearer $SKWID_ADMIN_TOKEN`:

- `POST /api/admin/proposals/:id/approve`
- `POST /api/admin/runs` with `{ "proposalId": "...", "baseCommit": "<full Git hash>", "changes": [{ "path": "public/file.js", "operation": "write", "content": "..." }] }`; omit `changes` to use the optional model adapter. The full base commit is frozen at queue time, must exist in the worker repository, and is rechecked in the detached worktree before any change is applied.
- `POST /api/admin/runs/:id/reconcile` with `{ "decision": "publish", "title": "...", "summary": "..." }` or `{ "decision": "reject" }`. Publication writes a journal and release row only after a non-empty runner-generated check receipt passed and the candidate patch and commit are present. Artifact details and the patch digest are derived server-side; the route does not accept caller-supplied check evidence. It records owner acceptance but does not merge or deploy source.
- `POST /api/admin/treasury/observe` reads and persists an actual RPC balance after enforcing the configured chain ID.
- `POST /api/admin/fees/prepare` returns unsigned Pons `collectFees(address)` call data. It cannot send. It remains disabled until a real token is configured and `SKWID_PONS_COLLECTION_ABI_VERIFIED=true` is set after verifying the candidate ABI against that token's active locker/version. When `SKWID_PONS_OPERATOR_ADDRESS` is supplied, preparation also attempts a fixed-block `eth_call` simulation.
- `POST /api/admin/registry/prepare` accepts a published `journalId` and optional bytes32 `supersedesReleaseHash`. It loads the exact contract ABI from `contracts/bindings/SkwidReleaseRegistry.json`, derives content/source/artifact hashes from persisted release evidence, and returns unsigned `publishRelease` calldata. It cannot accept arbitrary targets or calldata and cannot send. `SKWID_REGISTRY_OPERATOR_ADDRESS` enables a fixed-block simulation.

Errors expose stable codes and short messages; stack traces, SQL, provider bodies, credentials, and model responses are not returned.

## State and review boundary

Public submissions begin `pending` and are untrusted text. The owner approves one, then queues a run. A database lease with `FOR UPDATE SKIP LOCKED` prevents two workers from owning the same run. A successful worker stores the exact changes, patch, detached candidate commit, and fixed-check receipts as `review_ready`. Failed or unavailable checks move the proposal to `failed`, remain non-publishable, and can be explicitly re-approved for a new attempt. The owner reconciliation step is the only path to a release and public journal entry.

Allowed roots are normalized repository-relative paths. The defaults allow product source under `public/` and non-protected `server/` files while keeping the test harness outside candidate ownership. Traversal, absolute paths, duplicate paths, symlinks, `.git`, `.github`, `.env`, authentication, configuration, deployment, infrastructure, lockfiles, Dockerfiles, Heroku files, and Procfiles are rejected. The file and byte caps apply equally to owner and model proposals.

The runner deliberately has no scheduler. Queueing and invoking it are explicit owner operations. A production worker can invoke `npm run worker` after the owner queues a run; no recurring autonomous execution is required.

## Robinhood Chain and Pons

Chain ID defaults to Robinhood Chain `4663`. A token is absent until `SKWID_TOKEN_ADDRESS` is provided; status then returns `token: null`. Treasury balance is absent until an owner observation succeeds. Pons reads resolve `locker()` from the configured active factory at the current block and verify it against the reviewed locker before reading the token's protocol share, redirect, and protocol recipient.

The currently documented factory and locker are configuration defaults, not claims about a Skwid token. The collection ABI remains gated because the reviewed public documentation did not expose a bytecode-matched ABI for the active locker. The service never accepts arbitrary transaction targets or calldata and never holds a signer.

## Verification

Run focused checks with `npm test`. Validation, owner authentication, protected paths, and lease SQL run without external services. `tests/backend-db.test.mjs` performs a real insert/read inside a rolled-back transaction when `DATABASE_URL` is present; it skips otherwise. Run migrations before the database check.
