# Gate A — Competitive Deep-Scan: PR-Time Smart-Contract Audit Agents (2026-09-15)

> Source: GateAScan scout agent, 2026-09-15 · Verdict: **CONTESTED** · Feeds: rextor-audit PLAN.md Gate A decision.

**Positioning under test:** "CodeRabbit reviews code changes. Rextor audits money changes." — PR-webhook GitHub App → deterministic analyzers (Slither/Aderyn) in Docker → citation-constrained LLM triage → deterministic riskScore → on-chain attestation + agent reputation. Solana flagship + EVM riders.

**Method:** read-only web research against product pages, docs, GitHub repos, and primary announcements. Depth assessed on ACTUAL detector/CI mechanics, not marketing claims. Items not directly evidenced are marked [INFERENCE].

---

## 1. Greptile — generic PR security, zero contract semantics

- **Depth:** Security Check pairs "Opengrep rule-based scanning" + SCA (CVE databases) + "AI to detect chained exploits." Every published example finding is web2: authorization bypass, command injection, PATH attack, DoS, security-gate bypass. No Solidity, Solana, reentrancy, oracle, or signer-check capability anywhere on the product page.
- **PR/CI:** First-class GitHub App PR review (their core product), plus GitLab/Azure. Deep PR integration — but of a generic reviewer.
- **Chains:** None evidenced.
- **Attestation/reputation:** None.
- **Pricing:** Starter free (1 dev, 50 credits/mo); Pro $30/seat/mo (+$1/extra credit); Enterprise custom.
- **Read:** greptile.com/security-check, greptile.com/pricing

**Assessment:** Validates PR-time security demand; does NOT compete on contract semantics. Closest to the strawman in Rextor's positioning line (CodeRabbit/Greptile-class generic reviewer).

## 2. Crytic (Trail of Bits) — SaaS defunct; OSS actions remain

- **Current state:** `crytic.com` no longer resolves (DNS NXDOMAIN, checked 2026-09-15). The 2019 "Continuous Assurance for Smart Contracts" SaaS (GitHub-connected Slither builds) is gone.
- **What remains:** Slither (OSS, 95+ detectors), `crytic/slither-action` (GitHub Action; can open/update PRs with a Slither Markdown report), `slither-docs-action` (label-triggered OpenAI docs on PRs), and the pivot to `trailofbits/skills` — 58 agent skills for AI coding assistants (3.2k stars), i.e., ToB's 2025–26 energy went to agent-skills, not a hosted PR audit product.
- **Chains:** Slither = Solidity/Vyper; ToB skills cover Solana/Cairo/CosmWasm etc. (as AI guidance, not CI gates).
- **Attestation/reputation:** None.
- **Pricing:** N/A (OSS + services firm).

**Assessment:** The historical winner of this exact niche (2019 Crytic) exited. Today the PR-time Slither story is DIY GitHub Actions. That is the gap Rextor productizes — and evidence that hosting it well is a real service, not a solved commodity.

## 3. ChainGPT — LLM auditor, no PR hooks

- **Depth:** Pure-AI auditor "designed to evaluate Solidity"; Quick audits (<30s) and Full audits (<2h, industry-style report). Coverage list (access control, gas, governance, upgradeability) is checklist-level LLM output; no deterministic analyzer under the hood is advertised.
- **PR/CI:** GitHub repo input for full audits (public/private) — a one-shot repo scan, not a PR webhook/bot. API/SDK available for automation.
- **Chains:** Marketing lists BNB, Berachain, Ethereum, Arbitrum, Avalanche, Solana "and more" as deployment chains — but the evaluator is Solidity-oriented; Solana/Rust semantics depth is unevidenced.
- **Attestation/reputation:** None.
- **Pricing:** Credit-based (API: 1 credit per audit request); web app wallet-login + credits.

**Assessment:** Depth = generic LLM triage without deterministic grounding. Not a PR-time competitor. Rextor's SPEC-1 invariants (analyzer failures → `incomplete`, never silent-clean) are precisely what this class of product lacks.

