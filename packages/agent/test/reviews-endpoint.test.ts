// SPEC-6 §3 — dashboard data source: the agent-side review index (SQLite)
// written through at review settle time and served at GET /reviews/:owner/:repo
// (token-gated like the other service endpoints). The web NEVER opens this DB.
// All I/O faked or isolated to per-test temp DB files; no live network, no
// real analyzer containers (controller ruling 9).
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createReviewServer, feedbackIdle, type ReviewServer, type ReviewServerOptions } from "../src/server";
import { createReviewStore, type FeedbackReceiptRow, type ReviewRow, type ReviewStore } from "../src/db";
import { runReview, type ReviewDeps } from "../src/review";

// Logger seam: the service writes one JSON line per event to stdout; tests
// capture the raw writes and parse them.
function capture() {
  const raw: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    raw.push(String(chunk));
    return true;
  });
  function lines(): Array<Record<string, unknown>> {
    const parsed: Array<Record<string, unknown>> = [];
    for (const s of raw) {
      try {
        parsed.push(JSON.parse(s) as Record<string, unknown>);
      } catch {
        // ignore foreign stdout noise
      }
    }
    return parsed;
  }
  return { spy, raw, lines };
}

const TOKEN = "dashboard-test-token";

// Each test gets its own temp DB file — no cross-test SQLite state.
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempStore(): Promise<ReviewStore> {
  const dir = await mkdtemp(join(tmpdir(), "rextor-reviews-db-"));
  dirs.push(dir);
  return createReviewStore(join(dir, "reviews.db"));
}

const row = (over: Partial<ReviewRow>): ReviewRow => ({
  repo: "rextorsec/demo",
  pr: 1,
  head_sha: "a".repeat(40),
  review_id: "0x" + "1".repeat(64),
  chain: "tempo",
  tx_hash: "0x" + "2".repeat(64),
  explorer_url: "https://explorer.test/tx/0x" + "2".repeat(64),
  risk_score: 42,
  finding_count: 3,
  status: 0,
  comment_url: "https://github.com/rextorsec/demo/pull/1#issuecomment-1",
  created_at: "2026-09-18T00:00:00.000Z",
  ...over,
});

const get = (port: number, path: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}${path}`, { headers });

const WEBHOOK_BODY =
  '{"action":"opened","pull_request":{"html_url":"https://github.com/rextor/demo/pull/42"}}';

async function postReview(port: number, body = WEBHOOK_BODY, secret = "s"): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`,
    },
    body,
  });
}

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

// Fully-faked deps (same shape as server.test.ts) — routing/write-through
// tests pin the index, never the analyzer.
const FAKE_DIFF =
  "diff --git a/src/Vault.sol b/src/Vault.sol\n--- a/src/Vault.sol\n+++ b/src/Vault.sol\n@@ -1,1 +1,2 @@\n pragma solidity ^0.8.24;\n+contract Vault {}";

const makeFakeDeps = () => {
  const comments: string[] = [];
  const deps: ReviewDeps = {
    clone: async () => ({ dir: "/tmp/fake-repo", headSha: "b".repeat(40) }),
    fetchDiff: async () => FAKE_DIFF,
    runAnalyzer: async () =>
      '{"file":"src/Vault.sol","line":18,"severity":"high","check":"reentrancy-eth","description":"extcall before state zeroing"}',
    postComment: async (_prUrl, body) => {
      comments.push(body);
      return "https://github.com/rextor/demo/pull/42#issuecomment-99";
    },
    dispose: async () => {},
  };
  return { deps, comments };
};

