import { describe, it, expect } from "vitest";
import {
  normalizeFindings,
  parseAnalyzerReport,
  salvageAnalyzerReport,
  score,
  incompleteCauseFor,
  IncompleteReportError,
  type Finding,
} from "../src/findings";
import { CANONICAL_FINDINGS_LITERAL, CANONICAL_FINDINGS_SHA256, EMPTY_FINDINGS_SHA256 } from "./vectors";

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

describe("parseAnalyzerReport (SPEC-8 §1 dual dispatch)", () => {
  it("findings + scoped incomplete → findings flow, degradation returned, never throws", () => {
    const nd = [
      JSON.stringify(finding("high")),
      JSON.stringify({ status: "incomplete", reason: "slither-error: boom", scope: "evm" }),
    ].join("\n");
    const { findings, degraded } = parseAnalyzerReport(nd);
    expect(findings).toEqual([finding("high")]);
    expect(degraded).toEqual(["evm: slither-error: boom"]);
  });

  it("zero findings + scoped incompletes → throws with every scope joined", () => {
    const nd = [
      JSON.stringify({ status: "incomplete", reason: "no-rust-analyzed", scope: "solana" }),
      JSON.stringify({ status: "incomplete", reason: "slither-error: boom", scope: "evm" }),
    ].join("\n");
    let thrown: IncompleteReportError | undefined;
    try {
      parseAnalyzerReport(nd);
    } catch (e) {
      thrown = e as IncompleteReportError;
    }
    expect(thrown).toBeInstanceOf(IncompleteReportError);
    expect(thrown?.reason).toBe("solana: no-rust-analyzed | evm: slither-error: boom");
  });

  it("unscoped incomplete stays a hard throw", () => {
    expect(() =>
      parseAnalyzerReport(JSON.stringify({ status: "incomplete", reason: "x" })),
    ).toThrowError(IncompleteReportError);
  });

  it("normalizeFindings stays strict: scoped incompletes throw there too", () => {
    expect(() =>
      normalizeFindings(JSON.stringify({ status: "incomplete", reason: "x", scope: "evm" })),
    ).toThrowError(IncompleteReportError);
  });
});

describe("incompleteCauseFor (report-boundary cause classification)", () => {
  it("classifies the scripts' enumerated nothing-in-scope reasons as content", () => {
    // Exactly the three planned emissions across run.sh/evm.sh/solana.sh that
    // mean "the repo has nothing of its own for this engine to analyze".
    expect(incompleteCauseFor("no-contract-analyzed")).toBe("content"); // evm.sh
    expect(incompleteCauseFor("no-sol-sources")).toBe("content"); // evm.sh
    expect(incompleteCauseFor("no-rust-analyzed")).toBe("content"); // solana.sh
  });

  it("classifies every known infra reason as infra", () => {
    for (const reason of [
      "slither-missing", // evm.sh
      "semgrep-missing", // solana.sh
      "workdir-unavailable", // all three
      "tmpdir-unavailable", // evm.sh, solana.sh
      "evm-copy-failed", // evm.sh
      "evm-workdir-cd-failed", // evm.sh
      "crash", // dispatcher/slice crash line
      "solana-crash", // tag_scope fallback for a reason-less incomplete line
      "slice-failed-rc-1", // tag_scope synthesized (any rc)
      "slice-failed-rc-137",
      "slither-json-unparseable: Unexpected end of JSON input", // evm.sh
      "semgrep-json-unparseable: Expecting value", // solana.sh
      "slither-error: forge build failed (exit 1)", // evm.sh (analyzer exit≠0)
      "semgrep-error: unparseable rust file", // solana.sh (partial scan)
    ]) {
      expect(incompleteCauseFor(reason)).toBe("infra");
    }
  });

  it("never classifies an unknown reason as content (closed content table)", () => {
    expect(incompleteCauseFor("totally-novel-reason")).toBe("infra");
    expect(incompleteCauseFor("github setup failed: clone died")).toBe("infra");
    expect(incompleteCauseFor("no-contract-analyzed-but-worse")).toBe("infra"); // prefix ≠ match
    expect(incompleteCauseFor("NO-CONTRACT-ANALYZED")).toBe("infra"); // exact match only
    expect(incompleteCauseFor("")).toBe("infra");
  });

  it("strips the scoped-degradation prefix before classifying", () => {
    expect(incompleteCauseFor("evm: no-contract-analyzed")).toBe("content");
    expect(incompleteCauseFor("solana: no-rust-analyzed")).toBe("content");
    expect(incompleteCauseFor("evm: slither-error: boom")).toBe("infra");
  });
});

