// SPEC-8 §5 — live devnet smoke of the service-side auto-write dep. Drives the
// REAL makeSolanaVerdictDep (anchor client, registry rpc) with a smoke-
// namespaced review id (the same convention as the Tempo/B4 smokes — never a
// real review identity), then proves invariant 28 ON CHAIN:
//   1. first attest  → tx lands
//   2. identical replay → tx lands again, on-chain no-op Ok
//   3. conflicting replay → program rejects (IdempotencyConflict, 6003)
//   4. read-back → PDA fields still the ORIGINAL verdict
// Run from packages/agent (fee payer = the shared funded devnet wallet):
//   REXTOR_SOLANA_PROGRAM_ID=Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs \
//   REXTOR_SOLANA_KEYPAIR=$HOME/Documents/secret/solana-devnet.json \
//   pnpm solana:smoke
import { readFileSync } from "node:fs";
import {
  AnchorProvider,
  Program,
  Wallet,
  type Idl,
} from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { makeSolanaVerdictDep } from "../src/solana";
import type { AttestRecord } from "../src/attest";

function fail(msg: string): never {
  console.error(`SMOKE INCOMPLETE: ${msg}`);
  process.exit(1);
}

const programId = process.env.REXTOR_SOLANA_PROGRAM_ID;
const keypairPath = process.env.REXTOR_SOLANA_KEYPAIR;
if (!programId || !keypairPath) fail("REXTOR_SOLANA_PROGRAM_ID / REXTOR_SOLANA_KEYPAIR unset");

// "smoke"-namespaced review id: byte 0 = 0x00 + marker, zero-padded to EXACTLY
// 32 bytes (a short buffer passes the TS layer and fails on-chain as
// ConstraintSeeds — hit live during B4). Never collides with a real review.
const marker = "smoke:rextor-svc-auto";
const idBuf = Buffer.alloc(32, 0);
Buffer.from(marker).copy(idBuf, 1);
const reviewIdHex = `0x${idBuf.toString("hex")}`;

const secret: number[] = JSON.parse(readFileSync(keypairPath!, "utf8"));
const signerKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
console.log("agent wallet:", signerKeypair.publicKey.toBase58());
console.log("reviewId    :", reviewIdHex, `(${marker})`);

const balance = await new Connection("https://api.devnet.solana.com").getBalance(
  signerKeypair.publicKey,
);
const sol = balance / 1_000_000_000;
console.log("balance     :", `${sol} SOL`);
if (sol < 0.01) fail(`wallet too poor for a smoke (${sol} SOL) — ask RECTOR to fund`);

const record: AttestRecord = {
  reviewId: reviewIdHex as `0x${string}`,
  commitHash: `0x${"0".repeat(64)}` as `0x${string}`,
  findingsHash: `0x${"0".repeat(64)}` as `0x${string}`,
  findingsURI: "ipfs://smoke-nonprod-placeholder",
  riskScore: 42,
  findingCount: 0,
  status: 0,
  targetChainId: 0,
};

const dep = makeSolanaVerdictDep(() => process.env);
if (!dep) fail("dep undefined — env gating rejected the smoke");

// Devnet throttles under load; an idempotent replay is safe to retry.
async function withRetry(label: string, fn: () => Promise<{ txHash: string } | null>) {
  for (let i = 1; i <= 3; i++) {
    const res = await fn();
    if (res) return res;
    console.log(`${label}: attempt ${i} returned null${i < 3 ? " — retrying in 5s" : ""}`);
    if (i < 3) await new Promise((r) => setTimeout(r, 5000));
  }
  fail(`${label}: no receipt after retries (see agent log lines above)`);
}

console.log("\n[1/4] first attest…");
const first = await withRetry("attest", () => dep!(record));
console.log("  tx:", first.txHash);

console.log("[2/4] identical replay (program-side no-op Ok)…");
const replay = await withRetry("replay", () => dep!(record));
console.log("  tx:", replay.txHash, "(different signature, same on-chain state)");

console.log("[3/4] conflicting replay (riskScore 43) — expecting a loud reject…");
const errSpy = console.error; // the dep logs the failure; capture for the receipt
let conflictLogged = false;
console.error = (...args: unknown[]) => {
  const line = String(args.join(" "));
  if (line.includes("solana verdict write failed")) conflictLogged = true;
  errSpy(...args);
};
const conflict = await dep!({ ...record, riskScore: 43 });
console.error = errSpy;
if (conflict !== null) fail("conflicting verdict was NOT rejected — idempotency broken");
if (!conflictLogged) fail("conflict rejected but the failure was not logged");

// Read the PDA straight from the chain (independent of the client under test).
const idl = JSON.parse(
  readFileSync(new URL("../src/solana-idl.json", import.meta.url), "utf8"),
) as Idl;
const provider = new AnchorProvider(
  new Connection("https://api.devnet.solana.com", "confirmed"),
  new Wallet(signerKeypair),
  { commitment: "confirmed" },
);
const program = new Program(idl, provider);
const [pda] = PublicKey.findProgramAddressSync(
  [Buffer.from("review"), idBuf],
  new PublicKey(programId!),
);
console.log("[4/4] read-back of", pda.toBase58());
const onchain = (await program.account.review.fetch(pda)) as {
  agent: PublicKey;
  riskScore: number;
  status: number;
  findingsUri: string;
  slot: { toString(): string };
};
if (onchain.riskScore !== 42 || onchain.status !== 0 || onchain.findingsUri !== record.findingsURI) {
  fail(`on-chain state diverged: ${JSON.stringify(onchain)}`);
}
if (onchain.agent.toBase58() !== signerKeypair.publicKey.toBase58()) {
  fail("on-chain agent is not the signing wallet");
}

console.log("\nSMOKE RECEIPT");
console.log("programId :", programId);
console.log("reviewPda :", pda.toBase58());
console.log("agent     :", onchain.agent.toBase58());
console.log("riskScore :", onchain.riskScore, "· status:", onchain.status);
console.log("uri       :", onchain.findingsUri);
console.log("slot      :", onchain.slot.toString());
console.log("attest tx :", first.txHash);
console.log("replay tx :", replay.txHash);
console.log("conflict  : rejected (IdempotencyConflict) — state unchanged ✓");