## 4. OpenAudit — OSS on-demand metaskill, not PR-time

- **What it is:** `tradingstrategy-ai/openaudit` — a Claude Code/OpenAI Codex metaskill that runs a target contract (by address) through 10+ community skill pipelines in parallel: Trail of Bits skills (58), pashov, Cyfrin solskill, kadenzipfel scv-scan, forefy (Solidity + Anchor + Vyper), QuillAI, Archethect, HackenProof, auditmos, Frankcastle (Solana Anchor), Membrane (CosmWasm); plus static binaries Slither, Aderyn, Semgrep.
- **Depth:** Genuinely broad methodology coverage (100+ skills), including Solana/Anchor — but developer-driven, on-demand, local. No GitHub App, no webhook, no CI gate.
- **Chains:** Solidity, Vyper, Anchor/Rust, CosmWasm — broad.
- **Attestation/reputation:** None. **Pricing:** Free, open source (15 stars).

**Assessment:** Assembles the same ingredient list as Rextor (Slither + Aderyn + AI skills) in the same month-ish timeframe — strong evidence the stack is zeitgeist-correct — but delivers none of the product moats (PR-time, deterministic scoring, attestation, reputation).

## 5. Stealth/adjacent — where the real overlap is

### 5a. FYEO Scanner — closest live competitor on PR-time Web3 scanning
- **Depth:** Proprietary AI "trained on 300+ FYEO manual audits"; full + diff scans; dependency/CVE scanning; self-hosted inference; "85% fewer false positives" (self-reported). No published detector inventory; not analyzer-first in any evidenced way.
- **PR/CI:** "Continuous AI scanning on every pull request" — diff-level PR scans, GitHub sign-in with per-repo grants. Self-serve SaaS (scanner.fyeo.io).
- **Chains:** Audit practice lists Solana, Ethereum, Bitcoin, Near, Algorand, Cardano, Aptos, Sui, Ripple…; the Scanner's per-language support is not spelled out on public pages [INFERENCE: mirrors the audit chain list, unconfirmed for Solana].
- **Attestation/reputation:** None.
- **Pricing:** Credits: Free 50; Dev $59/mo (40 cr); Starter $99/mo (80 cr); Growth $300/mo (280 cr); Pro $1,500/mo (1,600 cr); Enterprise custom; top-ups $59–$899. Full audit ≤5k lines = 35 credits; PR review = "a few credits (being calibrated)."

**Assessment:** If any incumbent is converging on Rextor's surface, it is FYEO Scanner: self-serve, PR-time, Web3-native, credit-priced. What it lacks (on public evidence): deterministic analyzer grounding, deterministic reproducible scoring, attestation, reputation, Solana-flagship depth.

### 5b. Nethermind AuditAgent — PR-time CI + Solana, credit SaaS
- **Depth:** AI platform with Developer and Auditor scan tiers; CI scans are explicitly a "lighter" tier than dashboard scans. Chains: Solidity (.sol), Cairo (Starknet), **Rust (Solana)**.
- **PR/CI:** Real GitHub Actions integration — dashboard-generated YAML, `AUDIT_AGENT_TOKEN` secret, triggers on PR open/push/reopen/merge, "findings posted directly in the GitHub workflow."
- **Attestation/reputation:** None.
- **Pricing:** Subscription plans + per-scan credits ($50 free credits).

**Assessment:** Strongest single overlap on the "PR-time AI contract audit incl. Solana" axis. Still: no deterministic-analyzer-first architecture, no reproducible score, no attestation, CI tier explicitly degraded vs full scans.

### 5c. Solidity Prism — small vendor with a Rextor-shaped EVM pipeline
- **Depth:** Engines = **Slither + Aderyn + Mythril** static/symbolic + "AI Discovery" + custom heuristics, plus a forensic tx/fund-flow tracing engine. Nearly the same analyzer stack as Rextor's.
- **PR/CI:** GitHub integration that "runs on Pull Requests" (security + gas), plus web playground. Read-only GitHub App permissions advertised.
- **Chains:** EVM/Solidity only.
- **Attestation/reputation:** None. **Pricing:** credits (10 free).

