# SPEC-8 — Solana Adapter: Semgrep-over-Anchor Slice + Verdict Program

**Series:** [`SPEC.md`](../../SPEC.md) holds the product contract; this is subsystem spec 8.
**Status:** ACTIVE — Week 4 (B4+B5, inseparable per scope decision 3).
**Scope source:** [`docs/superpowers/plans/2026-09-18-week-3-scope.md`](../superpowers/plans/2026-09-18-week-3-scope.md) menu B4+B5 + [`2026-09-19-week-4-plan.md`](../superpowers/plans/2026-09-19-week-4-plan.md) Task 7.
**Spike evidence (2026-09-19, pre-gate):** toolchain green — anchor-cli 0.30.1, solana-cli 3.1.10 (Agave), cargo 1.94.1, semgrep installed; `fixtures/solana-vault` present (anchor-lang 0.31.1, static-analysis-only, NOT buildable by design); devnet wallet funded (~5 SOL). RECTOR: GO.

## Purpose

The Solana adapter tier: Anchor programs get the same review experience as EVM repos — deterministic findings, LLM triage/score, attestation — via a semgrep slice (B5) plus a native devnet verdict program (B4). **Adapter, not fork:** triage, rubric, gate, attestation contract, and the PR-comment surface are unchanged; only the deterministic front end and the native verdict record are Solana-specific.

## 1. Analyzer slice (B5)

