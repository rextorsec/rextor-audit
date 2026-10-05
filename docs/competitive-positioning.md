# Competitive positioning — Rextor Audit

**Date:** 2026-09-18 · **Snapshot refresh: 2026-09-25** (see §Refresh at bottom). **Status:** verified against public pages today (CodeRabbit Security launch post 2026-08-13 + pricing pages; our own Gate A scan `docs/gates/gate-a-competitive-scan-2026-09-15.md` had declared CodeRabbit an untested gap — this fills it). Snapshot doc; re-verify before demo week (CodeRabbit ships weekly).

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

## §Refresh — 2026-09-25 (demo-week snapshot)

- **CodeRabbit pricing moved**: the standalone ~$40 Security plan is reportedly gone, folded into an Advanced tier (~$72 annual / ~$90 monthly) carrying continuous security monitoring + per-PR scanning — per a third-party post (tomrochette.com, 2026-09-13). **Verify on coderabbit.ai/pricing before submission** — if true, it reads as *validation* (security is now a paid first-class tier, not an add-on) and slightly narrows the "price anchor" row above (their anchor rose toward ours).
- **Field otherwise stable** vs Gate A (2026-09-15): FYEO Scanner, Nethermind AuditAgent, Solidity Prism still show no deterministic-scoring + on-chain attestation on public pages (spot re-check 2026-09-25 — no new product posts surfaced).
- **GPT-6 Astra** entered CodeRabbit's evaluation cycle (futurumgroup, 2026-09-05): model churn is their compounding axis, not ours — our receipts chain-anchored and model-agnostic (E2 comparison receipt pending, see endgame R6).
- **Our surface changes since 09-18**: PR #36 hardening (gate reads raw analyzer severities, settle-path guarantees), PR #37 (Next 15 + nonce CSP), HyperEVM mainnet receipts re-verified live, CWF submission draft drafted (`docs/cwf-submission-draft.md`).

## §Dashboard teardown — 2026-10-05 (live walkthrough)

Method: authenticated walkthrough of app.coderabbit.ai as Admin on the `sip-protocol` workspace (Advanced trial, installed on sip-protocol/sip-protocol only). Every sidebar surface + dashboard tab visited; screenshots + innerText extracts at `~/local-dev/tmp/outreach/cr-*.png`; a real review was triggered on `sip-protocol/sip-protocol#1264` (`@coderabbitai review`, comments 5987891023/5987891481, saved to `~/local-dev/tmp/outreach/cr-pr1264-comments.json`). Decode-only pass — adoption decisions deliberately out of scope; candidates listed neutrally in §D.

### A. Pricing truth (updates §Refresh 2026-09-25 — now verified in-product, not via third party)

- Plan seen in billing: **Advanced, Monthly, $90/mo estimated, 1 seat, trial ends 19 Oct 2026**. No standalone Security plan visible.
- **Usage-based products** (à la carte toggles, one shared spend cap + invoice line for agent products): Usage-based reviews **$0.25 per reviewed file**; CodeRabbit Security Scan (billed monthly, no unit price shown); CodeRabbit Agent **$0.40 per agent minute** (covers Coding Agent + Automations Agent + Slack/Discord agent). Credits balance ("contact your account team"), usage meter ("$0.00 across 0 active products"), estimated invoice = plan + usage.
- Review usage surface cross-links: fair-usage limits policy + "usage-based reviews" enable → billing.

### B. IA map (observed)

- **Persistent action rail** (sidebar top): Triage (`/triage`, badge "Seat required") · New coding task (`/code/new`) · Run security scan (`/deep-scans`).
- **Analytics**: PR reviews (`/dashboard/summary`, 9 tabs: Summary · Quality metrics · Time metrics · PR security reviews · Knowledge base · Organization trends · Pre-merge checks · Review details · Data export) · IDE/CLI reviews (`/dashboard/ideCliSummary`, 3 tabs: Summary · Organization trends · Data metrics) · Review usage (`/dashboard/review-capacity`) · Reports (`/reports`, **"Legacy … no longer receive new features"**).
- **Settings tree**: General (Connected repositories · Connections · Scopes · Environments) — Product: Reviews (Triage settings · Repository settings · Learnings · Organization settings) — Security (Attack surface · Findings · Repositories · PR security reviews · Scan history) — Coding (Tasks · Skills · Configuration) — Automations (Beta: Home · Activity) — Communication (Slack) — Billing (Plans & payments · Team management) — Account (API keys).
- **Command palette (⌘K)** = full route registry (nav, settings, "New coding task", "Create skill", "Create coding environment", theme switch, "Refer and earn").
- Dashboard state rides the URL Grafana-style: `var-org_id`, `var-self_hosted_id`, `from=now-30d/d`, `to=now-1d/d`.

