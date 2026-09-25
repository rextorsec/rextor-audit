# Track Profiles

**Registry-mirrored doc — verified 2026-09-25.** Source of truth: [`packages/agent/src/chains.ts`](../packages/agent/src/chains.ts) (`CHAIN_REGISTRY`). This table and the registry must match exactly (same chainIds, same nulls); the registry completeness test enforces the code side.

## Tracks

| Track | Key | Name | Chain ID | Fork RPC (testnet) | Analyzers | Fork-sim | Attestation | Deployment doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Flagship | `tempo` | Tempo testnet | 42431 | `https://rpc.moderato.tempo.xyz` | Slither + Aderyn | yes | deployed — `0x51ac…495a` (deploy #3, v2; #2 `0x7fe6…0bcd` zeroed by the 09-21 testnet reset) | [`docs/deployments/tempo.md`](deployments/tempo.md) |
| Adapter | `solana` | Solana devnet | null — non-EVM (verified semantic null, SPEC-8 §3) | `https://api.devnet.solana.com` | semgrep-over-Anchor (SPEC-8 rule pack) | skipped — visible note (PoC sim is EVM-only) | deployed — programId `Aj6Nx…kMDs` (B4, devnet); home-chain attest on Tempo | [`docs/deployments/solana.md`](deployments/solana.md) |
| Primary | `hyperliquid` | HyperEVM **mainnet** | 999 | `https://rpc.hyperliquid.xyz/evm` (broadcast/reads via `https://hyperliquid.drpc.org`) | Slither + Aderyn | yes | deployed — `0x8f63…850c` (deploy #2, v2, MAINNET; testnet faucet path abandoned) | [`docs/deployments/hyperliquid.md`](deployments/hyperliquid.md) |
| Rider | `ethereum` | Ethereum | 1 | — | deterministic pass | no (config-level) | once deployed (config-level) | pending |
| Rider | `base` | Base | 8453 | — | deterministic pass | no (config-level) | once deployed (config-level) | pending |
| Rider | `arbitrum` | Arbitrum One | 42161 | — | deterministic pass | no (config-level) | once deployed (config-level) | pending |
| Rider | `robinhood` | Robinhood Chain | null — captured at integration, never fabricated | — | deterministic pass | no (config-level) | once deployed (config-level) | pending |

Per-entry notes from the registry:

- **tempo** — Flagship track: full loop — Slither+Aderyn, fork-sim; attestation deploy #3 (`0x51ac…495a`, agent registered + active, reviewCount 8 live 2026-09-25; deploy #2 zeroed by the 09-21 testnet state reset — documented).
- **hyperliquid** — Primary track: same loop; attestation deploy #2 went DIRECT to **mainnet** (chain 999, `0x8f63…850c`, twin tx confirmed block 46,562,201) — runbook [`docs/deployments/hyperliquid.md`](deployments/hyperliquid.md) records the faucet-war decision.
- **ethereum** — Rider: deterministic pass; attestation once deployed (config-level).
- **base** — Rider: config-level.
- **arbitrum** — Rider: config-level (Robinhood Chain is an Arbitrum Orbit chain).
- **robinhood** — Rider: params captured at integration — never fabricated.

Undeployed attestation slots stay `null` and are filled by SPEC-4 deployment commits (tempo filled 2026-09-17 — see [`docs/deployments/tempo.md`](deployments/tempo.md)); explorer links are `null` until verified — the report footer omits the link rather than guessing.

## Config resolution

`resolveChain(env)` in `chains.ts` picks the active track:

- `REXTOR_DEFAULT_CHAIN` — one of the keys above; **default `tempo`**. Unknown key → explicit error listing the known keys (fail loudly, never guess — SPEC-5 invariant 16).
- `REXTOR_FORK_RPC_URL` — overrides the registry fork target for the active track (per-deployment escape hatch); otherwise the track's testnet RPC is used, or `null` for riders.
- No chain-specific branches exist in engine code — every difference above lives in the registry + env (SPEC-5 invariant 15).

## Config-level riders

Ethereum, Base, Arbitrum One, and Robinhood Chain run the deterministic analyzer pass with no per-rider code paths (SPEC OUT-list): their differences are registry rows only. Fork-sim is a flagship/primary capability (a testnet fork RPC is required); rider attestation activates once their `RextorAttestation` deployments are recorded — config-level, no code changes. Robinhood Chain (an Arbitrum Orbit chain) has no verified chainId yet; params are captured at integration and never fabricated. Each rider review already records `targetChainId` (SPEC-4 v2): the audited repo's `foundry.toml` `chain_id` is the primary source when it maps to a registry chain, the home-chain id the fallback — informational only, never gating.
