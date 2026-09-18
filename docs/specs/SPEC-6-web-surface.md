# SPEC-6 — Product Surface: Landing, Dashboard, Install Flow

**Series:** [`SPEC.md`](../../SPEC.md) holds the product contract; this is subsystem spec 6 of 6.
**Status:** ACTIVE — Week 3.
**Scope source:** [`docs/superpowers/plans/2026-09-18-week-3-scope.md`](../superpowers/plans/2026-09-18-week-3-scope.md) (locked decisions + menu A1–F7). **Content source:** [`docs/superpowers/plans/2026-09-18-week-3-marketing-matrix.md`](../superpowers/plans/2026-09-18-week-3-marketing-matrix.md) (end-game table, receipts rule, `soon` budget).

## Purpose

The product surface that makes the engine legible and the wedge visible: a landing page that proves "audits are point-in-time, code is continuous" with receipts instead of claims, a living audit report per repo (attestation ledger + risk history + agent identity), and an install flow that gets a protocol team from zero to first attested PR review in minutes. This is the CWF money-demo surface.

## Process gate (hard rule)

Hallmark-designed static mocks in `mockups/{landing,dashboard,install}/` → RECTOR approval → only then `packages/web`. Approved mock `tokens.css` is the implementation's token source of truth — same token names, no re-invention. No `packages/web` code before approval.

## Components & contracts

### 1. App shell (`packages/web`, Next.js 14 app router)

- Routes: `/` (landing), `/dashboard/[owner]/[repo]` (living audit report), `/install`, `/docs` (light: concept + config reference rendered from the same content as `docs/rubric`-style pages — static MDX acceptable).
- TS strict, pnpm workspace member, vitest + Testing Library (Conatus web pattern). Deploy: Vercel. Env: `REXTOR_AGENT_URL`, `REXTOR_AGENT_TOKEN` (service auth), `NEXT_PUBLIC_*` limited to non-secrets (contract addresses, chainIds, explorer base URLs).
- **UI stack (locked 2026-09-18, RECTOR decision): Tailwind CSS + shadcn/ui + Radix UI** — CodeRabbit's own stack (Wappalyzer-verified), chosen so the studied CodeRabbit design DNA ports natively. Approved mock tokens map 1:1 into Tailwind v4 `@theme` + shadcn/ui CSS variables (`--background`/`--foreground`/`--primary`/… naming adopted in `tokens.css`). Fire the `shadcn` skill when scaffolding or adding components.
- No login, no billing, no multi-tenant anything (SPEC.md OUT list).

### 2. Landing (`/`)

Content (single source of truth = marketing-matrix doc; copy from SPEC.md):

1. **Hero:** positioning line — *"CodeRabbit reviews code changes. Rextor audits money changes."* Sub: every PR touching money-code is an audit event; verdicts anchored on-chain. CTA: install the GitHub App (→ `/install`).
2. **Capability matrix section:** the end-game table rendered from a **status data file** (`content/capabilities.json`), NOT JSX. Columns: generic AI review / one-shot audit bots / Rextor. Rules (binding): every shipped ✔ links a live receipt (explorer tx, `verify()` recipe, fork-sim evidence, demo video timestamp); `soon` badge budget ≤ 2, beyond that the row hides; competitor cells carry the dated footnote *"— not evidenced on public product pages as of `<date>`"* — never claims about their internals; named competitor (`CodeRabbit`) does NOT appear on the landing (archetype labels only).
3. **How it works:** the 5-stage loop (scope → deterministic pass → triage → verdict → anchor) with one honest artifact each.
4. **Track board:** from `docs/track-profiles.md` data — Tempo flagship (attestation deployed, tx receipt link), HyperEVM primary, riders config-level. Registry params only; never fabricated values (SPEC-5 invariant 16).
5. **Integrity section:** citation-constrained triage, `INCOMPLETE` never silent (attested status=1, score 0), PR content untrusted. This is a trust product — the integrity rails ARE marketing copy.
6. **Footer:** Rextor Security firm line, tagline, docs links.

Optional `/compare` (named-competitor SEO page): OUT of v1 unless RECTOR opts in (+0.5d); when built, same data file + sources cited with dates.

### 3. Dashboard (`/dashboard/[owner]/[repo]`)

Living audit report for one repo:

- **Review ledger:** rows = completed reviews — PR #, head sha (short), date, riskScore, findingCount, status (complete/incomplete), attestation chain + tx link, `verify()` affordance. Sorted desc.
- **Verify affordance per row:** expands the SPEC-4 footer recipe — findingsHash sha256 line, reviewId, link to tx on explorer, link to the PR comment carrying the findings JSON. The anyone-can-recompute path, one click deep.
- **Score history:** simple line/bar per review (rubric recomputable — the history shows it working).
- **Agent identity card:** `agents(agent)` + `reviewCount` read live from the active attestation chain (public RPC, viem read-only), agent name `rextor-audit[bot]`, attested incomplete count visible (honesty surfacing, not hidden).
- **Data sources:** agent-service review index — new `reviews` SQLite table (repo, pr, headSha, reviewId, chain, txHash, explorerUrl, riskScore, findingCount, status, commentUrl, createdAt) written at review completion; served at `GET /reviews/:owner/:repo` (token-gated like other service endpoints). Chain reads via server route handlers with public RPC only. Browser never makes key-bearing calls (invariant 18/19).
- Empty state (no reviews): explicit "no attested reviews yet — install and open a PR", never fake data.

### 4. Install flow (`/install`)

Four steps, each verifiable: (1) install the GitHub App (real install link; permissions listed honestly: PRs RW, Contents RO, `pull_request` event only); (2) add `rextor.yaml` (copy-paste snippet — the D2 config surface, rendered verbatim); (3) open a PR touching money-code; (4) what arrives — annotated anatomy of a real review comment (score banner, findings table with cited lines, attestation footer with tx link) + the check-run gate behavior from D2. Screenshots/content come from the real test-repo artifacts only — no invented examples.

## Cross-cutting invariants (numbering continues from SPEC-5)

17. The web surface never claims a capability whose backing work is unshipped: capabilities render from the status data file; shipped = receipt link present. `soon` presentation budget is configurable via the data file (`maxSoonRows`) — the RECTOR-approved 2026-09-18 mock runs the full table with de-emphasized badges and an honest footnote; a reduced budget is the post-CWF default.
18. Dashboard data = agent review index (SQLite) + public chain reads via server route handlers; no browser-held keys, no unauthenticated chain writes.
19. No secrets in the client bundle; `NEXT_PUBLIC_` limited to addresses/chainIds/explorer URLs.
20. `tokens.css` from the approved mockups is the implementation token source; divergent inline colors/fonts in `packages/web` are a spec violation.

## Acceptance

- Mocks: three self-contained HTML mocks in `mockups/`, Hallmark-stamped (macrostructure · theme · enrichment + pre-emit critique), verified at 320/375/414/768, honest copy only (real numbers or labelled `—`) — RECTOR-approved before any web code.
- Web: build + typecheck green; capabilities table renders from `capabilities.json` with every shipped ✔ linking a resolving receipt; dashboard renders the test-repo ledger from seeded `reviews` rows + live Tempo reads (`agents()`, `reviewCount`, per-review `verify()` true-path); install flow shows real comment anatomy; all four mobile widths verified; unit tests cover the data-file renderer, ledger row → verify-recipe expansion, and empty states.
- Deploy: Vercel preview live for RECTOR review before submission week.
