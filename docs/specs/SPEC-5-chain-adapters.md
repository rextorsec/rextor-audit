# SPEC-5 — Chain Adapters & Track Profiles

**Series:** [`SPEC.md`](../../SPEC.md) holds the product contract; this is subsystem spec 5 of 6 (see spec index there).
**Status:** ACTIVE — implemented by the Week-2 plan.
**Phase:** Week 2. Post-Gate-B EVM-first: Tempo flagship, Hyperliquid primary, riders config-level. Solana = adapter tier behind a future Gate B′ (out of scope).

## Purpose

One config surface telling the whole engine WHICH chain it serves: fork target (SPEC-3), attestation destination + address (SPEC-4), and the track story (submission docs). Riders stay config-level — no per-rider code paths (SPEC.md OUT list enforcement).

## Components & contracts

### 1. Chain registry (`packages/agent/src/chains.ts`)

```ts
interface ChainConfig {
  key: "tempo" | "hyperliquid" | "ethereum" | "base" | "arbitrum" | "robinhood";
  name: string;
  testnet: { chainId: number | null; rpc: string | null }; // null = not yet verified — fail explicit, never guess
  attestation: { address: `0x${string}` | null; chainId: number | null }; // filled by SPEC-4 deployments
  notes: string; // track-profile one-liner
}
```

- Seeded (params verified 2026-09-16): tempo testnet 42431 / `rpc.moderato.tempo.xyz` · hyperliquid testnet 998 / `rpc.hyperliquid-testnet.xyz` · ethereum 1 · base 8453 · arbitrum 42161 · robinhood `chainId: null` (params captured at integration — never fabricated).
- `resolveChain(env)` → active `ChainConfig` from `REXTOR_DEFAULT_CHAIN` (default `tempo`); unknown key → explicit error. `REXTOR_FORK_RPC_URL` overrides the registry fork target (per-deployment escape hatch).
- Repo-side hint: `foundry.toml` chain id ≠ active chain → warning log + comment footnote (informational only in v1 — no gating).

### 2. Track profiles (`docs/track-profiles.md`)

The judge-facing per-track story, versioned with the registry: what runs on each track (analyzers, fork-sim, attestation chain), what is config-level, what is deferred. Tempo = full loop on testnet; Hyperliquid = same loop, second deploy; riders = deterministic pass + attestation once deployed.

## Cross-cutting invariants

15. No chain-specific branches in engine code — differences live in the registry + env only.
16. Unverified params are `null`, and `null` fails loudly — fabricated chain params are a spec violation.

## Acceptance

- `resolveChain`: default, explicit, unknown-key error, fork-override precedence.
- Registry completeness test: every seeded entry carries verified testnet params or an explicit null + note.
- `docs/track-profiles.md` exists and matches the registry (dates, chainIds).
