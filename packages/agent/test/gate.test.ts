// SPEC-7 §1 — rextor.yaml config: parse (all-or-nothing on any schema
// violation), path filters, and the severity gate → check-run conclusion.
// Invariant 21: dismissal affects the GATE only — findings stay visible and
// scored. Invariant 24: INCOMPLETE ⇒ neutral, never failure.
import { describe, it, expect, vi } from "vitest";
import {
  parseRepoConfig,
  gateConclusion,
  inScope,
  type RepoConfig,
} from "../src/config";
import { runReview, type ReviewDeps, type Finding } from "../src/review";

const PR_URL = "https://github.com/rextor/demo/pull/42";
const HEAD_SHA = "b".repeat(40);

const f = (over: Partial<Finding> = {}): Finding => ({
  file: "src/Vault.sol",
  line: 11,
  severity: "high",
  check: "reentrancy",
  description: "external call before state zeroing",
  ...over,
});

const DEFAULTS: RepoConfig = {
  include: [],
  ignore: [],
  gateMinimum: null,
  dismissals: [],
};

const HIGH_NDJSON =
  `{"file":"src/Vault.sol","line":11,"severity":"high","check":"reentrancy","description":"ext call before state zeroing"}\n`;

describe("parseRepoConfig", () => {
  it("null text (no file) → defaults, no error", () => {
    const res = parseRepoConfig(null);
    expect(res.error).toBeUndefined();
    expect(res.config).toEqual(DEFAULTS);
  });

  it("full valid config parses, yaml snake_case maps to camelCase", () => {
    const yaml = [
      "paths:",
      '  include: ["contracts/**"]',
      '  ignore: ["**/test/**"]',
      "severity_gate:",
      "  minimum: high",
      "dismiss:",
      "  - rule_id: ADERYN-L01",
      "    path: src/peripheral.sol",
      "    line_hint: 12",
      '    reason: "owner-only entry point"',
    ].join("\n");
    const res = parseRepoConfig(yaml);
    expect(res.error).toBeUndefined();
    expect(res.config).toEqual({
      include: ["contracts/**"],
      ignore: ["**/test/**"],
      gateMinimum: "high",
      dismissals: [
        { ruleId: "ADERYN-L01", path: "src/peripheral.sol", lineHint: 12, reason: "owner-only entry point" },
      ],
    });
  });

  it("malformed YAML → visible error + defaults (never throws)", () => {
    const res = parseRepoConfig("paths: [unclosed");
    expect(res.error).toBeTruthy();
    expect(res.config).toEqual(DEFAULTS);
  });

  it("unknown top-level key → error + defaults (fail loud, all-or-nothing)", () => {
    const res = parseRepoConfig("severity_gate:\n  minimum: low\nsurprise: true");
    expect(res.error).toBeTruthy();
    expect(res.config).toEqual(DEFAULTS);
  });

  it("invalid gate minimum value → error + defaults", () => {
    const res = parseRepoConfig("severity_gate:\n  minimum: blocker");
    expect(res.error).toBeTruthy();
    expect(res.config).toEqual(DEFAULTS);
  });

  it("dismiss entry without reason → error + defaults (silencing carries a public why)", () => {
    const res = parseRepoConfig("dismiss:\n  - rule_id: X\n    path: a.sol");
    expect(res.error).toBeTruthy();
    expect(res.config).toEqual(DEFAULTS);
  });
});

