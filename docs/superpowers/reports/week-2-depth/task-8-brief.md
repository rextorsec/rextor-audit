### Task 8: SPEC-4 agent attestation integration — viem client, clone headSha, attestation footer

**Files:**
- Create: `packages/agent/src/attest.ts`, `packages/agent/test/attest.test.ts`
- Modify: `packages/agent/src/review.ts`, `packages/agent/src/github.ts`, `packages/agent/test/review.test.ts`, `packages/agent/test/github.test.ts`, `packages/agent/package.json` (add `viem`)

**Interfaces:**
- Consumes: `findingsHash` (T1), `canonicalFindingsJson` (T1), `resolveChain` (T7), contract ABI (T6), `rawFindingsResult` (T3).
- Produces:
  - `attest.ts`: `export interface AttestRecord { reviewId: \`0x${string}\`; commitHash: \`0x${string}\`; findingsHash: \`0x${string}\`; riskScore: number; findingCount: number; status: 0 | 1 }`; `export function reviewIdFor(repoFullName: string, prNumber: number, headSha: string): \`0x${string}\``; `export function commitHashFor(headSha: string): \`0x${string}\` (20-byte hex right-zero-padded to 32)`; `export function buildAttestRecord(input: { repoFullName: string; prNumber: number; headSha: string; findings: Finding[]; riskScore: number; incomplete: boolean }): AttestRecord`; `export const REXTOR_ATTESTATION_ABI = [...]` (human-readable: attest + verify); `export function makeAttestDep(readEnv?: () => NodeJS.ProcessEnv): ReviewDeps["attest"]` (undefined when `REXTOR_AGENT_PRIVATE_KEY` or `REXTOR_ATTEST_CONTRACT_ADDRESS` unset).
  - `review.ts`: `ReviewDeps.clone` returns `Promise<{ dir: string; headSha: string }>` (SPEC-4 §3 evolution); `ReviewDeps.attest?: (record: AttestRecord) => Promise<{ txHash: string; explorerUrl: string } | null>`; `ReviewResult.attestation?: { chain: string; reviewId: string; txHash: string; explorerUrl: string } | { skipped: string }`; runReview attests BEFORE posting on all three paths.

- [ ] **Step 1: Write the failing tests**

`packages/agent/test/attest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAttestRecord, commitHashFor, makeAttestDep, reviewIdFor } from "../src/attest";
import { keccak256 } from "viem";
import { findingHashVector } from "./vectors"; // shared vector module created in T1 — or inline below

const findings = [{ file: "a.sol", line: 1, severity: "low", check: "c", description: "d", id: 0 }];
const canonical = '[{"check":"c","description":"d","file":"a.sol","id":0,"line":1,"severity":"low"}]';
// sha256(canonical) — computed with shasum, pasted:
const canonicalSha256 = "<PASTE_SHA256_HERE>";

describe("verdict identity (SPEC-4 §1 vectors)", () => {
  it("reviewId = keccak256 of the published derivation string", () => {
    expect(reviewIdFor("rextorsec/rextor-audit", 1, "abc123")).toBe(
      keccak256(new TextEncoder().encode("rextor/review/v1|rextorsec/rextor-audit|1|abc123")),
    );
  });
  it("commitHash right-zero-pads the 20-byte git sha", () => {
    const sha40 = "971a6ca000000000000000000000000000000000"; // 40 hex chars
    expect(commitHashFor(sha40)).toBe("0x" + sha40 + "0".repeat(24));
  });
  it("buildAttestRecord hashes canonical findings and maps incomplete→1", () => {
    const rec = buildAttestRecord({
      repoFullName: "o/r", prNumber: 2, headSha: "971a6ca000000000000000000000000000000000",
      findings: findings as never, riskScore: 10, incomplete: false,
    });
    expect(rec.findingsHash).toBe("0x" + canonicalSha256);
    expect(rec.riskScore).toBe(10);
    expect(rec.findingCount).toBe(1);
    expect(rec.status).toBe(0);
    expect(buildAttestRecord({ repoFullName: "o/r", prNumber: 2, headSha: "971a6ca000000000000000000000000000000000", findings: [], riskScore: 0, incomplete: true }).status).toBe(1);
  });
});

describe("makeAttestDep", () => {
  it("is undefined when env unset; a function when set", () => {
    expect(makeAttestDep(() => ({}))).toBeUndefined();
    expect(makeAttestDep(() => ({
      REXTOR_AGENT_PRIVATE_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // anvil key #1, test-only
      REXTOR_ATTEST_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      REXTOR_ATTEST_CHAIN: "tempo",
    }))).toBeTypeOf("function");
  });
});
```

