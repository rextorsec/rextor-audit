import { afterAll, describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  createReviewServer,
  verifySignature,
  type ReviewServer,
  type ReviewServerOptions,
} from "../src/server";
import { MAX_BODY_BYTES } from "../src/queue";
import type { ReviewDeps } from "../src/review";
import { createReviewStore, type ReviewRow, type ReviewStore } from "../src/db";

// Fixed HMAC-SHA256 vector (SPEC-1 §4) — body + secret signed with
// `node -e "console.log('sha256=' + require('node:crypto').createHmac('sha256','rextor-test-secret').update(BODY,'utf8').digest('hex'))"`.
const SECRET = "rextor-test-secret";
const BODY =
  '{"action":"opened","number":42,"pull_request":{"html_url":"https://github.com/rextor/demo/pull/42"}}';
const SIGNATURE =
  "sha256=e4045342a62304e2e5bc28904e8924e943ade7b032219c0a9b0e36dbd86d2ebe";

describe("verifySignature", () => {
  it("accepts the fixed HMAC-SHA256 vector", () => {
    expect(verifySignature(BODY, SIGNATURE, SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifySignature(`${BODY} `, SIGNATURE, SECRET)).toBe(false);
  });
  it("rejects a wrong prefix", () => {
    expect(verifySignature(BODY, `sha1=${SIGNATURE.slice("sha256=".length)}`, SECRET)).toBe(false);
  });
  it("rejects a signature computed with a different secret", () => {
    expect(verifySignature(BODY, SIGNATURE, "other-secret")).toBe(false);
  });
  it("rejects a malformed signature hex", () => {
    expect(verifySignature(BODY, "sha256=zzzz", SECRET)).toBe(false);
  });
});

const FAKE_DIFF =
  "diff --git a/src/Vault.sol b/src/Vault.sol\n--- a/src/Vault.sol\n+++ b/src/Vault.sol\n@@ -1,1 +1,2 @@\n pragma solidity ^0.8.24;\n+contract Vault {}";

// Fully-faked deps — the server tests pin routing/auth, not the analyzer.
const makeFakeDeps = () => {
  const comments: string[] = [];
  const cloned: string[] = [];
  const deps: ReviewDeps = {
    clone: async (prUrl) => {
      cloned.push(prUrl);
      return { dir: "/tmp/fake-repo", headSha: "a".repeat(40) };
    },
    fetchDiff: async () => FAKE_DIFF,
    runAnalyzer: async () =>
      '{"file":"src/Vault.sol","line":18,"severity":"high","check":"reentrancy-eth","description":"extcall before state zeroing"}',
    postComment: async (_prUrl, body) => {
      comments.push(body);
    },
    dispose: async () => {},
  };
  return { deps, comments, cloned };
};

const post = (
  port: number,
  rawBody: string,
  headers: Record<string, string>,
): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/webhook`, { method: "POST", headers, body: rawBody });

const signed = (rawBody: string, secret: string): Record<string, string> => ({
  "content-type": "application/json",
  "x-github-event": "pull_request",
  "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`,
});

async function withServer<T>(
  opts: ReviewServerOptions,
  fn: (port: number, server: ReviewServer) => Promise<T>,
): Promise<T> {
  const server = createReviewServer(opts);
  const port = await new Promise<number>((resolvePort) => {
    server.listen(0, "127.0.0.1", () => resolvePort((server.address() as AddressInfo).port));
  });
  try {
    return await fn(port, server);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((closeDone) => server.close(() => closeDone()));
  }
}

describe("webhook endpoint", () => {
  it("accepts a signed pull_request.opened, queues it, and runs exactly one review + comment", async () => {
    const { deps, comments, cloned } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      const res = await post(port, BODY, signed(BODY, SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ queued: true });
      await server.idle(); // drain the async review before asserting effects
    });
    expect(comments).toHaveLength(1);
    expect(cloned).toEqual(["https://github.com/rextor/demo/pull/42"]);
  });

  it("accepts pull_request.synchronize", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      const body = BODY.replace('"opened"', '"synchronize"');
      const res = await post(port, body, signed(body, SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ queued: true });
      await server.idle(); // drain the async review before asserting effects
    });
    expect(comments).toHaveLength(1);
  });

  it("ignores pull_request actions outside opened/synchronize (200, no work)", async () => {
    const { deps, comments, cloned } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const body = BODY.replace('"opened"', '"closed"');
      const res = await post(port, body, signed(body, SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
    });
    expect(comments).toEqual([]);
    expect(cloned).toEqual([]);
  });

  it("ignores non-pull_request events (200, no work)", async () => {
    const { deps, comments, cloned } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, BODY, { ...signed(BODY, SECRET), "x-github-event": "push" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
    });
    expect(comments).toEqual([]);
    expect(cloned).toEqual([]);
  });

  it("rejects a missing signature header with 401 and does no work", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, BODY, {
        "content-type": "application/json",
        "x-github-event": "pull_request",
      });
      expect(res.status).toBe(401);
    });
    expect(comments).toEqual([]);
  });

  it("rejects an invalid signature with 401 and does no work", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, `${BODY} `, signed(BODY, SECRET));
      expect(res.status).toBe(401);
    });
    expect(comments).toEqual([]);
  });

  it("rejects a malformed JSON body with 400 even under a valid signature", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, "not-json", signed("not-json", SECRET));
      expect(res.status).toBe(400);
    });
    expect(comments).toEqual([]);
  });

  it("rejects a pull_request event missing the pull_request object with 400", async () => {
    const { deps } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const body = '{"action":"opened"}';
      const res = await post(port, body, signed(body, SECRET));
      expect(res.status).toBe(400);
    });
  });

  it("fails closed with 500 when no secret is configured (no 401 masquerade)", async () => {
    const prev = process.env.GITHUB_APP_SECRET;
    delete process.env.GITHUB_APP_SECRET;
    try {
      const { deps, comments } = makeFakeDeps();
      await withServer({ deps }, async (port) => {
        const res = await post(port, BODY, signed(BODY, SECRET));
        expect(res.status).toBe(500);
      });
      expect(comments).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.GITHUB_APP_SECRET = prev;
    }
  });

  it("treats a correctly signed null body as ignorable, not a crash", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const res = await post(port, "null", signed("null", SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
    });
    expect(comments).toEqual([]);
  });
});

