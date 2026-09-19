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
