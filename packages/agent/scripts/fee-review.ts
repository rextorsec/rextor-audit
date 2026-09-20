// E1 — chain cost-model review (SPEC: docs/e1-fee-review.md). Fetches REAL
// attestation transaction receipts from a live chain and reports the
// per-review attestation cost: gasUsed × effectiveGasPrice, per tx and
// aggregated. Read-only — no keys, no broadcasts, reproducible by anyone.
//
// Usage (from packages/agent):
//   npx tsx scripts/fee-review.ts --rpc <url> <txHash> [txHash...]
// Defaults to the Tempo testnet RPC from the chain registry when --rpc is
// omitted. Values print in raw wei plus 18-decimal human units (the gas
// asset on Tempo is an 18-decimal stablecoin — flagged explicitly in the
// doc; a chain with different decimals overrides via --decimals).
import { createPublicClient, http, formatUnits } from "viem";
import { CHAIN_REGISTRY } from "../src/chains";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const rpc = arg("--rpc") ?? CHAIN_REGISTRY.tempo.testnet.rpc;
const decimals = Number(arg("--decimals") ?? 18);
const hashes = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{64}$/.test(a));
if (hashes.length === 0) {
  console.error("no tx hashes given — pass receipt hashes of attest() transactions");
  process.exit(1);
}
if (!rpc) {
  console.error("no rpc (registry slot empty and --rpc not given)");
  process.exit(1);
}

const client = createPublicClient({ transport: http(rpc, { timeout: 20_000 }) });

const rows: Array<{ hash: string; gasUsed: bigint; price: bigint; wei: bigint; block: bigint }> = [];
for (const hash of hashes) {
  const r = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
  const wei = r.gasUsed * r.effectiveGasPrice;
  rows.push({ hash, gasUsed: r.gasUsed, price: r.effectiveGasPrice, wei, block: r.blockNumber });
}

const total = rows.reduce((a, r) => a + r.wei, 0n);
const costs = rows.map((r) => r.wei).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const median = costs[Math.floor(costs.length / 2)];
console.log("| tx | block | gasUsed | eff. gas price (wei) | cost (wei) | cost (human) |");
console.log("|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| \`${r.hash.slice(0, 12)}…\` | ${r.block} | ${r.gasUsed} | ${r.price} | ${r.wei} | ${formatUnits(r.wei, decimals)} |`,
  );
}
console.log("");
console.log(`count : ${rows.length}`);
console.log(`total : ${total} wei = ${formatUnits(total, decimals)}`);
console.log(`min   : ${costs[0]} wei = ${formatUnits(costs[0], decimals)}`);
console.log(`median: ${median} wei = ${formatUnits(median, decimals)}`);
console.log(`max   : ${costs[costs.length - 1]} wei = ${formatUnits(costs[costs.length - 1], decimals)}`);
console.log(`rpc   : ${rpc}`);
