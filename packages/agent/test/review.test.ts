import { afterEach, describe, it, expect, vi } from "vitest";
import {
  runReview,
  runAnalyzerContainer,
  summaryCommentBody,
  incompleteCommentBody,
  type ReviewDeps,
  type Finding,
} from "../src/review";
import type { AttestRecord } from "../src/attest";
import { EMPTY_FINDINGS_SHA256 } from "./vectors";
import { rawFindingsResult } from "../src/triage";
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
// Fake PR head sha for clone fakes — 40-hex so the attestation record builder accepts it.
const HEAD_SHA = "a".repeat(40);

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
      return { dir: vaultFixturePath, headSha: HEAD_SHA };
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
    expect(result).toEqual({
      commented: true,
      score: 0,
      incomplete: "slither exploded",
      attestation: { skipped: "attestation not configured" },
    });
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
        const { deps, comments, disposed } = makeDeps({ clone: async () => ({ dir: tmp, headSha: HEAD_SHA }) });
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
    const body = summaryCommentBody(25, rawFindingsResult([evil]));
    // The spoofed heading must not exist as a LINE and must not create a
    // second heading — one h2, the engine's own. (The sanitized cell may
    // still contain the harmless plain TEXT of the attempt, inert inside
    // its table cell.)
    expect(body).not.toContain("\n## rextor audit — risk score: 0");
    expect((body.match(/^## /gm) ?? []).length).toBe(1);
    // Table pipes in untrusted cells are collapsed: the rendered markdown
    // (everything above the attested JSON fence) stays one row per finding.
    // The canonical JSON block re-publishes untrusted strings VERBATIM —
    // inert inside the fence — so the findingsHash stays recomputable.
    const rendered = body.slice(0, body.indexOf("<details>"));
    expect(rendered).not.toContain("evil|Vault");
    expect(rendered).not.toContain("reentrancy-eth|fake");
    expect(rendered).toContain("evil Vault.sol");
    expect(rendered).toContain("reentrancy-eth fake");
  });

  it("neutralizes live markdown links and mentions in cells and reasons", () => {
    const summary = summaryCommentBody(25, rawFindingsResult([
      {
        file: "src/x|[phish](https://e).sol",
        line: 1,
        severity: "high",
        check: "reentrancy-eth",
        description: "x",
      },
    ]));
    // No live link may survive in the rendered markdown: an unescaped
    // `[phish](https://e)` sequence (preceded by anything but a backslash)
    // would render as a real link. The JSON fence is exempt by design.
    const rendered = summary.slice(0, summary.indexOf("<details>"));
    expect(rendered).not.toMatch(/(^|[^\\])\[phish\]\(https:\/\/e\)/);
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
    const body = summaryCommentBody(100, rawFindingsResult(many));
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
    const body = summaryCommentBody(85, rawFindingsResult([critical, ...many]));
    expect(body).toContain("crit-check");
    expect(body.length).toBeLessThan(65_000);
  });
});