describe("gateConclusion", () => {
  const gate = (minimum: "critical" | "high" | "medium" | "low"): RepoConfig => ({
    ...DEFAULTS,
    gateMinimum: minimum,
  });

  it("finding at exactly the gate minimum → failure", () => {
    expect(gateConclusion([f({ severity: "high" })], gate("high"), new Set())).toBe("failure");
  });

  it("critical finding breaches a high gate (severity rank, not equality)", () => {
    expect(gateConclusion([f({ severity: "critical" })], gate("high"), new Set())).toBe("failure");
  });

  it("finding below the gate → success", () => {
    expect(gateConclusion([f({ severity: "medium" })], gate("high"), new Set())).toBe("success");
  });

  it("no gate configured → success even with criticals (gate is opt-in)", () => {
    expect(gateConclusion([f({ severity: "critical" })], DEFAULTS, new Set())).toBe("success");
  });

  it("dismissed finding (ruleId+path match) is excluded from the gate", () => {
    const cfg: RepoConfig = {
      ...gate("high"),
      dismissals: [{ ruleId: "reentrancy", path: "src/Vault.sol", reason: "known" }],
    };
    const keys = new Set(["reentrancy\0src/Vault.sol"]);
    expect(gateConclusion([f()], cfg, keys)).toBe("success");
  });

  it("dismissal does not over-match: same rule on another path still fails the gate", () => {
    const cfg: RepoConfig = {
      ...gate("high"),
      dismissals: [{ ruleId: "reentrancy", path: "src/Other.sol", reason: "known" }],
    };
    const keys = new Set(["reentrancy\0src/Other.sol"]);
    expect(gateConclusion([f()], cfg, keys)).toBe("failure");
  });

  it("no findings + gate → success", () => {
    expect(gateConclusion([], gate("critical"), new Set())).toBe("success");
  });
});

describe("inScope (SPEC-7 §1 paths)", () => {
  const cfg: RepoConfig = {
    include: ["contracts/**"],
    ignore: ["**/test/**"],
    gateMinimum: null,
    dismissals: [],
  };

  it("finding outside include patterns is dropped", () => {
    expect(inScope([f({ file: "src/Vault.sol" })], cfg)).toEqual([]);
  });

  it("finding inside include and not ignored stays", () => {
    expect(inScope([f({ file: "contracts/Vault.sol" })], cfg)).toHaveLength(1);
  });

  it("ignore wins over include (test files never reviewed)", () => {
    expect(inScope([f({ file: "contracts/test/Vault.t.sol" })], cfg)).toEqual([]);
  });

  it("empty include = no include filter (default: review the scoped diff)", () => {
    expect(inScope([f({ file: "anywhere/thing.sol" })], DEFAULTS)).toHaveLength(1);
  });
});