### C. Per-surface inventory (what each surface actually shows)

- **Summary**: metric cards — Active Repositories; Merged PRs (Total, Avg per User); Active Users (Assigned/Unassigned); Chat Usage (Median Time, "Reviewer Time Saved"); CodeRabbit Review Comments; comments by Severity + Severity Distribution; Avg Comments per PR; comments by Category + Category Distribution. Filters: repository / username / teams. Populated-empty renders zeros + "No data" chips, never blank.
- **Quality metrics**: **Acceptance Rate by Severity / by Category** (suggestion-acceptance telemetry) + Review Comment Count by Severity / Category.
- **Time metrics**: Time to Merge; Weekly Review-Ready → Merge / → Last Human Review / → Last Commit; stats **Average / Median / P75 / P90**.
- **Review details · PR security reviews · Organization trends · Data export** (dashboard tabs): in the empty state all four render the same "Review Metrics" CSV export panel (date range + Export, "field details" docs link). One implementation behind four doors.
- **Review usage**: review events, rate-limit impact, fair-usage policy, usage-based overage toggle; My usage / Team usage; 7d / 30d.
- **Security · Attack surface**: Repositories mapped; **Verified surface %** ("verified security points" from PR reviews + deep scans); Repositories below **80% coverage**; per-repo attack-surface map with coverage + **drift** tracking.
- **Security · Findings**: Vulnerabilities | Secrets tabs; overview (repos covered %, open findings total/critical); table Category / Repo / Subsystem / State / Severity / File / Actions; honest empty state: *"No vulnerabilities found in the analyzed scope. **Coverage is incomplete.** 1 repository has no completed AI Deep Scan."*
- **Security · Repositories**: per-repo findings count, coverage %, last mapped / last scanned; Mapped/Scanned filters.
- **Security · PR security reviews** (analytics): PRs reviewed; Accepted findings; Acceptance rate; Unaddressed findings (high/critical split); **"Estimated cost savings"** from accepted high/critical findings; Findings by severity / category / **reachability** / **exploitability**; "Tracked since" baseline date.
- **Security · Scan history**: Scan / Repository / Status / Duration / **Cost** / Triggered by.
- **Deep scans** (`/deep-scans`): trial-credits ledger ($50, non-expiring, auto-applied) shown persistently on every security surface; per-repo Run Deep Scan; mapped/scanned filters.
- **Triage** (seat-gated): full-page wall *"Triage requires a seat … Open Team management to assign yourself one, or to see what's blocking it"* + persistent sidebar badge; the seat gate also reaches review dispatch (see §E). **Triage settings** = rules engine: condition→action on PR events, 5 templates (merge low-risk changes; auto-fix failing CI + review feedback after configurable inactivity; close stale PRs 30d + 24h notice; Slack reminders; P0/P1 inactivity nudges), rules table + activity. **Post-seat (2026-10-05, seat assigned to rz1989s — verified "Total seats assigned 1", wall gone):** Triage board = prioritized PR queue — tabs **Requires my action / All PRs / Close candidates**; PR cards carry chips **P1 · High risk · Deep review · +1** and reviewer count ("3 reviewers assigned"); Rules + Display controls inline; onboarding nudge to connect GitHub for repo-scoped visibility; empty-state copy: *"Focus on the PRs that matter most."*
- **New coding task** (`/code/new`): prompt box ("What do you want to *build|fix*, ⟨user⟩?"), repo + branch picker, "Start with" Linear issue / Jira issue / Skill, skills as head-start, task board Pinned / Needs attention / Working / Completed / Failed with per-status counts and repo filter.
- **Tasks** (`/code/tasks`): board listing + filters Owner / Status / Repository / Source.
- **Skills** (`/code/skills`): reusable instruction packs applicable across tasks.
- **Environments** (`/setup/environments`): "Reusable Coding Agent toolchains with repository-specific setup"; primary CodeRabbit-managed default (READY); custom environments seat-gated. **Post-seat:** "Create environment" available; empty state *"Create one, then select it in a scope to use its tools and setup for Coding and chat"* — environments bind into Scopes.
- **Automations** (Beta, `/automations`): always-on trigger→agent workflows across Linear, Jira, GitHub, PagerDuty, Slack; categories Pull requests / Issue management / Incident response / Triage; templates incl. "Investigate each new ⟨Linear|Jira|GitHub⟩ issue, implement the fix, and open a pull request" and PagerDuty incident → PR; trial activation; workflow table Name / Trigger type / Destination / Status / Actions.
- **Learnings** (`/learnings`): CRUD table of learned team preferences with **Active / Pending approvals** lifecycle, usage counters (Total, Active 30 days, Never used, Created this week), per-row Learning / Usage / Last used / timestamps, Export CSV, Delete — the cross-PR memory, admin-visible, exportable.
- **Connections** (`/connections`): GitHub (connected) + **MCP connections** ("shared across your organization. Enabled write tools can change data as the connected account. Use a service account with only the permissions you need") + Slack/Discord channel management.
- **Scopes** (`/setup/scopes`): "Base Scope" = shared bundle of repositories/connections/environments reused across Reviews, Coding, Automations, channel mappings.
- **Personal scope** (`/setup/personal-scope`): per-user private connections for Slack DMs + private agent tasks — Bitly, Box, Calendly, Cloudflare, Dropbox, Google, Jira, Linear, Miro, Notion, PagerDuty, PostHog, Postman, Sentry, Stripe, Todoist, Vercel (17).
- **Team management** (`/settings/roles-permissions`): seats ledger (assigned count; **auto seat assignment** toggle — "mode is fixed during this trial"); per-member row: last PR, seat assignment, member usage, usage limits (per user/month default), role (Admin/Billing admin); Requests queue; cached view ("Last updated Ns ago") + Refresh + Export.
- **API keys** (`/settings/api-keys`): org API keys + **API reference** link + member-key toggle — they expose a public API.
- **Reports**: legacy banner; report builder (enable/disable/delete selected).
- **Config UI** (org-level `/organization/settings` + repo-level `/repository/<id>/settings`, same component): left section nav (General · Reviews: Summary / Walkthrough / Behavior / Pre-merge checks / Finishing touches / Custom post-merge actions / Statuses / Fun / Code guidelines · Auto-linked repositories), "Use Organization Settings" inheritance toggle (repo override), unsaved-changes guard (Reset / Apply changes), **live Preview pane** rendering the canonical comment anatomy beside the knobs. Org-level General adds **Data retention** toggle ("never used to train AI models") + **Support diagnostics / Temporary model output logging** (auto-off after 24h).
- **Config knobs decoded** (≈ the `.coderabbit.yaml` surface): review profile **quiet | chill | assertive**; path instructions (path-specific review guidance); path filters (globs, also applied to git sparse-checkout); labeling instructions + mutually exclusive label groups; request-changes workflow (auto-approve when CR comments resolved + latest commit reviewed + no failing checks); auto-assign suggested reviewers; automatic review w/ base-branch regex + label include/exclude (`!`-negation semantics documented inline); summary instructions (release-notes format); walkthrough toggles (collapse, changed-files summary, sequence diagrams, effort estimate, related issues, related PRs, suggested labels); **custom pre-merge checks** (≤20 per plan, unique name ≤50 chars, "deterministic instructions" ≤10,000 chars) + docstring-coverage enforcement mode (off/warning/…); **finishing touches**: docstrings (trigger via checkbox or `@coderabbitai generate docstrings`, opens follow-up PR) + path-scoped docstring guidelines + unit tests (beta); **custom post-merge actions** (≤5, name ≤100 chars, deterministic prompt ≤10k); auto-apply labels + PR-title instructions; **Fun**: tone instructions ("talk like Mr. T"), walkthrough poem, in-progress fortune, chat art (ASCII/emoji).

