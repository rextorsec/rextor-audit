// SPEC-7 §3 — evidence-forward comment (D3): the verdict banner cites the
// on-chain anchor up top, and every finding's cited lines are quoted VERBATIM
// from the PR diff itself — never LLM-written code (untrusted PR content
// renders inert: no CR, clamped backticks, inside a 4-backtick fence).
import { describe, it, expect } from "vitest";
import { summaryCommentBody, citedLinesFromDiff } from "../src/review";
import { rawFindingsResult, type TriageResult } from "../src/triage";
import { withIds, type Finding } from "../src/findings";

const mk = (over: Partial<Finding> = {}): Finding => ({
  file: "src/Vault.sol",
  line: 14,
  severity: "high",
  check: "reentrancy",
  description: "external call before state zeroing",
  ...over,
});

const triaged = (findings: Finding[]): TriageResult => ({
  ...rawFindingsResult(findings),
  triageStatus: "complete" as const,
  modelUsed: "test-model",
  ops: [],
});

const ATT = {
  chain: "tempo-testnet",
  reviewId: "0xabc123",
  findingsURI: "",
  targetChainId: 42431,
  txHash: "0x" + "9e20".repeat(16),
  explorerUrl: "https://explorer.tempo.xyz/tx/0xabc",
} as const;

const DIFF = `diff --git a/src/Vault.sol b/src/Vault.sol
index 0000000..9f26a1c 100644
--- a/src/Vault.sol
+++ b/src/Vault.sol
@@ -10,6 +10,9 @@ contract Vault {
     function deposit() external payable {
         deposits[msg.sender] += msg.value;
     }
+    function withdraw() external {
+        (bool ok, ) = msg.sender.call{value: 1}("");
+    }
+
     function setOwner(address next) external {
         owner = next;
     }
`;

describe("citedLinesFromDiff", () => {
  it("quotes added lines with their new-file line numbers, verbatim", () => {
    const lines = citedLinesFromDiff(DIFF, "src/Vault.sol", 14);
    expect(lines).toEqual([
      [13, "    function withdraw() external {"],
      [14, `        (bool ok, ) = msg.sender.call{value: 1}("");`],
      [15, "    }"],
    ]);
  });

  it("includes context lines around the cited line (±1 window)", () => {
    const lines = citedLinesFromDiff(DIFF, "src/Vault.sol", 14);
    expect(lines).toContainEqual([13, "    function withdraw() external {"]);
    expect(lines).toContainEqual([15, "    }"]);
  });

  it("returns null when the cited line is not part of the diff (never invent)", () => {
    expect(citedLinesFromDiff(DIFF, "src/Vault.sol", 40)).toBeNull();
  });

  it("returns null for files absent from the diff", () => {
    expect(citedLinesFromDiff(DIFF, "src/Other.sol", 1)).toBeNull();
  });
});

