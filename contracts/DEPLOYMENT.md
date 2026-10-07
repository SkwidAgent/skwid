# Skwid contract handoff

Status: source, tests, deployment script, and null-address ABI bindings are prepared. Nothing
has been deployed or broadcast.

## Contracts

`SkwidFeeTreasury` accepts native ETH and explicitly allowlisted ERC-20s. ERC-20 support is
required because a Pons v1 fee collection can return both WETH and the launched token. Direct
locker transfers are recorded with `syncToken`; withdrawals synchronize first so unobserved
receipts cannot make the lifetime counters underflow. The contract has no swap, router,
arbitrary-call, automated collection, or trading function.

The owner controls the treasurer and token allowlist. The separate treasurer controls only
withdrawals and chooses an explicit nonzero recipient. Ownership uses OpenZeppelin's two-step
transfer, cannot be renounced, and cannot be accepted by the active treasurer.

`SkwidReleaseRegistry` stores compact immutable release hashes. The operator appends records;
the owner can replace the operator. Each entry binds the chain, registry, sequence, prior entry,
release hash, and optional known superseded release. Exact release replay is rejected. The
registry proves operator publication, not correctness or an audit.

OpenZeppelin Contracts v5.4.0 is pinned in `lib/openzeppelin-contracts` for `Ownable2Step`,
`ReentrancyGuard`, `SafeERC20`, and ERC-20 interfaces.

## Required deployment configuration

The deployment script reads these addresses from the environment and embeds no signing key:

- `SKWID_CONTRACT_OWNER`: governance/admin address; must differ from both operational roles.
- `SKWID_TREASURER`: withdrawal operator for `SkwidFeeTreasury`.
- `SKWID_RELEASE_OPERATOR`: publication operator for `SkwidReleaseRegistry`.

Before any mainnet deployment, verify all three addresses, chain ID `4663`, and the source-bound
build receipt. Then rehearse `script/DeploySkwid.s.sol:DeploySkwid` on a pinned Robinhood fork
with `foundry.py prepare`. The current task intentionally stops before rehearsal because the
user has not supplied the role addresses.

After treasury deployment, separately verify the actual Skwid token and its Pons factory and
locker. Resolve `locker()` from the factory. Confirm the token-specific `collectFees(address)`
ABI against verified source or a successful historical transaction before enabling an
owner-operated collection. Configure the treasury as the token's legitimate fee recipient only
through the applicable Pons flow. Allowlist the resolved WETH and Skwid token in the treasury.
Pons collection remains outside both contracts.

Actual mainnet broadcast is a separate authorized operation using an appropriate signer. After
deployment, record transaction receipts and runtime code, verify source on Robinhood Blockscout,
then replace the null addresses in the generated bindings and `infrastructure/contracts.json`.

Neither contract uses Nitro-specific precompiles or assumes Anvil reproduces Robinhood finality,
fee accounting, or sequencer behavior.
