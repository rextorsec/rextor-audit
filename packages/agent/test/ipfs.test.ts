// SPEC-4 v2 (B3) — ipfs.ts unit suite. Offline-deterministic: the Pinata HTTP
// call runs behind an injected fetchFn seam (SPEC-1 invariant 4 — no network
// in tests). The vectors pin the CID-content→findingsHash invariant
// EXTERNALLY (same literals as attest.test.ts), never recomputed in-suite.
import { afterEach, describe, expect, it, vi } from "vitest";

import { PinUnavailableError, makePinDep, pinReport } from "../src/ipfs";
import { canonicalFindingsJson, findingsHash, type Finding } from "../src/findings";
import { CANONICAL_FINDINGS_LITERAL, CANONICAL_FINDINGS_SHA256, EMPTY_FINDINGS_SHA256, VECTOR_FINDINGS } from "./vectors";

const REPORT = {
  commented: true,
  score: 10,
  findings: VECTOR_FINDINGS.map((f) => ({ ...f })) as Finding[],
};

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

const capturingFetch =
  (cid: string, captured: CapturedRequest[]) =>
  async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    captured.push({ url: String(url), init });
    return new Response(JSON.stringify({ IpfsHash: cid }), { status: 200 });
  };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pinReport", () => {
  it("pins the canonical findings JSON — CID content hashes to the attested findingsHash", async () => {
    const captured: CapturedRequest[] = [];
    const { uri, cid } = await pinReport(REPORT, { jwt: "test-jwt", fetchFn: capturingFetch("bafyTESTCID", captured) });
    expect(uri).toBe("ipfs://bafyTESTCID");
    expect(cid).toBe("bafyTESTCID");
    const req = captured[0]!;
    expect(req.url).toBe("https://api.pinata.cloud/pinning/pinJSONToIPFS");
    const headers = req.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-jwt");
    const body = JSON.parse(String(req.init?.body)) as { pinataContent: Finding[] };
    // The pinned document IS the findingsHash input: canonical re-serialization
    // of what the CID resolves to reproduces the EXTERNALLY-computed vector.
    expect(canonicalFindingsJson(body.pinataContent)).toBe(CANONICAL_FINDINGS_LITERAL);
    expect(findingsHash(body.pinataContent)).toBe(CANONICAL_FINDINGS_SHA256);
  });

  it("backtick-bearing findings survive the pin round-trip (re-canonicalized content hashes identically)", async () => {
    const captured: CapturedRequest[] = [];
    const findings: Finding[] = [
      { file: "src/V.sol", line: 1, severity: "low", check: "c", description: "has `backticks` and \nnewline", id: 0 },
    ];
    await pinReport({ commented: true, score: 3, findings }, { jwt: "j", fetchFn: capturingFetch("bafyX", captured) });
    const body = JSON.parse(String(captured[0]?.init?.body)) as { pinataContent: Finding[] };
    expect(findingsHash(body.pinataContent)).toBe(findingsHash(findings));
  });

  it("empty findings pin to [] whose canonical hash is the hard-incomplete payload hash", async () => {
    const captured: CapturedRequest[] = [];
    await pinReport({ commented: true, score: 0, findings: [] }, { jwt: "j", fetchFn: capturingFetch("bafyEMPTY", captured) });
    const body = JSON.parse(String(captured[0]?.init?.body)) as { pinataContent: Finding[] };
    expect(body.pinataContent).toEqual([]);
    expect(findingsHash(body.pinataContent)).toBe(EMPTY_FINDINGS_SHA256);
  });

  it("HTTP 401 → PinUnavailableError (auth failure is a pin failure, never a crash)", async () => {
    const fetchFn = async () => new Response("Unauthorized", { status: 401 });
    await expect(pinReport(REPORT, { jwt: "bad", fetchFn })).rejects.toThrow(/http 401/);
    await expect(pinReport(REPORT, { jwt: "bad", fetchFn })).rejects.toBeInstanceOf(PinUnavailableError);
  });

  it("transport failure (fetch throws) → PinUnavailableError", async () => {
    const fetchFn = async () => {
      throw new Error("getaddrinfo ENOTFOUND api.pinata.cloud");
    };
    await expect(pinReport(REPORT, { jwt: "j", fetchFn })).rejects.toBeInstanceOf(PinUnavailableError);
  });

  it("response without IpfsHash → PinUnavailableError", async () => {
    const fetchFn = async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 });
    await expect(pinReport(REPORT, { jwt: "j", fetchFn })).rejects.toThrow(/IpfsHash/);
  });

  it("unparseable response body → PinUnavailableError", async () => {
    const fetchFn = async () => new Response("<html>gateway error</html>", { status: 200 });
    await expect(pinReport(REPORT, { jwt: "j", fetchFn })).rejects.toBeInstanceOf(PinUnavailableError);
  });

  it("no JWT (opts nor env) → PinUnavailableError without any network call", async () => {
    vi.stubEnv("IPFS_PINNING_JWT", "");
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(pinReport(REPORT, { fetchFn })).rejects.toBeInstanceOf(PinUnavailableError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("makePinDep", () => {
  it("is undefined when IPFS_PINNING_JWT unset at wiring time; a function when set", () => {
    expect(makePinDep(() => ({}))).toBeUndefined();
    expect(makePinDep(() => ({ IPFS_PINNING_JWT: "jwt" }))).toBeTypeOf("function");
  });
});
