# E1 — Chain cost-model review: Tempo attestation cost per review

**Status: SHIPPED (Tempo-side) 2026-09-20.** HyperEVM section blocked on HYPE
funding (rides B2's blocker per week-4 plan Task 10). Tool:
[`packages/agent/scripts/fee-review.ts`](../../packages/agent/scripts/fee-review.ts)
— read-only, no keys, reproducible by anyone (Conatus `mantle_gas_review`
parity).

## Method

Every PR review attests on-chain (`attest()` on the Tempo v2 contract
`0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd` — registry
[`chains.ts`](../../packages/agent/src/chains.ts)); the cost of that review's
on-chain verdict is the attestation transaction's
`gasUsed × effectiveGasPrice`. The tool fetches **real receipts** from the
chain RPC — no estimates, no abstractions — and reports per-tx and aggregate
costs. Anyone can re-run it against the same hashes and get the same table.

Assumptions, explicit: human units assume the chain's gas asset has **18
decimals** (Tempo's fee asset is an 18-decimal stablecoin; override with
`--decimals` for any other chain). Raw wei columns are assumption-free.

## Live receipts — Tempo testnet (fetched 2026-09-20)

Six attestation transactions across PRs #3–#5 of
`rextorsec/rextor-audit-test` (v1 contract for the two oldest, v2
`0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd` for the rest):

| tx | block | gasUsed | eff. gas price (wei) | cost (wei) | cost (human) |
|---|---|---|---|---|---|
| `0x84cd7140d5…` | 36051371 | 1807730 | 85356203125 | 154300969075156250 | 0.1543 |
| `0x2b4be69c22…` | 36050123 | 1807730 | 85356203125 | 154300969075156250 | 0.1543 |
| `0x8e4e321af5…` | 36002883 | 1807730 | 11930452729 | 21567037311795170 | 0.0216 |
| `0xffa1049732…` | 35994239 | 1807718 | 11930452729 | 21566894146362422 | 0.0216 |
| `0xbf6e232f04…` | 35987780 | 1051374 | 11930452729 | 12543367807499646 | 0.0125 |
| `0x80acc9edaa…` | 35986942 | 1051386 | 11930452729 | 12543510972932394 | 0.0125 |

count 6 · total 0.3768 · min 0.0125 · median 0.0216 · max 0.1543

## What the numbers say

- **Cost per review attestation: ~0.012–0.155** in the chain's fee asset —
  cents, not dollars, even at 7× gas-price swings.
- **gasUsed is structural, price is market:** the v2 contract's attest costs a
  stable 1,807,730 gas (v1: 1,051,8xx — v2 adds findingsURI + targetChainId
  and the agent-identity checks); the 11.9 → 85.4 gwei swing between runs is
  network congestion, not our code. Cost projections must model price, and
  the tool measures both columns separately.
- **Repro:** from `packages/agent/`:
  `npx tsx scripts/fee-review.ts [--rpc <url>] <txHash>…` — point it at any
  attestation tx on any EVM chain.

## HyperEVM (blocked)

Identical measurement on HyperEVM testnet (chainId 998) lands when the
broadcaster is funded (HYPE → new owner EOA; runbook
[hyperliquid.md](hyperliquid.md)). Placeholder recorded per plan Task 10 —
Tempo-only numbers shipped rather than deferring the whole row.