**Assessment:** On EVM the analyzer+AI-in-PR pattern already exists in miniature. Rextor's EVM rider must differentiate on rigor (deterministic scoring, citation constraints, attestation), not on pipeline novelty.

### 5d. Solana Security Standard (Jitleo/Copenhagen0x) — deterministic Solana PR gate, free
- **Depth:** 52 SOL-0XX rules distilled from $514M of real Solana exploits (caller-controlled clock, cross-market state asymmetry, missing Anchor constraints…), each rule scored against canonical vulnerable/fixed pairs in CI.
- **PR/CI:** GitHub Action gating PRs with SARIF + inline diff annotations + baseline (NEW-findings-only) mode; Semgrep port; CLI; MCP server; editor plugins; rule files for Claude Code/Cursor/Copilot etc.
- **Chains:** Solana/Anchor (+ TS client files). **Attestation/reputation:** None. **Pricing:** Free OSS.

**Assessment:** For the Solana flagship, deterministic PR-gating is now table stakes — anyone can bolt this action onto a repo in minutes. It is rules-only (no AI triage, no scoring, no attestation), but it erodes the naive claim "no deterministic Solana PR checks exist." Rextor must exceed it (semantic depth beyond pattern-regex, triage, scoring) and arguably treat it as competitive baseline.

### 5e. In-house builds & consolidation signals
- **0xPolygon/smart-contracts-agentic-review:** org-wide agentic PR review for Solidity/Foundry — every repo stubs a reusable workflow; dual Claude Opus 4.7 + GPT-5.3-Codex per PR at ~$0.30–0.60/PR (~$30–60/mo per 100 PRs); explicitly "not a replacement for human security review." Enterprises are rolling their own — the buyer already understands the pattern; Rextor must beat "DIY workflow + prompts."
- **Zellic V12:** autonomous Solidity auditor launched 2025-09-25, released free. Zellic's own problem statement names Rextor's niche verbatim: "There are still no good solutions for teams who need small, quick reviews. This includes teams seeking continuous security — **an audit for every pull request**." V12 targets on-demand audits (Solidity); no PR-time GitHub App evidenced; product site now redirects to a sparse JS landing (v12.sh) [INFERENCE: early/quiet, not dominant].
- **Code4rena winding down** ("After 5 years of securing DeFi, Code4rena is closing its doors"), with Zellic now operating C4 and Zenith; **Cantina absorbed Spearbit's network** and now sells "hybrid audits + AI-native review + always-on coverage + live bug bounty" ($100B+ secured, enterprise engagement pricing) — and simultaneously pivoted broader into a general agentic security platform (Clarion/Apex). Contest platforms are consolidating; buyers of "continuous coverage" are in flux — timing tailwind for a productized PR-time auditor.
- **OtterSec / Zellic (services):** elite human audit firms, no AI PR-time product shipping (OtterSec = pentest/FV/fuzzing services; Zellic = V12 + services).
- **Minor PR-time bots:** `agunnaya001/smart-contract-auditor` (Probot GitHub App, Solidity PR audits, toy-scale), "Automated Smart Contract Auditor Pro" marketplace action (marketing-first, "#1 AI auditor" claim, no published detector rigor), **Savant Chat** (on-demand $0.07/line, no PR bot), **Cyfrin aderyn-ci** (Aderyn static analysis in CI — raw analyzer, the exact OSS ingredient Rextor orchestrates).
- **Attestation/reputation:** only `akoita/proof-of-audit` — a 0-star prototype staking ETH on audit claims with ERC-8004 identity, challenge flow, and deterministic agent reports on Base Sepolia. Nobody has productized audit attestation + agent reputation; the concept is now independently prototyped in the OSS zeitgeist (direction validated; window still open, but not empty forever).

---

## Gap analysis vs Rextor's six moat dimensions

