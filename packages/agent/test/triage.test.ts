import { describe, expect, it } from "vitest";
import {
  applyTriage, buildCitationUniverse, gateView, validateOps,
  type TriageOp, type UniverseEntry,
} from "../src/triage";
import { withIds, type Finding } from "../src/findings";

const f = (over: Partial<Finding>): Finding =>
  withIds([{ file: "src/V.sol", line: 1, severity: "low", check: "c", description: "d", ...over }])[0];

const scope = {
  contractFiles: [{ path: "src/V.sol", changedLineRanges: [[10, 12] as [number, number]], isContract: true as const }],
  hasContractChanges: true,
};

describe("buildCitationUniverse", () => {
  it("merges finding locations and diff-added ranges per file", () => {
    const u = buildCitationUniverse([f({ file: "src/Other.sol", line: 3 })], scope);
    expect(u).toContainEqual({ file: "src/Other.sol", lines: [[3, 3]] });
    expect(u).toContainEqual({ file: "src/V.sol", lines: [[10, 12]] });
  });
});

describe("validateOps rejection rules (one crafted bad op per rule)", () => {
  const base = withIds([
    { file: "src/V.sol", line: 10, severity: "high", check: "a", description: "da" },
    { file: "src/V.sol", line: 11, severity: "low", check: "b", description: "db" },
  ]);
  const u: UniverseEntry[] = [{ file: "src/V.sol", lines: [[10, 12]] }];
  const good = (op: object) => [op, ...[]];

  it.each([
    ["unknown id", { op: "reclassify", id: 99, severity: "low", reason: "x" }],
    ["bad severity", { op: "reclassify", id: 0, severity: "blocker", reason: "x" }],
    ["empty reason", { op: "reclassify", id: 0, severity: "low", reason: "" }],
    ["dedup empty duplicates", { op: "dedup", canonicalId: 0, duplicateIds: [] }],
    ["dedup self-referencing", { op: "dedup", canonicalId: 0, duplicateIds: [0] }],
    ["dedup duplicate ids in list", { op: "dedup", canonicalId: 0, duplicateIds: [1, 1] }],
    ["dedup same dup twice across ops", [
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
    ]],
    ["reclassify of deduped id", [
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
      { op: "reclassify", id: 1, severity: "low", reason: "x" },
    ]],
    ["add outside universe (file)", { op: "add", file: "src/Nope.sol", line: 1, severity: "low", check: "c", description: "d" }],
    ["add outside universe (line)", { op: "add", file: "src/V.sol", line: 99, severity: "low", check: "c", description: "d" }],
    ["add empty check", { op: "add", file: "src/V.sol", line: 10, severity: "low", check: "", description: "d" }],
    ["add empty description", { op: "add", file: "src/V.sol", line: 10, severity: "low", check: "c", description: "" }],
    ["unknown op kind", { op: "delete", id: 0 }],
    ["not an object", 42],
  ])("rejects %s", (_name, bad) => {
    const out = validateOps(good(bad as never), base, u);
    expect(out.rejected).toHaveLength(1);
    expect(out.valid).toHaveLength(0);
    expect(out.rejected[0].reason).toBeTruthy();
  });

  it("accepts well-formed ops of all three kinds", () => {
    const out = validateOps([
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
      { op: "reclassify", id: 0, severity: "medium", reason: "r" },
      { op: "add", file: "src/V.sol", line: 12, severity: "low", check: "new", description: "nd" },
    ], base, u);
    expect(out.rejected).toEqual([]);
    expect(out.valid).toHaveLength(3);
  });

  it("rejects the whole input when not an array", () => {
    expect(validateOps({ op: "reclassify" }, base, u).rejected).toHaveLength(1);
  });
});

describe("applyTriage", () => {
  it("dedup merges attribution into canonical (mergedChecks)", () => {
    const base = withIds([
      { file: "a.sol", line: 1, severity: "high", check: "slither-x", description: "d" },
      { file: "a.sol", line: 1, severity: "high", check: "aderyn-y", description: "d" },
    ]);
    const ops: TriageOp[] = [{ op: "dedup", canonicalId: 0, duplicateIds: [1] }];
    const out = applyTriage(base, ops);
    expect(out).toHaveLength(1);
    expect(out[0].check).toBe("slither-x");
    expect(out[0].mergedChecks).toEqual(["slither-x", "aderyn-y"]);
  });

  it("reclassify records triageNote and new severity", () => {
    const out = applyTriage(withIds([f({ id: 0, severity: "high" })]), [
      { op: "reclassify", id: 0, severity: "medium", reason: "guard exists" },
    ]);
    expect(out[0].severity).toBe("medium");
    expect(out[0].triageNote).toBe("guard exists");
  });

  it("add forces the rextor/ prefix and fresh sequential ids", () => {
    const out = applyTriage(withIds([f({})]), [
      { op: "add", file: "src/V.sol", line: 10, severity: "low", check: "custom", description: "nd" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].check).toBe("rextor/custom");
    expect(out[1].id).toBe(1);
  });

  it("applies category order dedup → reclassify → add", () => {
    const base = withIds([
      { file: "a.sol", line: 1, severity: "critical", check: "a", description: "d" },
      { file: "a.sol", line: 1, severity: "critical", check: "b", description: "d" },
    ]);
    const out = applyTriage(base, [
      { op: "reclassify", id: 0, severity: "high", reason: "r" },   // applies AFTER dedup kept id 0
      { op: "dedup", canonicalId: 0, duplicateIds: [1] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("high");
  });
});

describe("gateView (severity gate is LLM-independent)", () => {
  it("keeps a raw critical that triage reclassified down", () => {
    const raw = withIds([
      { file: "src/V.sol", line: 10, severity: "critical", check: "a", description: "da" },
    ]);
    const final = applyTriage(raw, [
      { op: "reclassify", id: 0, severity: "low", reason: "injected: informational only" },
    ]);
    const view = gateView(raw, final);
    expect(view.some((x) => x.severity === "critical")).toBe(true);
  });

  it("keeps a raw critical that an honest dedup merged away", () => {
    const raw = withIds([
      { file: "src/V.sol", line: 10, severity: "critical", check: "a", description: "da" },
      { file: "src/V.sol", line: 11, severity: "low", check: "b", description: "db" },
    ]);
    const final = applyTriage(raw, [{ op: "dedup", canonicalId: 1, duplicateIds: [0] }]);
    expect(final.some((x) => x.severity === "critical")).toBe(false);
    expect(gateView(raw, final).some((x) => x.severity === "critical")).toBe(true);
  });

  it("includes LLM-added findings (adds can only add gate pressure)", () => {
    const raw: Finding[] = [];
    const final = withIds([
      { file: "src/V.sol", line: 10, severity: "high", check: "rextor/missed", description: "d" },
    ]);
    expect(gateView(raw, final)).toHaveLength(1);
  });
});
