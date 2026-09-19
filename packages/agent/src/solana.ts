// SPEC-8 §5 — service-side auto-write of the chain-native verdict record.
// After a Solana-track (Anchor-shaped) review attests on the home chain
// (Tempo), the service mirrors the verdict to the devnet verdict program
// (B4, docs/deployments/solana.md): one PDA per review, seeds
// ["review", review_id], agent = the signing wallet.
//
// Gating (null-skip discipline, invariant 27): the dep exists only when BOTH
// `REXTOR_SOLANA_PROGRAM_ID` and `REXTOR_SOLANA_KEYPAIR` (path to the funded
// agent wallet's JSON keypair — the shared devnet wallet, NOT the program
// keypair) are set at wiring time, and re-checked at call time. Absent → the
// review's footer shows a VISIBLE skip note; never silent, never fatal.
//
// Idempotency is the PROGRAM's semantic (invariant 28): the client always
// sends the tx — an identical replay is an on-chain no-op Ok, a conflicting
// verdict is the loud `IdempotencyConflict` (6003). The client only
// pre-rejects payloads the program would deterministically reject, because a
// failed Solana tx still burns the fee.
import { readFileSync } from "node:fs";
import {
  AnchorProvider,
  Program,
  Wallet,
  type Idl,
} from "@coral-xyz/anchor";
import { Connection, Keypair, type TransactionSignature } from "@solana/web3.js";
import { CHAIN_REGISTRY } from "./chains";
import type { AttestRecord } from "./attest";
import type { ReviewDeps } from "./review";

/** Same fast-write budget as the Tempo attest dep (SPEC-4 §3): a hung devnet
 *  RPC must never delay the PR comment — the verdict is best-effort. */
const SOLANA_ATTEST_TIMEOUT_MS = 30_000;

/** The vendored IDL of the deployed verdict program (build artifact of
 *  `anchor build` — the IDL is the client contract and is committed here so
 *  the service never depends on a gitignored target/ tree). */
function loadIdl(): Idl {
  return JSON.parse(
    readFileSync(new URL("./solana-idl.json", import.meta.url), "utf8"),
  ) as Idl;
}

/** The slice of the anchor client the dep actually drives. Test seam: the
 *  vitest suite injects a recorder — no network, no keypair, no anchor. */
export interface SolanaVerdictIo {
  attest(args: {
    programId: string;
    keypairPath: string;
    rpc: string;
    /** EXACTLY 32 bytes — the reviewId hex minus the 0x prefix (client-side
     *  PDA derivation diverges from the program's otherwise — hit live on
     *  devnet during B4). */
    reviewId: number[];
    riskScore: number;
    status: number;
    findingsUri: string;
  }): Promise<TransactionSignature>;
}

/** Real anchor-client io: wallet from the JSON keypair file, connection on the
 *  registry's devnet RPC (chains.ts stays the single source of chain truth).
 *  The env programId is the gate — a mismatch against the vendored IDL's
 *  deployed address throws BEFORE any network call (a redeploy that changed
 *  the program keypair must never silently write to the stale address). */
const anchorIo = (): SolanaVerdictIo => ({
  async attest({ programId, keypairPath, rpc, reviewId, riskScore, status, findingsUri }) {
    const idl = loadIdl();
    if (idl.address !== programId) {
      throw new Error(
        `solana verdict programId mismatch: env ${programId} vs vendored IDL ${idl.address} — re-vendor the IDL after a redeploy`,
      );
    }
    // Keypair files are agent-generated JSON arrays of 0..255 (solana-keygen
    // format); validate instead of casting — a wrong-shape file must fail
    // loudly here, not corrupt a secret key silently.
    const raw = JSON.parse(readFileSync(keypairPath, "utf8")) as unknown;
    if (
      !Array.isArray(raw) ||
      raw.length !== 64 ||
      !raw.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)
    ) {
      throw new Error(`solana verdict keypair file is not a 64-byte secret array: ${keypairPath}`);
    }
    const secret = Uint8Array.from(raw as number[]);
    const wallet = new Wallet(Keypair.fromSecretKey(secret));
    const provider = new AnchorProvider(
      new Connection(rpc, "confirmed"),
      wallet,
      { commitment: "confirmed" },
    );
    const program = new Program(idl, provider);
    return program.methods
      .attestReview(reviewId, riskScore, status, findingsUri)
      .rpc();
  },
});