describe("IncompleteReportError carries the classified cause", () => {
  it("normalizeFindings stamps the cause on the unscoped throw", () => {
    let thrown: unknown;
    try {
      normalizeFindings('{"status":"incomplete","reason":"no-sol-sources"}');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(IncompleteReportError);
    expect((thrown as IncompleteReportError).incompleteCause).toBe("content");
  });

  it("parseAnalyzerReport: content only when EVERY degraded scope is content", () => {
    let thrown: IncompleteReportError | undefined;
    try {
      parseAnalyzerReport([
        JSON.stringify({ status: "incomplete", reason: "no-rust-analyzed", scope: "solana" }),
        JSON.stringify({ status: "incomplete", reason: "no-contract-analyzed", scope: "evm" }),
      ].join("\n"));
    } catch (e) {
      thrown = e as IncompleteReportError;
    }
    expect(thrown).toBeInstanceOf(IncompleteReportError);
    expect(thrown?.incompleteCause).toBe("content");
    expect(thrown?.reason).toBe("solana: no-rust-analyzed | evm: no-contract-analyzed");
  });

  it("parseAnalyzerReport: any infra scope dominates the combined cause", () => {
    let thrown: IncompleteReportError | undefined;
    try {
      parseAnalyzerReport([
        JSON.stringify({ status: "incomplete", reason: "no-rust-analyzed", scope: "solana" }),
        JSON.stringify({ status: "incomplete", reason: "slither-error: boom", scope: "evm" }),
      ].join("\n"));
    } catch (e) {
      thrown = e as IncompleteReportError;
    }
    expect(thrown?.incompleteCause).toBe("infra");
  });

  it("parseAnalyzerReport stamps infra on an unscoped infra reason", () => {
    let thrown: unknown;
    try {
      parseAnalyzerReport('{"status":"incomplete","reason":"slither-missing"}');
    } catch (e) {
      thrown = e;
    }
    expect((thrown as IncompleteReportError).incompleteCause).toBe("infra");
  });
});

describe("salvageAnalyzerReport (timeout partial stdout)", () => {
  const solanaLine = JSON.stringify({
    file: "programs/x/src/lib.rs", line: 3, severity: "high", check: "c", description: "d",
  });

  it("keeps completed slices from a stdout cut mid-line (trailing unterminated line dropped)", () => {
    const cut = `${solanaLine}\n{"file":"programs/y/src/lib.rs","line":9,"sev`;
    const report = salvageAnalyzerReport(cut);
    expect(report).not.toBeNull();
    expect(report!.findings).toHaveLength(1);
    expect(report!.findings[0]).toEqual(JSON.parse(solanaLine));
    expect(report!.degraded).toEqual([]);
  });

  it("passes already-terminated output through the normal rules untouched", () => {
    const report = salvageAnalyzerReport(`${solanaLine}\n`);
    expect(report!.findings).toHaveLength(1);
  });

  it("keeps a scoped degradation that rode along with salvaged findings", () => {
    const cut = [
      solanaLine,
      '{"status":"incomplete","scope":"solana","reason":"slice-failed-rc-3"}',
      '{"file":"programs/y/src/lib.rs","line":9', // cut mid-line
    ].join("\n");
    const report = salvageAnalyzerReport(cut);
    expect(report!.findings).toHaveLength(1);
    expect(report!.degraded).toEqual(["solana: slice-failed-rc-3"]);
  });

  it("returns null for a mid-stream corrupt line (only end-of-stream truncation is recoverable)", () => {
    expect(salvageAnalyzerReport(`${solanaLine}\ncorrupt{\n{"status":"incomplete","scope":"evm"}\n`)).toBeNull();
  });

  it("returns null when nothing usable survived the kill", () => {
    expect(salvageAnalyzerReport("")).toBeNull();
    expect(salvageAnalyzerReport('{"file":"programs/x/src/li')).toBeNull(); // one truncated line, all dropped
    expect(salvageAnalyzerReport('{"status":"incomplete","reason":"crash"}\n')).toBeNull(); // unscoped incomplete
    expect(salvageAnalyzerReport('{"status":"incomplete","scope":"evm","reason":"crash"}\n')).toBeNull(); // degraded-only
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
  it("matches an externally computed sha256 vector (shared with attest.test.ts)", () => {
    // Vectors live in ./vectors — computed OUTSIDE the implementation:
    //   printf %s '<CANONICAL_FINDINGS_LITERAL>' | shasum -a 256
    // attest.test.ts (SPEC-4) pins the SAME literals for findingsHash.
    const findings = withIds([{ file: "src/V.sol", line: 1, severity: "low", check: "c", description: "d" }]);
    expect(canonicalFindingsJson(findings)).toBe(CANONICAL_FINDINGS_LITERAL);
    expect(findingsHash(findings)).toBe(CANONICAL_FINDINGS_SHA256);
  });
  it("hashes the empty list to the shared EMPTY_FINDINGS_SHA256 vector", () => {
    // The hard-incomplete attestation payload (SPEC-4 #12): sha256("[]").
    expect(findingsHash([])).toBe(EMPTY_FINDINGS_SHA256);
  });
});