describe("GET /reviews/:owner/:repo", () => {
  it("returns seeded rows sorted created_at DESC (newest first)", async () => {
    const store = await tempStore();
    store.insert(row({ pr: 1, created_at: "2026-09-18T10:00:00.000Z" }));
    store.insert(row({ pr: 3, created_at: "2026-09-18T12:00:00.000Z" }));
    store.insert(row({ pr: 2, created_at: "2026-09-18T11:00:00.000Z" }));
    store.insert(row({ repo: "other/repo", pr: 9, created_at: "2026-09-18T13:00:00.000Z" }));

    await withServer({ store, apiToken: TOKEN }, async (port) => {
      const res = await get(port, "/reviews/rextorsec/demo", { "x-api-token": TOKEN });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = (await res.json()) as { reviews: ReviewRow[] };
      expect(body.reviews.map((r) => r.pr)).toEqual([3, 2, 1]);
      expect(body.reviews[0]).toEqual(row({ pr: 3, created_at: "2026-09-18T12:00:00.000Z" }));
    });
    store.close();
  });

  it("caps the listing at 200 rows (newest kept) regardless of index size", async () => {
    const store = await tempStore();
    for (let pr = 1; pr <= 205; pr++) {
      store.insert(row({ pr, created_at: new Date(Date.UTC(2026, 8, 18, 10, pr)).toISOString() }));
    }

    await withServer({ store, apiToken: TOKEN }, async (port) => {
      const res = await get(port, "/reviews/rextorsec/demo", { "x-api-token": TOKEN });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reviews: ReviewRow[] };
      expect(body.reviews).toHaveLength(200);
      expect(body.reviews[0].pr).toBe(205);
      expect(body.reviews[199].pr).toBe(6);
    });
    store.close();
  });

  it("answers 401 without a token and with a wrong token", async () => {
    const store = await tempStore();
    await withServer({ store, apiToken: TOKEN }, async (port) => {
      expect((await get(port, "/reviews/rextorsec/demo")).status).toBe(401);
      expect(
        (await get(port, "/reviews/rextorsec/demo", { "x-api-token": "wrong" })).status,
      ).toBe(401);
    });
    store.close();
  });

  it("answers 200 with an empty list for an unknown repo", async () => {
    const store = await tempStore();
    await withServer({ store, apiToken: TOKEN }, async (port) => {
      const res = await get(port, "/reviews/nobody/nothing", { "x-api-token": TOKEN });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ reviews: [], feedback_receipts: [] });
    });
    store.close();
  });

  it("writes through the webhook review into the index (server wiring)", async () => {
    const store = await tempStore();
    const { deps } = makeFakeDeps();
    await withServer({ deps, secret: "s", store, apiToken: TOKEN }, async (port, server) => {
      expect((await postReview(port)).status).toBe(200);
      await server.idle();

      const res = await get(port, "/reviews/rextor/demo", { "x-api-token": TOKEN });
      expect(res.status).toBe(200);
      const { reviews } = (await res.json()) as { reviews: ReviewRow[] };
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({
        repo: "rextor/demo",
        pr: 42,
        head_sha: "b".repeat(40),
        risk_score: 25, // one high finding → rubric v1
        finding_count: 1,
        status: 0,
        // no attest dep → attestation skipped: empty chain/tx fields, never fakes
        chain: "",
        tx_hash: "",
        explorer_url: "",
        // fake postComment returned a URL — recorded verbatim
        comment_url: "https://github.com/rextor/demo/pull/42#issuecomment-99",
      });
    });
    store.close();
  });

  it("carries the repo's feedback receipts in the payload (newest first, repo-scoped)", async () => {
    const store = await tempStore();
    store.insert(row({ pr: 1 }));
    store.recordFeedbackReceipt({
      repo: "rextorsec/demo", pr: 1, chain: "HyperEVM mainnet",
      tx_hash: "0x" + "cd".repeat(32), explorer_url: "", created_at: "2026-10-10T12:00:00.000Z",
    });
    store.recordFeedbackReceipt({
      repo: "rextorsec/demo", pr: 1, chain: "HyperEVM mainnet",
      tx_hash: "0x" + "ab".repeat(32), explorer_url: "", created_at: "2026-10-10T10:00:00.000Z",
    });
    store.recordFeedbackReceipt({
      repo: "other/repo", pr: 9, chain: "Ethereum",
      tx_hash: "0x" + "ee".repeat(32), explorer_url: "", created_at: "2026-10-10T13:00:00.000Z",
    });

    await withServer({ store, apiToken: TOKEN }, async (port) => {
      const res = await get(port, "/reviews/rextorsec/demo", { "x-api-token": TOKEN });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reviews: ReviewRow[]; feedback_receipts: FeedbackReceiptRow[] };
      expect(body.reviews).toHaveLength(1);
      expect(body.feedback_receipts.map((r) => r.tx_hash)).toEqual([
        "0x" + "cd".repeat(32),
        "0x" + "ab".repeat(32),
      ]);
      expect(body.feedback_receipts[0]).toEqual({
        repo: "rextorsec/demo",
        pr: 1,
        chain: "HyperEVM mainnet",
        tx_hash: "0x" + "cd".repeat(32),
        explorer_url: "",
        created_at: "2026-10-10T12:00:00.000Z",
      });
    });
    store.close();
  });
});

