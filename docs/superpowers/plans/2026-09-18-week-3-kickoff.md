# Week 3 Kickoff — Mockups → Contract v2 → Web Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Week-3 slice of the locked scope — SPEC-6 mockups to RECTOR approval, contract v2 + Tempo redeploy + HyperEVM + IPFS pin (B-track), and the `packages/web` surface (gated on mock approval).

**Architecture:** Static Hallmark mocks (`mockups/`) gate all web code. Contract v2 adds `findingsURI` + `targetChainId` to `RextorAttestation` (immutable → redeploy). Agent gains an IPFS pin step and a `reviews` SQLite index served at `GET /reviews/:owner/:repo`. Next.js 14 app-router web renders capabilities from a JSON data file, the dashboard from that index + public RPC reads.

**Tech Stack:** pnpm + turbo · TypeScript strict · vitest · Foundry (contracts) · viem · Next.js 14 (web, Vercel) · **Tailwind CSS + shadcn/ui + Radix UI (web)** · Pinata (IPFS) · better-sqlite3 (review index).

**Spec:** [`docs/specs/SPEC-6-web-surface.md`](../../specs/SPEC-6-web-surface.md) · scope: [`2026-09-18-week-3-scope.md`](2026-09-18-week-3-scope.md) · content: [`2026-09-18-week-3-marketing-matrix.md`](2026-09-18-week-3-marketing-matrix.md)

## Global Constraints

- TS strict everywhere; `pnpm test:run` green before any merge; one commit per feature, conventional prefixes, GPG signing (never disable), zero AI attribution.
- **Web UI stack (locked 2026-09-18, RECTOR): Tailwind CSS + shadcn/ui + Radix UI** — mock tokens adopt shadcn-compatible variable names; fire the `shadcn` skill at scaffold/component-add time.
- **Mockups-before-code is a hard gate** — Tasks 8–11 MUST NOT start before RECTOR approves all three mocks (Task 4).
- Approved mock `tokens.css` is the web token source of truth — same token names, no re-invention (invariant 20).
- Honest copy only: real numbers (below) or labelled `—`; no invented metrics/logos/testimonials (invariant 17).
- Chain params never fabricated (invariant 16); explorer links omitted rather than guessed.
- No secrets in client bundle; `NEXT_PUBLIC_` limited to addresses/chainIds/explorer URLs (invariant 19). PR content untrusted; markdown-sanitize every rendered string.
- Contract v2 = redeploy on Tempo (reviewCount reset documented in `docs/deployments/tempo.md`); HyperEVM deploys v2 directly.
- Live-chain broadcasts (Tempo/HyperEVM) require RECTOR confirmation at point of risk.
- Real artifacts for mock/web content: Tempo attest tx `0x62db…f079` (reviewCount 2, agent `0xE690…a122`, contract `0x5137…d31f`, chainId 42431, explorer per `docs/deployments/tempo.md`); test-repo reviews PR #1 (69/100), PR #2 comments (34/34/41). Never print key material.

**Parallel tracks:** Mockups (Tasks 1–4) and B-track (Tasks 5–7) are independent — run concurrently. Web (Tasks 8–11) waits on Task 4.

---

### Task 1: Landing mockup (`mockups/landing/`)

**Files:**
- Create: `mockups/landing/index.html`, `mockups/landing/tokens.css`
- Create: `mockups/landing/.hallmark-stamp.md` (macrostructure · theme · enrichment + pre-emit critique scores)

**Interfaces:**
- Produces: token names reused verbatim by `dashboard`/`install` mocks and later `packages/web` (`--color-*`, `--font-*`, `--space-*`, `--text-*`, `--ease-*`).

- [ ] **Step 1: Fire the hallmark skill** (`skill://hallmark`, default Design flow). Pre-flight: no existing web code → "No pre-flight signals — proceeding with full Hallmark stack." Brand inputs: mascot Rex the raptor, tagline *"Audits are point-in-time. Code is continuous."*, positioning line *"CodeRabbit reviews code changes. Rextor audits money changes."*, dark-background brand style.
- [ ] **Step 2: Pick macrostructure + theme; emit the 6-bullet preview block** before building. Sections (DOM order): Hero (positioning line, install CTA → `/install`) · Capability matrix (receipts-linked, ≤2 `soon`, dated footnote, archetype columns — NO "CodeRabbit" name) · How it works (5-stage loop) · Track board (Tempo deployed w/ real tx link, HyperEVM pending, riders config-level) · Integrity rails section · Footer (Rextor Security). Enrichment: none or Tier-A CSS only — no fake product screenshots (re-drawn chrome forbidden).
- [ ] **Step 3: Build** — self-contained HTML + `tokens.css`, OKLCH tokens, 4pt spacing, 8 states for interactive elements, `prefers-reduced-motion`, stamp as first CSS line, append `.hallmark/log.json`.
- [ ] **Step 4: Slop test (58 gates)** — fix any fails; re-emit preview row. Copy pass: every number cross-checked against Global Constraints artifacts; `soon` count ≤ 2.
- [ ] **Step 5: Verify at 320 / 375 / 414 / 768 px** (browser tab, screenshot each width, no horizontal scroll). Fix and re-verify.

