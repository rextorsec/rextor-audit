// Deep Scan runner: clone (faked git) → analyzer (faked container) → parse →
// triage-absent scoring. No live network, no real containers, no real git
// (controller ruling 9). INCOMPLETE outcomes are reports with status 1, never
// throws — the route records them; only a misconfigured token seam throws.
import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { runScan, isValidScanRepo, isValidScanRef, type ScanDeps } from "../src/scan";

const SHA = "e".repeat(40);
const TOKEN = "scan-test-token";

const HIGH =
  '{"file":"src/Vault.sol","line":18,"severity":"high","check":"reentrancy-eth","description":"extcall before state zeroing"}';
const MEDIUM =
  '{"file":"src/Vault.sol","line":42,"severity":"medium","check":"shadowing-local","description":"local shadows state variable"}';

const makeDeps = (ndjson: string, over: Partial<ScanDeps> = {}) => {
  const gitArgs: string[][] = [];
  const cleaned: string[] = [];
  const deps: ScanDeps = {
    runGit: async (args) => {
      gitArgs.push(args);
      if (args.includes("rev-parse")) return SHA;
      return "";
    },
    token: () => TOKEN,
    rmDir: async (dir) => {
      cleaned.push(dir);
      await rm(dir, { recursive: true, force: true });
    },
    runAnalyzer: async () => ndjson,
    ...over,
  };
  return { deps, gitArgs, cleaned };
};

describe("runScan", () => {
  it("scores a complete report through the triage-absent rubric path", async () => {
    const { deps, gitArgs } = makeDeps(`${HIGH}\n${MEDIUM}\n`);
    const report = await runScan("rextorsec/demo", "main", deps);
    expect(report).toMatchObject({
      repo: "rextorsec/demo",
      ref: "main",
      head_sha: SHA,
      status: 0,
      risk_score: 35, // rubric v1: high 25 + medium 10, no triage, no sim
      finding_count: 2,
    });
    // SPEC-2 §1 stable ids ride the findings, same as PR reviews.
    expect(report.findings.map((f) => f.id)).toEqual([0, 1]);
    expect(report.incomplete).toBeUndefined();
    // github.ts clone pattern: fetch by URL (token in the argv URL, never in
    // .git/config), array args only, then checkout FETCH_HEAD.
    const fetch = gitArgs.find((args) => args.includes("fetch"));
    expect(fetch).toEqual([
      "-C", expect.any(String), "fetch", "--depth", "1",
      `https://x-access-token:${TOKEN}@github.com/rextorsec/demo.git`, "main",
    ]);
    expect(gitArgs[0]).toEqual(["init", expect.any(String)]);
    expect(gitArgs.some((args) => args.includes("checkout") && args.includes("FETCH_HEAD"))).toBe(true);
    expect(gitArgs.some((args) => args.includes("submodule"))).toBe(true);
    expect(gitArgs[gitArgs.length - 1]).toEqual(["-C", expect.any(String), "rev-parse", "HEAD"]);
  });

  it("defaults the ref to HEAD when omitted", async () => {
    const { deps, gitArgs } = makeDeps(HIGH);
    const report = await runScan("rextorsec/demo", undefined, deps);
    expect(report.ref).toBe("HEAD");
    const fetch = gitArgs.find((args) => args.includes("fetch"));
    expect(fetch?.[fetch.length - 1]).toBe("HEAD");
  });

  it("an unscoped incomplete report is an INCOMPLETE scan: status 1, null score, honest reason + cause", async () => {
    // "no-sol-sources" is the analyzer scripts' enumerated nothing-in-scope
    // emission → the report boundary classifies it "content".
    const { deps } = makeDeps('{"status":"incomplete","reason":"no-sol-sources"}');
    const report = await runScan("rextorsec/demo", "main", deps);
    expect(report.status).toBe(1);
    expect(report.risk_score).toBeNull();
    expect(report.finding_count).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.incomplete).toBe("no-sol-sources");
    expect(report.incompleteCause).toBe("content");
  });

  it("an analyzer failure is INCOMPLETE (infra cause), head sha preserved", async () => {
    const { deps } = makeDeps("", {
      runAnalyzer: async () => {
        throw new Error("docker daemon gone");
      },
    });
    const report = await runScan("rextorsec/demo", "main", deps);
    expect(report.status).toBe(1);
    expect(report.risk_score).toBeNull();
    expect(report.head_sha).toBe(SHA);
    expect(report.incomplete).toBe("analyzer failed: docker daemon gone");
    expect(report.incompleteCause).toBe("infra");
  });

  it("an unparseable report is INCOMPLETE, never a silent clean pass", async () => {
    const { deps } = makeDeps("not json at all");
    const report = await runScan("rextorsec/demo", "main", deps);
    expect(report.status).toBe(1);
    expect(report.incomplete).toMatch(/^unparseable analyzer report: /);
  });

  it("a scoped dual-dispatch degradation scores the clean side and carries visible notes", async () => {
    const ndjson = `{"status":"incomplete","reason":"anchor build failed","scope":"solana"}\n${HIGH}\n`;
    const { deps } = makeDeps(ndjson);
    const report = await runScan("rextorsec/demo", "main", deps);
    expect(report.status).toBe(0); // the EVM side scanned clean — same as a PR review
    expect(report.degraded).toEqual(["solana: anchor build failed"]);
    expect(report.risk_score).toBe(25);
  });

  it("a clone failure is INCOMPLETE with an empty head sha and a redacted token", async () => {
    const { deps, gitArgs } = makeDeps(HIGH, {
      runGit: async (args) => {
        if (!args.includes("fetch")) return "";
        throw new Error(`fatal: could not read from x-access-token:${TOKEN}@github.com: 403`);
      },
    });
    const report = await runScan("rextorsec/demo", "main", deps);
    expect(report.status).toBe(1);
    expect(report.head_sha).toBe("");
    expect(report.risk_score).toBeNull();
    expect(report.incomplete).toMatch(/^git clone failed for rextorsec\/demo@main: /);
    expect(report.incompleteCause).toBe("infra");
    expect(report.incomplete).not.toContain(TOKEN);
    expect(report.incomplete).toContain("***");
    expect(gitArgs.some((args) => args.includes("rev-parse"))).toBe(false);
  });

  it("removes the clone dir exactly once on every path", async () => {
    const ok = makeDeps(HIGH);
    await runScan("rextorsec/demo", "main", ok.deps);
    expect(ok.cleaned).toHaveLength(1);
    const failing = makeDeps("", {
      runAnalyzer: async () => {
        throw new Error("boom");
      },
    });
    await runScan("rextorsec/demo", "main", failing.deps);
    expect(failing.cleaned).toHaveLength(1);
  });
});