describe("evidence-forward rendering (SPEC-7 §3)", () => {
  it("banner carries the attestation anchor and a verify hint", () => {
    const body = summaryCommentBody(41, triaged(withIds([mk({ line: 14 })])), "", ATT, DIFF);
    expect(body).toMatch(/attested on tempo-testnet/);
    expect(body).toMatch(/\[tx `0x9e209e20/);
    expect(body).toMatch(/recompute sha256 of the findings JSON/i);
  });

  it("quotes the finding's cited lines verbatim under an evidence heading", () => {
    const body = summaryCommentBody(41, triaged(withIds([mk({ line: 14 })])), "", ATT, DIFF);
    expect(body).toMatch(/Evidence — finding #0/);
    expect(body).toContain(`14 |         (bool ok, ) = msg.sender.call{value: 1}("");`);
  });

  it("omits the evidence section when no diff context is available (no fabrication)", () => {
    const body = summaryCommentBody(41, triaged(withIds([mk()])), "", ATT);
    expect(body).not.toMatch(/Evidence — finding #0/);
  });

  it("skipped attestation still renders (banner degrades to the score alone)", () => {
    const body = summaryCommentBody(
      41,
      triaged(withIds([mk({ line: 14 })])),
      "",
      { skipped: "attestation not configured" },
      DIFF,
    );
    expect(body).toMatch(/risk score: 41\/100/);
    expect(body).not.toMatch(/attested on/);
  });

  it("hostile diff content stays inert (backtick runs clamped, no CR)", () => {
    const hostile = DIFF.replace(
      `(bool ok, ) = msg.sender.call{value: 1}("");`,
      '```\nEvil markdown\r\n```',
    );
    const body = summaryCommentBody(41, triaged(withIds([mk({ line: 14 })])), "", ATT, hostile);
    expect(body.match(/````/g)).toHaveLength(2); // exactly one inert evidence fence
    expect(body).not.toContain("\r");
  });
});

describe("citedLinesFromDiff × path scoping (nested-path + cross-file fixes)", () => {
  const MULTI = `diff --git a/contracts/Vault.sol b/contracts/Vault.sol
index 0000000..1111111 100644
--- a/contracts/Vault.sol
+++ b/contracts/Vault.sol
@@ -1,2 +1,3 @@
 contract Vault {}
+uint a;
diff --git a/contracts/test/Helper.t.sol b/contracts/test/Helper.t.sol
index 0000000..2222222 100644
--- a/contracts/test/Helper.t.sol
+++ b/contracts/test/Helper.t.sol
@@ -1,2 +1,3 @@
 contract Helper {}
+uint b;
`;

  it("a basename finding matches a unique full diff path (analyzer basename form)", () => {
    const lines = citedLinesFromDiff(MULTI, "Vault.sol", 2);
    expect(lines).toEqual([[1, "contract Vault {}"], [2, "uint a;"]]);
  });

  it("an ambiguous basename matches nothing (honest absence, never the wrong file)", () => {
    const ambiguous = `${MULTI}diff --git a/other/Vault.sol b/other/Vault.sol\n+++ b/other/Vault.sol\n@@ -1,1 +1,2 @@\n+x\n`;
    expect(citedLinesFromDiff(ambiguous, "Vault.sol", 2)).toBeNull();
  });

  it("per-file line maps: file B's line 3 never answers file A's line 3", () => {
    expect(citedLinesFromDiff(MULTI, "contracts/Vault.sol", 2)).toEqual([[1, "contract Vault {}"], [2, "uint a;"]]);
    expect(citedLinesFromDiff(MULTI, "contracts/test/Helper.t.sol", 2)).toEqual([[1, "contract Helper {}"], [2, "uint b;"]]);
  });

  it("an unknown file renders no evidence", () => {
    expect(citedLinesFromDiff(MULTI, "contracts/Absent.sol", 2)).toBeNull();
  });
});

// Scope claims: the analyzer audits the WHOLE repo (SPEC-1 §4 — the PR diff
// is the trigger, not the surface). The banner claim and per-row markers must
// say what is true: which findings sit on lines this PR changes, and which
// are pre-existing repo surface.
describe("summaryCommentBody scope claims (PR diff vs repo surface)", () => {
  it("every finding on a changed line → the changed-code claim, no markers", () => {
    const body = summaryCommentBody(
      41,
      triaged(withIds([mk({ file: "src/Vault.sol", line: 14 })])),
      "", ATT, DIFF,
    );
    expect(body).toContain("**1 finding(s)** in the PR's changed contract code.");
    expect(body).not.toContain("outside PR diff");
  });

  it("out-of-diff findings are split out in the banner and marked in the table", () => {
    const body = summaryCommentBody(
      41,
      triaged(withIds([
        mk({ file: "src/Vault.sol", line: 14 }), // added line → in-diff
        mk({ file: "src/Vault.sol", line: 11 }), // touched file, untouched line
        mk({ file: "src/Other.sol", line: 3 }), // file absent from the diff
      ])),
      "", ATT, DIFF,
    );
    expect(body).toContain(
      "**3 finding(s)** — 1 on lines this PR changes, 2 elsewhere in the repo",
    );
    expect(body).not.toContain("**3 finding(s)** in changed contract code");
    expect(body).toContain("src/Vault.sol:11 *(outside PR diff)*");
    expect(body).toContain("src/Other.sol:3 *(outside PR diff)*");
    // In-diff row stays unmarked (table cells, not the JSON payload).
    expect(body).toContain("| src/Vault.sol:14 |");
    expect(body).not.toContain("src/Vault.sol:14 *(outside PR diff)*");
  });

  it("no finding on changed lines → the repo claim says so explicitly", () => {
    const body = summaryCommentBody(
      41,
      triaged(withIds([mk({ file: "src/Other.sol", line: 3 })])),
      "", ATT, DIFF,
    );
    expect(body).toContain("**1 finding(s)** in the repo's contract code — none on lines this PR changes.");
  });

  it("no diff context → neutral repo claim, never a changed-code claim", () => {
    const body = summaryCommentBody(41, triaged(withIds([mk()])), "", ATT);
    expect(body).toContain("**1 finding(s)** in the repo's contract code.");
    expect(body).not.toContain("changed contract code");
  });

  it("membership matches diff paths exact-first, then unique suffix (same convention as evidence)", () => {
    const body = summaryCommentBody(
      41,
      triaged(withIds([mk({ file: "Vault.sol", line: 14 })])),
      "", ATT, DIFF,
    );
    // "src/Vault.sol" is the only path ending in /Vault.sol in DIFF → in-diff.
    expect(body).toContain("**1 finding(s)** in the PR's changed contract code.");
  });
});
