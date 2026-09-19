// SPEC-4 §3 — verdict identity + on-chain anchoring. The attestation
// ENHANCES the review; it can never block or fail it (invariant: the comment
// always posts — runReview wraps every failure into a "skipped" footer).
//
// Verdict identity (binding, shared with RextorAttestation.sol):
//   reviewId     = keccak256("rextor/review/v1|" + owner/repo + "|" + pr + "|" + headSha)
//   commitHash   = 20-byte git sha, right-zero-padded to bytes32
//   findingsHash = sha256(canonicalFindingsJson(findings)) — SAME canonical
//                  form published in the PR comment (SPEC-2 §2), so anyone can
//                  recompute it from the comment and verify() on-chain.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { findingsHash, type Finding } from "./findings";
import { resolveChain, attestationChainId } from "./chains";
import type { ReviewDeps } from "./review";

// Exact contract ABI (SPEC-4 v2 — findingsURI + targetChainId). attest + verify
// share the payload. parseAbi is NOT optional: viem's writeContract/getAbiItem
// need parsed items — raw human-readable strings throw `'name' in …` at call
// time (T10 Phase C live).
export const REXTOR_ATTESTATION_ABI = parseAbi([
  "function attest(bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash, string findingsURI, uint16 riskScore, uint16 findingCount, uint8 status, uint32 targetChainId)",
  "function verify(bytes32 reviewId, bytes32 commitHash, bytes32 findingsHash, string findingsURI, uint16 riskScore, uint16 findingCount, uint8 status, uint32 targetChainId) view returns (bool)",
]);

export interface AttestRecord {
  reviewId: `0x${string}`;
  commitHash: `0x${string}`;
  findingsHash: `0x${string}`;
  /** SPEC-4 v2 — IPFS-pinned full report; "" = degraded (pin unavailable, B3 wires). */
  findingsURI: string;
  riskScore: number;
  findingCount: number;
  status: 0 | 1;
  /** SPEC-4 v2 — the chain the audited code targets; 0 = unresolved. */
  targetChainId: number;
}

/** SPEC-4 §1 — keccak256 over the published derivation string. */
export function reviewIdFor(repoFullName: string, prNumber: number, headSha: string): `0x${string}` {
  return keccak256(toHex(`rextor/review/v1|${repoFullName}|${prNumber}|${headSha}`));
}

/** 20-byte git sha right-zero-padded to a bytes32 hex string. Throws on anything else. */
export function commitHashFor(headSha: string): `0x${string}` {
  if (!/^[0-9a-f]{40}$/i.test(headSha)) throw new Error(`not a 40-hex git sha: ${headSha}`);
  return ("0x" + headSha.toLowerCase()).padEnd(66, "0") as `0x${string}`;
}

export function buildAttestRecord(input: {
  repoFullName: string;
  prNumber: number;
  headSha: string;
  findings: Finding[];
  riskScore: number;
  incomplete: boolean;
  /** IPFS-pinned full report; omitted → "" (degraded mode, SPEC-4 v2 ruling). */
  findingsURI?: string;
  /** The chain the audited code targets; omitted/unresolved → 0. */
  targetChainId?: number;
}): AttestRecord {
  return {
    reviewId: reviewIdFor(input.repoFullName, input.prNumber, input.headSha),
    commitHash: commitHashFor(input.headSha),
    // T1's findingsHash directly — the SAME sha256-over-canonical-form the PR
    // comment publishes, so verify() recomputes from the comment alone.
    findingsHash: ("0x" + findingsHash(input.findings)) as `0x${string}`,
    findingsURI: input.findingsURI ?? "",
    riskScore: input.riskScore,
    findingCount: input.findings.length,
    status: input.incomplete ? 1 : 0,
    targetChainId: input.targetChainId ?? 0,
  };
}

// Attestation is a fast testnet write, not a review step: a hung RPC must
// never delay the comment past this budget (SPEC-4 §3 "30 s abort").
const ATTEST_TIMEOUT_MS = 30_000;

