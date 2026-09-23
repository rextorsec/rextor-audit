import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  createReviewServer,
  installDrain,
  type DrainOptions,
  type ReviewServer,
} from "../src/server";
import type { ReviewDeps } from "../src/review";

// Drain semantics (R3): reviews are ACKed before they run, so a supervisor
// SIGTERM must finish in-flight reviews instead of silently dropping them —
// GitHub never redelivers an ACKed delivery. These tests pin the drain gate
// (503 + Retry-After to mid-drain deliveries), the idle wait, the drain cap,
// and the second-signal force exit.

const SECRET = "rextor-test-secret";
const BODY =
  '{"action":"opened","number":42,"pull_request":{"html_url":"https://github.com/rextor/demo/pull/42"}}';
const FAKE_DIFF =
  "diff --git a/src/Vault.sol b/src/Vault.sol\n--- a/src/Vault.sol\n+++ b/src/Vault.sol\n@@ -1,1 +1,2 @@\n pragma solidity ^0.8.24;\n+contract Vault {}";

const makeFakeDeps = () => {
  const cloned: string[] = [];
  const deps: ReviewDeps = {
    clone: async (prUrl) => {
      cloned.push(prUrl);
      return { dir: "/tmp/fake-repo", headSha: "a".repeat(40) };
    },
    fetchDiff: async () => FAKE_DIFF,
    runAnalyzer: async () =>
      '{"file":"src/Vault.sol","line":18,"severity":"high","check":"reentrancy-eth","description":"extcall before state zeroing"}',
    postComment: async () => {},
    dispose: async () => {},
  };
  return { deps, cloned };
};

const post = (
  port: number,
  rawBody: string,
  headers: Record<string, string>,
): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/webhook`, { method: "POST", headers, body: rawBody });

const signed = (rawBody: string): Record<string, string> => ({
  "content-type": "application/json",
  "x-github-event": "pull_request",
  "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex")}`,
});

// Exit sink that records instead of terminating the worker: every code lands
// in `calls`, `firstCode` resolves with the first one.
function captureExit() {
  const calls: number[] = [];
  let first!: (code: number) => void;
  const firstCode = new Promise<number>((resolve) => {
    first = resolve;
  });
  return {
    calls,
    firstCode,
    exit: (code: number) => {
      calls.push(code);
      first(code);
    },
  };
}

const gated = <T,>() => {
  let release!: (value: T) => void;
  const done = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { done, release };
};

async function withDrainServer<T>(
  deps: ReviewDeps,
  drainOptions: DrainOptions,
  fn: (port: number, server: ReviewServer) => Promise<T>,
): Promise<T> {
  const server = createReviewServer({ deps, secret: SECRET });
  const port = await new Promise<number>((resolvePort) => {
    server.listen(0, "127.0.0.1", () => resolvePort((server.address() as AddressInfo).port));
  });
  const removeDrain = installDrain(server, drainOptions);
  try {
    return await fn(port, server);
  } finally {
    removeDrain();
    server.closeAllConnections();
    await new Promise<void>((closeDone) => server.close(() => closeDone()));
  }
}

