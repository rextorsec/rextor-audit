# Track Profiles

**Registry-mirrored doc — verified 2026-09-16.** Source of truth: [`packages/agent/src/chains.ts`](../packages/agent/src/chains.ts) (`CHAIN_REGISTRY`). This table and the registry must match exactly (same chainIds, same nulls); the registry completeness test enforces the code side.

## Tracks

| Track | Key | Name | Chain ID | Fork RPC (testnet) | Analyzers | Fork-sim | Attestation | Deployment doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Flagship | `tempo` | Tempo testnet | 42431 | `https://rpc.moderato.tempo.xyz` | Slither + Aderyn | yes | deployed — `0x7fe6…0bcd` (deploy #2, v2) | [`docs/deployments/tempo.md`](deployments/tempo.md) |
| Primary | `hyperliquid` | HyperEVM testnet | 998 | `https://rpc.hyperliquid-testnet.xyz/evm` (bare domain 404s — `/evm` required) | Slither + Aderyn | yes | pending — deploy #2 (v2 direct) | [`docs/deployments/hyperliquid.md`](deployments/hyperliquid.md) |
| Rider | `ethereum` | Ethereum | 1 | — | deterministic pass | no (config-level) | once deployed (config-level) | pending |
| Rider | `base` | Base | 8453 | — | deterministic pass | no (config-level) | once deployed (config-level) | pending |
| Rider | `arbitrum` | Arbitrum One | 42161 | — | deterministic pass | no (config-level) | once deployed (config-level) | pending |
| Rider | `robinhood` | Robinhood Chain | null — captured at integration, never fabricated | — | deterministic pass | no (config-level) | once deployed (config-level) | pending |

Per-entry notes from the registry:

- **tempo** — Flagship track: full loop — Slither+Aderyn, fork-sim; attestation deployed 2026-09-17 (`0x5137…d31f`, agent registered + active).
- **hyperliquid** — Primary track: same loop, attestation deploy #2 (v2 deploys directly — no v1 history). Runbook prepared: [`docs/deployments/hyperliquid.md`](deployments/hyperliquid.md) (broadcast RECTOR-gated).
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

Ethereum, Base, Arbitrum One, and Robinhood Chain run the deterministic analyzer pass with no per-rider code paths (SPEC OUT-list): their differences are registry rows only. Fork-sim is a flagship/primary capability (a testnet fork RPC is required); rider attestation activates once their `RextorAttestation` deployments are recorded — config-level, no code changes. Robinhood Chain (an Arbitrum Orbit chain) has no verified chainId yet; params are captured at integration and never fabricated.
