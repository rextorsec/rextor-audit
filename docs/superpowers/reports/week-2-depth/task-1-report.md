# Task 1 Report — SPEC-2 triage core (pure)

**Status:** DONE
**Commit:** `6b08523` — `feat: SPEC-2 triage core — op schema, validation, application, rubric v1, findingsHash`
**Branch:** `feat/week-2-depth` (base f5e22a2)

## What was implemented

- `packages/agent/src/findings.ts`:
  - Exported `SEVERITIES` (was private), added `PocInfo`, extended `Finding` with optional `id`/`triageNote`/`mergedChecks`/`poc`.
  - Added `withIds` (stable 0-based analyzer-order ids, non-destructive), `scoreV1` (rubric v1: v0 weights + critical-unproven→25, cap 100), `stableValue` (private: recursive key-sort + undefined-drop), `canonicalFindingsJson` (compact JSON, sorted keys at every level, backticks → `\u0060`), `findingsHash` (sha256 hex over the canonical bytes, `node:crypto`).
  - `normalizeFindings`/`score`/`parseFindingLine` untouched — analyzer NDJSON shape stays frozen at the five base fields; new optional fields cannot leak in from analyzer output.
- `packages/agent/src/triage.ts` (new): `TriageOp`, `UniverseEntry`, `TriageOutcome`, `buildCitationUniverse` (finding file:line ∪ scoped changedLineRanges), `validateOps` (all rejection rules incl. cross-op dedup tracking: removed/usedAsDup), `applyTriage` (category order dedup → reclassify → add; `mergedChecks` attribution merge; `rextor/` prefix forced on adds; fresh sequential ids).
- `packages/agent/src/diff-scope.ts`: added `export type Scope = DiffScopeResult;` alias.
- Tests: `packages/agent/test/triage.test.ts` (new, 21 tests) and appended blocks in `packages/agent/test/findings.test.ts` (10 tests), per the brief's verbatim code.

## TDD evidence

**RED** (`cd packages/agent && pnpm vitest run test/triage.test.ts test/findings.test.ts`, before implementation):
```
 Test Files  2 failed (2)
      Tests  10 failed | 13 passed (23)
```
Failures were `TypeError: withIds is not a function` / missing exports — exactly the expected "not exported" failure mode.

**GREEN** (same command, after implementation):
```
 Test Files  2 passed (2)
      Tests  44 passed (44)
```

**Full gate** (brief Step 4):
```
cd packages/agent && pnpm vitest run && pnpm typecheck && cd ../.. && pnpm test:run && pnpm typecheck
 Test Files  7 passed (7)
      Tests  85 passed (85)      // 54 pre-existing + 31 new
> tsc --noEmit                 // clean
 Tasks:    1 successful, 1 total   // turbo test:run
GATE GREEN
```
Re-run again after the amend: 85/85 + both typechecks green.

## Externally computed sha256 vector

```
printf %s '[{"check":"c","description":"d","file":"src/V.sol","id":0,"line":1,"severity":"low"}]' | shasum -a 256
→ e68cea4f66e1dde2b0bdba549c0d57ae7d37550a35896f946459666fd607a244
```
Computed via shell **before** the implementation existed (never derived by calling `findingsHash`); pasted into the test.

## Files changed

- `packages/agent/src/findings.ts` (+51/-1)
- `packages/agent/src/triage.ts` (new, +120)
- `packages/agent/src/diff-scope.ts` (+3)
- `packages/agent/test/triage.test.ts` (new, +117)
- `packages/agent/test/findings.test.ts` (+52)

## Deviations from verbatim brief code (all flagged, all behavior-preserving)

1. **`isId` type guard (triage.ts)** — brief's `Number.isInteger(v) && v >= 0` fails typecheck under the repo's TypeScript 7.0.2 (tsgo): `Number.isInteger` does not narrow, so `v >= 0` reads `v: unknown` → TS18046. Fixed as `typeof v === "number" && Number.isInteger(v) && v >= 0` (semantically identical — `Number.isInteger` is false for every non-number). Same pattern as the file's own `requireNumber`.
2. **Missing type imports in test append** — the brief's findings.test.ts snippet references `Severity` and `PocInfo["status"]` without importing them; added `type PocInfo, type Severity` to the appended import block. (Same cosmetic-blemish class as ledger Ruling 3; corrected intent.)
3. **Unused `createHash` import in test append** — the brief's snippet imports it but never uses it (leftover; the vector is deliberately external). Removed.

## Self-review findings

- Verified every Interface-block name is exported under the exact binding names/signatures (T2 consumes `UniverseEntry`; T3 consumes `validateOps`/`applyTriage`/`TriageOp`).
- Verified `applyTriage` id allocation cannot collide: `nextId = max(live ids)+1`, and deduped ids are absent from the output entirely.
- Test hygiene: tests assert observable contracts (rejection reasons truthy, application semantics, canonical form, externally-fixed hash) — no implementation pinning beyond the SPEC-2-published canonical literal. The `f`/`good` test helpers are brief-authored test seams.
- One commit, exact brief message, GPG-signed from global config, zero AI attribution; working tree clean after commit.

## Concerns

- None blocking. The `isId` TS7 deviation (item 1 above) is the only semantic-adjacent judgment call; it is behavior-identical and covered by the rejection tests.
