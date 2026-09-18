// SPEC-4 v2 (B3) — IPFS pin of the review report. The pinned document IS the
// canonical findings JSON (SPEC-2 §2) — the exact preimage the on-chain
// findingsHash covers — so anyone can fetch the CID, re-canonicalize, and
// sha256-verify against the attestation (SPEC-4 invariant 14 end-to-end).
//
// Degradation mirrors SPEC-4 §3 attest: a pin failure throws
// PinUnavailableError and the pipeline attests with findingsURI "" — the pin
// ENHANCES the review; it can never block or fail it.
import { canonicalFindingsJson, type Finding } from "./findings";
import type { ReviewDeps, ReviewResult } from "./review";

const PINATA_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

// A hung pin must not delay the comment: the attestation budget is 30 s
// (attest.ts); the pin rides in front of it, so its own budget is tighter.
const PIN_TIMEOUT_MS = 15_000;

export class PinUnavailableError extends Error {
  constructor(cause: string) {
    super(`ipfs pin unavailable: ${cause}`);
    this.name = "PinUnavailableError";
  }
}

export interface PinOptions {
  /** Overrides IPFS_PINNING_JWT (tests / multi-tenant callers). */
  jwt?: string;
  /** Injectable fetch seam (tests; mirrors openrouter.ts). */
  fetchFn?: typeof fetch;
  /** Pinata metadata name; default `rextor-audit-report`. */
  name?: string;
}

export interface PinResult {
  /** On-chain findingsURI value: `ipfs://<cid>` (conatus ipfs.ts pattern). */
  uri: string;
  /** The bare CID as returned by Pinata. */
  cid: string;
}

export async function pinReport(report: ReviewResult, opts: PinOptions = {}): Promise<PinResult> {
  const jwt = opts.jwt ?? process.env.IPFS_PINNING_JWT;
  if (!jwt) throw new PinUnavailableError("IPFS_PINNING_JWT unset");
  // canonicalFindingsJson = the findingsHash input bytes (SPEC-2 §2). It is
  // parsed back to a VALUE for pinataContent (Pinata serializes pinataContent
  // itself — it cannot accept pre-serialized bytes). Wire formatting is then
  // irrelevant BY CONSTRUCTION: any verifier must re-canonicalize before
  // hashing (the \u0060 backtick escape is a PR-comment-fence artifact, not
  // an IPFS one), and sha256(canonical(JSON.parse(pinned))) is byte-identical
  // to the attested findingsHash — pinned in ipfs.test.ts against external
  // vectors.
  const pinataContent: unknown = JSON.parse(canonicalFindingsJson(report.findings ?? []));
  const doFetch = opts.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIN_TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(PINATA_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        pinataContent,
        pinataMetadata: { name: opts.name ?? "rextor-audit-report" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new PinUnavailableError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new PinUnavailableError(`http ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  let data: { IpfsHash?: unknown };
  try {
    data = (await res.json()) as typeof data;
  } catch (err) {
    throw new PinUnavailableError(`unparseable response: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof data.IpfsHash !== "string" || data.IpfsHash.length === 0) {
    throw new PinUnavailableError("response missing IpfsHash");
  }
  return { uri: `ipfs://${data.IpfsHash}`, cid: data.IpfsHash };
}

/**
 * ReviewDeps `pin` seam. Undefined unless IPFS_PINNING_JWT is set at wiring
 * time (→ "pin not configured" is just the empty findingsURI path); the JWT
 * is re-read at call time so a long-lived server never pins a rotated key
 * (mirrors makeAttestDep). EVERY failure resolves as a throw — review.ts
 * catches it and attests with findingsURI "".
 */
export function makePinDep(readEnv: () => NodeJS.ProcessEnv = () => process.env): ReviewDeps["pin"] {
  if (!readEnv().IPFS_PINNING_JWT) return undefined;
  return (report) => {
    const env = readEnv();
    return pinReport(report, { jwt: env.IPFS_PINNING_JWT });
  };
}
