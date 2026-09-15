# Task 3 Report — agent package scaffold + diff-scope module

**Commit:** `3e46673` — `feat: agent scaffold + diff-scope with contract-path classification`
**Branch:** `feat/week-1-engine-loop` (not switched; repo had advanced to `2304ddd` EVM-first pivot before I started — no conflicts with my scope)

## What was implemented

- **`packages/agent/package.json`** — `@rextor/agent`, private, `"type": "module"`, `scripts.test = "vitest run"`, devDeps `tsx ^4.23.13`, `typescript ^7.0.2`, `vitest ^5.0.1` (current registry versions at install time).
- **`packages/agent/tsconfig.json`** — minimal strict config: `strict: true`, `module`/`moduleResolution: NodeNext`, `target ES2022`, `noEmit`, `skipLibCheck`.
- **`packages/agent/vitest.config.ts`** — empty `defineConfig({})`.
- **`packages/agent/src/diff-scope.ts`** — `scopeDiff(diff)` per SPEC-1 §2:
  - Parses `diff --git a/x b/x` headers for the new-side path. Unquoted paths split at the last ` b/` (spaces survive); quoted paths (`"a/…" "b/…"`) handled minimally with C-escape unescaping (`\"`, `\\`, `\n`, `\t`; octal UTF-8 escapes left as-is — exotic, out of scope).
  - Hunk math from `@@ -a[,b] +c[,d] @@` (count-less forms default to 1): `+` lines recorded at the running NEW-file line number; `-` lines advance only the old side; context advances both; `\ No newline at end of file` skipped; hunk termination by consumed counts (also survives truncated fixtures like the test's).
  - Added lines merged into contiguous ranges (`Array<[number, number]>`), one range per run.
  - `ScopedFile = { path, changedLineRanges, isContract: true }` (literal `true` per SPEC-1 §2); `CONTRACT_PATH_RE = /(\.sol$|(^|\/)contracts\/|(^|\/)programs\/)/` exported verbatim.
  - Deletion-only hunks on contract files yield `changedLineRanges: []` but the file is still listed and `hasContractChanges` stays true — a contract deletion IS a contract change for a scoper. `hasContractChanges = contractFiles.length > 0`, so docs-only diffs give `false` per SPEC-1 §2.
- **`packages/agent/test/diff-scope.test.ts`** — brief Step-2 test verbatim **except**:
  1. **Ruling 4 applied:** second case uses the plain README-only string literal; dead `.prepend` ternary dropped (behavior preserved — it always evaluated to that literal).
  2. **Flagged deviation (see below):** first case expects `[[11, 11]]`, not the brief's `[[14, 14]]`.

## Deviation from brief: `[[14, 14]]` → `[[11, 11]]` (needs controller awareness)

The brief's first test expects `changedLineRanges: [[14, 14]]`, but its own fixture says `@@ -10,4 +10,9 @@` with a one-line context then one added line:

- SPEC-1 §2 (binding): ranges are NEW-file line numbers of added lines.
- Brief Step 4 + task brief restatement: added lines start at `c` (= 10), tracked through `+` lines → context consumes 10, the added line is 11.

`[[14, 14]]` is unreachable without corrupting the parser (e.g. a bogus +3 offset), so I corrected the expectation to `[[11, 11]]`, kept the fixture verbatim, and left an in-test comment. Alternative (mutating the fixture header to `+13,…` to preserve `[[14, 14]]`) rejected: it would have changed the input instead of the derived expectation. Overrule and I'll flip it — one-line change.

## TDD evidence

**RED** — `cd packages/agent && pnpm vitest run test/diff-scope.test.ts` (after `pnpm install` at repo root; `src/` not yet written):

```
 FAIL  test/diff-scope.test.ts [ test/diff-scope.test.ts ]
Error: Cannot find module '../src/diff-scope' imported from .../packages/agent/test/diff-scope.test.ts
 Test Files  1 failed (1)
```

**GREEN** — same command after implementing `src/diff-scope.ts`:

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  67ms
```

**Suite check** — `pnpm -r test` at root: only `@rextor/agent` defines a `test` script (`profiles/`, `web/` are `.gitkeep` placeholders; fixtures are foundry/cargo, not pnpm) → 1 file, 2 tests, passed. No other tests exist to break.

**Edge-case smoke** (throwaway tsx script, since the mandated tests don't cover these; script deleted after run — all passed):
- added-run merging `[[2,4]]`; two separated runs `[[2,2],[5,5]]`
- deletion-only contract hunk → `[]` ranges, still flagged
- quoted path with escaped quotes → `contracts/my "vault" file.sol`
- `\ No newline` marker does not shift numbering
- new file via `/dev/null` with `-0,0` counts → `[[1,2]]`
- classifier edges: `src/Foo.sol` ✓ `contracts/a/b.sol` ✓ `programs/x/src/lib.rs` ✓ `test/Foo.t.sol` ✓ (`.sol$`) `README.md` ✗ `src/main.rs` ✗

## Self-review findings (`git show 3e46673`)

- Commit author `RECTOR <rector@rectorspace.com>`, GPG per global config, no AI attribution, exactly 5 intended files, 175 insertions.
- `packages/agent/.gitkeep` left in place — matches sibling placeholder packages (`profiles/`, `web/`); removing it would be a repo-convention call outside this task's exact commit scope.
- No suppressions, no special-cased inputs, no TODOs; exported surface is exactly `scopeDiff`, `CONTRACT_PATH_RE`, `ScopedFile`, `DiffScopeResult`.
- Test import stays brief-verbatim (`"../src/diff-scope"`, extensionless) — vite resolves it; tsc-under-NodeNext would want an extension, but no typecheck script is wired for this package yet (turbo `typecheck` task will need one when Task 2 lands — noted for controller).

## Concerns

1. **The `[[11, 11]]` deviation above** — deliberate, documented in-code; cheapest possible fix if overruled.
2. **`pnpm-lock.yaml` created at repo root by `pnpm install` and NOT committed** (commit command was `git add packages/agent` exactly; lockfile is not gitignored). Tree currently shows `?? pnpm-lock.yaml`. Recommend committing it (chore commit or fold into Task 2's commit) so the workspace is reproducible.
3. **esbuild postinstall blocked** by pnpm 9's script policy ("add to onlyBuiltDependencies") — harmless here: vitest/tssx run fine via the platform optional dep; noting in case a later task needs native build scripts.
4. `isContract` typed as literal `true` per SPEC-1 §2; the SDD brief said `boolean`. SPEC-1 is the binding contract; flagging the discrepancy only.

## Fix round 1 — commit `619757f` (`test: diff-scope edge-case coverage + path-unescape honesty`)

**[IMPORTANT] edge-case coverage committed** — the deleted smoke checks are now permanent `it(...)` cases in `packages/agent/test/diff-scope.test.ts`; the brief-mandated two cases are untouched:
1. `merges contiguous added lines into one range` → `[[2, 4]]` (guards the SPEC-1 §2 mergeRuns contract against split-range regressions)
2. `keeps separated added runs as distinct ranges` → `[[2, 2], [5, 5]]` (guards against merging across gaps)
3. `flags deletion-only contract hunks with empty ranges` → file listed with `changedLineRanges: []`, `hasContractChanges: true`
4. `does not shift numbering across \ No newline markers` → `[[2, 2]]` on a `programs/` path (also covers the Solana classifier branch)
5. `numbers added lines in /dev/null new files from the hunk start` → `[[1, 2]]` from `@@ -0,0 +1,2 @@`
6. `unquotes quoted diff headers with escaped characters` → `contracts/my "vault" file.sol` (guards QUOTED_SIDES_RE + unescaping)
7. `leaves octal escapes in quoted paths untouched` → pins the MINOR fix below (old `/\\(.)/g` would yield `303251` and fail this)

**[MINOR] unescapeGitPath octal honesty** — `src/diff-scope.ts` regex changed from `/\\(.)/g` to `/\\([^0-7])/g`: backslash-escapes are unescaped only when the following char is not an octal digit, so Git octal UTF-8 escapes (`\303\251`) now genuinely pass through untouched (previously the backslash was stripped, mangling them to `303251`). Doc comment rewritten to state the actual behavior and scope rationale.

**Verification** — `cd packages/agent && pnpm vitest run`:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  76ms
```

**Files changed:** `packages/agent/test/diff-scope.test.ts` (+105: 7 new cases), `packages/agent/src/diff-scope.ts` (comment + 1-line regex). Lockfile concern resolved upstream by controller commit `25e5b6d`.