**Dispatch lives inside the analyzer container** (the engine's `runAnalyzerContainer` and `ReviewDeps.runAnalyzer` seam are untouched — chain differences live at the analyzer layer, invariant 15):

- `run.sh` gains a repo-shape dispatch: if `/repo/Anchor.toml` exists, OR any `/repo/programs/*/Cargo.toml` declares `anchor-lang`, run `solana.sh`; otherwise the existing Slither path. Neither path changes the NDJSON contract (`{file, line, severity, check, description}` per line; exit 3 + `{"status":"incomplete","reason":…}` on failure — SPEC-1 §1).
- `solana.sh` runs semgrep over the repo with the baked rule pack (`analyzer/rules/solana-anchor/`), converts `--json` output to the NDJSON schema, and carries the same fail-closed discipline as `run.sh`: semgrep missing → incomplete; unparseable JSON → incomplete; empty scan of a repo that has `.rs` sources under `programs/` → incomplete (`no-rust-analyzed`), never a silent clean pass.
- Severity mapping: rule `metadata.rextor_severity` is the source of truth (`critical|high|medium|low`); missing metadata degrades to semgrep's `ERROR→high`, `WARNING→medium`, `INFO→low` — explicit, never silent.
- `file` is the basename (EVM convention), `line` is `start.line`.

**Rule pack v1 (deterministic, fixture-anchored, real audit classes):**

| ID | Severity | Pattern class | Fixture match |
|---|---|---|---|
| `REXTOR-SOL-001` | high | manual lamport mutation (`try_borrow_mut_lamports` on a ctx account) — authority bypass / drain surface | `withdraw` (a) |
| `REXTOR-SOL-002` | high | direct write to `$acc.owner` inside a program instruction without constraint evidence — ownership takeover surface | `set_owner` (b) |
| `REXTOR-SOL-003` | low | `.unwrap()` on `checked_*` arithmetic with an instruction argument — panic/griefing DoS surface | `withdraw` amount math |

Rules are vetted against the fixture: **exactly 3 findings** with pinned ids/severities/lines is the acceptance test (run against the fixture via semgrep locally AND inside the rebuilt image).

## 2. Diff scope

`CONTRACT_PATH_RE` already classifies `programs/**` as contract code — Anchor PRs scope correctly with **zero engine changes**. Documented limitation (v1): root-level `.rs` outside `programs/` in a non-Anchored layout is unscoped. The fixture's root layout is analyzer-target-only; full-loop smokes use `programs/` layout in the test repo.

## 3. Chain registry

- `ChainKey` gains `"solana"`; entry: `name: "Solana devnet"`, `testnet: { chainId: null, rpc: "https://api.devnet.solana.com" }` (RPC verified live pre-entry), `attestation: { address: null, chainId: null }`, `explorer: null`, notes naming the adapter tier.
- `chainId: null` is a **verified semantic fact** (non-EVM chains carry no EVM chain id), not a gap — invariant 16's null-fails-loudly then applies naturally: `attestationChainId(solana) === null` → `targetChainId` 0 → footer skips the segment (existing null-skip recipe, SPEC-4 v2).
- `ChainConfig.attestation.address` widens `0x${string} | null` → `string | null`: the Solana slot holds a base58 programId post-deploy. No other entry changes.

## 4. Fork-sim guard

`REXTOR_FORK_RPC_URL` is set on the production deployment, so env-absence cannot protect Solana repos: `runSimStage` checks the cloned repo's shape (`Anchor.toml` at root OR `programs/*/Cargo.toml` with `anchor-lang`) and when Anchor-shaped **skips** PoC generation and fork-sim with a visible note: *"Fork-sim skipped: Anchor (Solana) repo — PoC sim is EVM-only (SPEC-8)."* Skipped ≠ unproven (no rubric change) — mirrors the existing no-fork skip semantic. Repo-shape detection is deterministic and unit-tested with temp dirs; it is a repo-shape branch, not a chain-name branch.

## 5. Attestation semantics

- **Home chain (scope decision 1):** Solana-track reviews attest on Tempo exactly like EVM reviews — `score → pin → attest` unchanged; `targetChainId` continues to mean "the chain attestation rides on" per the engine's registry (Tempo 42431). No per-PR chain detection in v1 (documented limitation; the footer already names the attesting chain).
- **Native verdict record (B4):** the Anchor program gives the demo chains a chain-native verdict record. It is an ops-level receipt path in v1 (scripted smoke post-deploy), not service wiring — service-side auto-write stays behind `REXTOR_SOLANA_PROGRAM_ID` when it exists, skipped with a visible note when absent (null-skip discipline).

## 6. Verdict program (B4) — `programs/attestation-solana/`

Standalone Anchor workspace (own `Anchor.toml`, `Cargo.toml` pinning
`anchor-lang = "=0.31.1"` via avm — matching the Gate-B fixture's anchor-lang;
the 0.30 CLI line cannot build on a modern dep graph because anchor-syn 0.30.1's
IDL build uses `Span::source_file`, removed in proc-macro2 1.0.60).

**State:** one PDA per review: seeds `["review", review_id]`, fields `{ agent: Pubkey, risk_score: u8, status: u8, findings_uri: String (≤ 128 bytes), slot: u64 }`. `review_id: [u8; 32]` (the same keccak/sha256 recipe the EVM contract hashes — bytes only, no derivation change).

**Instruction:** `attest_review(review_id, risk_score, status, findings_uri)`:
- `agent` = signer (the agent wallet; PDA's `agent` field records it — mirrors EVM `registerAgent`/attest identity).
- Idempotency mirrors the EVM contract (SPEC-4): same params on an existing PDA → Ok no-op; conflicting `risk_score`/`status`/`findings_uri` on an existing review → explicit error (`IdempotencyConflict`).
- `risk_score` ≤ 100 enforced; `status`: 0 = complete, 1 = incomplete (same vocabulary as Tempo).

**Tests:** Anchor workspace tests (localnet via `anchor test`) covering: first attest creates the PDA with all fields; identical re-attest is a no-op Ok; conflicting re-attest errors; oversize `findings_uri` errors; `risk_score` > 100 errors; wrong signer (unsigned payer) fails. Green locally BEFORE the devnet gate.

**Deploy:** 🔴 RECTOR gate (plan global constraints — Solana devnet deploys). `anchor deploy --provider.cluster devnet` from the funded shared devnet wallet (`~/Documents/secret/solana-devnet.json` via env-path, never argv). ProgramId + deploy tx recorded in `docs/deployments/solana.md` + the registry slot; `chains.test.ts` updated with the recorded literal (mirror the Tempo `5019723` pattern).

## Cross-cutting invariants (numbering continues from SPEC-7)

25. The analyzer NDJSON/incomplete contract is chain-blind: the Solana slice emits the same schema and the same fail-closed incompleteness (no-rust-analyzed is incomplete, never clean).
26. Fork-sim absence on Solana is a **visible skip**, never silent, never unproven; determinism (rubric, gate, canonical JSON) is untouched by the adapter.
27. Non-EVM chain facts are recorded as verified nulls with notes (no EVM chainId on Solana), never fabricated numbers.
28. The Solana verdict program's idempotency semantics mirror the EVM contract: same verdict replay is a no-op; conflicts are loud errors.

## Acceptance

- `solana.sh` + rule pack: exactly 3 findings on `fixtures/solana-vault` (ids, severities, lines pinned in the test); incomplete-contract behaviors unit-tested (missing semgrep, bad JSON, no-rust-analyzed).
- `run.sh` dispatch: Anchor detection unit-testable via mounted fixtures; EVM path byte-identical for non-Anchored repos.
- `runSimStage`: Anchor-shaped repoDir → skipped + note; EVM repoDir unchanged (temp-dir unit tests).
- `chains.ts`: solana entry + widened address type; registry-completeness test extended; all existing assertions green.
- Anchor workspace: `anchor build` + `anchor test` green locally; deploy is gated and recorded.
- Root suites green (`pnpm test:run`, `pnpm typecheck`); analyzer image rebuilt after rule/slice changes.