| Moat dimension | Greptile | Crytic/ToB | ChainGPT | OpenAudit | FYEO Scanner | Nethermind AuditAgent | Solidity Prism | Solana Security Std | Zellic V12 | Cantina | **Rextor (target)** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Contract-semantics depth (deterministic detectors + cited triage) | ✗ generic | OSS only (Slither) | ✗ pure LLM | ~ skills+Slither/Aderyn, on-demand | ~ proprietary AI, detector inventory unpublished | ~ AI tiers; CI tier lighter | ~ Slither+Aderyn+Mythril+AI (EVM) | ~ 52 pattern rules, Solana only | ~ autonomous Solidity, depth self-claimed | ~ AI-native + human network | ✔ deterministic-first + citation-constrained LLM |
| PR-time CI (GitHub App/webhook) | ✔ generic | DIY actions | ✗ repo scan only | ✗ | ✔ continuous PR scans | ✔ GitHub Action, findings on PR | ✔ runs on PRs | ✔ action gate (rules) | ✗ | ✗ (engagement-based) | ✔ GitHub App, full pipeline |
| Solana support | ✗ | skills only | ◐ claim, unevidenced | ✔ Anchor skills | ◐ audit-side yes, scanner unconfirmed | ✔ Rust/Solana CI scans | ✗ EVM only | ✔ flagship (52 rules) | ✗ Solidity | ◐ services | ✔ flagship |
| Deterministic scoring (reproducible riskScore) | ✗ | ✗ | ✗ | ✗ | ✗ (AI severity ranking) | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ |
| On-chain attestation | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ (only 0-star prototype exists elsewhere) |
| Agent reputation | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ (same prototype only) |

## Verdict rationale — CONTESTED

The full moat stack is unowned: **no shipping product combines PR-time CI + deterministic analyzer grounding + reproducible scoring + on-chain attestation + agent reputation, on Solana-first semantics.** Zellic — an insider — states the PR-time audit niche still has "no good solutions." Code4rena's wind-down and Cantina/Spearbit consolidation show incumbents restructuring around "always-on coverage," not owning it. Crytic's own SaaS is dead DNS.

But the verdict is **CONTESTED, not CONFIRMED-clean**, because three partial overlaps are real and shipping in 2026:
1. **Nethermind AuditAgent** already does PR-time GitHub-Action AI scans including Rust/Solana, with credit SaaS pricing — the nearest product-shaped threat on Rextor's CI+chains axis.
2. **FYEO Scanner** already sells self-serve continuous PR scanning for Web3 code with credit pricing and a 300+ audit training corpus — the nearest threat on positioning/self-serve GTM.
3. **Solana Security Standard + Cyfrin aderyn-ci/slither-action** make "deterministic Solana/EVM checks at PR time" free commodities — the deterministic-detection layer alone is not a moat; Rextor's moat must be the pipeline (triage, scoring, attestation), and even that is being prototyped (proof-of-audit).

### What to sharpen (per the CONTESTED protocol)
- **Name the wedge:** "FYEO scans changes; Nethermind posts AI findings on PRs; nobody makes the verdict reproducible or accountable." Lead Gate A copy with deterministic riskScore + attestation, not "AI PR review" (a crowded claim).
- **Treat SSS-style rules as table stakes:** exceed 52 pattern rules with Anchor-native semantics (signer authority, PDA derivation, account-constraint, CPI, clock/sysvar misuse) — and consider ingesting public rule sets (SSS, Slither/Aderyn detectors) so coverage is never the differentiator customers compare.
- **Ship attestation + reputation EARLY:** the only other implementation is a 0-star prototype; first mover on a public, verifiable audit-reputation ledger on Solana owns the category language.
- **Beat the DIY baseline:** Polygon's in-house workflow costs ~$0.30–0.60/PR; Rextor's pricing and setup must clearly beat "reusable workflow + API keys" for teams without security staff.
- **Exploit the consolidation window:** C4 wind-down + Cantina/Spearbit/enterprise platform moves mean "continuous coverage" buyers are re-shopping now; PR-time attestation is a credible answer to "what replaces a point-in-time audit report?"
