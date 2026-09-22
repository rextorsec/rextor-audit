// E1/B2 tooling — attest an already-published review record to a second chain
// NATIVELY (home chain keeps its own verdict; demo chains get native twins of
// the same reviewId). Mirrors makeAttestDep's write + success-receipt guard and
// adds a verify() read-back: a twin that cannot be recomputed on-chain is not a
// receipt (invariant 17). Chain params come from the chains.ts registry —
// never fabricated (invariant 16); --rpc overrides the registry endpoint
// (the official HyperEVM RPC rejects some state queries; drpc serves them).
//
// Usage:
//   REXTOR_AGENT_PRIVATE_KEY=0x… tsx scripts/attest-twin.ts \
//     --chain hyperliquid [--rpc https://hyperliquid.drpc.org] \
//     [--address 0x…  (override registry slot)] \
//     --review-id 0x… --commit-hash 0x… --findings-hash 0x… \
//     --findings-uri ipfs://… --score 93 --count 9 --status 0 --target-chain-id 999
//
// Prints the mined tx hash + gasUsed × effectiveGasPrice (fee-review input).
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_REGISTRY, type ChainKey } from "../src/chains";
import { REXTOR_ATTESTATION_ABI, type AttestRecord } from "../src/attest";

const { values } = parseArgs({
  options: {
    chain: { type: "string" },
    rpc: { type: "string" },
    address: { type: "string" },
    "review-id": { type: "string" },
    "commit-hash": { type: "string" },
    "findings-hash": { type: "string" },
    "findings-uri": { type: "string" },
    score: { type: "string" },
    count: { type: "string" },
    status: { type: "string" },
    "target-chain-id": { type: "string" },
  },
});

function fail(msg: string): never {
  console.error(`attest-twin: ${msg}`);
  process.exit(1);
}

const chainKey = (values.chain ?? "hyperliquid") as ChainKey;
const registry = CHAIN_REGISTRY[chainKey];
if (!registry) fail(`unknown chain key: ${chainKey}`);
const chainId = registry.attestation.chainId ?? registry.testnet.chainId;
if (chainId == null || !registry.testnet.rpc) fail(`registry chain params unverified for ${chainKey}`);
const address = (values.address ?? registry.attestation.address) as `0x${string}` | null;
if (!address) fail(`registry attestation slot null for ${chainKey} (no deploy recorded)`);

const pk = process.env.REXTOR_AGENT_PRIVATE_KEY;
if (!pk) fail("REXTOR_AGENT_PRIVATE_KEY unset");

const record: AttestRecord = {
  reviewId: values["review-id"] as `0x${string}`,
  commitHash: values["commit-hash"] as `0x${string}`,
  findingsHash: values["findings-hash"] as `0x${string}`,
  findingsURI: values["findings-uri"] ?? "",
  riskScore: Number(values.score ?? NaN),
  findingCount: Number(values.count ?? NaN),
  status: Number(values.status ?? 0) as 0 | 1,
  targetChainId: Number(values["target-chain-id"] ?? chainId),
};
if (!/^0x[0-9a-f]{64}$/i.test(record.reviewId)) fail("--review-id must be 32-byte hex");
if (!/^0x[0-9a-f]{64}$/i.test(record.commitHash)) fail("--commit-hash must be 32-byte hex");
if (!/^0x[0-9a-f]{64}$/i.test(record.findingsHash)) fail("--findings-hash must be 32-byte hex");
if (!Number.isInteger(record.riskScore) || record.riskScore < 0 || record.riskScore > 100) {
  fail("--score must be an integer 0..100");
}
if (!Number.isInteger(record.findingCount) || record.findingCount < 0) fail("--count must be a non-negative integer");

const viemChain = defineChain({
  id: chainId,
  name: registry.name,
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
  rpcUrls: { default: { http: [values.rpc ?? registry.testnet.rpc!] } },
});
const account = privateKeyToAccount(pk as `0x${string}`);
const wallet = createWalletClient({ account, chain: viemChain, transport: http() });
const pub = createPublicClient({ chain: viemChain, transport: http() });

const hash = await wallet.writeContract({
  address,
  abi: REXTOR_ATTESTATION_ABI,
  functionName: "attest",
  args: [
    record.reviewId,
    record.commitHash,
    record.findingsHash,
    record.findingsURI,
    record.riskScore,
    record.findingCount,
    record.status,
    record.targetChainId,
  ],
  chain: viemChain,
  account,
});
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") fail(`attestation tx reverted: ${hash}`);

const verified = await pub.readContract({
  address,
  abi: REXTOR_ATTESTATION_ABI,
  functionName: "verify",
  args: [
    record.reviewId,
    record.commitHash,
    record.findingsHash,
    record.findingsURI,
    record.riskScore,
    record.findingCount,
    record.status,
    record.targetChainId,
  ],
});
if (verified !== true) fail(`verify() read-back returned ${verified} — twin not a receipt`);

const gas = receipt.gasUsed * receipt.effectiveGasPrice;
console.log(`tx            ${hash}`);
console.log(`explorer      ${registry.explorer ? `${registry.explorer}/tx/${hash}` : "(none)"}`);
console.log(`gasUsed       ${receipt.gasUsed}`);
console.log(`effGasPrice   ${receipt.effectiveGasPrice} wei`);
console.log(`cost          ${gas} wei (${Number(gas) / 1e18} native-18-decimals)`);
console.log(`verify        true`);
