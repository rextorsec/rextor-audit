import { describe, expect, it, vi } from "vitest";
import { ReviewQueue } from "../src/queue";

// Executor-form deferred: `Promise.withResolvers` is ES2024-lib and does not
// typecheck under this project's ES2022 target.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Deterministic microtask flush: drains every pending queue hop (segment
// chaining runs a bounded number of microtasks) without wall-clock timers.
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("ReviewQueue", () => {
  it("runs enqueued work sequentially in order", async () => {
    const q = new ReviewQueue();
    const events: string[] = [];
    const gates = [deferred(), deferred(), deferred()];
    const gated =
      (n: number) => async () => {
        events.push(`start-${n}`);
        await gates[n - 1]!.promise;
        events.push(`end-${n}`);
      };
    const p1 = q.enqueue("a", gated(1));
    const p2 = q.enqueue("b", gated(2));
    const p3 = q.enqueue("c", gated(3));
    await flush();
    expect(events).toEqual(["start-1"]); // b and c parked behind a
    gates[0].resolve();
    await p1;
    await flush();
    expect(events).toEqual(["start-1", "end-1", "start-2"]); // b only after a ended
    gates[1].resolve();
    await p2;
    await flush();
    expect(events).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3"]);
    gates[2].resolve();
    await Promise.all([p1, p2, p3]);
    expect(events).toEqual([
      "start-1",
      "end-1",
      "start-2",
      "end-2",
      "start-3",
      "end-3",
    ]);
  });

  it("skips a duplicate deliveryId entirely (in-flight and after completion)", async () => {
    const q = new ReviewQueue();
    const run = vi.fn(async () => {});
    await q.enqueue("d1", run);
    await q.enqueue("d1", run);
    expect(run).toHaveBeenCalledTimes(1);
    // In-flight dedup: d2's run never settles, so its enqueue promise is
    // deliberately not awaited (awaiting a never-settling run would deadlock
    // the test); dedup registration is synchronous, so the duplicate below is
    // deterministically skipped whether or not d2 has started.
    void q.enqueue("d2", () => new Promise<void>(() => {}));
    await q.enqueue("d2", run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("worker errors are contained (enqueue still resolves)", async () => {
    const q = new ReviewQueue();
    await expect(q.enqueue("e", async () => { throw new Error("boom"); })).resolves.toBeUndefined();
  });

  it("idle() resolves only after queued work drains", async () => {
    const q = new ReviewQueue();
    await q.idle(); // empty queue drains trivially
    const done: string[] = [];
    const gate = deferred();
    const p = q.enqueue("x", async () => {
      await gate.promise;
      done.push("x");
    });
    let idleResolved = false;
    const idle = q.idle().then(() => {
      idleResolved = true;
    });
    await flush();
    expect(idleResolved).toBe(false); // parked run keeps idle() pending
    gate.resolve();
    await idle;
    expect(done).toEqual(["x"]);
    await p;
  });

  it("logs lifecycle and warns on stall (observability rail)", async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const q = new ReviewQueue({ stallWarnMs: 10_000 });
      const label = "https://github.com/o/r/pull/9";
      const gate = deferred();
      const done = q.enqueue(
        "obs-1",
        async () => {
          await gate.promise;
        },
        label,
      );
      await flush();
      expect(logSpy.mock.calls.map((c) => String(c[0])).some((s) => s === `[rextor] review started: ${label}`)).toBe(true);
      // Advance past one warn interval on the fake clock; the interval callback
      // must have fired — the rail that would have surfaced the 2026-09-22
      // silent-hang incident (a stuck run starved every later review).
      await vi.advanceTimersByTimeAsync(10_000);
      expect(errSpy.mock.calls.map((c) => String(c[0])).some((s) => s.includes("review STILL RUNNING after") && s.includes(label))).toBe(true);
      gate.resolve();
      await done;
      expect(logSpy.mock.calls.map((c) => String(c[0])).some((s) => s.includes(`[rextor] review finished: ${label}`))).toBe(true);
    } finally {
      vi.useRealTimers();
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