/**
 * Default `attestSolana` dep. Undefined unless BOTH env keys are set at wiring
 * time; re-read at call time (a long-lived server must not pin a rotated
 * config — the makeAttestDep pattern). EVERY failure path — unset env,
 * out-of-range payload, RPC/program error, timeout — logs and resolves null;
 * the caller renders the visible skip note and the comment posts anyway.
 */
export function makeSolanaVerdictDep(
  readEnv: () => NodeJS.ProcessEnv = () => process.env,
  io: SolanaVerdictIo = anchorIo(),
  timeoutMs: number = SOLANA_ATTEST_TIMEOUT_MS,
): ReviewDeps["attestSolana"] {
  const boot = readEnv();
  if (!boot.REXTOR_SOLANA_PROGRAM_ID || !boot.REXTOR_SOLANA_KEYPAIR) return undefined;
  return async (record) => {
    // Re-read at call time (rotated config must not need a restart to matter).
    const env = readEnv();
    const programId = env.REXTOR_SOLANA_PROGRAM_ID;
    const keypairPath = env.REXTOR_SOLANA_KEYPAIR;
    if (!programId || !keypairPath) {
      console.error("[rextor] solana verdict env unset at call time — skipping");
      return null;
    }
    // Fee-burn guards: the program rejects these deterministically, and a
    // rejected Solana tx still pays. Fail here, loudly, for free.
    if (!/^0x[0-9a-f]{64}$/.test(record.reviewId)) {
      console.error("[rextor] solana verdict: reviewId is not 32 bytes — refusing to send");
      return null;
    }
    if (record.riskScore < 0 || record.riskScore > 100) {
      console.error("[rextor] solana verdict: riskScore out of range — refusing to send");
      return null;
    }
    if (record.status < 0 || record.status > 1) {
      console.error("[rextor] solana verdict: status out of range — refusing to send");
      return null;
    }
    if (Buffer.byteLength(record.findingsURI, "utf8") > 128) {
      console.error("[rextor] solana verdict: findingsURI exceeds 128 bytes — refusing to send");
      return null;
    }
    // The same bytes the EVM contract hashes: 32-byte array, hex minus "0x".
    const reviewId = Array.from(Buffer.from(record.reviewId.slice(2), "hex"));
    const rpc = CHAIN_REGISTRY.solana.testnet.rpc;
    if (!rpc) {
      console.error("[rextor] solana registry rpc unverified — skipping");
      return null;
    }
    const attempt = io
      .attest({
        programId,
        keypairPath,
        rpc,
        reviewId,
        riskScore: record.riskScore,
        status: record.status,
        findingsUri: record.findingsURI,
      })
      .then((signature) => {
        // Registry explorer slot is null (chains.ts invariant-27 discipline —
        // nulls until verified + recorded) → empty explorerUrl and the footer
        // renders the bare signature. When the slot gets recorded, build the
        // link HERE from it so the registry stays the single source of truth.
        return { txHash: signature, explorerUrl: "" };
      });
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        console.error("[rextor] solana verdict timed out — the tx may still have landed");
        resolve(null);
      }, timeoutMs);
    });
    return Promise.race([attempt, guard])
      .catch((err: unknown) => {
        // Log the MESSAGE only — never stack traces/env that could echo secrets.
        console.error("[rextor] solana verdict write failed:", err instanceof Error ? err.message : err);
        return null;
      })
      .finally(() => clearTimeout(timer));
  };
}