describe("scan input validation", () => {
  it("accepts owner/name slugs over the URL-safe charset", () => {
    expect(isValidScanRepo("rextorsec/rextor-audit")).toBe(true);
    expect(isValidScanRepo("a.b_c-d/e.f_g-h")).toBe(true);
    expect(isValidScanRepo("1/2")).toBe(true);
  });

  it("rejects repo slugs that are not owner/name or try to walk out", () => {
    expect(isValidScanRepo("noslash")).toBe(false);
    expect(isValidScanRepo("a/b/c")).toBe(false);
    expect(isValidScanRepo("")).toBe(false);
    expect(isValidScanRepo("a/")).toBe(false);
    expect(isValidScanRepo("/a")).toBe(false);
    expect(isValidScanRepo("a/..")).toBe(false);
    expect(isValidScanRepo("../etc")).toBe(false);
    expect(isValidScanRepo("a/b c")).toBe(false);
    expect(isValidScanRepo("a/b$bad")).toBe(false);
  });

  it("accepts safe git refs: branches, tags, shas, full refspecs", () => {
    expect(isValidScanRef("main")).toBe(true);
    expect(isValidScanRef("HEAD")).toBe(true);
    expect(isValidScanRef("v2.1.0")).toBe(true);
    expect(isValidScanRef("feature/x")).toBe(true);
    expect(isValidScanRef(SHA)).toBe(true);
    expect(isValidScanRef("refs/heads/main")).toBe(true);
  });

  it("rejects refs that are option injection, ranges, reflog, lock, or path forms", () => {
    expect(isValidScanRef("")).toBe(false);
    expect(isValidScanRef("--upload-pack=evil")).toBe(false);
    expect(isValidScanRef("-oProxyCommand=x")).toBe(false);
    expect(isValidScanRef("main..other")).toBe(false);
    expect(isValidScanRef("a@{b}")).toBe(false);
    expect(isValidScanRef("main.lock")).toBe(false);
    expect(isValidScanRef("/absolute")).toBe(false);
    expect(isValidScanRef("trailing/")).toBe(false);
    expect(isValidScanRef("a b")).toBe(false);
    expect(isValidScanRef("a~b")).toBe(false);
    expect(isValidScanRef("a^b")).toBe(false);
    expect(isValidScanRef("a:b")).toBe(false);
    expect(isValidScanRef("*")).toBe(false);
    expect(isValidScanRef("x".repeat(201))).toBe(false);
  });
});
