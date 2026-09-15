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
