// SPEC-7 §2 — per-finding suggested fix diffs (D1): the `suggest_fix` triage
// op (validated, grounding-checked, capped), payload stripping (the attested
// findingsHash covers evidence, never suggestions), and inert rendering
// (suggested-only; invariant 23 — the agent never applies anything).
import { describe, it, expect } from "vitest";
import {
  validateOps,
  applyTriage,
  buildCitationUniverse,
  SUGGEST_DIFF_MAX_CHARS,
  type UniverseEntry,
} from "../src/triage";
import { canonicalFindingsJson, withIds, type Finding } from "../src/findings";
import { summaryCommentBody } from "../src/review";
import { rawFindingsResult } from "../src/triage";
import { PROFILE_V1_SYSTEM, buildTriageUserMessage, TRIAGE_DIFF_CONTEXT_MAX_CHARS } from "../src/profile";

const mk = (over: Partial<Finding> = {}): Finding => ({
  file: "src/Vault.sol",
  line: 11,
  severity: "high",
  check: "reentrancy",
  description: "external call before state zeroing",
  ...over,
});

const UNIVERSE: UniverseEntry[] = [{ file: "src/Vault.sol", lines: [[1, 50]] }];
const SCOPE_DIFF = `diff --git a/src/Vault.sol b/src/Vault.sol
--- a/src/Vault.sol
+++ b/src/Vault.sol
@@ -1,2 +1,3 @@
 contract Vault {}
+uint x;
`;

const GOOD_DIFF = `--- a/src/Vault.sol
+++ b/src/Vault.sol
@@ -11,7 +11,7 @@
     function withdraw() external {
         uint256 amount = deposits[msg.sender];
-        (bool ok, ) = msg.sender.call{value: amount}("");
+        deposits[msg.sender] = 0;
         require(ok, "transfer failed");
     }
`;

describe("suggest_fix validation (SPEC-7 §2, citation-constrained)", () => {
  it("valid op grounded in the owning finding's file is accepted", () => {
    const findings = withIds([mk()]);
    const { valid, rejected } = validateOps(
      [{ op: "suggest_fix", id: 0, diff: GOOD_DIFF }],
      findings,
      UNIVERSE,
    );
    expect(valid).toEqual([{ op: "suggest_fix", id: 0, diff: GOOD_DIFF }]);
    expect(rejected).toEqual([]);
  });

  it("unknown id → rejected", () => {
    const { valid, rejected } = validateOps(
      [{ op: "suggest_fix", id: 99, diff: GOOD_DIFF }],
      withIds([mk()]),
      UNIVERSE,
    );
    expect(valid).toEqual([]);
    expect(rejected[0].reason).toMatch(/unknown or removed id 99/);
  });

  it("diff not referencing the finding's file → rejected as fabrication", () => {
    const wrongFile = GOOD_DIFF.replaceAll("src/Vault.sol", "src/Other.sol");
    const { valid, rejected } = validateOps(
      [{ op: "suggest_fix", id: 0, diff: wrongFile }],
      withIds([mk()]),
      UNIVERSE,
    );
    expect(valid).toEqual([]);
    expect(rejected[0].reason).toMatch(/does not reference src\/Vault\.sol/);
  });

  it("oversized diff → rejected", () => {
    const bloated = GOOD_DIFF + "\n".repeat(SUGGEST_DIFF_MAX_CHARS);
    const { valid, rejected } = validateOps(
      [{ op: "suggest_fix", id: 0, diff: bloated }],
      withIds([mk()]),
      UNIVERSE,
    );
    expect(valid).toEqual([]);
    expect(rejected[0].reason).toMatch(/exceeds/);
  });

  it("empty diff → rejected", () => {
    const { valid, rejected } = validateOps(
      [{ op: "suggest_fix", id: 0, diff: "   " }],
      withIds([mk()]),
      UNIVERSE,
    );
    expect(valid).toEqual([]);
    expect(rejected[0].reason).toMatch(/empty diff/);
  });

  it("suggest_fix for an id consumed by an earlier dedup → rejected", () => {
    const findings = withIds([mk(), mk({ check: "reentrancy-eth" })]);
    const { valid, rejected } = validateOps(
      [
        { op: "dedup", canonicalId: 0, duplicateIds: [1] },
        { op: "suggest_fix", id: 1, diff: GOOD_DIFF },
      ],
      findings,
      UNIVERSE,
    );
    expect(valid.some((o) => o.op === "suggest_fix")).toBe(false);
    expect(rejected[0].reason).toMatch(/unknown or removed id 1/);
  });
});

