import { describe, expect, it } from "vitest";
import { CHAIN_REGISTRY, resolveChain, type ChainKey } from "../src/chains";

describe("CHAIN_REGISTRY", () => {
  it("carries verified testnet params for tempo + hyperliquid, nulls elsewhere", () => {
    expect(CHAIN_REGISTRY.tempo.testnet).toEqual({ chainId: 42431, rpc: "https://rpc.moderato.tempo.xyz" });
    expect(CHAIN_REGISTRY.hyperliquid.testnet).toEqual({ chainId: 998, rpc: "https://rpc.hyperliquid-testnet.xyz" });
    expect(CHAIN_REGISTRY.ethereum.testnet.chainId).toBe(1);
    expect(CHAIN_REGISTRY.base.testnet.chainId).toBe(8453);
    expect(CHAIN_REGISTRY.arbitrum.testnet.chainId).toBe(42161);
    expect(CHAIN_REGISTRY.robinhood.testnet.chainId).toBeNull(); // never fabricated (SPEC-5 #16)
  });
  it("every entry has non-empty notes; tempo attestation filled by deploy #1, others null", () => {
    // SPEC-4 §2: slots start null and are filled by recorded deployments —
    // docs/deployments/tempo.md is the anchor for this literal.
    expect(CHAIN_REGISTRY.tempo.attestation).toEqual({
      address: "0x513707577e4d8925295072df7944b0659228d31f",
      chainId: 42431,
    });
    for (const key of Object.keys(CHAIN_REGISTRY) as ChainKey[]) {
      expect(CHAIN_REGISTRY[key].notes.length).toBeGreaterThan(0);
      if (key !== "tempo") expect(CHAIN_REGISTRY[key].attestation.address).toBeNull();
    }
  });
  it("registry and entries are deeply frozen — spread can't share mutable state", () => {
    expect(Object.isFrozen(CHAIN_REGISTRY)).toBe(true);
    for (const key of Object.keys(CHAIN_REGISTRY) as ChainKey[]) {
      expect(Object.isFrozen(CHAIN_REGISTRY[key])).toBe(true);
      expect(Object.isFrozen(CHAIN_REGISTRY[key].testnet)).toBe(true);
      expect(Object.isFrozen(CHAIN_REGISTRY[key].attestation)).toBe(true);
    }
  });
});

describe("resolveChain", () => {
  it("defaults to tempo", () => {
    expect(resolveChain({}).key).toBe("tempo");
  });
  it("explicit selection + fork override precedence", () => {
    const r = resolveChain({ REXTOR_DEFAULT_CHAIN: "hyperliquid", REXTOR_FORK_RPC_URL: "https://x" });
    expect(r.key).toBe("hyperliquid");
    expect(r.forkRpc).toBe("https://x");
    expect(resolveChain({ REXTOR_FORK_RPC_URL: "https://x" }).forkRpc).toBe("https://x");
    expect(resolveChain({}).forkRpc).toBe("https://rpc.moderato.tempo.xyz");
  });
  it("unknown key → explicit error listing known keys", () => {
    expect(() => resolveChain({ REXTOR_DEFAULT_CHAIN: "solana" })).toThrow(/unknown chain: solana/);
  });
  it("prototype keys are rejected, not resolved (fail-loud regression)", () => {
    for (const evil of ["toString", "valueOf", "constructor", "__proto__"]) {
      expect(() => resolveChain({ REXTOR_DEFAULT_CHAIN: evil })).toThrow(
        `unknown chain: ${evil} (known: tempo, hyperliquid, ethereum, base, arbitrum, robinhood)`,
      );
    }
  });
});
