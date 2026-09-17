### Task 3: SPEC-2 pipeline integration — triage in runReview + PR comment v1

**Files:**
- Create: `packages/agent/test/triage-pipeline.test.ts`
- Modify: `packages/agent/src/review.ts`, `packages/agent/src/triage.ts`, `packages/agent/src/github.ts`, `packages/agent/test/review.test.ts`, `packages/agent/test/github.test.ts`

**Interfaces:**
- Consumes (T1+T2 exact names): `validateOps`, `applyTriage`, `buildCitationUniverse`, `TriageOp`, `UniverseEntry`, `withIds`, `scoreV1`, `canonicalFindingsJson`, `chatCompletion`, `extractJsonArray`, `triageModelFor`, `TriageUnavailableError`, `PROFILE_V1_SYSTEM`, `buildTriageUserMessage`.
- Produces:
  - `triage.ts` adds: `export interface TriageResult { finalFindings: Finding[]; ops: TriageOp[]; rejectedOps: Array<{ op: unknown; reason: string }>; modelUsed: string; triageStatus: "complete" | "incomplete" }`; `export const NO_TRIAGE_MODEL = "none (unconfigured)"`; `export function rawFindingsResult(findings: Finding[]): TriageResult`; `export function triageFromEnv(readEnv?: () => NodeJS.ProcessEnv): (findings: Finding[], scope: DiffScopeResult) => Promise<TriageResult>` (env resolved PER CALL; unset env → `rawFindingsResult` with `modelUsed: NO_TRIAGE_MODEL`).
  - `review.ts`: `ReviewDeps` gains `triage?: (findings: Finding[], scope: DiffScopeResult) => Promise<TriageResult>`; `summaryCommentBody(scoreValue: number, triaged: TriageResult): string` (NEW SIGNATURE — all callers/tests updated); `runReview` inserts triage between normalize and score; soft-incomplete on missing/throwing dep.

- [ ] **Step 1: Write the failing tests**

`packages/agent/test/triage-pipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runReview, summaryCommentBody, type ReviewDeps } from "../src/review";
import { NO_TRIAGE_MODEL, rawFindingsResult, triageFromEnv, type TriageResult } from "../src/triage";
import { scoreV1, withIds, type Finding } from "../src/findings";

const finding: Finding = { id: 0, file: "src/V.sol", line: 10, severity: "high", check: "reentrancy-eth", description: "reentrant call" };
const scope = {
  contractFiles: [{ path: "src/V.sol", changedLineRanges: [[10, 10] as [number, number]], isContract: true as const }],
  hasContractChanges: true,
};

const fakeDeps = (triage?: ReviewDeps["triage"], ndjson = JSON.stringify({ file: "src/V.sol", line: 10, severity: "high", check: "reentrancy-eth", description: "reentrant call" })) => {
  const comments: string[] = [];
  const deps: ReviewDeps = {
    clone: async () => "/tmp/fake",
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
    expect(body).not.toMatch(/\[link\]\(https:\/\/evil/);   // no live link
    expect(body).not.toMatch(/!\[img\]/);                    // no live image
    expect(body).not.toMatch(/@owner/);                      // no mention notification
    expect(body).toContain("LLM triage unavailable") === false; // triage DID complete
  });
});

describe("summaryCommentBody v1", () => {
  it("renders ops trail, rejected count, model line, findings JSON details block", () => {
    const t: TriageResult = {
      finalFindings: withIds([finding]),
      ops: [{ op: "dedup", canonicalId: 0, duplicateIds: [] } as never], // counts as 1 dedup op for the line
      rejectedOps: [{ op: {}, reason: "x" }],
      modelUsed: "vendor/m", triageStatus: "complete",
    };
    const body = summaryCommentBody(25, t);
    expect(body).toContain("risk score: 25/100");
    expect(body).toContain("Triaged by `vendor/m` @ temp 0");
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
    const triage = triageFromEnv(readEnv);
    // @ts-expect-error test seam: inject fetch
    globalThis.__rextorFetch = fakeFetch('[{"op":"reclassify","id":0,"severity":"low","reason":"guarded"}]');
    const res = await triage([finding], scope);
    expect(res.triageStatus).toBe("complete");
    expect(res.finalFindings[0].severity).toBe("low");
    expect(res.modelUsed).toBe("vendor/front"); // high finding → frontier
    delete (globalThis as Record<string, unknown>).__rextorFetch;
  });

  it("unset env → soft-incomplete with NO_TRIAGE_MODEL, no network", async () => {
    const res = await triageFromEnv(() => ({}))([finding], scope);
    expect(res.triageStatus).toBe("incomplete");
    expect(res.modelUsed).toBe(NO_TRIAGE_MODEL);
  });
});
```