// R2 — the settle point writes a feedback_receipts row ONLY for a CONFIRMED
// broadcast outcome; skips, failures, and store-less servers record nothing
// and never break the settled review.
describe("feedback settle receipts (R2)", () => {
  const attestedDeps = (feedback: NonNullable<ReviewDeps["feedback"]>): ReviewDeps => {
    const { deps } = makeFakeDeps();
    deps.attest = async () => ({ txHash: "0xabc", explorerUrl: "" });
    deps.feedback = feedback;
    return deps;
  };

  async function settleAndReadReceipts(
    deps: ReviewDeps,
    store?: ReviewStore,
  ): Promise<{ reviews: number; receipts: FeedbackReceiptRow[] }> {
    return withServer({ deps, secret: "s", store, apiToken: TOKEN }, async (port, server) => {
      expect((await postReview(port)).status).toBe(200);
      await server.idle();
      await feedbackIdle(); // the receipt write rides the tracked broadcast
      const res = await get(port, "/reviews/rextor/demo", { "x-api-token": TOKEN });
      const body = (await res.json()) as { reviews: ReviewRow[]; feedback_receipts: FeedbackReceiptRow[] };
      return { reviews: body.reviews.length, receipts: body.feedback_receipts };
    });
  }

  it("a confirmed outcome records exactly one receipt with the review's repo/pr", async () => {
    const store = await tempStore();
    try {
      const txHash = "0x" + "cd".repeat(32);
      const deps = attestedDeps(async () => ({ txHash, explorerUrl: "" }));
      const { reviews, receipts } = await settleAndReadReceipts(deps, store);
      expect(reviews).toBe(1);
      expect(receipts).toEqual([
        {
          repo: "rextor/demo",
          pr: 42,
          chain: "Ethereum", // feedbackConfig default — test env sets no REXTOR_FEEDBACK_CHAIN
          tx_hash: txHash,
          explorer_url: "",
          created_at: expect.any(String),
        },
      ]);
    } finally {
      store.close();
    }
  });

  it("a skipped outcome records nothing — the review row is unaffected", async () => {
    const store = await tempStore();
    try {
      const deps = attestedDeps(async () => ({ skipped: "submitter is the agent NFT owner (self-feedback rule)" }));
      const { reviews, receipts } = await settleAndReadReceipts(deps, store);
      expect(reviews).toBe(1);
      expect(receipts).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("a failing feedback dep records no receipt and never breaks the settled review", async () => {
    const store = await tempStore();
    const log = capture();
    try {
      const deps = attestedDeps(async () => {
        throw new Error("rpc unreachable");
      });
      const { reviews, receipts } = await settleAndReadReceipts(deps, store);
      expect(reviews).toBe(1);
      expect(receipts).toEqual([]);
      const logged = log.lines().filter((l) => l.event === "chain.feedback_failed");
      expect(logged).toHaveLength(1);
      expect(logged[0].msg).toBe("feedback failed:");
      expect(logged[0].err).toMatchObject({ name: "Error", message: "rpc unreachable" });
    } finally {
      log.spy.mockRestore();
      store.close();
    }
  });

  it("a confirmed outcome without an index store settles cleanly (receipt is best-effort)", async () => {
    const deps = attestedDeps(async () => ({ txHash: "0x" + "cd".repeat(32), explorerUrl: "" }));
    // No store: the receipt write is skipped, the settle path never crashes.
    await withServer({ deps, secret: "s", apiToken: TOKEN }, async (port, server) => {
      expect((await postReview(port)).status).toBe(200);
      await server.idle();
      await feedbackIdle();
    });
  });
});

describe("runReview write-through (review index rows)", () => {
  const attestDiff = FAKE_DIFF;

  const baseDeps = (over: Partial<ReviewDeps>, rows: ReviewRow[]): ReviewDeps => ({
    clone: async () => ({ dir: "/tmp/fake", headSha: "c".repeat(40) }),
    fetchDiff: async () => attestDiff,
    runAnalyzer: async () =>
      '{"file":"src/Vault.sol","line":18,"severity":"high","check":"reentrancy-eth","description":"extcall before state zeroing"}',
    postComment: async () => "https://github.com/o/r/pull/7#issuecomment-7",
    dispose: async () => {},
    recordReview: (r) => {
      rows.push(r);
    },
    ...over,
  });

  it("records a complete row with attestation tx fields and the comment URL", async () => {
    const rows: ReviewRow[] = [];
    const deps = baseDeps(
      { attest: async () => ({ txHash: "0xabc", explorerUrl: "https://explorer.test/tx/0xabc" }) },
      rows,
    );
    const res = await runReview("https://github.com/o/r/pull/7", deps);
    expect(res.incomplete).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      repo: "o/r",
      pr: 7,
      head_sha: "c".repeat(40),
      risk_score: 25,
      finding_count: 1,
      status: 0,
      chain: (res.attestation as { chain: string }).chain,
      tx_hash: "0xabc",
      explorer_url: "https://explorer.test/tx/0xabc",
      comment_url: "https://github.com/o/r/pull/7#issuecomment-7",
    });
    expect(rows[0].created_at).toBeTruthy();
  });

  it("records an incomplete row (status 1, score 0) when the analyzer fails", async () => {
    const rows: ReviewRow[] = [];
    const deps = baseDeps({ runAnalyzer: async () => { throw new Error("docker gone"); } }, rows);
    const res = await runReview("https://github.com/o/r/pull/7", deps);
    expect(res.incomplete).toContain("docker gone");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 1, risk_score: 0, finding_count: 0, comment_url: "https://github.com/o/r/pull/7#issuecomment-7" });
  });

  it("records empty tx/chain fields when attestation is skipped or fails", async () => {
    const rows: ReviewRow[] = [];
    // no attest dep at all → "not configured" skip
    await runReview("https://github.com/o/r/pull/7", baseDeps({}, rows));
    // attest dep present but returns null → "attempt failed" skip
    await runReview("https://github.com/o/r/pull/7", baseDeps({ attest: async () => null }, rows));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.chain).toBe("");
      expect(r.tx_hash).toBe("");
      expect(r.explorer_url).toBe("");
      expect(r.status).toBe(0);
    }
  });

  it("does not record a row when the diff has no contract changes (no comment, no attest)", async () => {
    const rows: ReviewRow[] = [];
    const deps = baseDeps({ fetchDiff: async () => "diff --git a/README.md b/README.md\n+hello" }, rows);
    const res = await runReview("https://github.com/o/r/pull/7", deps);
    expect(res.commented).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("a throwing index write never fails the settled review", async () => {
    const deps = baseDeps({ recordReview: () => { throw new Error("disk full"); } }, []);
    const res = await runReview("https://github.com/o/r/pull/7", deps);
    expect(res.commented).toBe(true);
    expect(res.score).toBe(25);
  });
});

