// SPEC-8 §5 — the native Solana verdict dep: env gating (visible skip, never
// silent), fee-burn payload guards, call-time env re-read, timeout/error →
// null, and the runReview chaining (Anchor-shaped repo + settled home-chain
// attest → native write; footer carries the receipt or the skip note).
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeSolanaVerdictDep, type SolanaVerdictIo } from "../src/solana";
import { buildAttestRecord, type AttestRecord } from "../src/attest";
import { runReview, type ReviewDeps } from "../src/review";
import { CHAIN_REGISTRY } from "../src/chains";

const ENV_FULL = {
  REXTOR_SOLANA_PROGRAM_ID: CHAIN_REGISTRY.solana.attestation.address as string,
  REXTOR_SOLANA_KEYPAIR: "/secrets/agent-wallet.json",
};

const REC: AttestRecord = buildAttestRecord({
  repoFullName: "rextorsec/rextor-audit-test",
  prNumber: 5,
  headSha: "a".repeat(40),
  findings: [],
  riskScore: 88,
  incomplete: false,
  findingsURI: "ipfs://QmTest",
});

/** The dep is the last line before an irreversible fee burn: its guards exist
 *  for values that LIE about their type (JS callers, wire data). This helper
 *  deliberately constructs such out-of-contract records the same way such a
 *  caller would — bypassing AttestRecord's `status: 0 | 1` etc. */
const wireRecord = (overrides: Record<string, unknown>): AttestRecord =>
  JSON.parse(JSON.stringify({ ...REC, ...overrides })) as AttestRecord;

/** Recorder io — returns a fixed signature and captures the args it got. */
function fakeIo(result: Promise<string> = Promise.resolve("5mokeSignatureDummy")): {
  io: SolanaVerdictIo;
  calls: Array<Parameters<SolanaVerdictIo["attest"]>[0]>;
} {
  const calls: Array<Parameters<SolanaVerdictIo["attest"]>[0]> = [];
  return {
    io: {
      attest: async (args) => {
        calls.push(args);
        return result;
      },
    },
    calls,
  };
}

describe("makeSolanaVerdictDep — gating", () => {
  it("is undefined unless BOTH env keys are set at wiring time", () => {
    expect(makeSolanaVerdictDep(() => ({}), fakeIo().io)).toBeUndefined();
    expect(makeSolanaVerdictDep(() => ({ REXTOR_SOLANA_PROGRAM_ID: "p" }), fakeIo().io)).toBeUndefined();
    expect(
      makeSolanaVerdictDep(() => ({ REXTOR_SOLANA_KEYPAIR: "/k" }), fakeIo().io),
    ).toBeUndefined();
    expect(typeof makeSolanaVerdictDep(() => ENV_FULL, fakeIo().io)).toBe("function");
  });

  it("skips (null) when the env is unset again at CALL time", async () => {
    const { io } = fakeIo();
    let env: NodeJS.ProcessEnv = { ...ENV_FULL };
    const dep = makeSolanaVerdictDep(() => env, io);
    env = {};
    await expect(dep!(REC)).resolves.toBeNull();
  });
});

describe("makeSolanaVerdictDep — fee-burn payload guards", () => {
  // A Solana tx the program would deterministically reject still pays the fee —
  // each guard must refuse BEFORE any io (network) happens.
  const badCases: Array<[string, AttestRecord]> = [
    ["reviewId not 32 bytes", wireRecord({ reviewId: "0x1234" })],
    ["riskScore over 100", wireRecord({ riskScore: 101 })],
    ["status over 1", wireRecord({ status: 2 })],
    ["findingsURI over 128 bytes", wireRecord({ findingsURI: `ipfs://${"x".repeat(123)}` })], // 6+123 = 129
  ];
  for (const [name, record] of badCases) {
    it(`refuses to send when ${name}`, async () => {
      const { io, calls } = fakeIo();
      const dep = makeSolanaVerdictDep(() => ENV_FULL, io);
      await expect(dep!(record)).resolves.toBeNull();
      expect(calls).toHaveLength(0);
    });
  }

  it("accepts the boundary values the program accepts (100, 1, 128 bytes)", async () => {
    const { io, calls } = fakeIo();
    const dep = makeSolanaVerdictDep(() => ENV_FULL, io);
    await expect(
      dep!({ ...REC, riskScore: 100, status: 1, findingsURI: `ipfs://${"x".repeat(121)}` }), // exactly 128
    ).resolves.toEqual({ txHash: "5mokeSignatureDummy", explorerUrl: "" });
    expect(calls).toHaveLength(1);
  });
});

describe("makeSolanaVerdictDep — the write", () => {
  it("passes the registry rpc, env programId/keypair and the 32 reviewId bytes", async () => {
    const { io, calls } = fakeIo();
    const dep = makeSolanaVerdictDep(() => ENV_FULL, io);
    await dep!(REC);
    expect(calls).toHaveLength(1);
    expect(calls[0].programId).toBe(ENV_FULL.REXTOR_SOLANA_PROGRAM_ID);
    expect(calls[0].keypairPath).toBe(ENV_FULL.REXTOR_SOLANA_KEYPAIR);
    expect(calls[0].rpc).toBe(CHAIN_REGISTRY.solana.testnet.rpc);
    expect(calls[0].reviewId).toEqual(Array.from(Buffer.from(REC.reviewId.slice(2), "hex")));
    expect(calls[0].reviewId).toHaveLength(32);
    expect(calls[0].riskScore).toBe(REC.riskScore);
    expect(calls[0].status).toBe(REC.status);
    expect(calls[0].findingsUri).toBe(REC.findingsURI);
  });

  it("resolves null on a rejected write (never throws into the review)", async () => {
    const { io } = fakeIo(Promise.reject(new Error("IdempotencyConflict (6003)")));
    const dep = makeSolanaVerdictDep(() => ENV_FULL, io);
    await expect(dep!(REC)).resolves.toBeNull();
  });

  it("resolves null on a hung RPC after the timeout budget", async () => {
    const { io } = fakeIo(new Promise<string>(() => {}));
    const dep = makeSolanaVerdictDep(() => ENV_FULL, io, 20);
    await expect(dep!(REC)).resolves.toBeNull();
  });
});

