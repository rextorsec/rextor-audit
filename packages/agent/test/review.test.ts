import { describe, it, expect } from "vitest";
import {
  runReview,
  runAnalyzerContainer,
  type ReviewDeps,
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
// only GitHub I/O is faked (controller ruling 9).
const makeDeps = (over: Partial<ReviewDeps> = {}) => {
  const comments: Array<{ prUrl: string; body: string }> = [];
  const cloned: string[] = [];
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
  };
  return { deps: { ...deps, ...over }, comments, cloned };
};

describe("runReview", () => {
  it("docs-only diff: no comment posted, commented:false, repo never touched", async () => {
    const { deps, comments, cloned } = makeDeps({ fetchDiff: async () => DOCS_DIFF });
    const result = await runReview(PR_URL, deps);
    expect(result).toEqual({ commented: false, score: 0 });
    expect(comments).toEqual([]);
    expect(cloned).toEqual([]);
  });

  describe.skipIf(!docker)("happy path (real analyzer container on the vault fixture)", () => {
    it(
      "posts exactly one comment carrying the top finding and the score",
      { timeout: 180_000 },
      async () => {
        const { deps, comments } = makeDeps();
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
      },
    );

    it(
      "analyzer failure surfaces as an INCOMPLETE comment with the reason (never silent clean)",
      { timeout: 180_000 },
      async () => {
        // Empty temp dir → analyzer fails per SPEC-1 §1 (exit 3, incomplete report).
        const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
        const { deps, comments } = makeDeps({ clone: async () => tmp });
        const result = await runReview(PR_URL, deps);

        expect(result.commented).toBe(true);
        expect(result.incomplete).toBeTruthy();
        expect(result.score).toBe(0);
        expect(comments).toHaveLength(1);
        expect(comments[0].body).toContain("INCOMPLETE");
        // Reason from the analyzer is preserved verbatim in the comment.
        expect(comments[0].body).toContain(result.incomplete as string);
      },
    );
  });
});
