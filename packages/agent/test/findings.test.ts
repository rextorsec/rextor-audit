import { describe, it, expect } from "vitest";
import {
  normalizeFindings,
  score,
  IncompleteReportError,
  type Finding,
} from "../src/findings";

// SPEC-1 §1 NDJSON finding shape; helper keeps fixtures terse but explicit.
const finding = (
  severity: Finding["severity"],
  overrides: Partial<Finding> = {},
): Finding => ({
  file: "Vault.sol",
  line: 16,
  severity,
  check: "reentrancy-eth",
  description: "Arbitrary jump destination",
  ...overrides,
});

const toNdjson = (findings: Finding[]): string =>
  findings.map((f) => JSON.stringify(f)).join("\n");

describe("normalizeFindings", () => {
  it("parses NDJSON into findings with exact fields", () => {
    const want = [
      finding("high"),
      finding("high", { check: "arbitrary-send-eth", line: 20 }),
      finding("medium", { check: "solc-version", line: 1 }),
    ];
    expect(normalizeFindings(toNdjson(want))).toEqual(want);
  });

  it("accepts empty string and returns no findings", () => {
    expect(normalizeFindings("")).toEqual([]);
    expect(score(normalizeFindings(""))).toBe(0);
  });

  it("tolerates trailing newlines and blank lines", () => {
    const want = [finding("low", { check: "naming-convention", line: 4 })];
    expect(normalizeFindings(toNdjson(want) + "\n")).toEqual(want);
    expect(normalizeFindings(toNdjson(want) + "\n\n")).toEqual(want);
    expect(normalizeFindings("\n" + toNdjson(want))).toEqual(want);
  });

  it("throws IncompleteReportError preserving the analyzer's reason", () => {
    const ndjson = JSON.stringify({
      status: "incomplete",
      reason: "solc: unsupported EvmVersion",
    });
    let thrown: unknown;
    try {
      normalizeFindings(ndjson);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(IncompleteReportError);
    expect((thrown as IncompleteReportError).reason).toBe(
      "solc: unsupported EvmVersion",
    );
  });

  it("throws a line-numbered error on a malformed non-JSON line (never silently skips)", () => {
    const good = JSON.stringify(finding("high"));
    expect(() => normalizeFindings(`${good}\nthis is not json`)).toThrowError(
      /line 2/,
    );
  });

  it("throws on a JSON line that is not a finding (never silently skips)", () => {
    expect(() => normalizeFindings(`{"unrelated":true}`)).toThrowError(
      /line 1/,
    );
  });

  it("throws on an unknown severity", () => {
    const line = JSON.stringify({ ...finding("high"), severity: "info" });
    expect(() => normalizeFindings(line)).toThrowError(/severity/);
  });

  it("throws on a fractional line number (corrupt analyzer output)", () => {
    const line = JSON.stringify({ ...finding("high"), line: 1.5 });
    expect(() => normalizeFindings(line)).toThrowError(/line/);
  });

  it("throws on a negative line number (corrupt analyzer output)", () => {
    const line = JSON.stringify({ ...finding("high"), line: -3 });
    expect(() => normalizeFindings(line)).toThrowError(/line/);
  });
});

describe("score", () => {
  it("scores the known vector: two highs + one medium -> 60", () => {
    expect(score([finding("high"), finding("high"), finding("medium")])).toBe(
      60,
    );
  });

  it("weights each severity: critical 60, high 25, medium 10, low 3", () => {
    expect(score([finding("critical")])).toBe(60);
    expect(score([finding("high")])).toBe(25);
    expect(score([finding("medium")])).toBe(10);
    expect(score([finding("low")])).toBe(3);
  });

  it("caps the sum at 100 (boundary: exactly 100 stays, above is clipped)", () => {
    expect(score([finding("critical"), finding("critical")])).toBe(100); // 120 uncapped
    expect(score(Array.from({ length: 4 }, () => finding("high")))).toBe(100); // exactly 100
    expect(
      score([
        finding("high"),
        finding("high"),
        finding("high"),
        finding("high"),
        finding("medium"),
      ]),
    ).toBe(100); // 110 uncapped
  });

  it("scores no findings as 0", () => {
    expect(score([])).toBe(0);
  });
});

import {
  canonicalFindingsJson, findingsHash, scoreV1, withIds,
  type PocInfo, type Severity,
} from "../src/findings";

describe("scoreV1 (rubric v1 — SPEC-2 §2)", () => {
  const finding = (severity: Severity, poc?: PocInfo["status"]): Finding => ({
    file: "a.sol", line: 1, severity, check: "c", description: "d",
    ...(poc ? { poc: { status: poc } } : {}),
  });
  it.each([
    [[finding("critical")], 60],
    [[finding("critical", "confirmed")], 60],
    [[finding("critical", "skipped")], 60],
    [[finding("critical", "unproven")], 25],
    [[finding("high")], 25],
    [[finding("medium"), finding("low")], 13],
    [[finding("critical"), finding("critical"), finding("high")], 100], // 145 capped
  ])("scoreV1(%j) === %i", (findings, expected) => {
    expect(scoreV1(findings)).toBe(expected);
  });
});

describe("canonicalFindingsJson + findingsHash", () => {
  it("is key-order independent and backtick-free", () => {
    const a = withIds([{ file: "a.sol", line: 1, severity: "low", check: "c", description: "d" }]);
    const b = [{ description: "d", check: "c", line: 1, severity: "low", file: "a.sol", id: 0 }];
    expect(canonicalFindingsJson(a)).toBe(canonicalFindingsJson(b as Finding[]));
    expect(canonicalFindingsJson(a)).not.toContain("`");
  });
  it("escapes backticks as \\u0060 but parses back identically", () => {
    const fs = withIds([{ file: "a.sol", line: 1, severity: "low", check: "c", description: "has `ticks`" }]);
    const canonical = canonicalFindingsJson(fs);
    expect(canonical).toContain("\\u0060");
    expect(JSON.parse(canonical)[0].description).toBe("has `ticks`");
  });
  it("matches an externally computed sha256 vector", () => {
    // Vector computed OUTSIDE the implementation (implementer: run
    //   printf %s '<CANONICAL_LITERAL>' | shasum -a 256
    // over the exact canonical literal asserted below and paste the digest here):
    const canonical = canonicalFindingsJson(
      withIds([{ file: "src/V.sol", line: 1, severity: "low", check: "c", description: "d" }]),
    );
    expect(canonical).toBe(
      '[{"check":"c","description":"d","file":"src/V.sol","id":0,"line":1,"severity":"low"}]',
    );
    expect(findingsHash(
      withIds([{ file: "src/V.sol", line: 1, severity: "low", check: "c", description: "d" }]),
    )).toBe("e68cea4f66e1dde2b0bdba549c0d57ae7d37550a35896f946459666fd607a244");
  });
});