describe("runReview × config gate (SPEC-7 §1 wiring)", () => {
  const baseDeps = (over: Partial<ReviewDeps> = {}): {
    deps: ReviewDeps & { checkRuns: Array<{ conclusion: string; summary: string }>; comments: Array<{ prUrl: string; body: string }> };
    checkRuns: Array<{ conclusion: string; summary: string }>;
    comments: Array<{ prUrl: string; body: string }>;
  } => {
    const checkRuns: Array<{ conclusion: string; summary: string }> = [];
    const comments: Array<{ prUrl: string; body: string }> = [];
    const deps: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/unused", headSha: HEAD_SHA }),
      fetchDiff: async () =>
        `diff --git a/src/Vault.sol b/src/Vault.sol\nindex 0000000..9f26a1c 100644\n--- a/src/Vault.sol\n+++ b/src/Vault.sol\n@@ -1,1 +1,2 @@\n contract Vault {}\n+uint x;\n`,
      runAnalyzer: async () => HIGH_NDJSON,
      postComment: async (_prUrl, body) => {
        comments.push({ prUrl: _prUrl, body });
        return "https://github.com/rextor/demo/pull/42#issuecomment-1";
      },
      dispose: async () => {},
      ...over,
    };
    const withRecord = deps as ReviewDeps & {
      checkRuns: typeof checkRuns;
      comments: typeof comments;
    };
    withRecord.checkRuns = checkRuns;
    withRecord.comments = comments;
    return { deps: withRecord, checkRuns, comments };
  };

  it("gate breached → check-run failure, comment still posted", async () => {
    const { deps, checkRuns, comments } = baseDeps({
      readBaseConfig: async () => "severity_gate:\n  minimum: high\n",
      postCheckRun: async (_pr, _sha, conclusion, summary) => {
        checkRuns.push({ conclusion, summary });
      },
    });
    const res = await runReview(PR_URL, deps);
    expect(res.commented).toBe(true);
    expect(checkRuns).toHaveLength(1);
    expect(checkRuns[0].conclusion).toBe("failure");
    expect(comments).toHaveLength(1);
  });

  it("no config file → success conclusion, no config-error note", async () => {
    const { deps, checkRuns, comments } = baseDeps({
      readBaseConfig: async () => null,
      postCheckRun: async (_pr, _sha, conclusion, summary) => {
        checkRuns.push({ conclusion, summary });
      },
    });
    await runReview(PR_URL, deps);
    expect(checkRuns[0].conclusion).toBe("success");
    expect(comments[0].body).not.toMatch(/rextor\.yaml/);
  });

  it("malformed config → visible config-error note in comment, defaults applied (success)", async () => {
    const { deps, checkRuns, comments } = baseDeps({
      readBaseConfig: async () => "nope: [",
      postCheckRun: async (_pr, _sha, conclusion, summary) => {
        checkRuns.push({ conclusion, summary });
      },
    });
    await runReview(PR_URL, deps);
    expect(comments[0].body).toMatch(/rextor\.yaml/);
    expect(checkRuns[0].conclusion).toBe("success");
  });

  it("INCOMPLETE review → neutral conclusion even with a strict gate", async () => {
    const { deps, checkRuns } = baseDeps({
      readBaseConfig: async () => "severity_gate:\n  minimum: critical\n",
      postCheckRun: async (_pr, _sha, conclusion, summary) => {
        checkRuns.push({ conclusion, summary });
      },
      runAnalyzer: async () => {
        throw new Error("slither exploded");
      },
    });
    const res = await runReview(PR_URL, deps);
    expect(res.incomplete).toBeTruthy();
    expect(checkRuns[0].conclusion).toBe("neutral");
  });

  it("no readBaseConfig dep → review unaffected, no check-run (back-compat)", async () => {
    const { deps, checkRuns, comments } = baseDeps({});
    const res = await runReview(PR_URL, deps);
    expect(res.commented).toBe(true);
    expect(checkRuns).toHaveLength(0);
    expect(comments).toHaveLength(1);
  });

  it("dismissed finding still renders in the comment (silencing ≠ hiding)", async () => {
    const { deps, checkRuns, comments } = baseDeps({
      readBaseConfig: async () =>
        "severity_gate:\n  minimum: high\ndismiss:\n  - rule_id: reentrancy\n    path: src/Vault.sol\n    reason: known-owner-only\n",
      postCheckRun: async (_pr, _sha, conclusion, summary) => {
        checkRuns.push({ conclusion, summary });
      },
    });
    await runReview(PR_URL, deps);
    expect(checkRuns[0].conclusion).toBe("success");
    expect(comments[0].body).toMatch(/reentrancy/);
  });

  it("postCheckRun throwing never fails the review (best-effort)", async () => {
    const { deps, comments } = baseDeps({
      readBaseConfig: async () => "severity_gate:\n  minimum: high\n",
      postCheckRun: async () => {
        throw new Error("checks API down");
      },
    });
    const res = await runReview(PR_URL, deps);
    expect(res.commented).toBe(true);
    expect(comments).toHaveLength(1);
  });

  it("ignore-filtered findings never reach the comment or the gate", async () => {
    const { deps, checkRuns, comments } = baseDeps({
      readBaseConfig: async () =>
        "paths:\n  ignore: [\"src/**\"]\nseverity_gate:\n  minimum: high\n",
      postCheckRun: async (_pr, _sha, conclusion, summary) => {
        checkRuns.push({ conclusion, summary });
      },
    });
    await runReview(PR_URL, deps);
    expect(checkRuns[0].conclusion).toBe("success");
    expect(comments[0].body).not.toMatch(/reentrancy/);
  });
});
