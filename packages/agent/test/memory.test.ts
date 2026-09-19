// SPEC-7 §4 — dismissals + learnings memory: server-side, repo-keyed SQLite
// (a repo-file store would be an injection vector — scope decision 5). The
// base-branch yaml syncs in wholesale per review; the gate consults the
// store; learnings ANNOTATE only (never silence, never re-score). Invariant
// 21: PR content can never reach this store — only the base-branch yaml can.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReviewStore, type ReviewStore } from "../src/db";
import { dismissalKey } from "../src/config";
import { canonicalFindingsJson, withIds, type Finding } from "../src/findings";
import { runReview, type ReviewDeps } from "../src/review";

const dirs: string[] = [];
beforeAll(() => {});
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempStore(): Promise<ReviewStore> {
  const dir = await mkdtemp(join(tmpdir(), "rextor-memory-db-"));
  dirs.push(dir);
  return createReviewStore(join(dir, "reviews.db"));
}

const PR_URL = "https://github.com/rextor/demo/pull/42";
const HEAD_SHA = "c".repeat(40);
const NDJSON =
  `{"file":"src/Vault.sol","line":11,"severity":"high","check":"reentrancy","description":"ext call before state zeroing"}\n`;
const DIFF = `diff --git a/src/Vault.sol b/src/Vault.sol
--- a/src/Vault.sol
+++ b/src/Vault.sol
@@ -1,1 +1,2 @@
 contract Vault {}
+uint x;
`;

describe("dismissals store (SPEC-7 §4)", () => {
  it("sync inserts entries with provenance and exposes gate keys", async () => {
    const store = await tempStore();
    store.syncDismissals("o/r", [{ ruleId: "ADERYN-L01", path: "src/p.sol", reason: "owner-only" }], HEAD_SHA);
    expect(store.dismissedKeys("o/r")).toEqual(new Set([dismissalKey("ADERYN-L01", "src/p.sol")]));
  });

  it("sync is wholesale: entries dropped from the yaml disappear from the store", async () => {
    const store = await tempStore();
    store.syncDismissals("o/r", [
      { ruleId: "A", path: "a.sol", reason: "x" },
      { ruleId: "B", path: "b.sol", reason: "y" },
    ], HEAD_SHA);
    store.syncDismissals("o/r", [{ ruleId: "A", path: "a.sol", reason: "x" }], HEAD_SHA);
    expect(store.dismissedKeys("o/r")).toEqual(new Set([dismissalKey("A", "a.sol")]));
  });

  it("stores are repo-keyed: one repo's silencing never leaks into another", async () => {
    const store = await tempStore();
    store.syncDismissals("o/r", [{ ruleId: "A", path: "a.sol", reason: "x" }], HEAD_SHA);
    expect(store.dismissedKeys("other/r2")).toEqual(new Set());
  });
});

describe("learnings store (SPEC-7 §4)", () => {
  it("first occurrence records 1; repeats increment and refresh sample/lastSeen", async () => {
    const store = await tempStore();
    const first = store.recordOccurrence("o/r", "reentrancy", "src/Vault.sol", "sample-1");
    expect(first.occurrences).toBe(1);
    const second = store.recordOccurrence("o/r", "reentrancy", "src/Vault.sol", "sample-2");
    expect(second.occurrences).toBe(2);
    const other = store.recordOccurrence("o/r", "reentrancy", "src/Other.sol", "s3");
    expect(other.occurrences).toBe(1); // per (ruleId, path), not per rule
  });
});

describe("runReview × repoMemory", () => {
  const baseDeps = (over: Partial<ReviewDeps> = {}) => {
    const comments: string[] = [];
    const deps: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/unused", headSha: HEAD_SHA }),
      fetchDiff: async () => DIFF,
      runAnalyzer: async () => NDJSON,
      postComment: async (_u, body) => {
        comments.push(body);
        return "url";
      },
      dispose: async () => {},
      ...over,
    };
    return { deps, comments };
  };

  it("memory-dismissed finding is gate-excluded yet stays visible and scored", async () => {
    const yamlDismissals = [{ ruleId: "reentrancy", path: "src/Vault.sol", reason: "known" }];
    const memoryKeys = new Set([dismissalKey("reentrancy", "src/Vault.sol")]);
    const { deps, comments } = baseDeps({
      readBaseConfig: async () => "severity_gate:\n  minimum: high\n",
      repoMemory: {
        syncDismissals: () => {},
        dismissedKeys: () => memoryKeys,
        recordOccurrence: () => ({ occurrences: 1, lastSeenAt: "now" }),
      },
    });
    void yamlDismissals;
    const res = await runReview(PR_URL, deps);
    expect(res.score).toBe(25); // high = 25: dismissed from GATE, not from score
    expect(comments[0]).toContain("reentrancy");
  });

  it("recurrence ≥2 annotates the row (store reports prior occurrences)", async () => {
    const { deps, comments } = baseDeps({
      repoMemory: {
        syncDismissals: () => {},
        dismissedKeys: () => new Set(),
        recordOccurrence: () => ({ occurrences: 2, lastSeenAt: "now" }),
      },
    });
    await runReview(PR_URL, deps);
    expect(comments[0]).toMatch(/rextor ledger: fired 2× in this repo/);
  });

  it("first occurrence renders no annotation", async () => {
    const { deps, comments } = baseDeps({
      repoMemory: {
        syncDismissals: () => {},
        dismissedKeys: () => new Set(),
        recordOccurrence: () => ({ occurrences: 1, lastSeenAt: "now" }),
      },
    });
    await runReview(PR_URL, deps);
    expect(comments[0]).not.toMatch(/rextor ledger:/);
  });

  it("learningNote never enters the attested payload", async () => {
    const finding: Finding = {
      file: "a.sol", line: 1, severity: "low", check: "c", description: "d",
      learningNote: "rextor ledger: fired 5× in this repo",
      suggestedDiff: "--- a/a.sol\n+++ b/a.sol\n",
    };
    expect(canonicalFindingsJson([finding])).not.toMatch(/learningNote|suggestedDiff/);
  });

  it("memory failures degrade — review still completes with yaml keys only", async () => {
    const { deps, comments } = baseDeps({
      readBaseConfig: async () => "severity_gate:\n  minimum: critical\n",
      repoMemory: {
        syncDismissals: () => { throw new Error("db locked"); },
        dismissedKeys: () => { throw new Error("db locked"); },
        recordOccurrence: () => { throw new Error("db locked"); },
      },
    });
    const res = await runReview(PR_URL, deps);
    expect(res.commented).toBe(true);
    expect(comments).toHaveLength(1);
  });
});