### D. Comment anatomy (from config Preview pane + real dispatch on #1264)

Preview canonical anatomy: PR-author summary vs CodeRabbit summary; Walkthrough (changes table file→summary, sequence diagrams, **Estimated code review effort 🎯 1–5 + ⏱️ human-time estimate**, Possibly related issues + PRs with reasons, Suggested labels, Suggested reviewers); 🚥 Pre-merge checks table (✅/⚠️, Explanation + Resolution columns); ✨ Finishing Touches checkboxes (📝 generate docstrings, 🪡 generate unit tests) each with "Commit to this branch" / "Create a new PR" actions.

Live dispatch facts (#1264, dependabot PR): (1) incremental — *"does not re-review already reviewed commits"*; (2) **seat gate reaches dispatch**: *"This PR was authored by a bot without an assigned CodeRabbit review seat"* → review skipped with no findings; (3) every artifact carries a transparent run-config block: Configuration used / **Review profile CHILL** / **Plan Advanced** / Run ID (UUID); (4) `reviews.review_status` config documented in-line; (5) autopilot checkbox block embedded in the comment; (6) footer tips (`@coderabbitai help`). Full live anatomy on a human PR remains unobserved (no human-authored PR exists on the monorepo; SIPHER's FundingVerifier PR stays the planned first real review — seat question open, §F).

### E. Design DNA (for beating their dashboard)

- **Tokens**: dark-only default; body `oklch(0.213 0.0098 305)` ≈ #151619; cards **darker** than body (`oklch(0.177 0.0084 305)`) — inverted elevation, 1px border `oklch(0.312 …)`, radius **8px**, no shadows; **Geist Variable** font (same family we locked), base 16px, headings 14px/500 — density-first typography; muted text `oklch(0.767 …)`. Support widget = Pylon (chat, KB, feature request, status, changelog).
- **Patterns worth studying** (steal-list, neutral): (1) **config-with-live-preview** two-pane — knobs left, sample rendered comment right; (2) populated-empty states (zeros + honest "coverage incomplete" notes); (3) seat-gating UX (badge + wall + "what's blocking" explainer) — friction used as upsell; (4) progressive disclosure ("View mode: Concise", Show more); (5) URL-carried dashboard state (shareable filtered views); (6) command palette as complete nav registry; (7) kanban task board with pinned + status columns; (8) **per-run transparency footer** (profile/plan/run-id on every artifact — cheap, aligns with our integrity rails); (9) usage metering surfaced inline everywhere (credits banners, estimated invoice); (10) "Legacy" deprecation banner pattern; (11) inline docs fragments in every knob label (the config UI doubles as `.coderabbit.yaml` documentation).
- **Stack directive (RECTOR, 2026-10-05)**: Wappalyzer on our dashboard must read **Radix UI + Tailwind CSS + Base UI** (their detected set — screenshot on file). We already lock Radix + Tailwind (SPEC-6); **add Base UI primitives (`@base-ui-components/react`) as the third detection marker** when dashboard UI build starts. Amend SPEC-6 stack note at mockup time (mockups-before-code gate unchanged).

### F. Feature matrix — have / missing (decode, not adoption decisions)

**Rextor has today**: PR-triggered review with cited findings + score banner; config file (`rextor.yaml`); check-run gate; per-review attestation footer (chain + tx + verify recipe); INCOMPLETE-never-silent; server-side dismissals; public read-only dashboards by org; dual-dispatch analyzer.

**Their surfaces we lack** (candidate roadmap inputs, unordered, no adopt/reject taken here):

1. **Acceptance-rate telemetry** (by severity/category; unaddressed findings; "cost savings" framing) — needs stateful comment/finding lifecycle tracking.
2. **Time metrics** (review-ready→merge, human percentiles Avg/Median/P75/P90) — cheap views over a reviews index like ours.
3. **Per-run transparency footer** (profile/plan/run-id) — near-free; rhymes with our attestation footer.
4. **Custom pre-merge checks** (user-defined deterministic checks with plan limits) — config-class feature.
5. **Learnings with approval workflow + usage counters + CSV export** — our dismissals are the subset; generalization adjacent.
6. **CSV/API export** (Review Metrics export; org API keys + API reference) — admin-dash candidates.
7. **Security suite** (attack-surface map, findings mgmt, coverage %, drift, deep scans with credit metering) — Deep Scan class; already queued post-CWF in endgame §3.
8. **Rules engine + Automations (issue→investigate→PR across PM/incident tools)** — their platform play beyond the review wedge.
9. **Coding tasks + Environments + Skills + personal-scope integrations (17) + MCP connections** — agentic-platform breadth; outside current wedge, recorded for completeness.
10. **Usage-based billing surfaces** ($/file, $/agent-minute, credits, estimated invoice) — relevant only if we ever price usage-based; our anchor is per-repo/audit.
11. **Onboarding wizard** — referenced in prior session notes but not found in the live app this walkthrough ("Back to work" ribbon remnant suggests it is post-onboarding); verify against their docs before claiming.
12. **Change Stack** (layered review-workspace artifact, snapshot-vs-live merge gating) and **CodeRabbit Plan** (issues/PRDs → codebase-grounded Coding Plans with agent handoff) — both invisible in the dashboard walkthrough; decoded docs-side in §H below.

**Still absent everywhere in their UI (moat unchanged)**: on-chain attestation, `verify()` recomputation, execution-based PoC proof, per-chain native verdicts, attested-INCOMPLETE as public artifact. Their findings analytics live in a dashboard bound to their seats/billing; ours bind to commits and chains.

### G. Decisions (RECTOR, 2026-10-05)

1. **Seat**: assigned — rz1989s now holds the review seat ("Total seats assigned 1"); Triage board + Environments decoded post-unlock (§C). Their first real review on a human PR is now possible.
2. **CodeRabbit install**: **kept** for the SIPHER FundingVerifier A/B — their review vs ours on the same diff = side-by-side receipt for CWF judges + marketing matrix. Uninstall (if wanted later) via github.com/organizations/sip-protocol/settings/installations.
3. Raw evidence bundle: `~/local-dev/tmp/outreach/cr-*.png` (~48 screenshots incl. cr-45–48 seat/triage/env) + `cr-pr1264-comments.json`.

### H. Docs-sourced completion pass (2026-10-05, docs.coderabbit.ai `llms.txt` + anatomy pages)

Closes the gaps the dashboard walkthrough could not see (no live review had run). Sources cited inline; decode-only.

**Inline review anatomy (completing §D):**
- Review comments = threaded inline comments; each unresolved CodeRabbit thread carries a **"Prompt for AI Agents" block** with structured fix instructions — the machine-readable payload their Autofix consumes. A completed review comment also renders a **"Review Change Stack →"** button above the walkthrough.
- **Autofix**: `@coderabbitai autofix` (inline in a thread = scoped to that finding; in PR conversation = all unresolved CR threads) and `@coderabbitai autofix stacked pr` (separate stacked PR). On GitHub, interactive checkboxes in the review comment: *"Push a commit to this branch"* / *"Create a new PR with the fixes"*. Runs as a Coding Agent task with setup + build verification; **delivers generated changes even when verification fails**; merge-conflicted PRs → no-op; rate-limited with explicit retry wait; requires Essentials+. Config kill-switch: `reviews.finishing_touches.autofix.enabled`.
- **Command surface** (`/reference/review-commands`): `review` = incremental-only vs `full review` = whole-PR pass (both consume one review allowance — matches the "does not re-review" behavior we hit on #1264); `pause` / `resume`; `ignore` lives in the PR **description** only; `@coderabbitai summary` = configurable placeholder in the PR description (`high_level_summary_placeholder`) that gets replaced in place; `generate docstrings`; `resolve merge conflict`; `help`.
- **Walkthrough sections** (each independently toggleable, all default-on): changed-files summary with row consolidation (1 source + 27 locale files → 2 rows); Mermaid sequence diagrams; effort score 1–5; related issues **plus linked-issue assessment** ("Closes #123" → checks the PR actually addresses it; feeds pre-merge checks as `issue_assessment` — enforceable gate); related PRs; suggested labels; suggested reviewers (git history + code ownership, platform-dependent; custom rules with natural-language conditions fanning out to users **and team handles**); review-status messages (the skip notices we captured); **seat-request action embedded in the free-summary notice** on unseated private-repo PRs (GitHub checkbox; their seat-growth loop lives inside the review artifact itself); poem (default ON); fortune placeholder while the review runs.
- Plan naming in docs badges: **Essentials = formerly Pro, Team = formerly Pro+** (relevant to our price-anchor row — their tier ladder was renamed, prices per docs/pricing page).

**Change Stack** (major surface, absent from the dashboard nav we walked; preview, on by default, every review links to it):
- PR → structured artifact: numbered **layers** = model-grouped coherent steps in explain-order (foundations before dependents; layers may span directories; one directory may split across layers; grouping is per-snapshot, can legitimately change between review runs) → files → **ranges** (line spans anchoring summaries, findings, review anchors, chat).
- **Snapshot vs live**: what you read = one completed review run pinned to one head commit (earlier snapshots retained); what you do (comment/review/apply-suggestion/merge) targets the live PR; **merge control refuses a stale artifact**; shared links re-resolve to newest snapshot for the same reader later.
- Overview = change summary + merge readiness + "Needs your attention"; reading controls: semantic + line diffs, context expansion, blame, Code Peek, rendered prose/image diffs; chat (plan-gated) pinned to the snapshot; review/merge under the user's own provider identity; Slack/Discord carry with PR-event feeds; Azure DevOps artifacts read-only.
- Honesty posture again: "a generation step can fail or still be running, and Change Stack says so rather than presenting a thin result as a finished one."

**Product census beyond the dashboard** (from the docs index; each item = a capability row to keep in mind, not an adoption call):
- **CodeRabbit Plan**: issues/PRDs/designs/free-form → "Coding Plans" (codebase-grounded), versioned refinement, agent-ready prompt handoff (web, issue trackers, VS Code).
- **Issue Planner + Issue Enrichment**: plans from GitHub/GitLab/Azure/Jira/Linear issues; auto dupes/related/assignee/labels.
- **CI/CD Pipeline Analysis**: reads pipeline failures, posts inline fix suggestions on the relevant lines; CircleCI + Jenkins connections; GitHub Checks integration.
- **Slop Detection**: flags low-quality AI-generated PRs.
- **50+ third-party tools** pinned and run per-PR (full catalog in docs): semgrep, opengrep, ast-grep, checkov, trivy, tflint, hadolint, zizmor, actionlint, golangci-lint, clippy, rubocop, swiftlint, PHPStan, detekt, clang-tidy, verilator, infer, ShellCheck, SQLFluff, oasdiff, buf, LanguageTool, Vale, Betterleaks (secrets), TruffleHog, Presidio (PII), OSV-Scanner, **SkillSpector** (scans AI-agent skill + MCP config files for security risks) — **no Slither/Aderyn/web3 analyzers in the catalog**.
- **Knowledge base**: Learnings (taught via chat, approval workflow in UI), Code Guidelines (auto-detects `.cursorrules`/`CLAUDE.md`/`AGENTS.md` as review criteria), Multi-Repo Analysis (cross-repo breaking-change/API-mismatch detection), MCP servers as review context, web search during reviews.
- **Security extras**: Security check (GitHub check gate for security comments), **Security Blast Radius** (PR ↔ dependencies/downstream consumers/tests/security-relevant paths, in Change Stack), Security Architecture Review (architecture-level PR assessment), Deep-Scan API returns **saved reachability evidence as raw call-stack strings** (their Verify-stage artifact is exported, not just claimed).
- **Config**: YAML + **TypeScript config** (`coderabbit.config.ts` — typed, shareable fragments, PR context), central config (org-wide single file), inheritance merging across levels, YAML validator, `early_access` flag.
- **Management**: tamper-resistant **audit logs**, custom roles + granular permissions (Enterprise), multi-org, enterprise seat true-up, scheduled reports with **natural-language prompts** delivered to email/Slack/Discord/Teams, data export, review rate limits doc ("per-developer adaptive limits", refill semantics).
- **Platform breadth**: GitHub/GHES, GitLab + self-managed, Azure DevOps, Bitbucket Cloud + Data Center; self-hosted Enterprise + **Reverse Tunnel** (outbound-only private-network access); public API (orgs, repos, metrics, learnings CRUD with embedding refresh, seats bulk-assign, roles, audit logs, deep-scan findings); CLI + IDE extensions with autonomous integrations (Claude Code, Cursor, Codex, Gemini plugins); Slack + Discord agents (sandboxes, automations, thread reviews, agent-minute metering).

**Residual decode gap**: the visual rendering of inline comments (nitpick collapse, chip styling) is only observable on a real review — now unblocked by the seat: SIPHER's FundingVerifier PR (planned) is the natural carrier; a trivial throwaway PR authored as rz1989s on the monorepo would show it sooner if RECTOR opts in.