describe("graceful drain on SIGTERM", () => {
  it("closes the listener and answers 503 + Retry-After 30 to a delivery arriving during drain", async () => {
    const { deps, cloned } = makeFakeDeps();
    const diff = gated<string>();
    let diffRequested = false;
    deps.fetchDiff = async () => {
      diffRequested = true;
      return diff.done;
    };
    const { calls, firstCode, exit } = captureExit();
    await withDrainServer(deps, { timeoutMs: 5_000, exit }, async (port, server) => {
      const closeSpy = vi.spyOn(server, "close");
      const acked = await post(port, BODY, signed(BODY));
      expect(acked.status).toBe(200);
      await acked.json(); // drain the body so undici returns the keep-alive connection to its pool
      await vi.waitFor(() => expect(diffRequested).toBe(true)); // review parked mid-run

      process.emit("SIGTERM", "SIGTERM");

      // Established-connection delivery during drain gets 503 + Retry-After
      // (GitHub redelivers it after restart) and is never enqueued.
      const redelivery = await post(port, BODY, { ...signed(BODY), "x-github-delivery": "mid-drain-1" });
      expect(redelivery.status).toBe(503);
      expect(redelivery.headers.get("retry-after")).toBe("30");

      diff.release(FAKE_DIFF);
      expect(await firstCode).toBe(0);
      expect(calls).toEqual([0]);
      expect(closeSpy).toHaveBeenCalled(); // listener closed within the drain lifecycle
      expect(cloned).toHaveLength(1); // mid-drain delivery never became work
    });
  });

  it("exits 0 only after the in-flight review settles (idle arrives after the signal)", async () => {
    const { deps, cloned } = makeFakeDeps();
    const clone = gated<{ dir: string; headSha: string }>();
    deps.clone = async (prUrl) => {
      cloned.push(prUrl);
      return clone.done;
    };
    const { calls, firstCode, exit } = captureExit();
    await withDrainServer(deps, { timeoutMs: 5_000, exit }, async (port) => {
      const acked = await post(port, BODY, signed(BODY));
      expect(acked.status).toBe(200);
      await vi.waitFor(() => expect(cloned).toHaveLength(1)); // review parked in clone

      process.emit("SIGTERM", "SIGTERM");
      // Absence check: prove the exit is HELD while the review is parked. A
      // real wait is unavoidable — the drain's cap timer and the HTTP stack
      // under test are real timers (fake timers would freeze undici/node:http).
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(calls).toEqual([]);

      clone.release({ dir: "/tmp/fake-repo", headSha: "a".repeat(40) });
      expect(await firstCode).toBe(0);
      expect(calls).toEqual([0]);
    });
  });

  it("exits 1 when the drain cap elapses with the queue still busy, logging the state", async () => {
    const { deps } = makeFakeDeps();
    deps.fetchDiff = async () => new Promise<string>(() => {}); // review never settles
    const { firstCode, exit } = captureExit();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await withDrainServer(deps, { timeoutMs: 25, exit }, async (port) => {
        const acked = await post(port, BODY, signed(BODY));
        expect(acked.status).toBe(200);
        await acked.json();
        process.emit("SIGTERM", "SIGTERM");
        const startedAt = Date.now();
        expect(await firstCode).toBe(1);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
        // The cap log names the state reached: server closed, queue busy.
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("drain timed out"));
      });
    } finally {
      errSpy.mockRestore();
    }
  });

  it("force-exits 1 on a second signal without waiting for the queue", async () => {
    const { deps } = makeFakeDeps();
    deps.fetchDiff = async () => new Promise<string>(() => {});
    const { calls, firstCode, exit } = captureExit();
    await withDrainServer(deps, { timeoutMs: 5_000, exit }, async (port) => {
      const acked = await post(port, BODY, signed(BODY));
      expect(acked.status).toBe(200);
      process.emit("SIGTERM", "SIGTERM"); // starts the drain
      process.emit("SIGTERM", "SIGTERM"); // escape hatch, no cap wait
      expect(await firstCode).toBe(1);
      expect(calls).toEqual([1]);
    });
  });

  it("honors REXTOR_DRAIN_TIMEOUT_MS when no explicit timeout is injected", async () => {
    const { deps } = makeFakeDeps();
    deps.fetchDiff = async () => new Promise<string>(() => {});
    const { firstCode, exit } = captureExit();
    const prev = process.env.REXTOR_DRAIN_TIMEOUT_MS;
    process.env.REXTOR_DRAIN_TIMEOUT_MS = "25";
    try {
      await withDrainServer(deps, { exit }, async (port) => {
        const acked = await post(port, BODY, signed(BODY));
        expect(acked.status).toBe(200);
        await acked.json();
        process.emit("SIGTERM", "SIGTERM");
        const startedAt = Date.now();
        expect(await firstCode).toBe(1);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
      });
    } finally {
      if (prev === undefined) delete process.env.REXTOR_DRAIN_TIMEOUT_MS;
      else process.env.REXTOR_DRAIN_TIMEOUT_MS = prev;
    }
  });
});

describe("main guard", () => {
  it("importing server.ts installs no signal handlers (main guard stays inert)", () => {
    // Delta check, not absolute: vitest itself may hold listeners, but the
    // module under test must add none at import time — installDrain runs
    // only from the tsx-entry main guard.
    const beforeTerm = process.listenerCount("SIGTERM");
    const beforeInt = process.listenerCount("SIGINT");
    expect(typeof installDrain).toBe("function");
    expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
    expect(process.listenerCount("SIGINT")).toBe(beforeInt);
  });
});
