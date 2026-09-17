# Task 8 Report: SPEC-4 Agent Attestation Integration

**Commit:** `0e8bb5b` — `feat: SPEC-4 agent attestation (viem) — verdict identity, idempotent record, PR footer` (GPG-signed, single commit, no AI attribution, on `feat/week-2-depth`)

## What Was Implemented

### `packages/agent/src/attest.ts` (new)
- `REXTOR_ATTESTATION_ABI` — exact T6 human-readable ABI: `attest(bytes32,bytes32,bytes32,uint16,uint16,uint8)` + `verify(…) view returns (bool)`.
- `AttestRecord` — reviewId / commitHash / findingsHash (`0x${string}`), riskScore, findingCount, status `0|1`.
- `reviewIdFor` — `keccak256("rextor/review/v1|" + owner/repo + "|" + pr + "|" + headSha)` via viem.
- `commitHashFor` — 40-hex git sha lowercased, right-zero-padded to 66 chars; **throws** on non-40-hex.
- `buildAttestRecord` — findingsHash = `"0x" + findingsHash(findings)` **imported from T1's `findings.ts`** (single source of truth — same canonical string, guaranteed). status = incomplete ? 1 : 0.
- `makeAttestDep(readEnv?)` — **undefined** when `REXTOR_AGENT_PRIVATE_KEY` or `REXTOR_ATTEST_CONTRACT_ADDRESS` unset (wiring-time check, matches the pinned test contract `makeAttestDep(() => ({}))` → undefined); returned closure re-reads env at call time, resolves chain via T7 `resolveChain` (`chainId = attestation.chainId ?? testnet.chainId`; null chainId/rpc → `console.error` + null), builds viem wallet+public clients per call, `writeContract(attest…)` → `waitForTransactionReceipt` → `{ txHash, explorerUrl }` (empty explorerUrl when registry has none). 30 s abort via `Promise.race` with cleared timer. **All** failure paths log error *messages only* (secrets never logged) and resolve `null`.
- Note: viem 2.56.5 exports `privateKeyToAccount` only from `viem/accounts`, not the root entry.

### `packages/agent/src/review.ts`
- `ReviewDeps.clone` → `Promise<{ dir, headSha }>` (SPEC-4 §3 binding evolution).
- `ReviewDeps.attest?` → `(record: AttestRecord) => Promise<{ txHash, explorerUrl } | null>`.
- `ReviewResult.attestation?` → `{ chain, reviewId, txHash, explorerUrl } | { skipped }`.
- `runReview`: `attestStage` closure runs **before** `postComment` on **all three** verdict paths — success (final simmed findings + scoreV1, `incomplete=false`), analyzer-failed and normalize-failed (both `[]`, 0, `incomplete=true` → the empty-findings hash). Every failure (no dep → "attestation not configured"; null/throw → "attestation attempt failed") degrades to a skipped footer; the comment always posts. `prIdentity` local parser mirrors `github.ts`'s `PR_URL_RE` (avoids a runtime review↔github cycle); `activeChainName()` from `resolveChain(process.env).name` with try/catch → "tempo".
- `attestationFooter` + `withFooter`: success → `---` / `⚖ attested on <chain> · reviewId \`0x…\` · findingsHash \`0x…\` · [tx \`0xabc…\`](url)` (bare `tx \`0x…\`` when explorerUrl empty); skipped → `_attestation skipped: <reason>_`. Free-text interpolations (chain, skip reason) pass through `cell()`; hex literals stay raw.

### `packages/agent/src/github.ts`
- `runGit` seam → `Promise<string>` (default returns raw `execFileP` stdout; clone trims).
- Real clone appends `git -C <dir> rev-parse HEAD` **inside the token-redacting try**, returns `{ dir, headSha }`.
- Default deps gain `attest: makeAttestDep()` (undefined when env unset → "not configured" footer).

