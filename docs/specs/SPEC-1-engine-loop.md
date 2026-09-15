# SPEC-1 — Engine Loop

**Series:** [`SPEC.md`](../../SPEC.md) holds the product contract; this is subsystem spec 1 of 6 (see spec index there).
**Status:** ACTIVE — implemented by the [Week-1 plan](../superpowers/plans/2026-09-15-week-1-foundation.md).
**Phase:** Week 1 (Sep 16–22). EVM only, fully deterministic, no LLM.

## Purpose

The PR-time audit spine every later spec builds on: GitHub PR webhook → diff-scope → Dockerized analyzer → normalized findings → deterministic score → PR comment. If this loop is wrong, everything above it (SPEC-2 triage, SPEC-3 fork-sim) is wrong — hence it gets its own contract.

## Components & contracts

### 1. Analyzer container (`packages/agent/analyzer`)

CLI contract — `docker run --rm -v <repo>:/repo rextor/analyzer`:

- **Clean run:** exit 0, stdout = NDJSON, one finding per line:
  `{"file":string,"line":number,"severity":"critical"|"high"|"medium"|"low","check":string,"description":string}`
- **Analyzer failure** (crash, missing binary, unparseable repo): stdout = single `{"status":"incomplete","reason":string}`, exit 3. NEVER an empty stdout posing as a clean pass.
- Image: `python:3.12-slim` + slither-analyzer + pinned solc (0.8.24 via solc-select). Slim, prune caches in-layer (Conatus learnings).

### 2. Diff scope (`packages/agent/src/diff-scope.ts`)

`scopeDiff(diff: string): { contractFiles: ScopedFile[]; hasContractChanges: boolean }`

- `ScopedFile = { path: string; changedLineRanges: Array<[number, number]>; isContract: true }` — ranges are NEW-file line numbers of added lines.
- Contract-path heuristic, exported as `CONTRACT_PATH_RE`: `.sol` files, `contracts/**`, `programs/**` (Solana).
- Docs-only diff → `hasContractChanges: false`; engine posts nothing.
- Input: GitHub PR `.diff` (unified diff format).

### 3. Findings normalizer + riskScore v0 (`packages/agent/src/findings.ts`)

- `normalizeFindings(ndjson: string): Finding[]` — parses §1 NDJSON. A `status:"incomplete"` line throws `IncompleteReportError(reason)` — the error type SPEC-2 triage must preserve end-to-end.
- `score(findings: Finding[]): number` — rubric v0: critical 60 · high 25 · medium 10 · low 3; sum; cap 100. Pure function of findings → recomputable by anyone from the published findings JSON.

### 4. Webhook + review runner (`packages/agent/src/server.ts`, `review.ts`)

- Events: `pull_request.opened` / `pull_request.synchronize` (GitHub only in MVP).
- `verifySignature(rawBody: string, sig: string, secret: string): boolean` — HMAC-SHA256, `sha256=` prefix, tested against a fixed vector.
- `runReview(prUrl: string): Promise<{ commented: boolean; score: number }>` — shallow-clone head, fetch `.diff`, scope; contract changes → mount repo into analyzer container → normalize → score → post ONE PR comment summary block. No contract changes → `{ commented: false }`.
- Env: `GITHUB_APP_SECRET`, `GITHUB_TOKEN` (from the symlinked `.env`).

## Cross-cutting invariants (binding on this and all later specs)

1. Findings MUST carry `file` + `line` — upstream requirement for SPEC-2's citation-constrained triage.
2. Tool failure → `INCOMPLETE` with reason, never a silent clean pass.
3. PR content is untrusted input. Container isolation from day one; prompt-injection hardening arrives with SPEC-2's LLM layer.
4. Docker-gated tests skip gracefully when Docker is absent; everything else runs offline-deterministic.

## Acceptance

- `fixtures/vault` (reentrancy + unguarded `setOwner`) — Foundry test PROVES the drain: exploit succeeding IS the fixture's validity proof.
- Container run against the fixture emits a `reentrancy-eth` `high` finding on `Vault.sol`.
- Container run against a contract-less repo exits 3 with `status:"incomplete"`.
- End-to-end happy path on a test repo: PR comment posted with score.
