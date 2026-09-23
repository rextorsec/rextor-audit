// SPEC-4 v2 (B3) — ipfs.ts unit suite. Offline-deterministic: the Pinata HTTP
// call runs behind an injected fetchFn seam (SPEC-1 invariant 4 — no network
// in tests). The vectors pin the CID-content→findingsHash invariant
// EXTERNALLY (same literals as attest.test.ts), never recomputed in-suite.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

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

/** Extract the multipart `file` part as text (type-guarded — FormDataEntryValue is File | string). */
async function filePart(init?: RequestInit): Promise<string> {
  const entry = (init?.body as FormData).get("file");
  if (!(entry instanceof Blob)) throw new Error("multipart file part missing");
  return entry.text();
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
  it("uploads the EXACT canonical findings bytes to pinFileToIPFS — sha256(raw body) = attested findingsHash", async () => {
    const captured: CapturedRequest[] = [];
    const { uri, cid } = await pinReport(REPORT, { jwt: "test-jwt", fetchFn: capturingFetch("bafyTESTCID", captured) });
    expect(uri).toBe("ipfs://bafyTESTCID");
    expect(cid).toBe("bafyTESTCID");
    const req = captured[0]!;
    expect(req.url).toBe("https://api.pinata.cloud/pinning/pinFileToIPFS");
    const headers = req.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-jwt");
    // STRING equality, not a JSON roundtrip: the uploaded file IS the
    // canonical bytes, so verification is download → sha256 → compare, one
    // step, no re-canonicalization (controller ruling, fix round 1).
    const fileText = await filePart(req.init);
    const canonical = canonicalFindingsJson(REPORT.findings as Finding[]);
    // External literal first (printf %s '<literal>' | shasum -a 256), then the
    // serializer agreement — belt and braces.
    expect(fileText).toBe(CANONICAL_FINDINGS_LITERAL);
    expect(fileText).toBe(canonical);
    expect(createHash("sha256").update(fileText, "utf8").digest("hex")).toBe(CANONICAL_FINDINGS_SHA256);
  });

  it("backtick-bearing findings pin the RAW canonical bytes — \\u0060 escapes survive verbatim on the wire", async () => {
    const captured: CapturedRequest[] = [];
    const findings: Finding[] = [
      { file: "src/V.sol", line: 1, severity: "low", check: "c", description: "has `backticks` and \nnewline", id: 0 },
    ];
    await pinReport({ commented: true, score: 3, findings }, { jwt: "j", fetchFn: capturingFetch("bafyX", captured) });
    const fileText = await filePart(captured[0]?.init);
    const canonical = canonicalFindingsJson(findings);
    expect(fileText).toBe(canonical); // string equality — escapes intact, NOT re-serialized
    expect(fileText).toContain("\\u0060"); // the raw canonical escape is on the wire
    // One-step verification: sha256 of the pinned content == the attested hash.
    expect(createHash("sha256").update(fileText, "utf8").digest("hex")).toBe(findingsHash(findings));
  });

  it("empty findings upload '[]' whose raw sha256 is the hard-incomplete payload hash", async () => {
    const captured: CapturedRequest[] = [];
    await pinReport({ commented: true, score: 0, findings: [] }, { jwt: "j", fetchFn: capturingFetch("bafyEMPTY", captured) });
    const fileText = await filePart(captured[0]?.init);
    expect(fileText).toBe("[]");
    expect(createHash("sha256").update(fileText, "utf8").digest("hex")).toBe(EMPTY_FINDINGS_SHA256);
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

describe("stalled pin response body (deadline arms through the body read)", () => {
  it("a body that never settles rejects at the deadline instead of hanging the queue slot", async () => {
    const stalledFetch = async (_url: unknown, init?: RequestInit): Promise<Response> => {
      // Faithful stall model: the body never emits, and the read REJECTS when
      // the abort signal fires (real undici behavior the code relies on).
      const { promise, reject } = Promise.withResolvers<unknown>();
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      return { ok: true, json: () => promise } as unknown as Response;
    };
    await expect(
      pinReport(REPORT, { jwt: "j", timeoutMs: 50, fetchFn: stalledFetch as unknown as typeof fetch }),
    ).rejects.toThrow(/body did not settle within 50ms/);
  });
});

describe("IpfsHash charset validation", () => {
  const jsonResponse = (body: string): typeof fetch =>
    (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

  it("rejects a hostile IpfsHash carrying markdown-breaking bytes", async () => {
    await expect(
      pinReport(REPORT, { jwt: "j", fetchFn: jsonResponse('{"IpfsHash":"QmAbc`payload"}') }),
    ).rejects.toThrow(/valid CID charset/);
  });

  it("accepts a legitimate alphanumeric CIDv0", async () => {
    const res = await pinReport(REPORT, {
      jwt: "j",
      fetchFn: jsonResponse('{"IpfsHash":"QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"}'),
    });
    expect(res.cid).toBe("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG");
    expect(res.uri).toBe("ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG");
  });
});
