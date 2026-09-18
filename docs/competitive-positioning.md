# Competitive positioning — Rextor Audit

**Date:** 2026-09-18 · **Status:** verified against public pages today (CodeRabbit Security launch post 2026-08-13 + pricing pages; our own Gate A scan `docs/gates/gate-a-competitive-scan-2026-09-15.md` had declared CodeRabbit an untested gap — this fills it). Snapshot doc; re-verify before demo week (CodeRabbit ships weekly).

## The one line

**CodeRabbit reviews code changes. Rextor audits money changes.**

## Head-to-head (CodeRabbit, verified 2026-09-18)

What they ship: PR review AI at breadth — summaries/walkthroughs, inline comments with one-click fix, chat-in-PR, `.coderabbit.yaml`, cross-PR learnings, CLI + IDE (+ Codex/Claude Code/Cursor/Gemini hooks), GitHub/GitLab/Azure/Bitbucket. **CodeRabbit Security (launched 2026-08-13): Map → Hunt → Verify → Fix** — sandboxed agents build a repo attack-surface map; parallel hunt agents trace entry→sink per risk area; an independent verifier re-checks reachability/safeguards/evidence and *explicitly reports inconclusive*; Fix drafts remediation on a security branch as a reviewable PR. Plus AI Deep Scan (whole-repo, scheduled), dashboard (findings/deps/secrets/SBOM), SARIF/CycloneDX/SPDX export, Security Learnings. New Triage product (PR-queue prioritization). Pricing: seat-based — Essentials $24/dev/mo annual ($30 monthly), Pro Plus ~$48; legacy tiers sunset Jun 2026; free/OSS tiers exist. Which tier includes Security: unverified at snapshot.

The honest read: **their Verify stage is evidence-*reading*** — reopening cited paths, checking reachability, safeguards. It never executes your code. And their inconclusive-reporting posture is philosophically the same as our `INCOMPLETE` tier — the market converged on our integrity position; we execute it harder (attested on-chain, not just stated).

Where Rextor wins — and stays winning:

| Dimension | CodeRabbit | Rextor (after Week-3 scope) |
|---|---|---|
| Proof by execution | ✗ — never runs code | fork-sim PoC; confirmed-vs-unproven attested |
| Accountability | ✗ — dashboard-bound | on-chain verdict, `verify()` recomputable, IPFS report (v2) |
| Determinism | LLM throughout | published rubric, temp 0, `INCOMPLETE` never silent |
| Web3 semantics | none public | Slither/Aderyn + chain registry + chain-native verdicts |
| Price anchor | per seat $24–48 | per-repo, anchored on audit engagements |

For them to match: fork infrastructure per chain + deterministic scoring + attestation contracts + chain deploys — a second product inside a horizontal per-seat business. The incumbent calculus works for us: low-volume/high-stakes verticals are structurally unattractive to a volume-optimized platform.

**Deliberately NOT competing on:** breadth (platforms, IDE/CLI, languages), chat maturity, whole-repo Deep Scan (real gap — post-CWF roadmap item), secrets/deps/SBOM, SOC 2 posture. See the capability matrix (`docs/superpowers/plans/2026-09-18-week-3-marketing-matrix.md`) for the receipts version.

## The moat (post-scope)

1. **Proof asymmetry** — only tool where a critical can be execution-confirmed on a fork and the score recomputed by anyone from public artifacts.
2. **The accountability ledger** — every review deepens a public, unforgeable track record (verdicts tied to commits, agent identity, reputation). Copying the code doesn't copy the history.
3. **Audit-firm trust model** — citation-constrained LLM, untrusted PR content, sandboxed sim, no-fund-path attest key.
4. **Vertical depth** — web3 analyzers, chain registry, chain cost models, Solana adapter tier.
5. **Business-model flywheel** — agent findings → human escalation via Rextor Security; the firm's methodology feeds the agent.
6. **Timing** — Code4rena wind-down / consolidation window; buyers are re-shopping "what replaces a point-in-time audit report" now. Moats 2 and 5 need the calendar head start more than the code does.

Not moats (honesty pass): the LLM (commodity), the analyzers (free), the rubric weights (published on purpose — the moat is verifiable execution of a public recipe, not secrecy), the GitHub App plumbing (table stakes).

## vs Conatus (our own Mantle hackathon winner — not a competitor, the pattern source)

Conatus proved the pattern: on-chain verdicts (real MNT, mainnet), ERC-8004 identity (#115), IPFS-pinned reports, published rubric — and won $17.5k on the polish. Rextor extends it where Conatus was weak: PR-time diff-scope (vs single-file paste-audit), execution-based PoC proof, GitHub-native loop, multi-chain native verdicts. Conatus keeps the "real mainnet gas" story; the residue of its gaps (IPFS URI, ERC-8004, chain cost-model tool) is exactly the Week-3 B-track.

## Copy rules for the landing (from the receipts rule)

- Never "X can't" — always "not evidenced on public product pages as of `<date>`".
- Every green check links a live artifact; `soon` badge for unshipped rows (see marketing-matrix doc).
- Named competitor lives on `/compare` (SEO play, optional) and judge docs — not the landing table.
