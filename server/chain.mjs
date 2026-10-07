import { Interface, JsonRpcProvider, getAddress } from 'ethers';
import { HttpError } from './errors.mjs';

export async function observeTreasury(config, pool) {
  if (!config.chain.rpcUrl || !config.treasuryAddress) {
    throw new HttpError(503, 'chain_unconfigured', 'Treasury observation is not configured.');
  }
  let address;
  try {
    address = getAddress(config.treasuryAddress);
  } catch {
    throw new HttpError(503, 'chain_unconfigured', 'Treasury address is invalid.');
  }
  const provider = new JsonRpcProvider(config.chain.rpcUrl, undefined, { staticNetwork: false });
  const [network, balance, blockNumber] = await Promise.all([
    provider.getNetwork(),
    provider.getBalance(address),
    provider.getBlockNumber(),
  ]);
  if (Number(network.chainId) !== config.chain.id) {
    throw new HttpError(502, 'chain_mismatch', 'The configured RPC is for a different chain.');
  }
  const result = await pool.query(
    `INSERT INTO skwid.treasury_observations (address, balance_wei, block_number)
     VALUES ($1, $2, $3) RETURNING address, balance_wei, block_number, observed_at`,
    [address, balance.toString(), blockNumber],
  );
  const row = result.rows[0];
  return { address: row.address, balanceWei: row.balance_wei, blockNumber: String(row.block_number), observedAt: row.observed_at };
}

// Pons collection preparation intentionally returns unsigned call data only. The
// target and ABI must come from version-specific owner configuration after the
// token's actual escrow has been verified.
const factoryInterface = new Interface(['function locker() view returns (address)']);
const lockerReadInterface = new Interface([
  'function tokenProtocolFeeShares(address) view returns (uint256)',
  'function feeRedirects(address) view returns (address)',
  'function protocolFeeRecipient() view returns (address)',
]);
const candidateCollectionInterface = new Interface(['function collectFees(address token) returns (uint256 amount0, uint256 amount1)']);

export async function readPonsFeeConfiguration(config) {
  if (!config.chain.rpcUrl || !config.token.address) throw new HttpError(503, 'pons_unconfigured', 'A verified Skwid token and RPC are required.');
  const provider = new JsonRpcProvider(config.chain.rpcUrl, undefined, { staticNetwork: false });
  const [network, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
  if (Number(network.chainId) !== 4663 || config.chain.id !== 4663) throw new HttpError(502, 'chain_mismatch', 'Pons fee reads require Robinhood Chain 4663.');
  const factory = getAddress(config.pons.factoryAddress);
  const token = getAddress(config.token.address);
  const lockerResult = await provider.call({ to: factory, data: factoryInterface.encodeFunctionData('locker') }, blockNumber);
  const locker = getAddress(factoryInterface.decodeFunctionResult('locker', lockerResult)[0]);
  if (config.pons.expectedLockerAddress && locker !== getAddress(config.pons.expectedLockerAddress)) {
    throw new HttpError(502, 'pons_version_mismatch', 'The active Pons locker differs from the configured reviewed locker.');
  }
  const calls = await Promise.all([
    provider.call({ to: locker, data: lockerReadInterface.encodeFunctionData('tokenProtocolFeeShares', [token]) }, blockNumber),
    provider.call({ to: locker, data: lockerReadInterface.encodeFunctionData('feeRedirects', [token]) }, blockNumber),
    provider.call({ to: locker, data: lockerReadInterface.encodeFunctionData('protocolFeeRecipient') }, blockNumber),
  ]);
  return {
    chainId: 4663,
    blockNumber: String(blockNumber),
    factory,
    locker,
    token,
    protocolFeeShare: lockerReadInterface.decodeFunctionResult('tokenProtocolFeeShares', calls[0])[0].toString(),
    feeRedirect: getAddress(lockerReadInterface.decodeFunctionResult('feeRedirects', calls[1])[0]),
    protocolFeeRecipient: getAddress(lockerReadInterface.decodeFunctionResult('protocolFeeRecipient', calls[2])[0]),
  };
}

export async function preparePonsCollection(config) {
  if (!config.pons.collectionAbiVerified) {
    throw new HttpError(503, 'collection_disabled', 'Collection stays disabled until the active locker ABI is verified for the real token.');
  }
  const state = await readPonsFeeConfiguration(config);
  const transaction = {
    to: state.locker,
    data: candidateCollectionInterface.encodeFunctionData('collectFees', [state.token]),
    chainId: 4663,
    value: '0',
  };
  let simulation = null;
  if (config.pons.operatorAddress) {
    const provider = new JsonRpcProvider(config.chain.rpcUrl, 4663, { staticNetwork: true });
    try {
      await provider.call({ ...transaction, from: getAddress(config.pons.operatorAddress) }, Number(state.blockNumber));
      simulation = { ok: true, blockNumber: state.blockNumber };
    } catch {
      simulation = { ok: false, blockNumber: state.blockNumber };
    }
  }
  return { transaction, feeConfiguration: state, simulation };
}
