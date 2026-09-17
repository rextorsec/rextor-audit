# Task 7 Report — SPEC-5 chain registry + track profiles

**Status:** DONE · Commit `93cd8b0` on `feat/week-2-depth` (parent `a65df42`)

## What was implemented

Three new files, nothing else touched:

1. **`packages/agent/src/chains.ts`** (63 lines) — SPEC-5 chain registry, leaf module (zero imports):
   - `ChainKey` union: `"tempo" | "hyperliquid" | "ethereum" | "base" | "arbitrum" | "robinhood"`
   - `ChainConfig`: key, name, testnet `{chainId, rpc}`, attestation `{address, chainId}`, explorer, notes
   - `CHAIN_REGISTRY: Record<ChainKey, ChainConfig>` — verified seeds 2026-09-16: tempo 42431 / `https://rpc.moderato.tempo.xyz`, hyperliquid 998 / `https://rpc.hyperliquid-testnet.xyz`, ethereum 1, base 8453, arbitrum 42161, robinhood chainId **null** (never fabricated — SPEC-5 invariant 16). All attestation addresses and explorers start `null`.
   - `ResolvedChain extends ChainConfig` with `forkRpc`
   - `resolveChain(env)`: default `tempo`; unknown key → `Error` listing known keys; `forkRpc = REXTOR_FORK_RPC_URL ?? testnet.rpc`
   - No chain-specific branches anywhere — pure data + one resolution fn (invariant 15). No default exports.

2. **`packages/agent/test/chains.test.ts`** (35 lines) — exactly the brief's 5-test suite: registry params (verified + nulls), notes non-empty + attestation nulls, default-to-tempo, fork-override precedence, unknown-key error.

3. **`docs/track-profiles.md`** (37 lines) — judge-facing track table mirroring `CHAIN_REGISTRY` exactly (same keys/names/chainIds/RPCs/nulls), per-entry notes, config-resolution section (`REXTOR_DEFAULT_CHAIN`, `REXTOR_FORK_RPC_URL`, invariant 15 statement), "Config-level riders" section, 2026-09-16 verification date stamp. Deployment pointers marked "(pending)" since `docs/deployments/` does not exist yet (per brief: pointer only "when it exists").

## TDD evidence

- **RED:** `pnpm vitest run test/chains.test.ts` after writing only the test → `Test Files 1 failed (1)`, "Failed to resolve import ../src/chains" (module missing, as brief expected).
- **GREEN:** same command after implementation → `5 passed (5)`; `pnpm typecheck` clean.
- **Full suites (pre-commit):**
  - `packages/agent`: `vitest run` → 12 files, **133 passed | 1 skipped** (128 prior + 5 new); `tsc --noEmit` clean.
  - Repo root: `pnpm test:run` → turbo 1 task successful (agent suite green); `pnpm typecheck` → 1 task successful.

## Commit

`93cd8b0` `feat: SPEC-5 chain registry (tempo flagship, hyperliquid, riders) + track profiles doc`
- GPG-signed (`git log %G?` = G), author RECTOR, no trailers/body → zero AI attribution.
- 3 files changed, 135 insertions(+); working tree clean afterward.

## Self-review findings

- **Leaf purity:** `chains.ts` has no `import` statements — confirmed by grep. Nothing from other src files (Task 8 contract safe).
- **Interface names** match the binding T8 contract exactly: `ChainKey`, `ChainConfig`, `CHAIN_REGISTRY`, `ResolvedChain`, `resolveChain`.
- **Doc-vs-registry consistency:** chainIds 42431/998/1/8453/42161/null all present and identical in both; RPCs identical; attestation/explorer nulls stated identically.
- **Edge case considered, accepted:** empty-string `REXTOR_DEFAULT_CHAIN` → throws `unknown chain:  (known: …)` — fail-loud, spec-compliant (brief's verbatim implementation).

## Concerns

None blocking. Two informational notes:
1. `docs/deployments/<chain>.md` pointers are forward references — directory doesn't exist until SPEC-4 deployments land (marked "pending" in the doc).
2. SPEC-5 §1 mentions a `foundry.toml` chain-id mismatch warning log (informational, v1) — not in this task's file list; assumed owned by a sibling/task 8 scope. Flagging in case the controller wants it tracked.

## Fix round 1 (controller review of 93cd8b0)

**IMPORTANT — prototype-chain fail-open in `resolveChain`:** guard `key in CHAIN_REGISTRY` (true for `toString`/`valueOf`/`constructor`/`__proto__` via `Object.prototype`) replaced with `!Object.hasOwn(CHAIN_REGISTRY, key)` (tsconfig target ES2022, so `hasOwn` is available). Previously `resolveChain({REXTOR_DEFAULT_CHAIN: "toString"})` returned `{forkRpc: null}` instead of throwing — fail-open at exactly the boundary invariant 16 exists for.
**M1 — shared mutable nested objects:** registry now deep-frozen via a 7-line `deepFreeze` helper (entry + nested testnet/attestation + registry object). `resolveChain`'s shallow spread shares nested objects across resolutions; freezing makes poisoning impossible (strict-mode modules → mutation throws).
**M3 — doc/registry text drift:** rider rows' Analyzers cell in `docs/track-profiles.md` said "Slither + Aderyn" (extrapolated from flagship notes); now "deterministic pass", matching the registry rider notes exactly. Flagship/primary rows keep "Slither + Aderyn" (registry: "full loop — Slither+Aderyn" / "same loop"). M2/M4 untouched as instructed.

**Tests added (2):** prototype-key regression (toString, valueOf, constructor, `__proto__` each throw the exact unknown-chain error listing known keys) and deep-frozen contract (registry, every entry, every testnet/attestation frozen).

**TDD evidence:** new tests RED against pre-fix `chains.ts` (verified via `git stash` of the fix: both fail — `× prototype keys are rejected…`, `× registry and entries are deeply frozen…`), GREEN post-fix. chains.test.ts 7/7; full agent suite 12 files, **135 passed | 1 skipped**; `tsc --noEmit` clean.

**Files changed:** `packages/agent/src/chains.ts` (guard + freeze), `packages/agent/test/chains.test.ts` (+14 lines, 2 tests), `docs/track-profiles.md` (4 rider rows).
