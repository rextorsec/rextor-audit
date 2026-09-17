### Task 9: Webhook hardening — body cap, delivery dedup queue, octokit timeout

**Files:**
- Modify: `packages/agent/src/server.ts`, `packages/agent/src/github.ts`
- Create: `packages/agent/src/queue.ts`
- Create: `packages/agent/test/queue.test.ts`; modify `packages/agent/test/server.test.ts`

**Interfaces:**
- Consumes: existing `createReviewServer`/`handleWebhook` internals, `githubDeps`.
- Produces: `queue.ts`: `export const MAX_BODY_BYTES = 1_048_576`; `export class ReviewQueue { enqueue(deliveryId: string, run: () => Promise<void>): Promise<void>; }` — sequential execution; duplicate `deliveryId` (in-flight OR processed within TTL 15 min) resolves immediately without running; server responds 200 after signature+event validation and enqueues; oversized bodies → 413 before buffering completes; Octokit constructed with `request: { timeout: 15_000 }`.

- [ ] **Step 1: Write the failing tests**

`packages/agent/test/queue.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ReviewQueue } from "../src/queue";

describe("ReviewQueue", () => {
  it("runs enqueued work sequentially in order", async () => {
    const q = new ReviewQueue();
    const order: number[] = [];
    const slow = (n: number) => new Promise<void>((resolve) => setTimeout(() => { order.push(n); resolve(); }, 10));
    await q.enqueue("a", () => slow(1));
    const p2 = q.enqueue("b", () => slow(2));
    const p3 = q.enqueue("c", () => slow(3));
    await Promise.all([p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("skips a duplicate deliveryId entirely (in-flight and after completion)", async () => {
    const q = new ReviewQueue();
    const run = vi.fn(async () => {});
    await q.enqueue("d1", run);
    await q.enqueue("d1", run);
    expect(run).toHaveBeenCalledTimes(1);
    const release = new Promise<void>(() => {});
    await q.enqueue("d2", () => release); // never settles — stays in-flight
    await q.enqueue("d2", run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("worker errors are contained (enqueue still resolves)", async () => {
    const q = new ReviewQueue();
    await expect(q.enqueue("e", async () => { throw new Error("boom"); })).resolves.toBeUndefined();
  });
});
```

`server.test.ts` additions (use the existing harness's fake deps pattern):

```ts
describe("hardening", () => {
  it("413s a body larger than 1 MiB before signature work", async () => {
    // start server on ephemeral port, POST >1MiB with any signature
    // expect 413 and that verifySignature was never called (spy via secret mismatch would also 500 — assert status only)
  });
  it("duplicate X-GitHub-Delivery triggers exactly one review", async () => {
    // valid signed payload for pull_request.opened, same delivery id twice
    // fake deps count runAnalyzer calls === 1; both responses 200
  });
  it("responds 200 immediately, before the review completes", async () => {
    // fake deps where runAnalyzer blocks on a deferred; assert response arrives first
  });
});
```

(Implement following the existing `server.test.ts` request-helper conventions — sign with the same HMAC helper the suite already uses.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run test/queue.test.ts test/server.test.ts` — FAIL (`../src/queue` missing; 413 not implemented).

- [ ] **Step 3: Implement**

`packages/agent/src/queue.ts`:

```ts
// Week-2 hardening: sequential review queue with GitHub delivery dedup.
// GitHub redelivers after ~10s of no response; without dedup the same
// delivery double-posts comments.
const DELIVERY_TTL_MS = 15 * 60 * 1000;

export class ReviewQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<string>();
  private readonly processedAt = new Map<string, number>();

  async enqueue(deliveryId: string, run: () => Promise<void>): Promise<void> {
    const now = Date.now();
    for (const [id, at] of this.processedAt) {
      if (now - at > DELIVERY_TTL_MS) this.processedAt.delete(id);
    }
    if (this.inFlight.has(deliveryId) || this.processedAt.has(deliveryId)) return;
    this.inFlight.add(deliveryId);
    this.tail = this.tail.then(async () => {
      try {
        await run();
      } catch (err) {
        console.error("[rextor] queued review failed:", err instanceof Error ? err.message : err);
      } finally {
        this.processedAt.set(deliveryId, Date.now());
        this.inFlight.delete(deliveryId);
      }
    });
    await this.tail;
  }
}
```

`server.ts`:
1. Buffer the body with a cap: accumulate chunks; if `total > MAX_BODY_BYTES` (import from queue.ts or define locally = 1_048_576) → `res.writeHead(413)` + `res.end("payload too large")` + `req.destroy()` — before signature verification.
2. After signature + event validation: read `x-github-delivery`; respond 200 immediately; `queue.enqueue(deliveryId, () => runReview(prUrl, deps))` (module-level `new ReviewQueue()` per server instance — hold it on the closure like `deps`).
3. Keep the existing ignore/500 semantics for non-PR events and bad signatures.

`github.ts`: construct Octokit with a request timeout:

```ts
const octokit = new Octokit({ auth: token(), request: { timeout: 15_000 } });
```

(check the existing construction site — keep the DI seams untouched; the timeout is a constant of the real adapter).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run && pnpm typecheck && cd ../.. && pnpm test:run && pnpm typecheck`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/queue.ts packages/agent/src/server.ts packages/agent/src/github.ts packages/agent/test/queue.test.ts packages/agent/test/server.test.ts
git commit -m "feat: webhook hardening — 1MiB body cap, delivery dedup queue, octokit timeout"
```

---