describe("GET /dismissals/:owner/:repo (dashboard v2)", () => {
  const entry = (over: Partial<{ ruleId: string; path: string }> = {}) => ({
    ruleId: "ADERYN-L01",
    path: "src/peripheral.sol",
    reason: "owner-confirmed safe — access-controlled",
    ...over,
  });

  it("serves the repo's synced dismissal memory as plain rows", async () => {
    const store = await tempStore();
    store.syncDismissals("rextorsec/demo", [entry(), entry({ ruleId: "SLITHER-X", path: "src/core.sol" })], "b".repeat(40));
    await withServer({ store, apiToken: TOKEN }, async (port) => {
      const res = await get(port, "/dismissals/rextorsec/demo", { "x-api-token": TOKEN });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        dismissals: [
          { rule_id: "ADERYN-L01", path: "src/peripheral.sol" },
          { rule_id: "SLITHER-X", path: "src/core.sol" },
        ],
      });
    });
    store.close();
  });

  it("answers 401 without or with a wrong token", async () => {
    const store = await tempStore();
    await withServer({ store, apiToken: TOKEN }, async (port) => {
      expect((await get(port, "/dismissals/rextorsec/demo")).status).toBe(401);
      expect((await get(port, "/dismissals/rextorsec/demo", { "x-api-token": "wrong" })).status).toBe(401);
    });
    store.close();
  });

  it("unknown repo → 200 { dismissals: [] } (zero state, not an error)", async () => {
    const store = await tempStore();
    await withServer({ store, apiToken: TOKEN }, async (port) => {
      const res = await get(port, "/dismissals/nobody/nothing", { "x-api-token": TOKEN });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ dismissals: [] });
    });
    store.close();
  });

  it("reflects yaml-sync removals — the synced store IS the truth", async () => {
    const store = await tempStore();
    store.syncDismissals("rextorsec/demo", [entry()], "b".repeat(40));
    store.syncDismissals("rextorsec/demo", [], "c".repeat(40));
    expect(store.listDismissals("rextorsec/demo")).toEqual([]);
    store.close();
  });
});
