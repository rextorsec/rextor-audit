# Rextor Audit — Master Execution Plan

**Event:** Colosseum Crypto World's Fair — runs Sep 14 → Oct 12, 2026 (11:59pm PT). Winners ~Dec 5.
**Today:** Sep 15, 2026. **27 days to submission.**

## Non-negotiables

1. **Mockups-before-code** (web surfaces): every UI ships first as a static Hallmark-designed mock in `mockups/`, reviewed and approved, THEN implemented in `packages/web`. No exceptions.
2. **Integrity rules:** LLM findings require cited line ranges; tool failures → `INCOMPLETE`, never a clean pass; PR content is untrusted input (prompt-injection hardening; sims sandboxed in Docker).
3. **Submit early:** target Oct 10, not Oct 11:59pm.
4. **Tests:** every new function/module gets tests (`pnpm test:run` green before merge to main). 80%+ coverage on new code.
5. **One commit per feature.** `feat:`/`fix:`/`chore:`/`docs:` prefixes. GPG-signed (global config handles it).

## Phase 0 — Today (Sep 15): lock & scaffold

- [x] Decisions locked: product, name, org (`rextorsec`), domains, track aims
- [x] Monorepo scaffolded, private GitHub repo created
- [ ] **RECTOR (manual):** register at https://colosseum.com/arena/hackathon — verify multi-track selection mechanics on the platform (screenshot for the record)
- [ ] **RECTOR (manual):** buy `rextoraudit.com` + `rextorsecurity.com` (~$25/yr, verified available Sep 15)
- [ ] **RECTOR (decision):** confirm team roster (avg winning team >3; Colosseum cofounder-matching exists if needed)

## Phase 1 — Week 1 (Sep 16–22): foundation + gates

Engine skeleton end-to-end on EVM: PR webhook → diff-scope → Slither-in-Docker → findings JSON → PR comment (no LLM yet). Fixtures: vulnerable Solidity Vault + Foundry test proving the bug.

**GATE A — competitive deep-scan (by Sep 22):** Greptile / Crytic / ChainGPT / OpenAudit actual contract-review depth + any stealth PR-time audit products. Output: positioning confirmation or reposition.
**GATE B — Solana credibility spike (by Sep 22):** Aderyn-Rust (or equivalent) against a vulnerable Anchor fixture. If credible findings → Solana module stays flagship. If NOT → EVM-first pivot (Tempo becomes flagship; Solana demotes to adapter).

Detailed bite-sized tasks: `docs/superpowers/plans/2026-09-15-week-1-foundation.md`.

## Phase 2 — Week 2 (Sep 23–29): engine depth + chains

- Rextor profile v1: citation-constrained triage (Policy-A pattern — reclassify / dedup / add-with-citation; counts non-cited ops; assigns no score).
- Deterministic `riskScore` rubric v1 (recomputable; published).
- Fork-sim: Foundry fork (EVM chains) + liteSVM (Solana) — PoC reproduction for critical/high findings.
- Attestation: EVM contract (deploy Tempo testnet first, then HyperEVM + riders), Solana attestation program.
- Full GitHub App loop live on a test repo.
- Author specs at phase start (post-gates): `SPEC-2` triage+scoring · `SPEC-3` fork-sim · `SPEC-4` attestation · `SPEC-5` chain adapters.

## Phase 3 — Week 3 (Sep 30–Oct 6): product surface (mockup-first!)

- [ ] **Mock phase (Hallmark, fired):** landing (rextoraudit.com) + dashboard (living audit report) as static mocks in `mockups/` → RECTOR approval → build.
- Next.js web: landing, install flow, docs quickstart, single-repo dashboard (attestation ledger, risk history).
- The money demo: real audited protocol + subtle post-audit bug in a PR → Rextor catches it with a runnable PoC comment.
- Track-specific demo material: Tempo payments profile (policy engine, fee sponsorship), Hyperliquid vault/perps profile.
- Agent identity + reputation (ERC-8004 pattern on EVM; Solana equivalent).
- Author `SPEC-6` (product surface) alongside mock approval — content gated by what the engine actually ships.

## Phase 4 — Final week (Oct 7–12): polish & submit

- rextoraudit.com live (Vercel) + `/.well-known/security.txt` on both domains; one-pager on rextorsecurity.com.
- 3-minute demo video (the money shot: stale audit PDF vs live catch).
- README/submission: document every track integration (Solana + Tempo + Hyperliquid deep; riders config-level).
- **Submit Oct 10.** Post-submission: keep repo public (judging criterion: open-source composability).

## Stack (locked)

pnpm + turbo monorepo · TypeScript strict · Node/tsx agent in Docker · Next.js 14 web on Vercel · Foundry (EVM contracts + fork-sim) · Anchor (Solana) · Slither + Aderyn-class analyzers · liteSVM · OpenRouter (temp 0) · vitest.

## Repo layout

```
packages/agent        engine: webhook, diff-scope, pipeline, profiles runner, reporters
packages/web          Next.js product surface (built AFTER mock approval)
packages/profiles     Rextor review profiles (versioned, chain-aware)
contracts/attestation-evm    Foundry: attestation + agent identity
programs/attestation-solana  Anchor: attestation program
fixtures/             vulnerable demo contracts/programs + proving tests
mockups/              Hallmark static UI mocks (pre-code, approval gate)
docs/superpowers/plans/      bite-sized execution plans
docs/specs/                 per-subsystem SPEC-N contracts (index in SPEC.md)
```

## Risk register

| Risk | Mitigation |
|---|---|
| Aderyn-Rust immature | Gate B pivot: EVM-first, Tempo flagship |
| Incumbent found in scan | Gate A: reposition (depth/attestation) or fold |
| Prompt injection via PR content | Untrusted-input handling, sandboxed sims, instruction separation |
| False-positive noise → muted bot | PoC-gated critical findings, severity thresholds, profile tuning |
| 27-day scope creep | OUT list in SPEC.md enforced; riders are config-only |
| Track stacking disallowed | Confirm at registration (Phase 0); model 1–2 track wins regardless |
