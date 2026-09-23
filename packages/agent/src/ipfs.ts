// SPEC-4 v2 (B3) — IPFS pin of the review report. The pinned file IS the
// canonical findings JSON (SPEC-2 §2) — the exact bytes the on-chain
// findingsHash covers — uploaded RAW via Pinata pinFileToIPFS (multipart
// `file` field, application/json; no parse/re-serialize anywhere). The
// verification story is ONE step: download the CID → sha256(content) →
// compare with the on-chain findingsHash. Backtick \u0060 escapes from the
// canonical serializer ride on the wire verbatim — the raw bytes hash
// correctly even for backtick-bearing Solidity findings (controller ruling,
// fix round 1: pinJSONToIPFS would have re-serialized them away).
//
// Degradation mirrors SPEC-4 §3 attest: a pin failure throws
// PinUnavailableError and the pipeline attests with findingsURI "" — the pin
// ENHANCES the review; it can never block or fail it.
import { canonicalFindingsJson } from "./findings";
import type { ReviewDeps, ReviewResult } from "./review";

const PINATA_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

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
  /** Overrides PIN_TIMEOUT_MS (tests; mirrors openrouter config.timeoutMs). */
  timeoutMs?: number;
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
  // The canonical bytes are uploaded VERBATIM as the multipart `file` field —
  // never parsed and re-serialized, so the CID content is byte-identical to
  // the findingsHash input (SPEC-2 §2 canonical form, \u0060 escapes intact).
  // No content-type header is set by hand: fetch generates the multipart
  // boundary. pinataMetadata is metadata (name), not content — it never
  // touches the pinned bytes.
  const canonical = canonicalFindingsJson(report.findings ?? []);
  const form = new FormData();
  form.append("file", new Blob([canonical], { type: "application/json" }), "report.json");
  form.append("pinataMetadata", JSON.stringify({ name: opts.name ?? "rextor-audit-report" }));
  const doFetch = opts.fetchFn ?? fetch;
  const controller = new AbortController();
  const budgetMs = opts.timeoutMs ?? PIN_TIMEOUT_MS;
  // The deadline arms for the WHOLE exchange — headers AND body. A stalled
  // Pinata body must hit the same deadline instead of hanging a serial queue
  // slot until undici's default body timeout.
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    let res: Response;
    try {
      res = await doFetch(PINATA_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      throw new PinUnavailableError(err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new PinUnavailableError(`http ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    let data: { IpfsHash?: unknown };
    try {
      data = (await res.json()) as typeof data;
    } catch (err) {
      if (controller.signal.aborted) {
        throw new PinUnavailableError(`response body did not settle within ${budgetMs}ms`);
      }
      throw new PinUnavailableError(`unparseable response: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (typeof data.IpfsHash !== "string" || data.IpfsHash.length === 0) {
      throw new PinUnavailableError("response missing IpfsHash");
    }
    return { uri: `ipfs://${data.IpfsHash}`, cid: data.IpfsHash };
  } finally {
    clearTimeout(timer);
  }
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
