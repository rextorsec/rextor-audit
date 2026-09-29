# CODE ROAST REPORT

**Roast Date**: 2026-09-25
**Repository**: rextor-audit (main @ `811e498`, 2026-09-24)
**Mode**: `--no-mercy --save-roast`
**Scope**: `packages/agent` (service + analyzer), `packages/web` (landing/dashboard), `programs/attestation-solana`, CI. Vendored third-party code (`analyzer/vendor/forge-std`) inspected but excluded from scoring — it is upstream's code, not ours.

---

## Verdict: **NEEDS WORK** *(one step from SHIP IT — blocked by exactly one thing: an EOL framework in production)*

---

## CAREER ENDERS

**None found.** Not a participation trophy — verified by sweep:

| Sweep | Pattern | Result |
|---|---|---|
| Debt markers | `\b(TODO\|FIXME\|HACK\|XXX\|WORKAROUND)\b` | **0 hits** in first-party code |
| Type abuse | `as any`, `: any`, `<any>` | **0 type-level hits** (only English prose in comments) |
| Empty catches | `catch … { }` | **0 in TS** (only vendored Solidity) |
| Injection surfaces | `eval(`, `new Function(`, `exec`/`spawn` with shell | **0**; only `execFile`/`execFileSync` (no shell, argv-array) |
| SQL injection | string-concatenated queries | **0**; 100% `prepare()` with `?`/`@named` params (only constant `${COLUMNS}` interpolated) |
| Committed secrets | credential-shaped literals | **0**; only test fixtures (anvil key #1, labeled "test-only") |
| Git hygiene | `.env`, `*.sqlite`, `.turbo`, `.vercel`, `*.tsbuildinfo` | all ignored, `!.env.example` whitelisted |

---

## EMBARRASSING MOMENTS

### 1. EOL framework serving a security company's public site
**File**: `packages/web/package.json:19` + `packages/web/next.config.mjs:8-14`
**Sin**: `"next": "^14.2.32"` — Next 14 no longer receives security fixes, and it fronts `www.rextoraudit.com` days before pitching "audits are point-in-time, code is continuous."
**Evidence**:
```js
// Hardening (2026-09-24): Next 14.2 carries advisories in the image
// optimization API (incl. the AVIF-optimizer RCE class) ...
images: { unoptimized: true },
// Post-CWF: upgrade to next@>=15.5.24 (14.x is EOL for security fixes)
```
**Why it's bad**: The mitigation (`images.unoptimized`) kills the known RCE surface and the config *documents the debt honestly* — but a prospective customer who runs `pnpm ls next` on the demo lands on an EOL major of the exact class of finding Rextor ships. The irony is the finding.
**The Fix**: The 15.x upgrade is already scheduled post-CWF. Before Oct 10 if at all possible: bump `next@>=15.5.24`, land the nonce-based CSP (retiring `script-src 'unsafe-inline'`), keep `unoptimized` or adopt `next/image` deliberately. If the deadline forces the choice, ship the upgrade to a Vercel preview and verify the 8 web tests — it is a half-day, not a week.

---

## EYE ROLL COLLECTION

### 2. Unbounded repo query — cap at the wrong layer
**File**: `packages/agent/src/db.ts:131-133`
**Sin**: `listForRepo` has no `LIMIT`. The dashboard's `MAX_RENDERED_ROWS = 200` (`packages/web/lib/reviews.ts:54`) slices *after* the service serialized every row for the repo onto the wire.
**Evidence**:
```ts
const listStmt = db.prepare(
  `SELECT ${COLUMNS} FROM reviews WHERE repo = ? ORDER BY created_at DESC, rowid DESC`,
);  // no LIMIT
// …then in web: reviews.filter(isReviewRow).slice(0, MAX_RENDERED_ROWS)
```
**Why it's bad**: One busy repo in year two = multi-megabyte JSON per dashboard render, paid on every force-dynamic request. The render cap is real but the transport still pays full freight.
**The Fix**: `LIMIT 200` in SQL (or a `?limit=` param the web passes). Three-character fix; delete the client-side slice or keep it as belt-and-braces.

### 3. `chmod 0o777` on PoC dirs — and the fallback directory is `$HOME`
**File**: `packages/agent/src/sim.ts:276` (with `simTmpBase` at `:235-237`)
**Sin**: World-writable PoC dirs containing attacker-influenced PR source, and on darwin `simTmpBase()` resolves to `homedir()` — so on the deployment host the 0777 dirs live under RECTOR's home.
**Evidence**:
```ts
await chmod(pocDir, 0o777);   // "lets it write artifacts through the bind mount (colima maps host perms)"
…
return process.env.REXTOR_SIM_TMP_DIR ?? (process.platform === "darwin" ? homedir() : tmpdir());
```
**Why it's bad**: 0777 under `$HOME` is a local-priv posture smell on a shared host and would trip most hardening audits ( CIS 2.2-class). It's a docker uid workaround, dirs are `rm`'d in `finally`, and `readExcerpt` has realpath containment — but a uid-matched work dir or `0o755` + group mapping removes the class, not the symptom.
**The Fix**: Dedicated `REXTOR_SIM_TMP_DIR` default (e.g. `/var/tmp/rextor-sim` in-container, or run the analyzer container with `--user $(id -u):$(id -g)`); drop to the narrowest perms that satisfy the mount.

### 4. `runReview` — a 320-line orchestrator
**File**: `packages/agent/src/review.ts:557-877`
**Sin**: github setup → clone → config → gate → sim → attest → comment → index → feedback → cleanup in one function body. `review.ts` is 877 lines, the largest file in the repo.
**Evidence**: `runReview` spans lines 557→877; nine concerns, each individually well-commented.
**Why it's bad**: Every catch in there is a *deliberate* degradation point (good!), but the reviewer's working memory dies around stage six. The 755-line test file carries the safety net, which says something about how much the shape demands.
**The Fix**: Stage functions returning a partial `ReviewResult` (the type already exists); `runReview` becomes a linear composition. Post-CWF; tests already pin behavior so the refactor is low-risk.

---

## MEH COLLECTION

### 5. `console.log/error` is the logging layer
**Files**: all of `packages/agent/src/*`
Discipline is genuinely good — `[rextor]` prefixes, message-only logging ("never stack traces/env that could echo secrets"), named incident lines (`SETTLED-REVIEW COMMENT LOST`). But there are no levels, no JSON lines for ingestion, and ops greps raw text. Post-CWF: pino or levels + structured fields.

### 6. Sequential redelivers at boot
**File**: `packages/agent/src/reconcile.ts:117-127`
Serial `await` per delivery over the recent-deliveries list. Bounded and boot-only, but a slow GitHub API tail extends restart linearly. Fine until it isn't.

### 7. No dedicated health endpoint
`GET /reviews/:o/:r` with a token doubles as the liveness probe. An unauthenticated `/healthz` would be honest ops and keep "is it alive" off the auth path.

### 8. Loopback bind hardcoded
**File**: `packages/agent/src/server.ts:599`
`server.listen(port, "127.0.0.1")` — correct-by-design behind the tunnel, but it's a magic string an operator can't override. One `REXTOR_BIND_HOST` away from boring.

---

## CLEAN BILL (evidence, not charity)

- **Security fundamentals**: `timingSafeEqual` + length-guard on *both* the webhook HMAC (`server.ts:41-45`) and the API token (`:242-243`); unset token fails closed (401 everything); 1 MiB body cap enforced *pre*-signature (memory-DoS answer); 503+Retry-After at pending cap 25; delivery-id dedup + 413 skip-list keyed by GUID; chat rate limiter (5/h) with bounded, self-sweeping maps; review cache capped at 500.
- **Path traversal**: `readExcerpt` realpaths both sides and prefix-checks (`sim.ts:55-61`) — the `..`/symlink-to-host-file class is closed.
- **Untrusted PR content**: config all-or-nothing parsing (no half-applied silencing); dismissals server-side in SQLite, never repo files; findings evidence constrained to the diff; check-run gate consumes raw analyzer severities so the LLM can't flip FAILURE→SUCCESS.
- **Web**: CSP + frame-deny + nosniff + referrer + permissions headers; `poweredByHeader: false`; `/api/chain` 404s unknown chains, 60s Data Cache + 10s RPC timeout + amplification defense; per-row shape validation (malformed row degrades, page never 500s); token never in client bundle; React-escaped inert text only; zero `dangerouslySetInnerHTML`.
- **Error handling**: every catch logs a *specific* reason and degrades visibly; analyzer failure ⇒ INCOMPLETE report, never a clean pass (the integrity rule is enforced in code, not docs).
- **Memory bounds**: queue `processedAt` pruned on every enqueue (TTL sweep, `queue.ts:50-53`); stall watchdog cleared in `finally`.
- **Testing**: 24 agent test files vs ~20 src modules (>1:1), 8 web suites; container-contract tests gated `skipIf(!docker)` and run in a dedicated CI job (non-gating until the image ships to ghcr **by digest** — known, tracked residual).

---

## FINAL ROAST SCORE

| Category | Score | Notes |
|----------|-------|-------|
| Security | 7/10 | Fundamentals unusually strong (timing-safe, prepared SQL, fail-closed). Loses 3 for EOL Next in prod + `unsafe-inline` CSP + 0777 dirs. |
| Scalability | 8/10 | Coalescing queue, pending cap, backpressure, bounded maps. Unbounded `listForRepo` + serial reconcile. |
| Code Quality | 8/10 | Zero TODO/any/empty-catch; comment discipline explains *why*. `runReview` god-function. |
| Testing | 9/10 | >1:1 test ratio, injection seams everywhere, contract gates. Only ding: non-gating container CI job (documented). |
| Documentation | 9/10 | SPEC-driven, header comments are design docs, `.env.example` present. Console-as-logger is the gap. |

**Overall**: **41/50**

**Roaster's Closing Statement**:
This is the cleanest codebase this roast has run through, and that is not a compliment paid lightly — the sweeps for the classic sins came back empty *with receipts*, not with hand-waving. The comment that says "an unbounded pre-signature buffer is a memory-DoS vector" is the difference between an engineer and a tutorial-follower; this repo has dozens of those. So the embarrassment is narrow and specific: a security firm shipping an EOL framework to its own public storefront is a finding any paying customer's scanner would file against *us*, and the 0777-under-$HOME chmod is the one place the codebase tolerates a workaround it would flag in someone else's product. Both are known, both are documented in-repo, and that's the uncomfortable part — the debt is not hidden, it is *scheduled*. Scheduled debt past a hard deadline has a way of becoming permanent debt. Fix #1 before Oct 10; the rest is polish on a genuinely production-grade service.