### Task 2: Dashboard mockup (`mockups/dashboard/`)

**Files:**
- Create: `mockups/dashboard/index.html`, `mockups/dashboard/tokens.css` (re-export of Task 1 tokens + additions), `mockups/dashboard/.hallmark-stamp.md`

**Interfaces:**
- Consumes: Task 1 token names.
- Produces: ledger row anatomy (PR, sha, date, riskScore, findings, status chip, chain + tx link, verify expander) implemented later as `ReviewLedgerRow`.

- [ ] **Step 1: Fire hallmark.** Same project system (diversification rule inverted — same tokens, page rhythm may differ).
- [ ] **Step 2: Sections:** repo header (owner/repo, chain badge) · Score history (bar/line from REAL data: 69, 41, 34 — labels with PR numbers) · Review ledger (3 REAL rows from test-repo: PR #1 69/100 complete; PR #2 41/100; PR #2 34/100; each with Tempo tx link + verify expander showing the findingsHash recipe) · Agent identity card (`rextor-audit[bot]`, agent `0xE690…a122`, reviewCount 2, attested-incomplete count visible) · Empty state block (shown as second static variant at bottom, labelled).
- [ ] **Step 3–5: Build → slop test → 4-width verify** (same as Task 1).

### Task 3: Install mockup (`mockups/install/`)

**Files:**
- Create: `mockups/install/index.html`, `mockups/install/tokens.css`, `mockups/install/.hallmark-stamp.md`

**Interfaces:**
- Consumes: Task 1 token names.

- [ ] **Step 1: Fire hallmark.**
- [ ] **Step 2: Four steps rendered as one scrolling page with step anchors:** (1) Install the GitHub App — real permissions list verbatim: PRs **RW**, Contents **RO**, `pull_request` event only; (2) Add `rextor.yaml` — copy-paste snippet (paths/ignore/severity-gate keys, D2 surface) in a plain `<pre>` (no fake window chrome); (3) Open a PR touching money-code; (4) What arrives — anatomy of a real review comment rebuilt from the actual test-repo comment structure (score banner, findings table w/ cited lines, attestation footer w/ tx + findingsHash recipe), every label pointing at the real artifact it mirrors.
- [ ] **Step 3–5: Build → slop test → 4-width verify.**

### Task 4: Mock commit + RECTOR gate

- [ ] **Step 1: Commit mocks:** `git add mockups/ && git commit -m "feat: hallmark mockups — landing, dashboard, install (SPEC-6 gate)"`.
- [ ] **Step 2: Present to RECTOR** — local file paths + one screenshot each + the three preview blocks. **STOP. Approval is the hard gate for Tasks 8–11.** Record approval/changes; iterate until approved.

### Task 5: Contract v2 — `findingsURI` + `targetChainId` (B1)

**Files:**
- Modify: `contracts/attestation-evm/src/RextorAttestation.sol`
- Modify: `contracts/attestation-evm/test/RextorAttestation.t.sol`
- Modify: `packages/agent/src/attest.ts` (ABI + record type)
- Modify: `packages/agent/test/attest.test.ts`

**Interfaces:**
- Produces: `attest(bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash, string calldata findingsURI, uint16 riskScore, uint16 findingCount, uint8 status, uint32 targetChainId)`; `Attested` event gains `findingsURI` + `targetChainId`; `verify(...)` signature extended to match; TS `AttestRecord` gains `findingsURI: string`, `targetChainId: number`.

- [ ] **Step 1: Failing forge tests** — v2 signature: happy attest (uri + chainId stored/read back), `verify()` true/false with new args, idempotent byte-identical no-op, conflict revert on changed uri, uri length cap (≤ 256 bytes) revert. Run: `forge test` in `contracts/attestation-evm` — expect FAIL (signature mismatch).
- [ ] **Step 2: Implement v2** — add fields to `Attestation` struct, extend `attest`/`attestations`/`verify`/event; keep immutability, errors, idempotency semantics unchanged.
- [ ] **Step 3: `forge test` green** (existing tests updated to v2 signature — counts unchanged or +1 per new test).
- [ ] **Step 4: Agent ABI + tests** — update `REXTOR_ATTESTATION_ABI` (parseAbi), `AttestRecord`, footer rendering (`findingsURI` shown, `targetChainId` in reviewId recipe line? NO — reviewId recipe unchanged; chainId shown as its own footer field). Run: `pnpm test:run` (root) — green. Include the viem `getAbiItem` regression pattern from PR #5 for the new signature.
- [ ] **Step 5: Commit:** `feat: attestation v2 — findingsURI + targetChainId (SPEC-4 errata)`.

### Task 6: IPFS pin + attestation footer v2 (B3)

**Files:**
- Create: `packages/agent/src/ipfs.ts`, `packages/agent/test/ipfs.test.ts`
- Modify: `packages/agent/src/attest.ts` (pin before attest; record gains `findingsURI`)
- Modify: `packages/agent/src/review.ts` (wire pin into pipeline: score → pin → attest)
- Modify: `.env.example` (+ `IPFS_PINNING_JWT` documented), secret-store `.env` via RECTOR handoff (never printed)

**Interfaces:**
- Produces: `pinReport(report: ReviewResult): Promise<{ uri: string; cid: string }>` — Pinata `/pinning/pinJSONToIPFS`, canonical-JSON body identical to the findingsHash input; throws typed `PinUnavailableError` → attest proceeds with `findingsURI: ""` (degrades, never blocks — mirrors SPEC-4 §3).
- Consumes: `REXTOR_ATTESTATION_ABI` v2 (Task 5).

- [ ] **Step 1: Failing vitest** — pin success → uri returned; 401 → `PinUnavailableError`; attest still succeeds with empty uri (footer omits IPFS line). Run: `pnpm vitest run packages/agent/test/ipfs.test.ts` — FAIL.
- [ ] **Step 2: Implement `ipfs.ts`** (fetch-based, injected `fetchFn` seam, no new deps beyond env) + wire pipeline. Canonical JSON = same serializer as findingsHash (SPEC-2 §2) — the CID content MUST hash to the attested findingsHash.
- [ ] **Step 3: `pnpm test:run` green.** Commit: `feat: ipfs report pin + footer v2 (pin degrades, never blocks)`.
- [ ] **Step 4: 🔴 RECTOR gate: Tempo redeploy (v2) + fresh smoke review → footer carries IPFS CID + new contract address; update `docs/deployments/tempo.md` (v2 address, reset note) + `docs/track-profiles.md` + `packages/agent/src/chains.ts` tempo slot.** Broadcast only after explicit RECTOR confirmation.

### Task 7: HyperEVM deploy #2 (B2)

**Files:**
- Create: `docs/deployments/hyperliquid.md`
- Modify: `contracts/attestation-evm/foundry.toml` (`[profile.hyperliquid]`), `packages/agent/src/chains.ts` (hyperliquid attestation slot)

- [ ] **Step 1: `[profile.hyperliquid]`** mirroring tempo profile (rpc `https://rpc.hyperliquid-testnet.xyz`, chainId 998). `forge test` unaffected.
- [ ] **Step 2: 🔴 RECTOR gate: fund + deploy v2 + register agent** — reuse `Deploy.s.sol`/`Register.s.sol` ops-script pattern (vm.envUint keys; `--skip-simulation` lesson applies if estimates mislead). Record address/tx/block in `docs/deployments/hyperliquid.md`; fill registry slot; extend `chains.test.ts` completeness.
- [ ] **Step 3: `pnpm test:run` + `forge test` green. Commit:** `feat: hyperEVM attestation deploy #2 (v2)`.

### Task 8: Web scaffold + landing (A3, post-gate)

**Files:**
- Create: `packages/web/` (Next.js 14 app router, pnpm workspace member, vitest + Testing Library), `packages/web/content/capabilities.json`, `packages/web/app/page.tsx` + section components, `packages/web/tokens.css` (from approved mock)

**Interfaces:**
- Produces: `capabilities.json` schema — `{ asOf: string, rows: [{ id, capability, generic: bool, bots: "no"|"partial", rextor: { shipped: bool, receipt?: string, soon?: bool }, backing: string }] }`; component `CapabilityTable(json)`.
- Consumes: approved `mockups/landing/tokens.css` verbatim.

- [ ] **Step 1: Scaffold** (`create-next-app` equivalent by hand: package.json, tsconfig strict, app router, vitest). Tokens from approved mock copied verbatim.
- [ ] **Step 2: `capabilities.json`** — rows from the marketing-matrix doc; statuses frozen as of authoring; receipts = real URLs (Tempo tx, verify recipe anchor, fork-sim evidence).
- [ ] **Step 3: CapabilityTable + failing test** — renders shipped ✔ with `<a href=receipt>`; `soon` badge; >2 soon rows hidden (test with a fixture of 3 soon rows); footnote date from `asOf`. Run: `pnpm vitest run packages/web` — RED then GREEN.
- [ ] **Step 4: Remaining sections** per approved mock; markdown/HTML-escape any future dynamic string (none in v1 — all static). Commit: `feat: web landing from approved mock (capabilities data file)`.

### Task 9: Review index + `/reviews` endpoint (dashboard data)

**Files:**
- Modify: `packages/agent/src/server.ts` (new route + auth), `packages/agent/src/db.ts` (or create), `packages/agent/test/reviews-endpoint.test.ts`

**Interfaces:**
- Produces: SQLite table `reviews(repo TEXT, pr INTEGER, head_sha TEXT, review_id TEXT, chain TEXT, tx_hash TEXT, explorer_url TEXT, risk_score INTEGER, finding_count INTEGER, status INTEGER, comment_url TEXT, created_at TEXT)`; `GET /reviews/:owner/:repo` → `{ reviews: Row[] }` (token-gated, 401 without `X-API-Token`); written in `review.ts` after attest/comment settle.
- Consumes: existing server auth middleware + DI seams (Week-1/2 pattern).

- [ ] **Step 1: Failing test** — seed fixture rows → GET returns sorted-desc JSON; no token → 401; unknown repo → `{ reviews: [] }`. RED → implement (better-sqlite3, prepared statements) → GREEN. Commit: `feat: review index + GET /reviews/:owner/:repo`.

### Task 10: Dashboard route (A4, post-gate)

**Files:**
- Create: `packages/web/app/dashboard/[owner]/[repo]/page.tsx` + `ReviewLedgerRow`, `ScoreHistory`, `AgentIdentityCard` components + tests
- Create: `packages/web/app/api/chain/[chain]/route.ts` (server-side public-RPC reads: `agents()`, `reviewCount`, `verify()`)

- [ ] **Step 1: Ledger + verify expander** — row anatomy from approved mock; expander renders findingsHash recipe (sha256 line, reviewId, tx link, PR-comment link) from row data. Failing test first (expansion content, sanitization).
- [ ] **Step 2: Identity card** — server route reads `agents(agent)` + `reviewCount` via viem public client (chainId from row); browser never calls RPC directly. Test: mocked viem client → rendered values.
- [ ] **Step 3: Empty state** — exact approved-mock copy. `pnpm test:run` green. Commit: `feat: dashboard — ledger, history, identity card (from approved mock)`.

### Task 11: Install flow + deploy (post-gate)

**Files:**
- Create: `packages/web/app/install/page.tsx` (+ `rextor.yaml` snippet as static content)

- [ ] **Step 1: Four steps from approved mock; permissions list verbatim.** Test: snippet block present, no dynamic content. Commit: `feat: install flow (from approved mock)`.
- [ ] **Step 2: 🔴 RECTOR gate: Vercel preview deploy** (`vercel` project for `packages/web`, env vars from secret store). Verify preview at 4 widths + receipt links resolve. Record URL in `docs/deployments/vercel-web.md`.

### Task 12 (continuous): RECTOR manual items (F-track) — never dispatched, tracked here

- F1 PAT renewal (before Sep 24) · F2 stale env purge · F3 CWF registration · F4 domains · F5 PEM (after: swap comment-posting to installation tokens).

## Self-review

- **Spec coverage:** SPEC-6 §1 shell (T8 scaffold) · §2 landing (T1 mock, T8 impl) · §3 dashboard (T2 mock, T9 data, T10 impl) · §4 install (T3 mock, T11 impl) · B1 (T5) · B3 (T6) · B2 (T7) · gate (T4) · F-track (T12). E-track/C-track/D-track = Week-4 plan per scope doc — intentional gap, not missed.
- **Placeholders:** none — every code step names exact files/signatures; mock content steps name real artifacts.
- **Type consistency:** v2 `attest` signature consistent across T5 Interfaces/Steps; `AttestRecord` naming matches SPEC-4 §3.