/**
 * Default `attest` dep. Undefined unless BOTH `REXTOR_AGENT_PRIVATE_KEY` and
 * `REXTOR_ATTEST_CONTRACT_ADDRESS` are set (checked at wiring time); chain
 * params are re-resolved from the SPEC-5 registry at call time. EVERY failure
 * path — unset env, unverified chain params, revert, timeout — logs and
 * resolves null; the caller renders "attestation skipped" and posts anyway.
 */
export function makeAttestDep(readEnv: () => NodeJS.ProcessEnv = () => process.env): ReviewDeps["attest"] {
  const boot = readEnv();
  if (!boot.REXTOR_AGENT_PRIVATE_KEY || !boot.REXTOR_ATTEST_CONTRACT_ADDRESS) return undefined;
  return (record) => {
    // Re-read at call time (a long-lived server must not pin a rotated key).
    const env = readEnv();
    const pk = env.REXTOR_AGENT_PRIVATE_KEY;
    const address = env.REXTOR_ATTEST_CONTRACT_ADDRESS as `0x${string}` | undefined;
    if (!pk || !address) {
      console.error("[rextor] attestation env unset at call time — skipping");
      return Promise.resolve(null);
    }
    const chain = resolveChain(env);
    // SPEC-5 shared null-skip recipe (chains.ts attestationChainId) — also
    // used by review.ts's targetChainId resolution; null = unverified → skip.
    const chainId = attestationChainId(chain);
    if (chainId == null || !chain.testnet.rpc) {
      console.error("[rextor] attestation chain params unverified — skipping");
      return Promise.resolve(null);
    }
    // SPEC-5 #16 — the resolved chain's registry attestation slot is null
    // until a deploy is recorded. The env address may be a stale override for
    // a DIFFERENT chain (e.g. Tempo's live contract with default chain
    // hyperliquid): a call to a non-contract address on HyperEVM mines
    // status=success as a no-op and slips past the receipt guard below. The
    // null slot must fail loudly BEFORE any tx is sent. (Deliberately not
    // comparing env address to registry address — a legitimate env override
    // for a NEW deploy precedes the registry commit.)
    if (chain.attestation.address == null) {
      console.error(`[rextor] attestation registry slot unverified for ${chain.key} — skipping`);
      return Promise.resolve(null);
    }
    const viemChain = defineChain({
      id: chainId,
      name: chain.name,
      nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
      rpcUrls: { default: { http: [chain.testnet.rpc] } },
    });
    const account = privateKeyToAccount(pk as `0x${string}`);
    const wallet = createWalletClient({ account, chain: viemChain, transport: http() });
    const publicClient = createPublicClient({ chain: viemChain, transport: http() });
    const attempt = (async () => {
      const hash = await wallet.writeContract({
        address,
        abi: REXTOR_ATTESTATION_ABI,
        functionName: "attest",
        args: [
          record.reviewId,
          record.commitHash,
          record.findingsHash,
          record.findingsURI,
          // viem types uint16/uint8/uint32 as number — only uint256+ takes bigint.
          record.riskScore,
          record.findingCount,
          record.status,
          record.targetChainId,
        ],
        chain: viemChain,
        account,
      });
      // The tx must be mined before the comment cites it: no receipt → no tx line.
      // SPEC-4 errata robustness — a MINED-BUT-REVERTED tx must never pass as
      // success (Conatus anchor.ts pattern): only a success receipt means the
      // attestation is actually on-chain state worth citing.
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`attestation tx reverted: ${hash}`);
      }
      return { txHash: hash, explorerUrl: chain.explorer ? `${chain.explorer}/tx/${hash}` : "" };
    })();
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        console.error("[rextor] attestation timed out — posting comment without tx");
        resolve(null);
      }, ATTEST_TIMEOUT_MS);
    });
    return Promise.race([attempt, guard])
      .catch((err: unknown) => {
        // Log the MESSAGE only — never stack traces/env that could echo secrets.
        console.error("[rextor] attestation failed:", err instanceof Error ? err.message : err);
        return null;
      })
      .finally(() => clearTimeout(timer));
  };
}