### `packages/agent/test/vectors.ts` (new) + `findings.test.ts` refactor
Shared external vector module, imported by BOTH `findings.test.ts` and `attest.test.ts`:
- `CANONICAL_FINDINGS_LITERAL` = `[{"check":"c","description":"d","file":"src/V.sol","id":0,"line":1,"severity":"low"}]`
- `CANONICAL_FINDINGS_SHA256` = `e68cea4f66e1dde2b0bdba549c0d57ae7d37550a35896f946459666fd607a244` (re-verified externally; matches T1's pasted literal)
- **`EMPTY_FINDINGS_SHA256`** (`sha256("[]")`, computed via `printf %s '[]' | shasum -a 256`) = **`4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`**
- findings.test.ts now asserts against the shared literals (including a new empty-list vector test) instead of private copies.

### Clone-shape migration (all repo-wide fakes)
`grep 'clone: async' packages/agent/test/` → 9 fakes, all now `{ dir, headSha }`: review.test.ts (makeDeps, container-test override, simDeps, 3 attestation tests), server.test.ts, triage-pipeline.test.ts. github.test.ts `runGit` fakes return `""`/stdout; new happy-path test asserts the full call sequence `init → fetch → checkout → rev-parse` with `revParse === ["-C", dir, "rev-parse", "HEAD"]` and trimmed stdout handling. server.test.ts webhook JSON assertions updated for the new `attestation` field (as did review.test.ts's analyzer-crash `toEqual`).

## TDD Evidence

**RED** (`pnpm vitest run test/attest.test.ts test/review.test.ts test/github.test.ts test/findings.test.ts test/server.test.ts test/triage-pipeline.test.ts`):
```
 Test Files  4 failed | 2 passed (6)
      Tests  13 failed | 53 passed (66)
```
Failures: attest module missing (review.test/attest tests), server/review exact-shape mismatches (`"attestation": { "skipped": "attestation not configured" }` expected, absent), github rev-parse sequence absent.

**GREEN** (after implementation):
```
 Test Files  13 passed (13)
      Tests  147 passed | 1 skipped (148)     # packages/agent, vitest run
```
Root: `pnpm test:run` → 1 successful task (agent suite 147/1 skipped); `pnpm typecheck` → clean, both at package and root level.

## Self-Review Findings (all fixed before final commit)

1. **Dead `sha256Hex` + duplicated digest pipeline** — first draft exported a tiny `sha256Hex` wrapper AND inlined the digest in `buildAttestRecord`. Fixed by binding to T1's exported `findingsHash()` directly (single source of truth for the hash) and deleting the helper; `createHash` import dropped.
2. **Untested common path** — every SPEC-5 registry chain has `explorer: null` today, so the bare-`tx \`0x…\`` footer (no link) is what production renders. Added a dedicated test asserting the link-free footer shape (`not.toContain("](https://")`).
3. **`return null as null`** — pointless assertion, removed.
4. **Footer carries findingsHash** — the brief's footer sketch omitted it, but SPEC-4 §3 explicitly lists findingsHash in the footer ("the reproducibility recipe sitting next to the `<details>` findings JSON it hashes"). Included it (from the built record); additive, breaks no pinned test. Flagging as a deliberate brief-vs-spec resolution for the controller.
5. **Test-side fixes during GREEN**: `res.incomplete` is the raw reason (the `analyzer failed:` prefix lives only in the comment body); footer assertions needed the full body captured (the `calls` array stores 40-char prefixes); git-sequence mapper had to unwrap `-C <dir> <subcommand>`.

## Concerns

- **`REXTOR_ATTEST_CHAIN` (SPEC-4 §3) is inert**: T7's `resolveChain` (binding interface) reads `REXTOR_DEFAULT_CHAIN` only. Per the SPEC-5 "one config surface" design I let `resolveChain` decide; the brief's test fixture passes `REXTOR_ATTEST_CHAIN` harmlessly. If the chain-selection env for attestation must literally be `REXTOR_ATTEST_CHAIN`, it's a one-line change in `makeAttestDep`.
- **Wiring-time vs call-time env**: `makeAttestDep` decides dep *existence* at wiring time (pinned by the brief's `toBeUndefined()` test — server constructs deps once at startup) but re-reads env for values on every call. A server started without the keys needs a restart to gain attestation; keys set at start and removed later degrade to a logged skip, never a crash.
- Edit-tool churn during this task mangled a few hunks mid-flight; all were repaired and the final state was verified by full typecheck + 147 passing tests + a post-commit grep sweep (0 stale clone fakes, 0 dead references), not assumed.

## Files Changed (12)
- New: `packages/agent/src/attest.ts`, `packages/agent/test/attest.test.ts`, `packages/agent/test/vectors.ts`
- Modified: `packages/agent/src/review.ts`, `packages/agent/src/github.ts`, `packages/agent/test/{review,github,findings,server,triage-pipeline}.test.ts`, `packages/agent/package.json`, `pnpm-lock.yaml`