describe("suggest_fix application", () => {
  it("applyTriage attaches the diff to the owning finding", () => {
    const findings = withIds([mk()]);
    const out = applyTriage(findings, [{ op: "suggest_fix", id: 0, diff: GOOD_DIFF }]);
    expect(out[0].suggestedDiff).toBe(GOOD_DIFF);
  });

  it("last suggest_fix wins (model refining its own diff)", () => {
    const findings = withIds([mk()]);
    const out = applyTriage(findings, [
      { op: "suggest_fix", id: 0, diff: GOOD_DIFF },
      { op: "suggest_fix", id: 0, diff: GOOD_DIFF + "\n# revised\n" },
    ]);
    expect(out[0].suggestedDiff).toMatch(/# revised/);
  });
});

describe("payload discipline (SPEC-7 §2)", () => {
  it("canonicalFindingsJson strips suggestedDiff — attested hash covers evidence only", () => {
    const plain = withIds([mk()]);
    const withDiff = plain.map((f) => ({ ...f, suggestedDiff: GOOD_DIFF }));
    expect(canonicalFindingsJson(withDiff)).toBe(canonicalFindingsJson(plain));
  });

  it("hash recipe unchanged for findings without suggestions", () => {
    const findings = withIds([mk(), mk({ line: 20, check: "access-control" })]);
    expect(canonicalFindingsJson(findings)).not.toMatch(/suggestedDiff/);
  });
});

describe("rendering (invariant 23 — inert, suggested-only)", () => {
  const triaged = (findings: Finding[]) => ({
    ...rawFindingsResult(findings),
    triageStatus: "complete" as const,
    modelUsed: "test-model",
    ops: [],
  });

  it("renders a collapsed diff block with the exact spec label", () => {
    const body = summaryCommentBody(41, triaged(withIds([{ ...mk(), suggestedDiff: GOOD_DIFF }])));
    expect(body).toMatch(/Suggestion — review before applying \(finding #0\)/);
    expect(body).toMatch(/````diff/);
    expect(body).toContain("msg.sender.call");
  });

  it("findings without suggestions render no block", () => {
    const body = summaryCommentBody(41, triaged(withIds([mk()])));
    expect(body).not.toMatch(/Suggestion — review before applying/);
  });

  it("backtick runs in the diff are clamped — the fence cannot be escaped", () => {
    const hostile = GOOD_DIFF + "\n```\nInjected markdown\n```\n";
    const body = summaryCommentBody(41, triaged(withIds([{ ...mk(), suggestedDiff: hostile }])));
    // Exactly the one suggestion block's open+close fences survive: the
    // injected 3-backtick lines were clamped to single backticks.
    expect(body.match(/````/g)).toHaveLength(2);
    expect(body).toContain("Injected markdown"); // content stays, inert
  });
});

describe("prompt contract", () => {
  const parsePayload = (msg: string): { prDiff?: string } => {
    const inner = msg.split("<untrusted_pr_data>\n")[1]!.split("\n</untrusted_pr_data>")[0]!;
    return JSON.parse(inner);
  };

  it("system prompt documents the suggest_fix op with its guardrails", () => {
    expect(PROFILE_V1_SYSTEM).toMatch(/"op":"suggest_fix"/);
    expect(PROFILE_V1_SYSTEM).toMatch(/under 2000 chars/);
    expect(PROFILE_V1_SYSTEM).toMatch(/Never fabricate context/);
  });

  it("user message carries the PR diff inside the untrusted block (intact after round-trip)", () => {
    const msg = buildTriageUserMessage([mk()], buildCitationUniverse([mk()], { contractFiles: [], hasContractChanges: true }), SCOPE_DIFF);
    expect(parsePayload(msg).prDiff).toBe(SCOPE_DIFF);
  });

  it("oversized diff context is hard-truncated with a marker", () => {
    const huge = "x".repeat(TRIAGE_DIFF_CONTEXT_MAX_CHARS + 1);
    const parsed = parsePayload(buildTriageUserMessage([mk()], [], huge));
    expect(parsed.prDiff).toBeTruthy();
    expect(parsed.prDiff).toMatch(/truncated — diff exceeded context budget\]$/);
    expect(parsed.prDiff!.length).toBeLessThan(TRIAGE_DIFF_CONTEXT_MAX_CHARS + 200);
  });

  it("absent diff context leaves prDiff out of the payload entirely", () => {
    const parsed = parsePayload(buildTriageUserMessage([mk()], []));
    expect("prDiff" in parsed).toBe(false);
  });
});