describe("hardening", () => {
  it("413s a body larger than 1 MiB before any signature work", async () => {
    const { deps, comments, cloned } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      // Garbage signature: any signature work would answer 401, so a 413
      // proves the cap rejected the payload before verification ran.
      const big = "x".repeat(MAX_BODY_BYTES + 1);
      const res = await post(port, big, {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=deadbeef",
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: "payload too large" });
    });
    expect(comments).toEqual([]);
    expect(cloned).toEqual([]);
  });

  it("accepts a body exactly at the 1 MiB cap (cap boundary proceeds to signature+parse)", async () => {
    const { deps, comments } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port) => {
      const big = "x".repeat(MAX_BODY_BYTES); // validly signed, not valid JSON
      const res = await post(port, big, signed(big, SECRET));
      // 400 (malformed JSON) — past the cap AND past the signature check.
      expect(res.status).toBe(400);
    });
    expect(comments).toEqual([]);
  });

  it("duplicate X-GitHub-Delivery triggers exactly one review", async () => {
    const { deps, comments, cloned } = makeFakeDeps();
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      const headers = { ...signed(BODY, SECRET), "x-github-delivery": "delivery-42" };
      const [r1, r2] = await Promise.all([post(port, BODY, headers), post(port, BODY, headers)]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      await server.idle();
    });
    expect(cloned).toEqual(["https://github.com/rextor/demo/pull/42"]);
    expect(comments).toHaveLength(1);
  });

  it("responds 200 before the review completes (queued, async)", async () => {
    const { deps, comments } = makeFakeDeps();
    let releaseDiff!: () => void;
    const diffGate = new Promise<void>((resolve) => {
      releaseDiff = resolve;
    });
    deps.fetchDiff = async () => {
      await diffGate; // park the review's very first step
      return FAKE_DIFF;
    };
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      const res = await post(port, BODY, signed(BODY, SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ queued: true });
      expect(comments).toEqual([]); // review still parked — response already out
      releaseDiff();
      await server.idle();
    });
    expect(comments).toHaveLength(1);
  });
});

