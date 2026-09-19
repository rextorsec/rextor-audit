// SPEC-4 §1/§3 — verdict identity (reviewId / commitHash / findingsHash) and
// the attestation dep factory. Hash vectors are EXTERNALLY computed literals
// shared with findings.test.ts via ./vectors — never recomputed in-suite.
import { describe, expect, it, vi } from "vitest";
import { getAbiItem, keccak256 } from "viem";

import { buildAttestRecord, commitHashFor, makeAttestDep, reviewIdFor, REXTOR_ATTESTATION_ABI } from "../src/attest";
import { CANONICAL_FINDINGS_LITERAL, CANONICAL_FINDINGS_SHA256, VECTOR_FINDINGS } from "./vectors";

const sha40 = "971a6ca000000000000000000000000000000000"; // 40 hex chars

describe("verdict identity (SPEC-4 §1 vectors)", () => {
  it("reviewId = keccak256 of the published derivation string", () => {
    expect(reviewIdFor("rextorsec/rextor-audit", 1, "abc123")).toBe(
      keccak256(new TextEncoder().encode("rextor/review/v1|rextorsec/rextor-audit|1|abc123")),
    );
  });

  it("commitHash right-zero-pads the 20-byte git sha", () => {
    expect(commitHashFor(sha40)).toBe("0x" + sha40 + "0".repeat(24));
  });

  it("commitHash is case-insensitive on input and always lowercase", () => {
    expect(commitHashFor(sha40.toUpperCase())).toBe("0x" + sha40 + "0".repeat(24));
  });

  it("commitHash rejects a non-40-hex sha (fail loud, never attest a bogus identity)", () => {
    expect(() => commitHashFor("abc123")).toThrow(/40-hex/);
    expect(() => commitHashFor("zz1a6ca000000000000000000000000000000000")).toThrow(/40-hex/);
  });

  it("buildAttestRecord hashes canonical findings and maps incomplete→1", () => {
    const rec = buildAttestRecord({
      repoFullName: "o/r", prNumber: 2, headSha: sha40,
      findings: VECTOR_FINDINGS as unknown as Parameters<typeof buildAttestRecord>[0]["findings"],
      riskScore: 10, incomplete: false,
    });
    // Same canonicalization as T1: the digest must equal the shared external literal.
    expect(rec.findingsHash).toBe("0x" + CANONICAL_FINDINGS_SHA256);
    expect(CANONICAL_FINDINGS_LITERAL).toContain("src/V.sol"); // vector sanity
    expect(rec.riskScore).toBe(10);
    expect(rec.findingCount).toBe(1);
    expect(rec.status).toBe(0);
    expect(rec.commitHash).toBe("0x" + sha40 + "0".repeat(24));
    // SPEC-4 v2 degraded defaults: no URI pinned, no target chain resolved.
    expect(rec.findingsURI).toBe("");
    expect(rec.targetChainId).toBe(0);
    const hard = buildAttestRecord({
      repoFullName: "o/r", prNumber: 2, headSha: sha40, findings: [], riskScore: 0, incomplete: true,
    });
    expect(hard.status).toBe(1);
    expect(hard.findingCount).toBe(0);
  });

  it("buildAttestRecord carries v2 findingsURI and targetChainId when supplied", () => {
    const rec = buildAttestRecord({
      repoFullName: "o/r", prNumber: 2, headSha: sha40, findings: [], riskScore: 5, incomplete: false,
      findingsURI: "ipfs://bafytest/report.json", targetChainId: 42431,
    });
    expect(rec.findingsURI).toBe("ipfs://bafytest/report.json");
    expect(rec.targetChainId).toBe(42431);
    // reviewId recipe is UNCHANGED — v2 fields never touch the derivation string.
    expect(rec.reviewId).toBe(reviewIdFor("o/r", 2, sha40));
  });
});
describe("REXTOR_ATTESTATION_ABI (viem-ready)", () => {
  // Regression (T10 Phase C live run): the ABI shipped as human-readable
  // strings, and writeContract threw `Cannot use 'in' operator to search for
  // 'name' in function attest(…)` — every attestation degraded to "skipped".
  it("resolves attest/verify via viem getAbiItem — parsed items, not HRABI strings", () => {
    const attest = getAbiItem({ abi: REXTOR_ATTESTATION_ABI, name: "attest" });
    expect(attest.type).toBe("function");
    // SPEC-4 v2: findingsURI + targetChainId added to the payload.
    expect(attest.inputs).toHaveLength(8);
    expect(attest.inputs.map((i) => i.name)).toEqual([
      "reviewId", "commitHash", "findingsHash", "findingsURI",
      "riskScore", "findingCount", "status", "targetChainId",
    ]);
    const verify = getAbiItem({ abi: REXTOR_ATTESTATION_ABI, name: "verify" });
    expect(verify.inputs).toHaveLength(8);
    expect(verify.outputs).toHaveLength(1);
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
  it("skips (null) when the resolved chain's registry attestation slot is null — even if the address env is set (SPEC-5 #16)", async () => {
    // Stale-env hazard: REXTOR_DEFAULT_CHAIN=hyperliquid (registry slot null
    // until deploy #2) while REXTOR_ATTEST_CONTRACT_ADDRESS still holds the
    // live Tempo address. A call to a non-contract address MINES status=success
    // as a no-op on HyperEVM, so the receipt guard alone cannot catch it —
    // the null registry slot must fail loudly BEFORE any tx is sent.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      REXTOR_AGENT_PRIVATE_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // anvil key #1, test-only
      REXTOR_ATTEST_CONTRACT_ADDRESS: "0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd", // Tempo deploy #1
      REXTOR_DEFAULT_CHAIN: "hyperliquid",
    };
    const attest = makeAttestDep(() => env)!;
    const record = buildAttestRecord({
      repoFullName: "o/r", prNumber: 1, headSha: sha40,
      findings: [], riskScore: 0, incomplete: false,
    });
    const result = await attest(record);
    expect(result).toBeNull();
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/registry slot unverified/));
    err.mockRestore();
  });
});
