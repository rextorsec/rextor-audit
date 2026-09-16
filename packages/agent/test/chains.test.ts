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
  it("every entry has non-empty notes; attestation addresses start null", () => {
    for (const key of Object.keys(CHAIN_REGISTRY) as ChainKey[]) {
      expect(CHAIN_REGISTRY[key].notes.length).toBeGreaterThan(0);
      expect(CHAIN_REGISTRY[key].attestation.address).toBeNull();
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
});