NOTE on the fetch seam: rather than a global, make `triageFromEnv` accept an optional second arg `opts?: { fetchFn?: typeof fetch }` used by tests to inject the transport — cleaner than globals; adjust the test accordingly (`triageFromEnv(readEnv, { fetchFn: fakeFetch(...) })`). Implement that signature.

Also update existing `review.test.ts` + `github.test.ts` call sites of `summaryCommentBody(score, findings)` → `summaryCommentBody(score, rawFindingsResult(findings))` (import from triage), and add one github test asserting the default deps object now includes a `triage` function when constructed (it always does — `triage: triageFromEnv()`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run test/triage-pipeline.test.ts`
Expected: FAIL — `TriageResult`/`rawFindingsResult` not exported; `summaryCommentBody` arity mismatch.

- [ ] **Step 3: Implement**

`triage.ts` — append:

```ts
import { chatCompletion, extractJsonArray, triageModelFor, TriageUnavailableError, type ChatMessage } from "./openrouter";
import { PROFILE_V1_SYSTEM, buildTriageUserMessage } from "./profile";
import { withIds } from "./findings";

export interface TriageResult {
  finalFindings: Finding[];
  ops: TriageOp[];
  rejectedOps: Array<{ op: unknown; reason: string }>;
  modelUsed: string;
  triageStatus: "complete" | "incomplete";
}

export const NO_TRIAGE_MODEL = "none (unconfigured)";

export function rawFindingsResult(findings: Finding[]): TriageResult {
  return { finalFindings: findings, ops: [], rejectedOps: [], modelUsed: NO_TRIAGE_MODEL, triageStatus: "incomplete" };
}

/** Default triage dep: env resolved per call (SPEC-1 env-at-call-time pattern). */
export function triageFromEnv(
  readEnv: () => NodeJS.ProcessEnv = () => process.env,
  opts: { fetchFn?: typeof fetch } = {},
): (findings: Finding[], scope: DiffScopeResult) => Promise<TriageResult> {
  return async (findingsIn, scope) => {
    const env = readEnv();
    const model = triageModelFor(findingsIn, env);
    const apiKey = env.OPENROUTER_API_KEY;
    if (!model || !apiKey) {
      if (model === null && (env.REXTOR_TRIAGE_MODEL || env.REXTOR_FRONTIER_MODEL || apiKey)) {
        console.warn("[rextor] triage env incomplete — need OPENROUTER_API_KEY, REXTOR_TRIAGE_MODEL, REXTOR_FRONTIER_MODEL; running untriaged");
      }
      return rawFindingsResult(findingsIn);
    }
    const findings = withIds(findingsIn);
    const universe = buildCitationUniverse(findings, scope);
    const messages: ChatMessage[] = [
      { role: "system", content: PROFILE_V1_SYSTEM },
      { role: "user", content: buildTriageUserMessage(findings, universe) },
    ];
    try {
      let raw = await chatCompletion({ apiKey, model, fetchFn: opts.fetchFn }, messages);
      let parsed = extractJsonArray(raw);
      if (parsed === null) {
        // SPEC-2 §3: retry ONCE with a corrective note.
        raw = await chatCompletion({ apiKey, model, fetchFn: opts.fetchFn }, [
          ...messages,
          { role: "assistant", content: raw.slice(0, 500) },
          { role: "user", content: "Your previous output was not valid JSON. Return ONLY the JSON array." },
        ]);
        parsed = extractJsonArray(raw);
      }
      if (parsed === null) throw new TriageUnavailableError("no JSON array in response after retry");
      const { valid, rejected } = validateOps(parsed, findings, universe);
      return {
        finalFindings: applyTriage(findings, valid),
        ops: valid,
        rejectedOps: rejected,
        modelUsed: model,
        triageStatus: "complete",
      };
    } catch (err) {
      console.error("[rextor] triage failed:", err instanceof Error ? err.message : err);
      return {
        ...rawFindingsResult(findings),
        modelUsed: model,
      };
    }
  };
}
```

`review.ts` — changes:

1. `ReviewDeps` gains: `/** LLM triage (SPEC-2); absent or failing → soft-incomplete. */ triage?: (findings: Finding[], scope: DiffScopeResult) => Promise<TriageResult>;`
2. `summaryCommentBody` new signature + rendering:

```ts
const MAX_FINDINGS_JSON_CHARS = 20_000;

const countOps = (t: TriageResult) => ({
  dedup: t.ops.filter((o) => o.op === "dedup").length,
  reclassify: t.ops.filter((o) => o.op === "reclassify").length,
  add: t.ops.filter((o) => o.op === "add").length,
});

function triageLine(t: TriageResult): string {
  if (t.triageStatus === "complete") {
    const c = countOps(t);
    const rej = t.rejectedOps.length > 0 ? ` · ${t.rejectedOps.length} non-conforming op(s) rejected` : "";
    return `Triaged by \`${cell(t.modelUsed)}\` @ temp 0 · ops: ${c.dedup} dedup · ${c.reclassify} reclassify · ${c.add} added${rej}`;
  }
  if (t.modelUsed !== NO_TRIAGE_MODEL) {
    return `Triage with \`${cell(t.modelUsed)}\` did not complete — raw analyzer findings shown.`;
  }
  return "_LLM triage not configured (set OPENROUTER_API_KEY, REXTOR_TRIAGE_MODEL, REXTOR_FRONTIER_MODEL)._";
}

function findingRow(f: Finding): string {
  const note = f.triageNote
    ?? (f.mergedChecks ? `merged: ${f.mergedChecks.join(", ")}` : "");
  return `| #${f.id ?? "—"} | ${f.severity} | ${cell(f.check)} | ${cell(f.file)}:${f.line} | ${cell(note)} |`;
}

export function summaryCommentBody(scoreValue: number, triaged: TriageResult): string {
  const findings = triaged.finalFindings;
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  const rendered = sorted.slice(0, MAX_RENDERED_FINDINGS);
  const hidden = findings.length - rendered.length;
  const banner =
    triaged.triageStatus === "incomplete"
      ? ["**LLM triage unavailable — findings below are raw analyzer output.**", ""]
      : [];
  const json = canonicalFindingsJson(findings);
  const jsonBlock =
    json.length > MAX_FINDINGS_JSON_CHARS
      ? [`_(findings JSON omitted: ${json.length} chars exceeds the ${MAX_FINDINGS_JSON_CHARS}-char budget — the attested findingsHash covers the full canonical form)_`]
      : ["```json", json, "```"];
  return [
    `## rextor audit — risk score: ${scoreValue}/100`,
    "",
    ...banner,
    `**${findings.length} finding(s)** in changed contract code.`,
    "",
    "| # | severity | check | location | note |",
    "| --- | --- | --- | --- | --- |",
    ...rendered.map(findingRow),
    ...(hidden > 0 ? ["", `...and ${hidden} more findings suppressed.`] : []),
    "",
    triageLine(triaged),
    "",
    "<details><summary>Findings JSON — sha256 of this block = on-chain findingsHash</summary>",
    "",
    ...jsonBlock,
    "",
    "</details>",
  ].join("\n");
}
```

3. `runReview` — replace the scoring/comment section of the success path:

```ts
    let triaged: TriageResult;
    if (deps.triage) {
      try {
        triaged = await deps.triage(withIds(findings), scope);
      } catch (err) {
        console.error("[rextor] triage dep threw:", err instanceof Error ? err.message : err);
        triaged = rawFindingsResult(withIds(findings));
      }
    } else {
      triaged = rawFindingsResult(withIds(findings));
    }

    const scoreValue = scoreV1(triaged.finalFindings);
    await deps.postComment(prUrl, summaryCommentBody(scoreValue, triaged));
    return { commented: true, score: scoreValue };
```

(Imports from `./triage` + `./findings` updated accordingly.)

4. `github.ts` default deps: add `triage: triageFromEnv(),` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run && pnpm typecheck && cd ../.. && pnpm test:run && pnpm typecheck`
Expected: ALL PASS (54 existing updated + ~30 new).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/review.ts packages/agent/src/triage.ts packages/agent/src/github.ts packages/agent/test/
git commit -m "feat: SPEC-2 triage pipeline integration + PR comment v1 (ops trail, banner, findings JSON)"
```

---

