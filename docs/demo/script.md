# Demo video script — 3:00 (draft v1, RECTOR red-pen target)

**Status:** DRAFT for approval (E3, week-4 plan Task 12). **Recording rules (binding):**
- Real artifacts ONLY (invariant 17). Every number/link below marked `[LIVE]` is re-verified at record time from the actual surfaces — the script never hardcodes a value the screen can't show.
- Every capability row referenced must be flipped `shipped` with a receipt before we shoot the scene that mentions it.
- Format: 1920×1080, dark theme matching the landing mock; terminal + browser only, no stock footage; VO recorded clean (Conatus polish bar).
- FRESH PRs only on camera (E2 rule) — PR #3-style evidence trails are for prep, not for the shot.

**Money shot (§3):** a stale audit PDF vs the live catch on a fresh PR.

---

## Cast of artifacts (verify all at record time)

| Artifact | Source | Status at draft |
|---|---|---|
| Fresh trigger PR (new branch, trivial vuln diff) | rextor-audit-test | shoot-time |
| Review comment: riskScore, findings table, cited lines, fix diff | bot comment | `[LIVE]` |
| Attestation footer: reviewId, findingsHash, tx link | bot comment | `[LIVE]` |
| `verify(...)` calls: true-payload vs tampered | cast against Tempo v2 `0x7fe6…0bcd` | proven 2026-09-18/19 |
| IPFS CID footer → gateway fetch → sha256 == on-chain hash | review #6 pattern (`ipfs://QmUqtDrt…`, tx `0xffa10497…`) | proven 2026-09-19 |
| Dashboard: ledger row, score history, identity card | Vercel deployment | `[LIVE]` |
| `@rextor-audit` chat reply (deterministic verdict) | issue comment | proven (receipt 5742416145) |
| rextor.yaml severity gate → check-run | fresh PR | rides F5 installation-token swap — if F5 hasn't landed, CUT this scene, don't fake it |
| ERC-8004 agentId | identity card | post-C1-broadcast — same rule: no receipt, no scene |
| Solana devnet programId | chains registry + explorer | post-B4-deploy — same rule |

## §1 — The gap (0:00–0:20)

**Screen:** split. Left: a real audit-report PDF title page (generic, scrolled slowly). Right: a git log scrolling past `main`, commits landing days after the audit date.

**VO:** "This audit covered this commit. Everything after it shipped unguarded. The biggest exploits of the last cycle were all deltas — code changed after the audit report was issued."

**Purpose:** the wedge, in one breath. No product yet.

## §2 — Every PR an audit event (0:20–0:55)

**Screen:** GitHub, fresh PR opened. Webhook lands (delivery 200 in the log). Cut to the bot comment arriving: verdict banner (riskScore `[LIVE]`), findings table, and the **quoted cited lines** — verbatim from the diff, file:line-pinned.

**VO:** "Rextor Audit reviews every pull request that touches money-code. Static analysis grounds the findings; every claim is pinned to cited lines from the actual diff — not model vibes."

**Production note:** pre-stage the repo; the review takes minutes — record the comment arrival by cutting from webhook delivery to the completed comment (honest edit; nothing faked on screen).

## §3 — The money shot: stale vs live (0:55–1:30)

**Screen:** back to the audit PDF: "No criticals at commit `abc123`." Hard cut to the fresh PR: the same vulnerable pattern the PDF waved through — caught, scored, with a suggested fix diff block labelled *"Suggestion — review before applying"*.

**VO:** "The audit saw this function before it was rewired. Rextor sees it the day it changes. Risk-scored, cited, and fixable — suggested only; the agent never touches your branch."

**Rule:** the vuln diff must be one the pipeline actually catches on camera (rehearse the trigger PR until the finding is deterministic).

## §4 — Anyone can verify (1:30–2:10)

**Screen:** the comment footer: reviewId + findingsHash + tx link. Split: left, `cast call` `verify()` with the exact payload → `true`; retamper one byte → `false`. Right: the findingsURI `ipfs://…` → gateway fetch → `sha256` → equals the on-chain hash. Then the dashboard: ledger row for the review, score history, identity card.

**VO:** "Every verdict is attested on-chain. The findings hash is recomputable from the public report — flip one byte and the contract says no. The full report is pinned to IPFS, and its hash matches the chain. The dashboard is the living audit report: every repo, every review, every receipt."

**Purpose:** this is the moat scene — reproducible + accountable, the line nobody else crosses.

## §5 — Operator experience (2:10–2:40)

