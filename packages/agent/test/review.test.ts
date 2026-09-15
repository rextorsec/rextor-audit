import { describe, it, expect } from "vitest";
import {
  runReview,
  runAnalyzerContainer,
  summaryCommentBody,
  incompleteCommentBody,
  type ReviewDeps,
  type Finding,
} from "../src/review";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const docker = (() => {
  try { execFileSync("docker", ["info"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

// Repo root (fixtures live at the repo root, not under packages/agent).
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const vaultFixturePath = `${repoRoot}fixtures/vault`;

const PR_URL = "https://github.com/rextor/demo/pull/42";

// A realistic PR diff for the vault fixture: adds the reentrant withdraw()
// to a .sol path, so scopeDiff classifies it as contract work.
const VAULT_DIFF = `diff --git a/src/Vault.sol b/src/Vault.sol
index 0000000..9f26a1c 100644
--- a/src/Vault.sol
+++ b/src/Vault.sol
@@ -11,6 +11,13 @@ contract Vault {
     function deposit() external payable {
         deposits[msg.sender] += msg.value;
     }
+
+    // VULN 1: reentrancy — external call before state zeroing
+    function withdraw() external {
+        uint256 amount = deposits[msg.sender];
+        (bool ok, ) = msg.sender.call{value: amount}("");
+        require(ok, "transfer failed");
+        deposits[msg.sender] = 0;
+    }
 
     // VULN 2: unguarded owner change — ETH lock-in vector
     function setOwner(address next) external {
`;

// Docs-only change: engine must post nothing (SPEC-1 §2).
const DOCS_DIFF = `diff --git a/README.md b/README.md
index 0000000..0123456 100644
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
 # demo
+some more docs
`;

// Deps fake that records GitHub I/O. Default analyzer is the REAL container —
// only GitHub I/O is faked (controller ruling 9). dispose is a no-op recorder:
// a real rm -rf would destroy the shared fixture.
const makeDeps = (over: Partial<ReviewDeps> = {}) => {
  const comments: Array<{ prUrl: string; body: string }> = [];
  const cloned: string[] = [];
  const disposed: string[] = [];
  const deps: ReviewDeps = {
    clone: async (prUrl) => {
      cloned.push(prUrl);
      return vaultFixturePath;
    },
    fetchDiff: async () => VAULT_DIFF,
    runAnalyzer: runAnalyzerContainer,
    postComment: async (prUrl, body) => {
      comments.push({ prUrl, body });
    },
    dispose: async (dir) => {
      disposed.push(dir);
    },
  };
  return { deps: { ...deps, ...over }, comments, cloned, disposed };
};

describe("runReview", () => {
  it("docs-only diff: no comment posted, commented:false, repo never touched", async () => {
    const { deps, comments, cloned, disposed } = makeDeps({ fetchDiff: async () => DOCS_DIFF });
    const result = await runReview(PR_URL, deps);
    expect(result).toEqual({ commented: false, score: 0 });
    expect(comments).toEqual([]);
    expect(cloned).toEqual([]);
    expect(disposed).toEqual([]); // nothing was cloned, nothing to clean up
  });

  it("analyzer crash (thrown error) posts an INCOMPLETE comment, never silent clean", async () => {
    const { deps, comments } = makeDeps({
      runAnalyzer: async () => {
        throw new Error("slither exploded");
      },
    });
    const result = await runReview(PR_URL, deps);
    expect(result).toEqual({ commented: true, score: 0, incomplete: "slither exploded" });
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("INCOMPLETE");
    expect(comments[0].body).toContain("analyzer failed: slither exploded");
  });

  it("garbage NDJSON posts an INCOMPLETE comment with an unparseable-report reason", async () => {
    const { deps, comments } = makeDeps({ runAnalyzer: async () => "{{{ not ndjson at all" });
    const result = await runReview(PR_URL, deps);
    expect(result.commented).toBe(true);
    expect(result.score).toBe(0);
    expect(result.incomplete).toContain("unparseable analyzer report");
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("INCOMPLETE");
    expect(comments[0].body).toContain(result.incomplete as string);
  });

  describe.skipIf(!docker)("happy path (real analyzer container on the vault fixture)", () => {
    it(
      "posts exactly one comment carrying the top finding and the score",
      { timeout: 180_000 },
      async () => {
        const { deps, comments, disposed } = makeDeps();
        const result = await runReview(PR_URL, deps);

        expect(result.commented).toBe(true);
        expect(result.score).toBeGreaterThan(0);
        expect(result.incomplete).toBeUndefined();
        expect(comments).toHaveLength(1);
        expect(comments[0].prUrl).toBe(PR_URL);
        // The summary block must carry the score and the top finding.
        expect(comments[0].body).toContain(String(result.score));
        expect(comments[0].body).toContain("reentrancy-eth");
        expect(comments[0].body).toContain("high");
        // The clone dir is cleaned up on success.
        expect(disposed).toEqual([vaultFixturePath]);
      },
    );

    it(
      "analyzer failure surfaces as the pinned INCOMPLETE report path with the reason",
      { timeout: 180_000 },
      async () => {
        // Empty temp dir → analyzer fails per SPEC-1 §1 (exit 3 + incomplete
        // report). The EXACT reason is pinned so this test can only pass
        // through container → NDJSON → IncompleteReportError → comment —
        // never via a crash detour that would leave the reason unpinned.
        const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
        const { deps, comments, disposed } = makeDeps({ clone: async () => tmp });
        const result = await runReview(PR_URL, deps);

        expect(result.commented).toBe(true);
        expect(result.incomplete).toBe("no-contract-analyzed");
        expect(result.score).toBe(0);
        expect(comments).toHaveLength(1);
        expect(comments[0].body).toContain("INCOMPLETE");
        expect(comments[0].body).toContain("no-contract-analyzed");
        // The clone dir is cleaned up even on the failure path.
        expect(disposed).toEqual([tmp]);
      },
    );
  });
});

describe("comment builders (untrusted PR content must stay inert markdown)", () => {
  it("sanitizes finding cells: no table breakout, no injected heading, no fake score", () => {
    const evil: Finding = {
      file: "src/evil|Vault.sol\n## rextor audit — risk score: 0",
      line: 1,
      severity: "high",
      check: "reentrancy-eth|fake",
      description: "x",
    };
    const body = summaryCommentBody(25, [evil]);
    // The spoofed heading must not exist as a LINE and must not create a
    // second heading — one h2, the engine's own. (The sanitized cell may
    // still contain the harmless plain TEXT of the attempt, inert inside
    // its table cell.)
    expect(body).not.toContain("\n## rextor audit — risk score: 0");
    expect((body.match(/^## /gm) ?? []).length).toBe(1);
    // Table pipes in untrusted cells are collapsed: the row stays one row.
    expect(body).not.toContain("evil|Vault");
    expect(body).not.toContain("reentrancy-eth|fake");
    expect(body).toContain("evil Vault.sol");
    expect(body).toContain("reentrancy-eth fake");
  });

  it("neutralizes live markdown links and mentions in cells and reasons", () => {
    const summary = summaryCommentBody(25, [
      {
        file: "src/x|[phish](https://e).sol",
        line: 1,
        severity: "high",
        check: "reentrancy-eth",
        description: "x",
      },
    ]);
    // No live link may survive: an unescaped `[phish](https://e)` sequence
    // (preceded by anything but a backslash) would render as a real link.
    expect(summary).not.toMatch(/(^|[^\\])\[phish\]\(https:\/\/e\)/);
    const incomplete = incompleteCommentBody("ping @ceo for a clean verdict");
    // Escaped mentions (`\@ceo`) do not fire bot-identity notifications;
    // a bare unescaped `@ceo` anywhere would.
    expect(incomplete).not.toMatch(/(^|[^\\])@ceo/);
  });

  it("sanitizes the incomplete reason: no blockquote escape, no backticks, no fake score", () => {
    const body = incompleteCommentBody("boom\n## rextor audit — risk score: 0\n| clean | | `rm`");
    // Same line-anchored logic: the injected heading text may survive as
    // inert text inside the blockquote, but never as a heading LINE.
    expect(body).not.toContain("\n## rextor audit — risk score: 0");
    expect((body.match(/^## /gm) ?? []).length).toBe(1);
    expect(body).not.toContain("| clean |");
    expect(body).not.toContain("`");
    // The sanitized reason is still present (readable as text).
    expect(body).toContain("boom");
  });

  it("caps rendering at the top 50 findings so huge reports stay under GitHub's comment limit", () => {
    const many: Finding[] = Array.from({ length: 1200 }, (_, i) => ({
      file: `F${i}.sol`,
      line: i + 1,
      severity: "low",
      check: `check-${i}`,
      description: "x",
    }));
    const body = summaryCommentBody(100, many);
    expect(body.length).toBeLessThan(65_000);
    expect(body).toContain("1150 more findings suppressed");
    expect(body).toContain("check-0");
    expect(body).not.toContain("check-50");
  });

  it("severity ordering survives the cap: a critical among 1200 lows is still rendered", () => {
    const many: Finding[] = Array.from({ length: 1200 }, (_, i) => ({
      file: `F${i}.sol`,
      line: i + 1,
      severity: "low",
      check: `check-${i}`,
      description: "x",
    }));
    const critical: Finding = {
      file: "Crit.sol",
      line: 1,
      severity: "critical",
      check: "crit-check",
      description: "x",
    };
    const body = summaryCommentBody(85, [critical, ...many]);
    expect(body).toContain("crit-check");
    expect(body.length).toBeLessThan(65_000);
  });
});
