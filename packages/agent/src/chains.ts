// SPEC-5 — chain registry: the ONLY place chain differences live (invariant
// 15). Params verified 2026-09-16: Tempo testnet 42431 (tempo.xyz docs),
// HyperEVM testnet 998 (hyperliquid.gitbook.io, for-developers/hyperevm);
// HyperEVM RPC corrected 2026-09-18 — the bare domain 404s, only the `/evm`
// path serves JSON-RPC (live eth_chainId probe → 0x3e6). Unverified → null,
// and null fails loudly downstream (invariant 16) — never a guess.
export type ChainKey = "tempo" | "hyperliquid" | "ethereum" | "base" | "arbitrum" | "robinhood";

export interface ChainConfig {
  key: ChainKey;
  name: string;
  testnet: { chainId: number | null; rpc: string | null };
  attestation: { address: `0x${string}` | null; chainId: number | null };
  explorer: string | null; // null until verified — footer omits the link
  notes: string;
}

// Deep-frozen: resolveChain spreads entries shallowly, so nested testnet /
// attestation objects are shared across resolutions — freezing keeps a
// poisoned entry from leaking into later resolves (SPEC-5 invariant 16).
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") deepFreeze(value);
  }
  return Object.freeze(obj);
}

export const CHAIN_REGISTRY: Record<ChainKey, ChainConfig> = deepFreeze({
  tempo: {
    key: "tempo", name: "Tempo testnet",
    testnet: { chainId: 42431, rpc: "https://rpc.moderato.tempo.xyz" },
    attestation: { address: "0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd", chainId: 42431 }, explorer: null,
    notes: "Flagship track: full loop — Slither+Aderyn, fork-sim, attestation deploy #2 (v2: findingsURI + targetChainId).",
  },
  hyperliquid: {
    key: "hyperliquid", name: "HyperEVM testnet",
    testnet: { chainId: 998, rpc: "https://rpc.hyperliquid-testnet.xyz/evm" },
    attestation: { address: null, chainId: null }, explorer: null,
    notes: "Primary track: same loop, attestation deploy #2 (v2 direct).",
  },
  ethereum: {
    key: "ethereum", name: "Ethereum",
    testnet: { chainId: 1, rpc: null },
    attestation: { address: null, chainId: null }, explorer: null,
    notes: "Rider: deterministic pass; attestation once deployed (config-level).",
  },
  base: {
    key: "base", name: "Base",
    testnet: { chainId: 8453, rpc: null },
    attestation: { address: null, chainId: null }, explorer: null,
    notes: "Rider: config-level.",
  },
  arbitrum: {
    key: "arbitrum", name: "Arbitrum One",
    testnet: { chainId: 42161, rpc: null },
    attestation: { address: null, chainId: null }, explorer: null,
    notes: "Rider: config-level (Robinhood Chain is an Arbitrum Orbit chain).",
  },
  robinhood: {
    key: "robinhood", name: "Robinhood Chain",
    testnet: { chainId: null, rpc: null },
    attestation: { address: null, chainId: null }, explorer: null,
    notes: "Rider: params captured at integration — never fabricated.",
  },
});

export interface ResolvedChain extends ChainConfig { forkRpc: string | null }

/**
 * SPEC-4 v2 — the targetChainId source: the id of the chain attestation rides
 * on (attestation slot preferred, testnet fallback), or null when unverified
 * (unknown key throws in resolveChain; null slots stay null). Null-skip
 * semantic (shared by attest.ts and review.ts — single recipe): callers SKIP
 * rather than print or attest 0; on-chain 0 = unresolved.
 */
export function attestationChainId(chain: ResolvedChain): number | null {
  return chain.attestation.chainId ?? chain.testnet.chainId;
}

export function resolveChain(env: { REXTOR_DEFAULT_CHAIN?: string; REXTOR_FORK_RPC_URL?: string }): ResolvedChain {
  const key = (env.REXTOR_DEFAULT_CHAIN ?? "tempo") as ChainKey;
  if (!Object.hasOwn(CHAIN_REGISTRY, key)) {
    throw new Error(`unknown chain: ${String(env.REXTOR_DEFAULT_CHAIN)} (known: ${Object.keys(CHAIN_REGISTRY).join(", ")})`);
  }
  return { ...CHAIN_REGISTRY[key], forkRpc: env.REXTOR_FORK_RPC_URL ?? CHAIN_REGISTRY[key].testnet.rpc };
}
