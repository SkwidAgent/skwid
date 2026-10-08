# Skwid

Skwid is an owner-governed software evolution service for Robinhood Chain. Visitors submit ideas, the owner approves a bounded change against an exact Git commit, an isolated worker produces check evidence, and the owner decides whether the result belongs in the public journal. The service never merges, deploys, signs a transaction, or publishes a journal record on its own.

The public site uses the exact display ticker `$Swkid`. A token, treasury observation, release registry, and Pons collection path remain absent until their real addresses and activation evidence are configured.

## How the loop works

1. `POST /api/proposals` stores a rate-limited public idea as untrusted `pending` text.
2. The owner approves it with `POST /api/admin/proposals/:id/approve`.
3. The owner queues an exact full Git base commit and explicit file changes with `POST /api/admin/runs`. Omitting changes uses the optional OpenAI-compatible planning adapter.
4. `npm run worker` leases one job with `FOR UPDATE SKIP LOCKED`, creates a detached worktree at the frozen commit, enforces protected paths and byte/file limits, and records a patch plus check receipts.
5. A passing candidate becomes `review_ready`. The owner may reject it or publish its existing evidence with `POST /api/admin/runs/:id/reconcile`. This publication writes the database journal; it does not merge or deploy the candidate.

The Docker check mode runs only operator-configured commands in a digest-pinned image with no network, a read-only filesystem, dropped capabilities, and resource limits. The explicit `syntax` mode is for owner-operated hosts without Docker. It runs only staged-diff whitespace checks, Node parser checks for changed JavaScript, and JSON parsing for changed JSON. Its receipts are labeled `syntax-only` and do not claim functional or runtime verification.

## Run locally

Requirements are Node 22 and PostgreSQL. Install the exact JavaScript dependencies from the lockfile:

```sh
npm ci
cp .env.example .env
npm run migrate
npm start
```

The database connection fails closed unless a public CA is provided as PEM in `SUPABASE_CA_CERT` or `DATABASE_SSL_ROOT_CERT`, or by file path in `PGSSLROOTCERT` or `DATABASE_CA_PATH`. URL SSL parameters are removed before connecting and certificate validation remains enabled.

The web process uses `PORT` and serves `public/`. The SPA routes are `/`, `/Home`, `/docs`, `/journal`, and `/lab`. Run one queued owner job separately with:

```sh
npm run worker
```

Configuration is documented in [.env.example](.env.example). Keep real credentials in the deployment environment. `SKWID_ADMIN_TOKEN` protects every mutation after public proposal intake. Model credentials are optional because owner-supplied file changes are a complete path.

## API

Public reads and intake:

- `GET /health` and `GET /ready`
- `GET /api/status`
- `GET /api/proposals`, `GET /api/proposals/:id`, and `POST /api/proposals`
- `GET /api/journal` and `GET /api/journal/:id`
- `GET /api/journal/feed.xml`
- `GET /api/treasury`
- `GET /api/fees`
- `GET /api/registry`

Bearer-authenticated owner operations:

- `POST /api/admin/proposals/:id/approve`
- `POST /api/admin/runs`
- `POST /api/admin/runs/:id/reconcile`
- `POST /api/admin/treasury/observe`
- `POST /api/admin/fees/prepare`
- `POST /api/admin/registry/prepare`

The status endpoint reports database-derived counts. Unknown token and treasury values remain `null`. A recorded treasury value includes its observation time and source block; the public view reports their exact stored provenance and elapsed age without describing the value as live. Pons reads are block-tagged and chain-checked. Fee preparation returns unsigned `collectFees(address)` calldata only after the real token and its active locker ABI have been verified and explicitly enabled. Registry preparation loads the generated contract binding, derives hashes from a persisted journal record, and returns unsigned `publishRelease` calldata. Neither endpoint has a signer or accepts an arbitrary transaction target.

Published journal entries have canonical shareable URLs at `https://skwid.fun/journal?entry=<id>`. Journal searches use shareable `/journal?q=<terms>` URLs and match every term against the title and summary of persisted entries. The RSS 2.0 feed projects those same persisted records and emits no sample items when the journal is empty.

Journal details include ordinary links to the immediately newer and older stored entries. Both the list and neighbor lookup order by creation time and then ID, so ties are deterministic and the first and last entries do not wrap around.

Each journal detail keeps its full source revision and patch digest beside check outcomes grouped only by their recorded scope. Syntax, runtime, failed, unknown, and missing evidence remain distinct rather than being inferred from a check name.

Every public proposal also has a permanent `/lab?proposal=<id>` page backed by the single-record API. The public response contains only the proposal ID, title, description, status, and creation time.

See [README-backend.md](README-backend.md) for request shapes, state transitions, worker policy, and configuration details.

## Contracts

The Foundry project contains two independently authored contracts:

- `SkwidFeeTreasury` accounts for native and allowlisted ERC-20 fee proceeds and limits withdrawals to its treasurer.
- `SkwidReleaseRegistry` appends immutable release hashes under a separate operator role.

Install the pinned contract dependencies without committing the vendor directories:

```sh
cd contracts
mkdir -p lib
git clone https://github.com/foundry-rs/forge-std.git lib/forge-std
git -C lib/forge-std checkout 77041d2ce690e692d6e03cc812b57d1ddaa4d505
git clone --branch v5.4.0 --depth 1 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
forge build
forge test
```

The source targets Solidity 0.8.26, Cancun, optimizer 200, and Robinhood Chain ID 4663. The checked-in ABI bindings intentionally contain `null` addresses. No contract or token deployment is claimed.

## Robinhood Chain handoff

Before a mainnet broadcast, supply and independently verify distinct `SKWID_CONTRACT_OWNER`, `SKWID_TREASURER`, and `SKWID_RELEASE_OPERATOR` addresses. Rehearse the deployment script against a pinned fork, review the receipt and bytecode, then broadcast through the owner's signer. After deployment, verify runtime code and source, record the real addresses in the bindings and application configuration, and run the read adapters against chain 4663.

Pons integration is limited to fee collection. Resolve the locker from the active factory for the actual token and verify the candidate `collectFees(address)` ABI against that version before enabling preparation. Trading, routing, token launch automation, and signing are outside this service.

Detailed deployment boundaries are in [contracts/DEPLOYMENT.md](contracts/DEPLOYMENT.md), with the source-bound check receipt in [contracts/VERIFICATION.md](contracts/VERIFICATION.md).

## Verification

```sh
npm test
```

The focused backend suite covers validation, owner authentication, lease acquisition, protected paths, frozen commits, and certificate-verified database configuration. When `DATABASE_URL` and its CA are supplied, it also performs a real insert/read inside a rolled-back transaction. Contract checks are documented separately because source readiness and an actual mainnet deployment are different states.