(The sha256 vectors here MUST be the same externally-computed literals as T1 — put them in one shared `test/vectors.ts` and import in both suites; adjust T1's test to import from it.)

`review.test.ts` additions:

```ts
describe("runReview attestation integration", () => {
  const findings0 = JSON.stringify({ file: "src/V.sol", line: 10, severity: "high", check: "c", description: "d" });

  it("attests BEFORE commenting and renders the footer with tx + reviewId", async () => {
    const calls: string[] = [];
    const deps: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/fake", headSha: "a".repeat(40) }),
      fetchDiff: async () => "diff --git a/src/V.sol b/src/V.sol\n@@ -1 +1 @@\n+x",
      runAnalyzer: async () => findings0,
      triage: undefined,
      postComment: async (_u, body) => { calls.push("comment:" + body.slice(0, 40)); },
      dispose: async () => {},
      attest: async (rec) => {
        calls.push("attest:" + rec.reviewId.slice(0, 10));
        return { txHash: "0xabc", explorerUrl: "https://explorer.example/tx/0xabc" };
      },
    };
    const res = await runReview("https://github.com/o/r/pull/3", deps);
    expect(calls[0]).toMatch(/^attest:/);     // attest precedes comment
    expect(calls[1]).toMatch(/^comment:/);
    expect(res.attestation).toMatchObject({ txHash: "0xabc" });
  });

  it("attest failure or absence never blocks the comment", async () => {
    const comments: string[] = [];
    const base: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/fake", headSha: "a".repeat(40) }),
      fetchDiff: async () => "diff --git a/src/V.sol b/src/V.sol\n@@ -1 +1 @@\n+x",
      runAnalyzer: async () => findings0,
      postComment: async (_u, body) => { comments.push(body); },
      dispose: async () => {},
    };
    const failing = { ...base, attest: async () => null };
    const res1 = await runReview("https://github.com/o/r/pull/3", failing);
    expect(res1.commented).toBe(true);
    expect(res1.attestation).toMatchObject({ skipped: expect.stringContaining("failed") });
    const res2 = await runReview("https://github.com/o/r/pull/3", base); // no attest dep
    expect(res2.attestation).toMatchObject({ skipped: expect.stringContaining("not configured") });
    expect(comments[0]).toContain("attestation skipped");
  });

  it("hard-incomplete review attests status=1 with empty-findings hash", async () => {
    let seen: unknown;
    const deps: ReviewDeps = {
      clone: async () => ({ dir: "/tmp/fake", headSha: "a".repeat(40) }),
      fetchDiff: async () => "diff --git a/src/V.sol b/src/V.sol\n@@ -1 +1 @@\n+x",
      runAnalyzer: async () => { throw new Error("docker daemon down"); },
      postComment: async () => {},
      dispose: async () => {},
      attest: async (rec) => { seen = rec; return null; },
    };
    await runReview("https://github.com/o/r/pull/3", deps);
    expect((seen as { status: number }).status).toBe(1);
    expect((seen as { findingsHash: string }).findingsHash).toBe("0x" + /* sha256("[]") — paste externally computed */ "");
  });
});
```

Update `github.test.ts`: `runGit` seam now returns stdout (`Promise<string>`); the real clone issues `git clone ... && git -C <dir> rev-parse HEAD` (or two calls); fake returns `""`; assert the rev-parse call happens. Update ALL existing clone fakes repo-wide to the `{ dir, headSha }` shape (`grep -rn "clone: async" packages/agent/test/`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run test/attest.test.ts` — FAIL (module missing, clone shape mismatch).

- [ ] **Step 3: Implement**

`pnpm --filter @rextor/agent add viem`.

`packages/agent/src/attest.ts`:

```ts
// SPEC-4 §3 — verdict identity + on-chain anchoring. Attestation enhances
// the review; it can never block or fail the review (invariant: comment
// always posts).
import { createHash } from "node:crypto";
import {
  createPublicClient, createWalletClient, defineChain, http,
  keccak256, privateKeyToAccount, toHex,
} from "viem";
import { canonicalFindingsJson, type Finding } from "./findings";
import { resolveChain } from "./chains";
import type { ReviewDeps } from "./review";

export const REXTOR_ATTESTATION_ABI = [
  "function attest(bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash, uint16 riskScore, uint16 findingCount, uint8 status)",
  "function verify(bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash, uint16 riskScore, uint16 findingCount, uint8 status) view returns (bool)",
] as const;

export interface AttestRecord {
  reviewId: `0x${string}`;
  commitHash: `0x${string}`;
  findingsHash: `0x${string}`;
  riskScore: number;
  findingCount: number;
  status: 0 | 1;
}

export function reviewIdFor(repoFullName: string, prNumber: number, headSha: string): `0x${string}` {
  return keccak256(toHex(`rextor/review/v1|${repoFullName}|${prNumber}|${headSha}`));
}

export function commitHashFor(headSha: string): `0x${string}` {
  if (!/^[0-9a-f]{40}$/i.test(headSha)) throw new Error(`not a 40-hex git sha: ${headSha}`);
  return ("0x" + headSha.toLowerCase()).padEnd(66, "0") as `0x${string}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function buildAttestRecord(input: {
  repoFullName: string; prNumber: number; headSha: string;
  findings: Finding[]; riskScore: number; incomplete: boolean;
}): AttestRecord {
  return {
    reviewId: reviewIdFor(input.repoFullName, input.prNumber, input.headSha),
    commitHash: commitHashFor(input.headSha),
    findingsHash: ("0x" + sha256Hex(canonicalFindingsJson(input.findings))) as `0x${string}`,
    riskScore: input.riskScore,
    findingCount: input.findings.length,
    status: input.incomplete ? 1 : 0,
  };
}

const ATTEST_TIMEOUT_MS = 30_000;

export function makeAttestDep(readEnv: () => NodeJS.ProcessEnv = () => process.env): ReviewDeps["attest"] {
  return (record) => {
    const env = readEnv();
    const pk = env.REXTOR_AGENT_PRIVATE_KEY;
    const address = env.REXTOR_ATTEST_CONTRACT_ADDRESS as `0x${string}` | undefined;
    if (!pk || !address) return Promise.resolve(null); // caller treats as skipped-config
    const chain = resolveChain(env);
    const chainId = chain.attestation.chainId ?? chain.testnet.chainId;
    if (!chainId || !chain.testnet.rpc) {
      console.error("[rextor] attestation chain params unverified — skipping");
      return Promise.resolve(null);
    }
    const viemChain = defineChain({
      id: chainId, name: chain.name,
      nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
      rpcUrls: { default: { http: [chain.testnet.rpc] } },
    });
    const account = privateKeyToAccount(pk as `0x${string}`);
    const wallet = createWalletClient({ account, chain: viemChain, transport: http() });
    const public_ = createPublicClient({ chain: viemChain, transport: http() });
    const attempt = (async () => {
      const hash = await wallet.writeContract({
        address, abi: REXTOR_ATTESTATION_ABI, functionName: "attest",
        args: [record.reviewId, record.commitHash, record.findingsHash,
               BigInt(record.riskScore), BigInt(record.findingCount), BigInt(record.status)],
        chain: viemChain, account,
      });
      await public_.waitForTransactionReceipt({ hash });
      return { txHash: hash, explorerUrl: chain.explorer ? `${chain.explorer}/tx/${hash}` : "" };
    })();
    return Promise.race([
      attempt,
      new Promise<null>((resolve) => setTimeout(() => {
        console.error("[rextor] attestation timed out — posting comment without tx");
        resolve(null);
      }, ATTEST_TIMEOUT_MS)),
    ]).catch((err: unknown) => {
      console.error("[rextor] attestation failed:", err instanceof Error ? err.message : err);
      return null;
    });
  };
}
```

`review.ts`:
1. `clone` returns `{ dir: string; headSha: string }`; `runReview` destructures and uses `repoDir = dir`.
2. `ReviewDeps` gains `attest?: (record: AttestRecord) => Promise<{ txHash: string; explorerUrl: string } | null>`.
3. `ReviewResult` gains `attestation?: { chain: string; reviewId: string; txHash: string; explorerUrl: string } | { skipped: string }`.
4. In `runReview`, a helper runs on every verdict path (success, analyzer-failed, normalize-failed — hard-incomplete attests `status: 1` with the empty/`[]` findings list):

```ts
  async function attestAndWrap(findings: Finding[], riskScore: number, incomplete: boolean, headShaLocal: string) {
    const record = buildAttestRecord({ repoFullName, prNumber, headSha: headShaLocal, findings, riskScore, incomplete });
    if (!deps.attest) return { skipped: "attestation not configured" } as const;
    const res = await deps.attest(record);
    if (!res) return { skipped: "attestation attempt failed" } as const;
    return { chain: activeChainName, reviewId: record.reviewId, ...res };
  }
```

(`repoFullName`/`prNumber` parsed from `prUrl` — add a tiny local parser mirroring `github.ts`'s `PR_URL_RE`; `activeChainName` from `resolveChain(process.env).name` wrapped in try/catch defaulting to `"tempo"`.) The success path calls it with final findings + `scoreV1`; the incomplete paths call it with `[]` + score 0. Both comment bodies append the footer:

```ts
function attestationFooter(att: { chain: string; reviewId: string; txHash: string; explorerUrl: string } | { skipped: string }): string[] {
  if ("skipped" in att) return ["", `_attestation skipped: ${att.skipped}_`];
  const link = att.explorerUrl ? `[tx \`${att.txHash.slice(0, 10)}…\`](${att.explorerUrl})` : `tx \`${att.txHash}\``;
  return ["", "---", `⚖ attested on ${att.chain} · reviewId \`${att.reviewId}\` · ${link}`];
}
```

The reviewId/footer strings are agent-generated (hex/known words) — still pass them through `cell()` where they interpolate free text (`chain` name comes from the registry; safe, but sanitize anyway for uniformity).

`github.ts`: real clone gains `const { stdout } = await execFileP("git", ["-C", dir, "rev-parse", "HEAD"], GIT_OPTS);` and returns `{ dir, headSha: stdout.trim() }`; `runGit` seam returns `Promise<string>` (default returns trimmed stdout; update fakes); default deps gain `attest: makeAttestDep(),`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run && pnpm typecheck && cd ../.. && pnpm test:run && pnpm typecheck`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/attest.ts packages/agent/src/review.ts packages/agent/src/github.ts packages/agent/test packages/agent/package.json pnpm-lock.yaml
git commit -m "feat: SPEC-4 agent attestation (viem) — verdict identity, idempotent record, PR footer"
```

---

