# E2 — Model-Flip Rehearsal Receipt (glm-5.3 vs flash)

**Date:** 2026-10-10 · **Rule:** week-4 Task 11 / endgame R6 — fresh trigger PR only, never on
evidence-carrying PRs. Executed on `rextorsec/rextor-audit-test` PR [#13](https://github.com/rextorsec/rextor-audit-test/pull/13)
(fixture `src/SmokeVault13.sol`, head `ac94e6e`), service proc `rextor-agent-v3-e2` with
`REXTOR_TRIAGE_MODEL=z-ai/glm-5.3` + `REXTOR_FRONTIER_MODEL=z-ai/glm-5.3` in proc env
(overriding `.env` defaults; explicit proc env wins over tsx `--env-file`). **Reverted same
hour** — prod back on `.env` defaults (`rextor-agent-v4`, both models `z-ai/glm-5.3-flash`).
Config default NOT changed — RECTOR call.

## Side-by-side

| | Baseline — PR #10 (2026-10-06) | E2 — PR #13 (2026-10-10) |
|---|---|---|
| Triage + frontier model | `z-ai/glm-5.3-flash` (both) | `z-ai/glm-5.3` (both) |
| Fixture surface | reentrancy high + unzeroed sweep low (`SmokeVault10.sol`) | same classes, fresh code (`SmokeVault13.sol`) |
| Risk score | **71/100** | **71/100** |
| Findings | **9** | **9** (5 in-diff / 4 outside-diff banner) |
| Severity gate (check-run) | `failure` (high breached) | `failure` (high breached) |
| Per-class detection | reentrancy-eth high · missing-zero-check low · low-level-calls · immutable-states | identical class set on the equivalent fixture |
| Triage ops banner | (flash era) | `z-ai/glm-5.3 @ temp 0 · 0 dedup · 0 reclassify · 0 added · 1 suggest` |
| Fix suggestion | — | 1 suggested diff on finding #0 (states-flip reorder) |
| PoC / fork-sim | — | unproven — PoC generation failed, honest degrade banner (same posture as R6 receipt) |
| Attestation | Tempo `0x9274…af3b` | Tempo `0x3a0a500e59a3cc2ff069ce873e8e149f33503204f436659fa9172064fa22edd8` |
| Auto-feedback receipt | tx `0xc92989da…` (pre-index era) | **`0x546e3b5e…` — recorded in the new `feedback_receipts` ledger (chain label Ethereum, the canonical registry chain)** |
| Review latency | ~192 s | ~3.5 min (comment + attestation + feedback all settled) |

## Read

- Verdict quality is **indistinguishable on this fixture pair**: same score, same finding
  count, same gate outcome, same per-class detection; glm-5.3 (full) additionally produced a
  suggested fix diff. No regression, no hallucinated findings, no silent drops.
- The triage-model label in a live receipt reads `z-ai/glm-5.3` — the env-driven label design
  is proven flip-safe in production, end to end.
- First live whole-repo **Deep Scan** rode the same session: `POST /scan` on
  `rextorsec/rextor-audit-test@ce7f6a9` → status 0, risk 34, 4 findings (`Vault.sol` family),
  ledger row recorded. Endpoint, store, and INCOMPLETE semantics verified in production.
- Structured JSON-line logging went live this session: `service.boot` / `service.listening` /
  review lifecycle all machine-readable on stdout.

## Receipts discipline

Every number above is copied from the live artifacts (PR comment, check-runs API, service
ledger `GET /reviews/rextorsec/rextor-audit-test`, `GET /scans?...`) — nothing estimated, no
backfilled rows. The three pre-index HyperEVM feedback broadcasts remain ledger-invisible by
design (receipts-not-claims: no fabricated history).
