import path from 'node:path';

const integer = (value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const jsonArray = (value, fallback) => {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export function loadConfig(env = process.env) {
  const repoRoot = path.resolve(env.SKWID_REPO_ROOT || process.cwd());
  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: integer(env.PORT, 3000, 1, 65535),
    databaseUrl: env.DATABASE_URL || null,
    databaseCaCert: env.DATABASE_SSL_ROOT_CERT || env.SUPABASE_CA_CERT || env.DATABASE_SSL_CA || null,
    databaseCaPath: env.DATABASE_CA_PATH || env.DATABASE_SSL_CA_FILE || env.PGSSLROOTCERT || null,
    adminToken: env.SKWID_ADMIN_TOKEN || null,
    trustProxy: env.SKWID_TRUST_PROXY === 'true',
    publicBaseUrl: env.SKWID_PUBLIC_URL || null,
    chain: {
      id: integer(env.SKWID_CHAIN_ID, 4663, 1),
      name: env.SKWID_CHAIN_NAME || 'Robinhood Chain',
      rpcUrl: env.SKWID_RPC_URL || null,
      explorerUrl: env.SKWID_EXPLORER_URL || null,
    },
    token: {
      address: env.SKWID_TOKEN_ADDRESS || null,
      explorerUrl: env.SKWID_TOKEN_EXPLORER_URL || null,
    },
    treasuryAddress: env.SKWID_TREASURY_ADDRESS || null,
    registry: {
      address: env.SKWID_RELEASE_REGISTRY_ADDRESS || null,
      operatorAddress: env.SKWID_REGISTRY_OPERATOR_ADDRESS || null,
    },
    pons: {
      factoryAddress: env.SKWID_PONS_FACTORY_ADDRESS || '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB',
      expectedLockerAddress: env.SKWID_PONS_LOCKER_ADDRESS || '0x736D76699C26D0d966744cAe304C000d471f7F35',
      collectionAbiVerified: env.SKWID_PONS_COLLECTION_ABI_VERIFIED === 'true',
      operatorAddress: env.SKWID_PONS_OPERATOR_ADDRESS || null,
    },
    links: {
      website: env.SKWID_WEBSITE_URL || null,
      x: env.SKWID_X_URL || null,
      github: env.SKWID_GITHUB_URL || null,
    },
    model: {
      apiKey: env.SKWID_MODEL_API_KEY || null,
      model: env.SKWID_MODEL || null,
      baseUrl: (env.SKWID_MODEL_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      timeoutMs: integer(env.SKWID_MODEL_TIMEOUT_MS, 60_000, 1_000, 180_000),
    },
    runner: {
      repoRoot,
      workRoot: path.resolve(env.SKWID_WORK_ROOT || path.join(repoRoot, '.skwid-runs')),
      allowedRoots: jsonArray(env.SKWID_ALLOWED_ROOTS, ['public/', 'server/']),
      contextFiles: jsonArray(env.SKWID_CONTEXT_FILES, ['README-backend.md', 'package.json']),
      fixedChecks: jsonArray(env.SKWID_FIXED_CHECKS, [['npm', 'test']]),
      image: env.SKWID_RUNNER_IMAGE || null,
      checkMode: env.SKWID_CHECK_MODE === 'syntax' ? 'syntax' : 'docker',
      maxFiles: integer(env.SKWID_MAX_CHANGE_FILES, 8, 1, 25),
      maxBytes: integer(env.SKWID_MAX_CHANGE_BYTES, 100_000, 1_000, 500_000),
      checkTimeoutMs: integer(env.SKWID_CHECK_TIMEOUT_MS, 120_000, 1_000, 600_000),
      leaseSeconds: integer(env.SKWID_RUN_LEASE_SECONDS, 300, 30, 3600),
    },
  };
}
