# Task 9 Report: Webhook hardening — body cap, delivery dedup queue, octokit timeout

**Commit:** `b62d716` — `feat: webhook hardening — 1MiB body cap, delivery dedup queue, octokit timeout`
**Branch:** `feat/week-2-depth` (on top of `0e8bb5b`)

## What was implemented

### 1. `packages/agent/src/queue.ts` (new)
- `export const MAX_BODY_BYTES = 1_048_576` — single source of truth for the cap.
- `export class ReviewQueue` with `enqueue(deliveryId, run): Promise<void>`:
  - **Sequential execution** via a `tail` promise chain: each accepted item chains onto the previous one's completion; arrival order == execution order.
  - **Dedup**: `inFlight: Set<string>` (registered synchronously at enqueue time, before the run starts — a redelivery racing the queue is already dedupable) + `processedAt: Map<string, number>` (set in the chain's `finally`, so completed items dedup for `DELIVERY_TTL_MS = 15 min`, pruned lazily on each enqueue). Duplicates resolve immediately without running.
  - **Worker errors contained**: `try/catch/finally` inside the chain — the run's rejection is logged (`[rextor] queued review failed: <message>`) and swallowed; `enqueue` always resolves, and `tail` never rejects.
  - `idle(): Promise<void>` — resolves when no queued or in-flight work remains (returns `tail`). This is the drain affordance mandated by CONTROLLER RULING 2; exposed on the server as `ReviewServer.idle()`.

### 2. `packages/agent/src/server.ts`
- **Body cap before signature work** (SPEC-1 invariant 2 analog): the request is accumulated chunk-by-chunk with a running total; the moment `total > MAX_BODY_BYTES` the buffering loop breaks (memory held is bounded at cap + one chunk, never the whole oversized body) and the handler answers `413 {"error":"payload too large"}` — before the secret check, signature verification, or any parsing. `req.destroy()` fires only from the `res.end` callback so the client observes the 413 rather than a connection reset.
- **Async review with dedup**: after signature + event/action validation (unchanged order: secret missing → 500 fail-closed, bad sig → 401, malformed JSON → 400, non-actionable → 200 `{ignored:true}`, missing prUrl → 400), the handler reads `x-github-delivery` (falls back to `randomUUID()` if absent so reviews still run), enqueues `runReview(prUrl, deps)` on the per-server `ReviewQueue` held on the `createReviewServer` closure, and responds `200 {"queued":true}` immediately — before the review completes. `runReview` errors never reach the HTTP layer (contained by the queue).
- **New `ReviewServer` interface** (`extends Server`, adds `idle(): Promise<void>`); `createReviewServer` returns it. `Server` subtype, so the `tsx` entrypoint (`listen`) is unaffected.
- Removed the now-dead synchronous `runReview` call and its `ReviewResult` import; header comment updated to document cap + async queue + GitHub ~10s redelivery rationale.

### 3. `packages/agent/src/github.ts`
- `const OCTOKIT_TIMEOUT_MS = 15_000` (module constant of the real adapter) applied at **both** Octokit construction sites (`fetchDiff`, `postComment`) via `new Octokit({ auth: token(), request: { timeout: OCTOKIT_TIMEOUT_MS } })`. DI seams (`runGit`/`token`/`rmDir`) untouched.

### 4. Tests
- `packages/agent/test/queue.test.ts` (new, 4 tests): sequential order (including the stronger negative assertions that b/c never *start* while a is parked), in-flight + post-completion duplicate skip, worker-error containment, `idle()` drain semantics.
- `packages/agent/test/server.test.ts`: new `describe("hardening")` with 4 tests (413 over cap with garbage signature — proves no signature work ran since any sig work yields 401; exact-at-cap boundary proceeds through signature+parse to 400; duplicate `X-GitHub-Delivery` over two concurrent POSTs → both 200, exactly one clone + one comment; 200 arrives while the review is parked on a gated `fetchDiff` — then drains). Existing two sync-review tests adapted per CONTROLLER RULING 2: they now expect `{queued:true}` and `await server.idle()` before asserting the preserved effects (`comments` length 1, `cloned` exact PR URL). No test deleted; `withServer` now passes the `ReviewServer` to the test body. `FAKE_DIFF` extracted to a module const for reuse by the gated test.

## TDD evidence

**RED** — after writing only the tests:
```
$ cd packages/agent && pnpm vitest run test/queue.test.ts test/server.test.ts
FAIL  test/queue.test.ts  Error: Cannot find module '../src/queue' ...
FAIL  test/server.test.ts Error: Cannot find module '../src/queue' ...
 Test Files  2 failed (2)
```
(exactly the Step-2 expected failure: `../src/queue` missing, 413 not implemented)

**GREEN** — after implementing queue.ts + server.ts + github.ts:
```
$ pnpm vitest run test/queue.test.ts test/server.test.ts
 Test Files  2 passed (2)
      Tests  23 passed (23)

$ cd packages/agent && pnpm vitest run && pnpm typecheck
 Test Files  14 passed (14)
      Tests  155 passed | 1 skipped (156)
(tsc clean)

$ cd ../.. && pnpm test:run && pnpm typecheck
 Tasks:    1 successful, 1 total      # test:run
 Tasks:    1 successful, 1 total      # typecheck
```
(155 passed vs 147 pre-task: +4 queue, +4 hardening; the two adapted server tests still assert exactly one review + comment per delivery.)

## Files changed
- `packages/agent/src/queue.ts` (new)
- `packages/agent/src/server.ts`
- `packages/agent/src/github.ts`
- `packages/agent/test/queue.test.ts` (new)
- `packages/agent/test/server.test.ts`

## Self-review findings (fixed during the task)
1. **Brief's dedup test deadlocks any conforming implementation** (`queue.test.ts`): the sketched line `await q.enqueue("d2", () => release)` with a never-settling run can never resolve under completion-semantics — and the sequential-order test *requires* completion-semantics (`Promise.all([p2,p3])` must resolve only after run 3 pushed; weaker dispatch/accept semantics fail it with `order` missing entries). No semantics satisfies both lines verbatim. Resolution: completion-semantics implementation, and the in-flight setup line is issued without `await` (`void q.enqueue("d2", () => new Promise(() => {}))`) — dedup registration is synchronous, so the duplicate is deterministically skipped and the assertion (`run` called exactly once) is unchanged. All other queue tests are verbatim from the brief except timer replacement (below).
2. **Project rule `ts-no-test-timers`**: the brief's tests use real 10 ms `setTimeout`s. Replaced with gate-based deferreds + a bounded microtask `flush()` — deterministic, no wall-clock, and the order test gained start-parking assertions (`["start-1"]` only) that the timer version couldn't make.
3. **Project rule `ts-promise-with-resolvers`**: `Promise.withResolvers` is ES2024-lib and fails this project's ES2022 `tsc` target (verified empirically: `TS2550`). Used executor-form deferreds with a comment naming the constraint (the rule's stated exception).
4. **Return-type friction**: `queue.enqueue` run parameter is `() => Promise<void>` (brief interface) while `runReview` returns `Promise<ReviewResult>`; `Promise<ReviewResult>` is not assignable to `Promise<void>`. Callsite wraps: `async () => { await runReview(...) }`. Caught by typecheck, fixed, re-verified.
5. Two mid-edit range slips on my side (server.test.ts duplicate block, github.ts misplaced lines) were detected by the edit tooling's parse warnings, re-grounded, and repaired — final `git diff` of github.ts is exactly the constant + two construction-site changes.

## Concerns (none blocking)
- **TTL pruning is not directly tested**: dedup of the *processed* path is covered (d1 pair), but the 15-minute expiry itself would need `Date.now` fake timers; the pruning loop is the brief's sketch verbatim. Low risk (lazy prune on every enqueue; Map-delete-during-iteration is safe for the current entry).
- **Missing `x-github-delivery` header**: falls back to `randomUUID()` (each such request runs, none dedup against each other). GitHub always sends the header; the fallback only prevents a silent no-op. Not pinned by a test.
- **413 + `req.destroy()` under fetch**: verified working over real undici fetch in the test; the end-callback ordering specifically prevents the RST-before-read race. If CI ever flakes there, the destroy could be dropped (response already ends the exchange), but I kept the brief's hard-kill semantics to deny slow-body resource holding.
- The 200-ack body is `{ queued: true }` — the brief left the body unspecified; tests pin it, so any future change is deliberate.
