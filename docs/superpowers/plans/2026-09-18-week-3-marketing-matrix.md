# Week 3 — Marketing Capability Matrix (persisted pre-kickoff)

**Date:** 2026-09-18 · **Provenance:** roadmap session with RECTOR — "put this marketing table
for end game of rextor-audit in web-marketing, in our plan, so we don't miss it later … if we
missed that feature, just put the table marketing as 'soon'".
**Status:** plan artifact — absorbed by SPEC-6 content section + Hallmark landing mockup at
Week-3 kickoff. Not yet implemented; nothing here gates `packages/web` before mockup approval.

---

## 1. Purpose

The end-game capability matrix doubles as (a) the landing centerpiece, (b) the don't-miss
checklist (every row traces to a Week-3/4 work item), and (c) the honest-status mechanism:
anything unshipped at demo time renders as **"soon"**, never silently dropped and never
faked as shipped.

## 2. Where it lands

| Surface | Content |
|---|---|
| Landing page (A3 mockup) | Public archetype table below — "Why Rextor" centerpiece section |
| `/compare` route (optional, +0.5d — RECTOR pick) | Named CodeRabbit variant, SEO play on "coderabbit alternative smart contracts" |
| Judges / submission docs | Named 3-way matrix (CodeRabbit + Conatus columns) — stays internal/judge-facing; Conatus never appears on the public site (our own product) |
| SPEC-6 | §Landing content: table component spec + status data file |

## 3. Rules (binding for the component)

1. **Receipts:** every Rextor ✔ in the shipped state links to a live artifact (explorer tx,
   `verify()` recipe, IPFS CID, fork-sim clip, demo video timestamp). Claims vs receipts —
   ours is the only column that can be receipts.
2. **Dated snapshot:** footnote convention from Gate A: *"— = not evidenced on public product
   pages as of `<date>`."* Never "X can't" — always "not evidenced, dated."
3. **Data file, not JSX:** rows live in a JSON/MDX status file; the table is a dumb renderer.
   Re-verification before demo week = 15-minute data edit.
4. **"Soon" budget: max 2 rows.** More than two `soon` badges reads as vaporware — beyond the
   budget, hide the row. Rule recorded per RECTOR's intent: never miss → show "soon";
   never over-promise → hide beyond two.
5. **Re-verify before demo week:** CodeRabbit ships weekly; refresh the competitor snapshot
   and the date stamp during E3 (demo video) week.
6. **Named-competitor tone:** factual, dated, sourced, zero disparagement. Tagline stays:
   *"CodeRabbit reviews code changes. Rextor audits money changes."* — name only on `/compare`
   and judge docs, not the landing table.

## 4. End-game public table (landing centerpiece)

Statuses frozen at SPEC-6 authoring; re-frozen at demo rehearsal (E2/E3). Backing IDs refer
to the Week-3 scope menu (roadmap session 2026-09-18).

| # | Capability | Generic AI review | One-shot audit bots | Rextor Audit | Backing | Status today |
|---|---|---|---|---|---|---|
| 1 | Built for money-code (Slither/Aderyn-class grounding) | — | ◐ | ✔ | Week-1 engine | ✅ shipped — receipt: test-repo PR comments |
| 2 | Every PR an audit event (diff-scoped, continuous) | ✔ | — | ✔ | Week-1 engine | ✅ shipped |
| 3 | Deterministic, recomputable risk score | — | ◐ | ✔ | SPEC-2 | ✅ shipped |
| 4 | Execution-proof findings (fork-sim PoC) | — | — | ✔ | SPEC-3 | ✅ shipped — receipt: fork-sim run |
| 5 | Verdict on-chain, native to the target chain | — | — | ✔ Tempo · ✔ Solana devnet · soon HyperEVM | B1, B2, B4+B5, B6 | ◐ partial — Tempo v2 live (`0x7fe6…0bcd`) + Solana devnet verdict program live (`Aj6Nx…kMDs`), HyperEVM pending |
| 6 | Integrity rails (`INCOMPLETE` never silent) | — | — | ✔ | Week-1/2 | ✅ shipped |
| 7 | Suggested fix per finding (reviewable diff) | ✔ | — | ✔ | D1 | ✅ shipped — receipt: test-repo PR fix-diff blocks |
| 8 | Repo config + severity merge gate | — | — | ✔ | D2 | 🔜 soon — check-run receipt rides F5 installation-token swap |
| 9 | Durable full report (IPFS) + anyone-can-verify | — | — | ✔ | B3 | ✅ shipped — receipt: `ipfs://QmUqtDrt…`, gateway sha256 == on-chain hash |
| 10 | Verifiable agent identity (ERC-8004) | — | — | ✔ | C1 | ✅ shipped — receipt: mint tx `0xc4c0565c…3d64`, agentId 50891 on canonical mainnet registry |
| 11 | Public agent reputation ledger | — | — | ✔ | C2 | ✅ shipped — receipt: feedback tx `0x02e73670…fb5ea`, 95/100 from bound agentWallet `0xE690…a122`; operator-seeded, disclosed on identity card |
| 12 | Cross-PR memory (dismissals) | ✔ | — | ✔ | D4 | ✅ shipped — server-side store, learnings ledger accruing |
| 13 | Chat in PR (`@rextor-audit`) | ✔ | — | ✔ | D5 | ✅ shipped — deterministic reply receipt 5742416145 |
| 14 | Chain cost-model reasoning | — | — | ✔ | E1 | ✅ shipped (Tempo) — receipt: `docs/e1-fee-review.md`, 6 real attests measured 0.0125–0.154; HyperEVM section rides HYPE funding |
| 15 | Living dashboard (ledger, history, identity card) | ✔ | — | ✔ | A3/A4 | ✅ shipped — live on Vercel |

Competitor columns carry the dated "not evidenced" footnote, not claims about their internals.
`soon` renders as a "Shipping Oct 2026" badge.

## 5. Named variants (not public landing)

- **Judges 3-way:** the full matrix from the 2026-09-18 session (CodeRabbit / Conatus /
  Rextor-after-scope columns) → submission docs + firm deck.
- **`/compare` (if picked):** CodeRabbit-named table, same rows, same footnote convention,
  sources cited inline with dates (their Security post 2026-08-13; pricing pages re-checked
  at build).

## 6. Row registry → don't-miss checklist

Every row's backing work item, for the kickoff to sweep in one pass:
A1 SPEC-6 · A2 mockups · A3+A4 Next.js web · B1 contract v2 · B2 HyperEVM · B3 IPFS ·
B4+B5 Solana pair · B6 mainnet garnish · C1 ERC-8004 · C2 reputation · D1 fix diffs ·
D2 `rextor.yaml` · D4 dismissals · D5 PR chat · E1 chain cost tool · E2/E3 rehearsal+video.
Target: all rows ✅ by **Oct 10**. Freeze rules: Sep-24 checkpoint (per roadmap session) and
demo-week re-verification.

## 7. Acceptance (when Week 3 lands this)

- Landing renders the table from a status data file; every ✅ links a receipt; `soon` badges
  ≤ 2; footnote date current.
- `/compare` exists iff RECTOR picked it; judges matrix lives in submission docs.
- No row claims a capability whose backing item is unshipped (status file is the source of
  truth, manually synced at each merge that flips a backing item).
