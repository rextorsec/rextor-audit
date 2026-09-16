# SPEC-4 — Attestation + Agent Identity (EVM-first)

**Series:** [`SPEC.md`](../../SPEC.md) holds the product contract; this is subsystem spec 4 of 6 (see spec index there).
**Status:** ACTIVE — implemented by the Week-2 plan.
**Phase:** Week 2 (contract + Tempo testnet deploy + agent integration). Dashboard display of attestations/reputation is SPEC-6 (Week 3).

## Purpose

Make every review verdict reproducible and accountable on-chain: commit hash + findings hash + riskScore + agent identity, anchored on the target chain. Gate A: nobody ships this — it is the wedge, deployed early.

## Components & contracts

### 1. Contract (`contracts/attestation-evm`, Foundry)

`RextorAttestation.sol` — minimal, immutable v1 (changes = redeploy; no upgrade path by design):

- **Agent registry:** `registerAgent(address agent, string calldata name) external onlyOwner`; `setAgentActive(address, bool) external onlyOwner`. `struct Agent { string name; bool active; uint64 reviewCount; }` — `reviewCount` accrues per attestation: the on-chain reputation primitive.
- **Attestation:** `attest(bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash, uint16 riskScore, uint16 findingCount, uint8 status) external` — caller must be an active agent; `status`: 0 = complete, 1 = incomplete (SPEC-1 hard tier). Increments `reviewCount`; emits `Attested` (full payload, indexed on `reviewId` + `agent`).
- **Idempotency:** re-attest of an EXISTING reviewId with byte-identical payload = no-op success (webhook redelivery safety); different payload → `revert IdempotencyConflict()`.
- **Views:** `attestations(bytes32)`, `agents(address)`, and `verify(bytes32 reviewId, …full payload…) view returns (bool)` — the anyone-can-recompute check.

Verdict identity & hashes (binding, shared with the agent):

- `reviewId = keccak256("rextor/review/v1|" + repoFullName + "|" + prNumber + "|" + headSha)` — `repoFullName` = `owner/repo`.
- `findingsHash = sha256(canonical final-findings JSON)` — canonicalization defined in SPEC-2 §2; covers PoC sources (SPEC-3 #10).
- `commitHash` = the PR head git sha: 20 bytes, right-zero-padded to `bytes32`.
- `riskScore` ≤ 100 (rubric v1 value); `findingCount` = final findings length.

### 2. Deployments (testnets only in Week 2 — no mainnet attestation)

| target | chainId | rpc | order |
|---|---|---|---|
| Tempo testnet (flagship) | 42431 | `https://rpc.moderato.tempo.xyz` | first |
| HyperEVM testnet (primary) | 998 | `https://rpc.hyperliquid-testnet.xyz` | second |
| riders (ethereum, base, arbitrum, robinhood) | — | — | config-level; registry slots only (SPEC-5) |

- Deploy via `forge script` profiles (`tempo`, `hyperliquid`); every deployment recorded in `docs/deployments/<chain>.md`: checksummed address, deploy tx, chainId, block, deploy-key address, contract commit.
- Keys: deploy/owner = RECTOR-controlled; the ATTEST key = dedicated EOA from `REXTOR_AGENT_PRIVATE_KEY` whose only power is `attest` (worst case from key theft: visible, attributable bogus attestations — no fund path by design).
- Testnet funding (Tempo + Hyperliquid faucets) is a RECTOR manual prerequisite — flagged in the Week-2 plan.

### 3. Agent integration (`packages/agent/src/attest.ts`)

- viem client per chain (http transport; chain params from the SPEC-5 registry). Chain selection uses the registry's `REXTOR_DEFAULT_CHAIN` knob (default `tempo`) — the plan sketch's separate `REXTOR_ATTEST_CHAIN` was superseded 2026-09-16: one chain env for the whole engine, per SPEC-5 invariant 15. Env: `REXTOR_AGENT_PRIVATE_KEY`, `REXTOR_ATTEST_CONTRACT_ADDRESS`.
- Pipeline position: `… → score → attest → postComment` — attest runs BEFORE the comment (fast testnet write, 30 s abort) so the comment can cite the tx. On any failure: log + post the comment WITHOUT the tx line — attestation enhances, never blocks, the review.
- `ReviewDeps` grows: `attest?: (record: AttestRecord) => Promise<{ txHash: string; explorerUrl: string } | null>` — injected; absent/env-unset → comment notes "attestation skipped (not configured)". The PR comment gains an attestation footer: chain, reviewId, tx/explorer link, findingsHash — the reproducibility recipe sitting next to the `<details>` findings JSON it hashes.
- SPEC-1 §4 interface evolution (binding for Week 2): `clone(prUrl)` returns `{ dir: string; headSha: string }` — the attest record needs the PR head sha for `reviewId`, and the clone has it locally. `ReviewResult` gains `attestation?: { chain: string; reviewId: string; txHash: string; explorerUrl: string } | { skipped: string }`.

## Cross-cutting invariants

12. An INCOMPLETE review is attested `status = 1` — an on-chain `riskScore: 0` can never masquerade as a clean pass.
13. Idempotent re-attest under webhook redelivery; conflicting re-attest reverts.
14. The attested findingsHash is verifiable end-to-end from public artifacts alone: PR comment (findings JSON) → sha256 → on-chain compare via `verify`.

## Acceptance

- Forge suite: register/activate gates; happy attest; idempotent no-op; conflict revert; inactive-agent revert; incomplete-status round-trip; `reviewCount` increments; `verify()` true/false paths.
- Agent unit (fakes): canonical-hash vector + reviewId vector (fixed, documented); injected attest success → footer rendered; attest throws → comment still posted, no tx line; env-unset → skipped note.
- Deployments recorded per §2; a smoke attestation of the fixtures/vault review readable back via `verify`.
