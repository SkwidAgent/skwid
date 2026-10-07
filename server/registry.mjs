import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, JsonRpcProvider, getAddress, isHexString, sha256, toUtf8Bytes, ZeroHash } from 'ethers';
import { HttpError } from './errors.mjs';

const bindingPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../contracts/bindings/SkwidReleaseRegistry.json');
const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
if (binding.chainId !== 4663 || !Array.isArray(binding.abi)) throw new Error('SkwidReleaseRegistry binding is invalid.');
const registryInterface = new Interface(binding.abi);

async function providerAndAddress(config) {
  if (!config.chain.rpcUrl || !config.registry.address) throw new HttpError(503, 'registry_unconfigured', 'The release registry is not configured.');
  const provider = new JsonRpcProvider(config.chain.rpcUrl, undefined, { staticNetwork: false });
  const [network, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
  if (Number(network.chainId) !== 4663 || config.chain.id !== 4663) throw new HttpError(502, 'chain_mismatch', 'Release registry reads require Robinhood Chain 4663.');
  const address = getAddress(config.registry.address);
  if (await provider.getCode(address, blockNumber) === '0x') throw new HttpError(502, 'registry_missing', 'No registry contract exists at the configured address.');
  return { provider, address, blockNumber };
}

const read = async (provider, address, blockNumber, name, args = []) => {
  const output = await provider.call({ to: address, data: registryInterface.encodeFunctionData(name, args) }, blockNumber);
  return registryInterface.decodeFunctionResult(name, output);
};

export async function readReleaseRegistry(config) {
  const { provider, address, blockNumber } = await providerAndAddress(config);
  const [releaseCount, latestEntryHash, operator, owner] = await Promise.all([
    read(provider, address, blockNumber, 'releaseCount'),
    read(provider, address, blockNumber, 'latestEntryHash'),
    read(provider, address, blockNumber, 'operator'),
    read(provider, address, blockNumber, 'owner'),
  ]);
  return {
    address,
    chainId: 4663,
    blockNumber: String(blockNumber),
    releaseCount: releaseCount[0].toString(),
    latestEntryHash: latestEntryHash[0],
    operator: getAddress(operator[0]),
    owner: getAddress(owner[0]),
  };
}

export async function prepareReleaseRecord(config, record, supersedesReleaseHash = ZeroHash) {
  if (!isHexString(supersedesReleaseHash, 32)) throw new HttpError(400, 'invalid_input', 'supersedesReleaseHash must be bytes32.');
  if (!/^[0-9a-f]{64}$/i.test(record.patch_sha256 || '') || !/^[0-9a-f]{40,64}$/i.test(record.commit_sha || '')) {
    throw new HttpError(409, 'invalid_state', 'The journal artifact hashes are incomplete.');
  }
  const registry = await readReleaseRegistry(config);
  const canonical = JSON.stringify({
    schema: 'skwid-registry-record/1',
    journalId: record.journal_id,
    runId: record.run_id,
    commit: record.commit_sha,
    patchSha256: record.patch_sha256,
    checks: record.checks,
  });
  const hashes = {
    contentHash: sha256(toUtf8Bytes(canonical)),
    sourceCommitHash: sha256(toUtf8Bytes(record.commit_sha)),
    artifactHash: `0x${record.patch_sha256}`,
    supersedesReleaseHash,
  };
  const transaction = {
    to: registry.address,
    data: registryInterface.encodeFunctionData('publishRelease', [
      hashes.contentHash,
      hashes.sourceCommitHash,
      hashes.artifactHash,
      hashes.supersedesReleaseHash,
    ]),
    chainId: 4663,
    value: '0',
  };
  let simulation = null;
  if (config.registry.operatorAddress) {
    const provider = new JsonRpcProvider(config.chain.rpcUrl, 4663, { staticNetwork: true });
    try {
      await provider.call({ ...transaction, from: getAddress(config.registry.operatorAddress) }, Number(registry.blockNumber));
      simulation = { ok: true, blockNumber: registry.blockNumber };
    } catch {
      simulation = { ok: false, blockNumber: registry.blockNumber };
    }
  }
  return { transaction, hashes, registry, simulation };
}
