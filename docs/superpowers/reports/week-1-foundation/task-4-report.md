# Task 4 Report: Findings normalizer + riskScore rubric v0

**Commit:** `922a9c6` — `feat: findings normalizer + rubric v0` (GPG-signed, no attribution trailers)
**Branch:** `feat/week-1-engine-loop` (on top of `dfbe862`)

## Implementation — `packages/agent/src/findings.ts` (127 lines)

Per SPEC-1 §3 (binding contract):

- **`Finding`** interface + exported `Severity` type — `file: string`, `line: number`, `severity: "critical"|"high"|"medium"|"low"`, `check: string`, `description: string` (matches SPEC-1 §1 NDJSON shape verbatim).
- **`normalizeFindings(ndjson: string): Finding[]`** — splits on `\n`, trims each line, skips blank lines (trailing-newline tolerance), and parses each remaining line:
  - `{"status":"incomplete","reason":…}` → throws **`IncompleteReportError(reason)`** (exported class; `reason` property preserved verbatim, `name` set, message embeds reason). Non-string reasons fall back to a JSON rendering — never `undefined`.
  - Non-JSON line → throws `findings NDJSON line N is not valid JSON: <preview>` (original parse error attached as `cause`; preview truncated at 120 chars).
  - Valid JSON that isn't a finding object (non-object, array, missing/mistyped `file`/`line`/`check`/`description`, severity outside the union) → throws with the 1-based line number. **No silent skips anywhere** — the SPEC-1-forbidden failure mode is structurally impossible.
- **`score(findings: Finding[]): number`** — pure; rubric v0 in a `Record<Severity, number>` (`critical 60 · high 25 · medium 10 · low 3`), sum, `Math.min(total, 100)`. The `Record` keyed by the severity union makes the rubric exhaustive at compile time: adding a severity forces a rubric decision.
- TypeScript strict, zero `any` (parse result handled as `unknown` → narrowed via guards). No dependencies.

## TDD evidence

**RED** — test written first; module absent:

```
$ pnpm vitest run test/findings.test.ts
 FAIL  test/findings.test.ts
Error: Cannot find module '../src/findings' imported from .../test/findings.test.ts
Test Files  1 failed (1)   Tests  no tests   EXIT=1
```

**GREEN** — after implementing `src/findings.ts`:

```
$ pnpm exec tsc --noEmit            # clean
$ pnpm vitest run test/findings.test.ts
 Test Files  1 passed (1)   Tests  11 passed (11)
```

**Full suite:**

```
$ pnpm vitest run
 Test Files  3 passed (3)   Tests  23 passed (23)  (12 existing + 11 new)
```

at `--testTimeout=180000`; at default timeouts the suite is 22/23 — see Concerns.

## Test coverage — `packages/agent/test/findings.test.ts` (11 cases)

Brief vector + SPEC-1 contract pins:

1. Known vector: two highs + one medium → `min(100, 25+25+10) = 60`.
2. NDJSON parses to findings with exact fields (`toEqual` on full objects).
3. Empty string → `[]`, score `0`.
4. Trailing-newline / blank-line tolerance (trailing `\n`, `\n\n`, leading blank line).
5. Incomplete line → `IncompleteReportError` with reason preserved exactly.
6. Malformed non-JSON line → throws with line number (`/line 2/`).
7. Valid-JSON non-finding line → throws (never silently skips).
8. Unknown severity (`"info"`) → throws.
9. Per-severity weights: critical 60 / high 25 / medium 10 / low 3 (low pinned separately — a low→0 regression passes nothing else).
10. Cap boundary: 2 criticals (120→100), exactly 4 highs (100→100), 4 highs + medium (110→100).
11. Zero findings → score 0.

## Files changed

- `packages/agent/src/findings.ts` (new)
- `packages/agent/test/findings.test.ts` (new)

## Self-review (`git show 922a9c6`)

- Export surface is exactly the SPEC-1 §3 contract + `Severity`/`IncompleteReportError` (required export).
- Error contract: every rejection path carries the 1-based line number — an operator can point at the offending analyzer output byte-for-byte.
- `score` is recomputable from published findings JSON alone (no global state, no clock).
- Project rule `ts-no-tiny-functions` honored: single-use `truncate` inlined at its call site; `show` kept (4 call sites, lockstep behavior).
- Commit contains exactly the two mandated files; message verbatim per brief.

## Concerns

1. **Pre-existing flake, not mine (verified):** `test/analyzer.contract.test.ts` "exits 0 with empty stdout on a zero-findings repo" has **no explicit timeout** and shells out to `docker run` on the Foundry-based `fixtures/vault-clean`. When that container run is cold/slow (observed ~34s; ~4.5s warm), vitest's default 5s `testTimeout` kills it. Evidence it's environmental and unrelated to this change: (a) passes 3/3 standalone with `--testTimeout=180000`; (b) full suite passes 23/23 with the same flag; (c) the test never imports `src/findings` (my files were untracked and inert during the failing runs); (d) it was green at session start per controller context. **Recommendation for controller:** one-line fix — pass a generous timeout to that `it(...)` (e.g. 120s). I did not touch the sibling-owned file; my commit is exactly the two mandated files.
2. `line` validated as finite number per SPEC-1 §1 (not constrained to positive integer — the spec pins `number`, nothing narrower).
3. A JSON line with a `status` field other than `"incomplete"` falls through to finding-shape validation and throws a field-level error — explicit, consistent with the no-silent-skip rule (SPEC defines only the two line kinds).