**Screen:** (a) `@rextor-audit` chat: ask for the verdict → deterministic reply re-stating findings + tx link, and a dismissal attempt via chat → refused, pointed at `rextor.yaml`. (b) `rextor.yaml` on the base branch: severity gate + a `dismiss:` entry with its public reason; findings stay visible, gate excludes.

**VO:** "Ask the agent in-PR — it answers from the cached review, read-only. Silencing is a single trusted channel: the owner's config on the base branch, every dismissal public with a reason. PR content can never silence its own findings."

**Gate:** chat scene safe (live). Check-run scene only if F5 landed; otherwise fold the gate explanation into the yaml shot.

## §6 — Where it runs, and close (2:40–3:00)

**Screen:** landing page — Tempo flagship (contract receipt), Solana + ERC-8004 rows (only if receipts are live), capabilities table with receipts-not-claims badges.

**VO:** "Attested on Tempo today, Solana and ERC-8004 identity in the registry — chain-native verdicts, chain-neutral identity. Rextor Audit. Audits are point-in-time. Code is continuous."

**Card:** rextoraudit.com (or the Vercel URL if F4 hasn't landed) + Rextor Security.

---

## Open items for RECTOR

1. Beat order OK? Any must-have cut or addition? (E2 model-flip scene deliberately absent — deferred.)
2. VO: your voice or synthesized? On-camera intro/outro or pure screen?
3. Length hard-cap 3:00 — §5 is the flexible scene if we overrun.
4. Domain: record with the Vercel URL or wait for F4? (Judges need SSO protection disabled either way — submission-week task.)

---

## RECEIPT RE-VERIFICATION — 2026-09-25 (autonomous sweep, pre-red-pen)

Every artifact below re-verified against live chains today. **Two script facts are STALE and must not reach the camera.**

### ⛔ Stale values to correct before recording

| Script says | Reality (verified 2026-09-25) |
|---|---|
| Tempo v2 `0x7fe6…0bcd` for `verify()` calls | **RETIRED** (zeroed by the 09-21 testnet reset). Cast against **`0x51ac8214089daf85b188437b087519acfc6c495a`** (deploy #3) — code live on chainId 42431. |
| IPFS pattern `ipfs://QmUqtDrt…`, tx `0xffa10497…` (Sep 19) | Use the current full-loop receipt: reviewId `0xb0644c0e…`, tx [`0x56311f293f…`](https://rpc.moderato.tempo.xyz) — status `0x1`, block 36628648, findingsURI `ipfs://QmWi8zD3…`. |

### ✅ Verified live today (safe to show as-is)

| Receipt | Evidence |
|---|---|
| Tempo registry `0x51ac…495a` | `eth_chainId` = 42431, `eth_getCode` non-empty |
| Tempo attestation txs: smoke 90/100 (`0x56311f293f…`), 93 (`0x4a2a834416…`), 93 (`0x1323a45515…`) | receipts: all status `0x1`, all `to` = registry |
| **HyperEVM MAINNET** registry `0x8f63…850c` | chainId 999, code live; twin tx `0x64e2a131…1834b5` status `0x1`, block 46562201, gas 194,330 — exact E1 record |
| Prod identity reads | `/api/chain/tempo` → `active:true, reviewCount:8`; `/api/chain/hyperliquid` → `active:true, reviewCount:1` |
| Solana devnet program `Aj6Nx…kMDs` | `getAccountInfo`: executable, BPFLoaderUpgradeable-owned — **B4 shipped, §6 Solana scene is recordable** |
| Dashboard + landing | www.rextoraudit.com live, nonce-CSP deployed 09-25; ledger rows via `/dashboard/rextorsec/rextor-audit-test` (16 rows, newest pr 8) |
| ERC-8004 identity | agentId 50891, identity card live on prod landing (C1 done) |
| Chat + severity gate | chat proven (receipt 5742416145); severity-gate FAILURE check-run live in production smoke (rextor-audit-test#8) — the §5 gate scene no longer rides F5 |

### Red-pen suggestions (decision, not rewrite)

1. **§6 VO is understated now**: "Attested on Tempo today" → consider "Attested on **Tempo and Hyperliquid mainnet** today" — a mainnet attestation is the strongest sentence in the video and it's currently missing.
2. §4 dashboard shot: record `www.rextoraudit.com` (F4 landed — open item #4 resolved).
3. §2/§3 trigger PR: fresh branch on `rextor-audit-test` as planned; the deterministic catch to rehearse is the SmokeVault reentrancy pattern (high → trips the gate on camera).
4. Check-run scene: keep it — gateView shipped in PR #36 and fired in the 09-24 production smoke.