describe("runReview sim integration (SPEC-3)", () => {
  // fakeDeps pattern (triage-pipeline.test.ts): every I/O seam faked, the REAL
  // pipeline runs. runReview reads process.env at call time, so the fork env
  // is stubbed per test — hermetic regardless of the runner's own env.
  const criticalNdjson = JSON.stringify({
    file: "src/Vault.sol", line: 16, severity: "critical", check: "reentrancy-eth", description: "drain",
  });
  const pocSource = "contract RextorPocTest { function testRextorPoc_0() public {} }";

  const simDeps = (over: Partial<ReviewDeps> = {}) => {
    const comments: string[] = [];
    const deps: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/fake", headSha: HEAD_SHA }),
      fetchDiff: async () => "diff --git a/src/Vault.sol b/src/Vault.sol\n@@ -16,1 +16,1 @@\n+x",
      runAnalyzer: async () => criticalNdjson,
      postComment: async (_prUrl, body) => { comments.push(body); },
      dispose: async () => {},
      ...over,
    };
    return { deps, comments };
  };

  const identityTriage = async (findings: Finding[]) => ({
    finalFindings: findings, ops: [], rejectedOps: [], modelUsed: "vendor/m", triageStatus: "complete" as const,
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it("attaches a runnable PoC block for confirmed criticals and a sim line", async () => {
    vi.stubEnv("REXTOR_FORK_RPC_URL", "https://fork.example");
    const { deps, comments } = simDeps({
      triage: identityTriage,
      generatePoc: async () => pocSource,
      runSim: async () => ({ block: 77, results: { testRextorPoc_0: true } }),
    });
    const res = await runReview(PR_URL, deps);
    const body = comments[0];
    expect(res.commented).toBe(true);
    // rubric v1: critical with a CONFIRMED PoC keeps its 60 (only unproven downgrades).
    expect(res.score).toBe(60);
    // The row labels the proof status; the sim line records the fork block.
    expect(body).toContain("[poc:confirmed]");
    expect(body).toContain("block 77");
    // The runnable PoC renders collapsed inside a 4-backtick fence.
    expect(body).toContain("<details><summary>Runnable PoC — finding #0 (Foundry)</summary>");
    expect(body).toContain("````solidity");
    expect(body).toContain(pocSource);
    expect(body).toContain("1 confirmed");
  });

  it("skipped sim (no env) → note line, no PoC block, critical stays 60", async () => {
    vi.stubEnv("REXTOR_FORK_RPC_URL", "");
    const { deps, comments } = simDeps({ triage: identityTriage });
    const res = await runReview(PR_URL, deps);
    expect(res.commented).toBe(true);
    expect(res.score).toBe(60); // critical skipped → no rubric change
    expect(comments[0]).toContain("Fork-sim skipped: no fork configured");
    expect(comments[0]).toContain("[poc:skipped]");
    expect(comments[0]).not.toContain("Runnable PoC");
    expect(comments[0]).not.toContain("````solidity");
  });
});

describe("runReview attestation integration (SPEC-4 §3)", () => {
  const findings0 = JSON.stringify({ file: "src/V.sol", line: 10, severity: "high", check: "c", description: "d" });
  const attestDiff = "diff --git a/src/V.sol b/src/V.sol\n@@ -1 +1 @@\n+x";

  it("attests BEFORE commenting and renders the footer with tx + reviewId", async () => {
    const calls: string[] = [];
    const bodies: string[] = [];
    const deps: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/fake", headSha: HEAD_SHA }),
      fetchDiff: async () => attestDiff,
      runAnalyzer: async () => findings0,
      triage: undefined,
      postComment: async (_u, body) => { calls.push("comment:" + body.slice(0, 40)); bodies.push(body); },
      dispose: async () => {},
      attest: async (rec) => {
        calls.push("attest:" + rec.reviewId.slice(0, 10));
        return { txHash: "0xabc", explorerUrl: "https://explorer.example/tx/0xabc" };
      },
    };
    const res = await runReview("https://github.com/o/r/pull/3", deps);
    expect(calls[0]).toMatch(/^attest:/); // attest precedes comment
    expect(calls[1]).toMatch(/^comment:/);
    expect(res.attestation).toMatchObject({ txHash: "0xabc" });
    // The footer (appended to the summary body) carries chain, reviewId and the tx link.
    const body = bodies[0];
    expect(body).toContain("---");
    expect(body).toContain("attested on");
    expect(body).toContain("[tx `0xabc…`](https://explorer.example/tx/0xabc)");
  });

  it("renders a bare tx (no link) when the attest dep returns no explorerUrl", async () => {
    // Every SPEC-5 registry entry has explorer: null today — this is the
    // COMMON real-world footer shape, not an edge case.
    const bodies: string[] = [];
    const deps: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/fake", headSha: HEAD_SHA }),
      fetchDiff: async () => attestDiff,
      runAnalyzer: async () => findings0,
      postComment: async (_u, body) => { bodies.push(body); },
      dispose: async () => {},
      attest: async () => ({ txHash: "0xabc", explorerUrl: "" }),
    };
    const res = await runReview("https://github.com/o/r/pull/3", deps);
    expect(res.attestation).toMatchObject({ txHash: "0xabc" });
    expect(bodies[0]).toContain("attested on");
    expect(bodies[0]).toContain("tx `0xabc`");
    expect(bodies[0]).not.toContain("](https://");
  });

  it("attest failure or absence never blocks the comment", async () => {
    const comments: string[] = [];
    const base: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/fake", headSha: HEAD_SHA }),
      fetchDiff: async () => attestDiff,
      runAnalyzer: async () => findings0,
      postComment: async (_u, body) => { comments.push(body); },
      dispose: async () => {},
    };
    const failing = { ...base, attest: async () => null };
    const res1 = await runReview("https://github.com/o/r/pull/3", failing);
    expect(res1.commented).toBe(true);
    expect(res1.attestation).toMatchObject({ skipped: expect.stringContaining("failed") });
    const res2 = await runReview("https://github.com/o/r/pull/3", base); // no attest dep
    expect(res2.attestation).toMatchObject({ skipped: expect.stringContaining("not configured") });
    expect(comments[0]).toContain("attestation skipped");
  });

  it("hard-incomplete review attests status=1 with the empty-findings hash", async () => {
    const seen: AttestRecord[] = [];
    const deps: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/fake", headSha: HEAD_SHA }),
      fetchDiff: async () => attestDiff,
      runAnalyzer: async () => { throw new Error("docker daemon down"); },
      postComment: async () => {},
      dispose: async () => {},
      attest: async (rec) => { seen.push(rec); return null; },
    };
    const res = await runReview("https://github.com/o/r/pull/3", deps);
    expect(res.incomplete).toBe("docker daemon down");
    expect(seen).toHaveLength(1); // exactly one attestation attempt
    expect(seen[0]?.status).toBe(1);
    // sha256("[]") — EXTERNAL literal shared via ./vectors (printf %s '[]' | shasum -a 256).
    expect(seen[0]?.findingsHash).toBe("0x" + EMPTY_FINDINGS_SHA256);
    expect(seen[0]?.findingCount).toBe(0);
  });
});