// --- runReview chaining: the footer carries the receipt or the visible skip --

const HEAD_SHA = "a".repeat(40);
// An Anchor-shaped PR diff: a .rs file under programs/ (contract-scoped per
// SPEC-8 §2), so runReview proceeds past scopeDiff.
const ANCHOR_DIFF = `diff --git a/programs/vault/src/lib.rs b/programs/vault/src/lib.rs
index 0000000..9f26a1c 100644
--- a/programs/vault/src/lib.rs
+++ b/programs/vault/src/lib.rs
@@ -1,3 +1,8 @@
+fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
+    let acc = &mut ctx.accounts.vault;
+    **acc.try_borrow_mut_lamports_mut()? -= amount;
+    Ok(())
+}
`;

/** Anchor-shaped clone dir: Anchor.toml at the root (the same detector the
 *  fork-sim guard uses — a repo-shape branch, never a chain-name branch). */
async function anchorRepoDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rextor-anchor-"));
  await writeFile(join(dir, "Anchor.toml"), "[programs.localnet]\n");
  return dir;
}

async function makeRunReviewDeps(
  cloneDir: string,
  over: Partial<ReviewDeps> = {},
): Promise<{ deps: ReviewDeps; comments: Array<{ body: string }> }> {
  const comments: Array<{ body: string }> = [];
  const deps: ReviewDeps = {
    clone: async () => ({ dir: cloneDir, headSha: HEAD_SHA }),
    fetchDiff: async () => ANCHOR_DIFF,
    runAnalyzer: async () => {
      throw new Error("simulated analyzer outage");
    },
    postComment: async (_prUrl, body) => {
      comments.push({ body });
    },
    dispose: async () => {},
    ...over,
  };
  return { deps, comments };
}

const TEMPO_TX = { txHash: "0xtempo000000000000000000000000000000000000", explorerUrl: "" } as const;

afterEach(async () => {
  vi.restoreAllMocks();
});

describe("runReview — solana verdict chaining (SPEC-8 §5)", () => {
  it("Anchor repo + settled home attest + dep set → native receipt in result and footer", async () => {
    const dir = await anchorRepoDir();
    const { io } = fakeIo();
    const { deps, comments } = await makeRunReviewDeps(dir, {
      attest: async () => TEMPO_TX,
      attestSolana: makeSolanaVerdictDep(() => ENV_FULL, io),
    });
    try {
      const result = await runReview("https://github.com/rextorsec/rextor-audit-test/pull/5", deps);
      expect(result.attestation).toMatchObject({ txHash: TEMPO_TX.txHash });
      expect(result.attestation).toHaveProperty("solanaVerdict");
      expect((result.attestation as { solanaVerdict?: { txHash: string } }).solanaVerdict)
        .toMatchObject({ txHash: "5mokeSignatureDummy", explorerUrl: "" });
      expect(comments[0].body).toContain("⛓ solana verdict (devnet)");
      expect(comments[0].body).toContain("`5mokeSignatureDummy`");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Anchor repo + dep undefined (env unset) → VISIBLE skip note, review still attests + posts", async () => {
    const dir = await anchorRepoDir();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, comments } = await makeRunReviewDeps(dir, {
      attest: async () => TEMPO_TX,
    });
    try {
      const result = await runReview("https://github.com/rextorsec/rextor-audit-test/pull/5", deps);
      expect((result.attestation as { solanaVerdict?: { skipped: string } }).solanaVerdict)
        .toMatchObject({ skipped: expect.stringContaining("env unset") });
      expect(comments[0].body).toContain("solana verdict skipped: env unset");
      // The home-chain attestation still happened — chaining, not replacement.
      expect(result.attestation).toMatchObject({ txHash: TEMPO_TX.txHash });
      errSpy.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Anchor repo + failed write → visible skip, never a review failure", async () => {
    const dir = await anchorRepoDir();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, comments } = await makeRunReviewDeps(dir, {
      attest: async () => TEMPO_TX,
      attestSolana: makeSolanaVerdictDep(
        () => ENV_FULL,
        fakeIo(Promise.reject(new Error("blockhash expired"))).io,
      ),
    });
    try {
      const result = await runReview("https://github.com/rextorsec/rextor-audit-test/pull/5", deps);
      expect((result.attestation as { solanaVerdict?: { skipped: string } }).solanaVerdict)
        .toMatchObject({ skipped: expect.stringContaining("write failed") });
      expect(comments[0].body).toContain("solana verdict skipped: write failed");
      errSpy.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("non-Anchor repo → no solana verdict at all, even with the dep fully configured", async () => {
    // The repo-root vault fixture is EVM-shaped (no Anchor.toml, no programs/).
    const { deps, comments } = await makeRunReviewDeps(
      join(import.meta.dirname, "../../../fixtures/vault"),
      { attest: async () => TEMPO_TX, attestSolana: makeSolanaVerdictDep(() => ENV_FULL, fakeIo().io) },
    );
    const result = await runReview("https://github.com/rextor/demo/pull/42", deps);
    expect(result.attestation).toMatchObject({ txHash: TEMPO_TX.txHash });
    expect((result.attestation as { solanaVerdict?: unknown }).solanaVerdict).toBeUndefined();
    expect(comments[0].body).not.toContain("solana verdict");
  });
});