describe("R2 feedback settle wiring", () => {
  // Fake deps + a settled ATTESTED review — the exact evidence (findingsURI +
  // findingsHash from the attestation) must ride the feedback record.
  const attestedDeps = () => {
    const { deps } = makeFakeDeps();
    deps.attest = async () => ({ txHash: "0xabc", explorerUrl: "" });
    return deps;
  };

  it("invokes feedback exactly once after a review settles with a successful attestation", async () => {
    const deps = attestedDeps();
    const calls: Array<{ record: { findingsURI: string; findingsHash?: string }; repo: string }> = [];
    deps.feedback = async (record, repo) => {
      calls.push({ record, repo });
      return { txHash: "0xfdb", explorerUrl: "" };
    };
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      const res = await post(port, BODY, signed(BODY, SECRET));
      expect(res.status).toBe(200);
      await server.idle(); // feedback fires AFTER the settle point
      await vi.waitFor(() => expect(calls).toHaveLength(1));
    });
    expect(calls[0].repo).toBe("rextor/demo");
    // No pin dep → degraded findingsURI ""; findingsHash is the attested sha256.
    expect(calls[0].record.findingsURI).toBe("");
    expect(calls[0].record.findingsHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("attestation skipped → feedback skipped with a reason, never invoked", async () => {
    const { deps } = makeFakeDeps(); // no attest dep → { skipped } attestation
    const calls: unknown[] = [];
    deps.feedback = async (record, repo) => {
      calls.push({ record, repo });
      return { txHash: "0xfdb", explorerUrl: "" };
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await withServer({ deps, secret: SECRET }, async (port, server) => {
      await post(port, BODY, signed(BODY, SECRET));
      await server.idle();
    });
    expect(calls).toEqual([]); // NEVER feedback without an attested artifact
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/feedback skipped: no attested artifact/));
  });

  it("flag unset → undefined-dependency path records the exact disabled reason", async () => {
    const prevFlag = process.env.REXTOR_AUTO_FEEDBACK;
    delete process.env.REXTOR_AUTO_FEEDBACK;
    try {
      const deps = attestedDeps(); // attested review, no feedback dep at all
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await withServer({ deps, secret: SECRET }, async (port, server) => {
        await post(port, BODY, signed(BODY, SECRET));
        await server.idle();
      });
      expect(log).toHaveBeenCalledWith(
        "[rextor] feedback skipped: auto-feedback disabled (REXTOR_AUTO_FEEDBACK off)",
      );
    } finally {
      if (prevFlag !== undefined) process.env.REXTOR_AUTO_FEEDBACK = prevFlag;
    }
  });

  it("hard-incomplete-but-attested review → feedback withheld (I2)", async () => {
    // The analyzer crashed AFTER clone, so the review attested status=1 with
    // the empty-findings payload. An ERC-8004 broadcast here would publish a
    // 95/100 rating whose feedbackHash is the empty-findings constant — on a
    // permanent public ledger, indistinguishable from a complete audit.
    const { deps } = makeFakeDeps();
    deps.runAnalyzer = async () => {
      throw new Error("slither crashed");
    };
    deps.attest = async () => ({ txHash: "0xabc", explorerUrl: "" });
    const calls: unknown[] = [];
    deps.feedback = async (record, repo) => {
      calls.push({ record, repo });
      return { txHash: "0xfdb", explorerUrl: "" };
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await withServer({ deps, secret: SECRET }, async (port, server) => {
        await post(port, BODY, signed(BODY, SECRET));
        await server.idle();
      });
      expect(calls).toEqual([]); // incomplete reviews earn NO feedback
      expect(log).toHaveBeenCalledWith(
        "[rextor] feedback skipped: review incomplete — feedback withheld",
      );
    } finally {
      log.mockRestore();
    }
  });
});

describe("C1 re-drive dedup guard", () => {
  // GitHub does not auto-redeliver failed deliveries; boot-time reconciliation
  // re-drives them. A re-driven delivery replays through the normal webhook
  // path with its ORIGINAL payload — and the ACKed review it belongs to may
  // already sit in the persistent index (ACKed-then-crashed). The index is
  // keyed (repo, pr, headSha): present → skip the enqueue, answer 200 so the
  // redelivery is marked OK. In-memory delivery dedup is fresh at boot, so
  // THIS guard is the duplicate-review protection.
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });
  async function tempStore(): Promise<ReviewStore> {
    const dir = await mkdtemp(join(tmpdir(), "rextor-guard-db-"));
    dirs.push(dir);
    return createReviewStore(join(dir, "reviews.db"));
  }
  const row = (over: Partial<ReviewRow>): ReviewRow => ({
    repo: "rextor/demo",
    pr: 42,
    head_sha: "b".repeat(40),
    review_id: "0x" + "1".repeat(64),
    chain: "tempo",
    tx_hash: "",
    explorer_url: "",
    risk_score: 3,
    finding_count: 1,
    status: 0,
    comment_url: "",
    created_at: "2026-09-23T00:00:00.000Z",
    ...over,
  });
  const SHA = "b".repeat(40);
  const BODY_SHA = JSON.stringify({
    action: "opened",
    number: 42,
    pull_request: { html_url: "https://github.com/rextor/demo/pull/42", head: { sha: SHA } },
  });

  it("an already-reviewed (repo, pr, headSha) is answered skipped and never re-reviewed", async () => {
    const { deps, cloned } = makeFakeDeps();
    const store = await tempStore();
    store.insert(row({}));
    try {
      await withServer({ deps, secret: SECRET, store }, async (port, server) => {
        const res = await post(port, BODY_SHA, signed(BODY_SHA, SECRET));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ skipped: "already reviewed" });
        await server.idle();
        expect(cloned).toEqual([]); // the guard, not the queue, stopped the duplicate
      });
    } finally {
      store.close();
    }
  });

  it("a NEW head sha on the same PR reviews normally", async () => {
    const { deps, cloned } = makeFakeDeps();
    const store = await tempStore();
    store.insert(row({ head_sha: "c".repeat(40) })); // old sha indexed, delivery carries a new one
    try {
      await withServer({ deps, secret: SECRET, store }, async (port, server) => {
        const res = await post(port, BODY_SHA, signed(BODY_SHA, SECRET));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ queued: true });
        await server.idle();
        expect(cloned).toEqual(["https://github.com/rextor/demo/pull/42"]);
      });
    } finally {
      store.close();
    }
  });

  it("a payload without head.sha cannot be guarded — normal enqueue (fail-open)", async () => {
    const { deps, cloned } = makeFakeDeps();
    const store = await tempStore();
    store.insert(row({})); // same (repo, pr) already indexed
    try {
      await withServer({ deps, secret: SECRET, store }, async (port, server) => {
        const res = await post(port, BODY, signed(BODY, SECRET));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ queued: true });
        await server.idle();
        expect(cloned).toEqual(["https://github.com/rextor/demo/pull/42"]);
      });
    } finally {
      store.close();
    }
  });
});
