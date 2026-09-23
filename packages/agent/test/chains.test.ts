import { describe, expect, it } from "vitest";
import {
  attestationChainId,
  CHAIN_REGISTRY,
  resolveChain,
  targetChainIdFromFoundry,
  type ChainKey,
} from "../src/chains";

describe("CHAIN_REGISTRY", () => {
  it("carries verified testnet params for tempo + hyperliquid, nulls elsewhere", () => {
    expect(CHAIN_REGISTRY.tempo.testnet).toEqual({ chainId: 42431, rpc: "https://rpc.moderato.tempo.xyz" });
    // RPC verified live 2026-09-18: bare domain 404s, only `/evm` serves
    // JSON-RPC. 2026-09-21: deployment target moved to MAINNET (chainId 999)
    // — the `testnet` field carries the chain params the service uses.
    expect(CHAIN_REGISTRY.hyperliquid.testnet).toEqual({ chainId: 999, rpc: "https://rpc.hyperliquid.xyz/evm" });
    expect(CHAIN_REGISTRY.ethereum.testnet.chainId).toBe(1);
    expect(CHAIN_REGISTRY.base.testnet.chainId).toBe(8453);
    expect(CHAIN_REGISTRY.arbitrum.testnet.chainId).toBe(42161);
    expect(CHAIN_REGISTRY.robinhood.testnet.chainId).toBeNull(); // never fabricated (SPEC-5 #16)
    // SPEC-8 §3 — non-EVM: no EVM chainId exists (verified semantic null,
    // invariant 27); RPC verified live 2026-09-19 (getHealth → ok).
    expect(CHAIN_REGISTRY.solana.testnet).toEqual({ chainId: null, rpc: "https://api.devnet.solana.com" });
    // B4 deployed 2026-09-19 (docs/deployments/solana.md anchors this literal):
    // address = the devnet programId (base58 — the widened slot's first use),
    // chainId stays the verified semantic null.
    expect(CHAIN_REGISTRY.solana.attestation).toEqual({
      address: "Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs",
      chainId: null,
    });
  });
  it("solana resolves and nulls the targetChainId source (SPEC-8 §3 null-skip)", () => {
    const resolved = resolveChain({ REXTOR_DEFAULT_CHAIN: "solana" });
    expect(resolved.key).toBe("solana");
    expect(attestationChainId(resolved)).toBeNull();
  });
  it("hyperliquid attestation filled by MAINNET deploy #2 — mainnet is the targetChainId source (SPEC-4 §2 / SPEC-5 #16)", () => {
    // 2026-09-21: faucet-gated testnet abandoned; deploy #2 landed on
    // HyperEVM MAINNET (chainId 999) owned by the post-rotation key.
    expect(CHAIN_REGISTRY.hyperliquid.attestation).toEqual({
      address: "0x8f63c0581ab3b2836c95f97fcf104d2dd962850c",
      chainId: 999,
    });
    expect(CHAIN_REGISTRY.hyperliquid.explorer).toBe("https://hyperevmscan.io");
    const resolved = resolveChain({ REXTOR_DEFAULT_CHAIN: "hyperliquid" });
    expect(resolved.testnet).toEqual({ chainId: 999, rpc: "https://rpc.hyperliquid.xyz/evm" });
    expect(attestationChainId(resolved)).toBe(999);
  });
  it("every entry has non-empty notes; deployed slots carry recorded addresses", () => {
    // SPEC-4 §2: slots start null and are filled by recorded deployments —
    // docs/deployments/tempo.md is the anchor for this literal. Tempo #2
    // (0x7fe69ade…) was zeroed by the 2026-09-21 state reset; #3 is current.
    expect(CHAIN_REGISTRY.tempo.attestation).toEqual({
      address: "0x51ac8214089daf85b188437b087519acfc6c495a",
      chainId: 42431,
    });
    for (const key of Object.keys(CHAIN_REGISTRY) as ChainKey[]) {
      expect(CHAIN_REGISTRY[key].notes.length).toBeGreaterThan(0);
      // Deployed slots: tempo (SPEC-4 #3) + hyperliquid (mainnet #2) + solana
      // (SPEC-8 B4). Everything else stays null until a recorded deployment
      // fills it.
      if (!["tempo", "hyperliquid", "solana"].includes(key)) {
        expect(CHAIN_REGISTRY[key].attestation.address).toBeNull();
      }
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
    expect(() => resolveChain({ REXTOR_DEFAULT_CHAIN: "sui" })).toThrow(/unknown chain: sui/);
  });
  it("prototype keys are rejected, not resolved (fail-loud regression)", () => {
    for (const evil of ["toString", "valueOf", "constructor", "__proto__"]) {
      expect(() => resolveChain({ REXTOR_DEFAULT_CHAIN: evil })).toThrow(
        `unknown chain: ${evil} (known: tempo, hyperliquid, ethereum, base, arbitrum, robinhood, solana)`,
      );
    }
  });
});

describe("targetChainIdFromFoundry", () => {
  it("maps registry-known chain ids through testnet.chainId", () => {
    expect(targetChainIdFromFoundry("chain_id = 8453")).toBe(8453);
    expect(targetChainIdFromFoundry("chain_id = 1")).toBe(1);
    expect(targetChainIdFromFoundry("chain_id = 42161")).toBe(42161);
    expect(targetChainIdFromFoundry("chain_id = 42431")).toBe(42431);
    expect(targetChainIdFromFoundry("chain_id = 999")).toBe(999);
  });
  it("unmapped ids, empty and null contents → null (never fabricated, invariant 16)", () => {
    expect(targetChainIdFromFoundry("chain_id = 1337")).toBeNull();
    expect(targetChainIdFromFoundry("")).toBeNull();
    expect(targetChainIdFromFoundry(null)).toBeNull();
  });
  it("strips # and // comments before matching — a commented-out hint never matches", () => {
    expect(targetChainIdFromFoundry("# chain_id = 1")).toBeNull();
    expect(targetChainIdFromFoundry("// chain_id = 1")).toBeNull();
    expect(targetChainIdFromFoundry("chain_id = 8453 # prod")).toBe(8453);
  });
  it("the first chain_id assignment wins", () => {
    expect(targetChainIdFromFoundry("chain_id = 42431\nchain_id = 8453")).toBe(42431);
  });
});
