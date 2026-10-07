# Verification receipt

Checked 2026-10-07 with the pinned workspace toolchain: Foundry 1.7.1, Solidity 0.8.26,
Cancun target, optimizer enabled with 200 runs.

- Managed build: passed.
- Managed tests: passed.
- Focused Forge tests: 21 passed, 0 failed, 0 skipped.
- Formatting check: passed.
- `SkwidFeeTreasury` runtime size: 4,689 bytes.
- `SkwidReleaseRegistry` runtime size: 2,059 bytes.
- Source fingerprint: `bef23fb5071111af68534a21d44b38553f2894bed5a52a19fcb138a7afa5e867`.
- ABI exports: `bindings/SkwidFeeTreasury.json` and `bindings/SkwidReleaseRegistry.json`,
  both with chain ID 4663 and null deployment addresses.

The checks cover constructor and role guards, two-step ownership, role separation,
authorization, native and ERC-20 receipt accounting, direct-transfer synchronization,
withdrawal replay prevention through real balances, native-transfer reentrancy, append-only
release chaining, release replay rejection, supersession validation, and zero-hash rejection.

Deployment rehearsal was not run because the owner, treasurer, and release-operator addresses
have not been supplied. No mainnet transaction was signed or broadcast. Pons collection was not
simulated or executed; its candidate ABI remains separately gated in
`infrastructure/contracts.json`.
