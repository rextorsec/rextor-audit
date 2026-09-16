// SPEC-2 §4 — pipeline integration: triage runs between normalize and score,
// the PR comment renders the triage trail, and the default triage dep is
// env-driven with an injectable fetch seam (never a global, never live in tests).
import { describe, expect, it } from "vitest";
import { runReview, summaryCommentBody, type ReviewDeps } from "../src/review";
import { NO_TRIAGE_MODEL, rawFindingsResult, triageFromEnv, type TriageResult } from "../src/triage";
import { canonicalFindingsJson, scoreV1, withIds, type Finding } from "../src/findings";

const finding: Finding = { id: 0, file: "src/V.sol", line: 10, severity: "high", check: "reentrancy-eth", description: "reentrant call" };
const scope = {
  contractFiles: [{ path: "src/V.sol", changedLineRanges: [[10, 10] as [number, number]], isContract: true as const }],
  hasContractChanges: true,
};

const fakeDeps = (triage?: ReviewDeps["triage"], ndjson = JSON.stringify({ file: "src/V.sol", line: 10, severity: "high", check: "reentrancy-eth", description: "reentrant call" })) => {
  const comments: string[] = [];
  const deps: ReviewDeps = {
    clone: async () => ({ dir: "/tmp/fake", headSha: "a".repeat(40) }),
    fetchDiff: async () => "diff --git a/src/V.sol b/src/V.sol\n@@ -10,1 +10,1 @@\n+x",
    runAnalyzer: async () => ndjson,
    postComment: async (_url, body) => { comments.push(body); },
    dispose: async () => {},
    ...(triage ? { triage } : {}),
  };
  return { deps, comments };
};

describe("runReview triage integration", () => {
  it("applies triage ops and scores the FINAL findings (rubric v1)", async () => {
    const triage = async (findings: Finding[]): Promise<TriageResult> => {
      expect(findings).toHaveLength(1);
      return {
        finalFindings: [{ ...findings[0], severity: "medium", triageNote: "guard added" }],
        ops: [{ op: "reclassify", id: 0, severity: "medium", reason: "guard added" }],
        rejectedOps: [], modelUsed: "vendor/m", triageStatus: "complete",
      };
    };
    const { deps, comments } = fakeDeps(triage);
    const res = await runReview("https://github.com/o/r/pull/1", deps);
    expect(res.score).toBe(scoreV1([{ ...finding, severity: "medium", triageNote: "guard added" }])); // 10
    expect(comments[0]).toContain("guard added");
    expect(comments[0]).toContain("vendor/m");
  });

  it("missing triage dep → soft-incomplete: banner, raw findings, score from raw", async () => {
    const { deps, comments } = fakeDeps();
    const res = await runReview("https://github.com/o/r/pull/1", deps);
    expect(res.score).toBe(25); // raw high
    expect(comments[0]).toContain("LLM triage unavailable");
    expect(comments[0]).toContain("raw analyzer output");
  });

  it("throwing triage dep → soft-incomplete, comment still posted", async () => {
    const { deps, comments } = fakeDeps(async () => { throw new Error("LLM down"); });
    const res = await runReview("https://github.com/o/r/pull/1", deps);
    expect(res.commented).toBe(true);
    expect(comments[0]).toContain("LLM triage unavailable");
  });

  it("hard-incomplete (analyzer) short-circuits BEFORE triage", async () => {
    let triageRan = false;
    const { deps, comments } = fakeDeps(async () => { triageRan = true; return rawFindingsResult([finding]); }, '{"status":"incomplete","reason":"solc missing"}');
    await runReview("https://github.com/o/r/pull/1", deps);
    expect(triageRan).toBe(false);
    expect(comments[0]).toContain("INCOMPLETE");
  });

  it("injection payloads in LLM-touched strings render inert", async () => {
    const evil = '[link](https://evil.example) ![img](x) @owner `tick` | pipe\nnewline';
    const triage = async (findings: Finding[]): Promise<TriageResult> => ({
      finalFindings: [{ ...findings[0], triageNote: evil, description: evil }],
      ops: [{ op: "reclassify", id: 0, severity: "high", reason: evil }],
      rejectedOps: [], modelUsed: "vendor/m", triageStatus: "complete",
    });
    const { deps, comments } = fakeDeps(triage);
    await runReview("https://github.com/o/r/pull/1", deps);
    const body = comments[0];
    // Rendered markdown (everything before the attested JSON fence) must carry
    // no live link, no live image, no mention notification. The JSON block is
    // the EXACT canonical form (findingsHash attests it) — inert by fence.
    const rendered = body.slice(0, body.indexOf("<details>"));
    expect(rendered).not.toMatch(/\[link\]\(https:\/\/evil/);   // no live link
    expect(rendered).not.toMatch(/!\[img\]/);                   // no live image
    // Escaped mentions (`\@owner`) do not fire bot-identity notifications;
    // a bare unescaped `@owner` anywhere in the rendered markdown would.
    expect(rendered).not.toMatch(/(^|[^\\])@owner/);
    expect(body).not.toContain("LLM triage unavailable"); // triage DID complete
  });
});

describe("summaryCommentBody v1", () => {
  it("renders ops trail, rejected count, model line, findings JSON details block", () => {
    const t: TriageResult = {
      finalFindings: withIds([finding, { ...finding, check: "reentrancy-no-eth" }]),
      ops: [{ op: "dedup", canonicalId: 0, duplicateIds: [1] }],
      rejectedOps: [{ op: {}, reason: "x" }],
      modelUsed: "vendor/m", triageStatus: "complete",
    };
    const body = summaryCommentBody(25, t);
    expect(body).toContain("risk score: 25/100");
    expect(body).toContain("Triaged by `vendor/m` @ temp 0");
    expect(body).toContain("1 dedup");
    expect(body).toContain("1 non-conforming op");
    expect(body).toContain("<details>");
    expect(body).toContain("```json");
    expect(body).toContain(canonicalFindingsJson(t.finalFindings));
  });

  it("notes omitted JSON when over budget, unconfigured line when env absent", () => {
    const big: Finding[] = withIds([{ ...finding, description: "x".repeat(21_000) }]);
    const body = summaryCommentBody(25, rawFindingsResult(big));
    expect(body).toContain("omitted");
    expect(body).toContain("LLM triage not configured");
  });
});

describe("triageFromEnv (default dep)", () => {
  const fakeFetch = (content: string) =>
    (async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) })) as unknown as typeof fetch;

  it("happy path: ids assigned, LLM ops validated + applied", async () => {
    const readEnv = () => ({
      OPENROUTER_API_KEY: "k",
      REXTOR_TRIAGE_MODEL: "vendor/base",
      REXTOR_FRONTIER_MODEL: "vendor/front",
    });
    const triage = triageFromEnv(readEnv, { fetchFn: fakeFetch('[{"op":"reclassify","id":0,"severity":"low","reason":"guarded"}]') });
    const res = await triage([finding], scope);
    expect(res.triageStatus).toBe("complete");
    expect(res.finalFindings[0].severity).toBe("low");
    expect(res.modelUsed).toBe("vendor/front"); // high finding → frontier
  });

  it("unset env → soft-incomplete with NO_TRIAGE_MODEL, no network", async () => {
    const res = await triageFromEnv(() => ({}))([finding], scope);
    expect(res.triageStatus).toBe("incomplete");
    expect(res.modelUsed).toBe(NO_TRIAGE_MODEL);
  });
});
