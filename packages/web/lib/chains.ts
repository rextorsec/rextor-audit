// SPEC-6 §3 + invariant 18 — web-side chain constants. Values MIRROR the
// agent's SPEC-5 registry (packages/agent/src/chains.ts) — verified in
// docs/deployments/tempo.md — but the agent package is NEVER imported here
// (server internals stay server-side; the web pins its own public constants).
// Only chains with a LIVE attestation deployment appear; params are never
// guessed (SPEC-5 invariant 16).

export interface WebChain {
  /** Registry key — also the /api/chain/[chain] path segment. */
  key: "tempo" | "hyperliquid";
  /** Display name — matches the agent-side row `chain` values verbatim. */
  name: "Tempo testnet" | "HyperEVM mainnet";
  chainId: 42431 | 999;
  /** Public RPC (read-only). */
  rpc: string;
  /** RextorAttestation v2 — the live attestation contract. */
  attestation: `0x${string}`;
  /** The registered attesting agent (public identity, deployment record). */
  agent: `0x${string}`;
  /** Public explorer base URL. */
  explorer: string;
}

export const WEB_CHAINS: Record<WebChain["key"], WebChain> = {
  tempo: {
    key: "tempo",
    name: "Tempo testnet",
    chainId: 42431,
    rpc: "https://rpc.moderato.tempo.xyz",
    attestation: "0x51ac8214089daf85b188437b087519acfc6c495a",
    agent: "0x5f2b9C1549F7e178dC0cC15FdCf3719c9fb47f37",
    explorer: "https://explore.testnet.tempo.xyz",
  },
  // Mirrors the agent SPEC-5 registry hyperliquid entry (MAINNET since
  // 2026-09-21): deploy #2, chain 999, drpc broadcast — the official RPC
  // serves eth_call reads fine (only forge fork-init state sync rejects).
  hyperliquid: {
    key: "hyperliquid",
    name: "HyperEVM mainnet",
    chainId: 999,
    rpc: "https://rpc.hyperliquid.xyz/evm",
    attestation: "0x8f63c0581ab3b2836c95f97fcf104d2dd962850c",
    agent: "0x5f2b9C1549F7e178dC0cC15FdCf3719c9fb47f37",
    explorer: "https://hyperevmscan.io",
  },
};

/** Solana devnet — the Anchor attestation program (pipeline reviews; PR-time
 *  EVM reviews anchor on the WebChain pairs above). Not a WebChain: no EVM
 *  rpc/attestation shape. Hero + FAQ link the program address directly. */
export const SOLANA_DEVNET = {
  key: "solana",
  name: "Solana devnet",
  program: "Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs",
  explorerUrl:
    "https://explorer.solana.com/address/Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs?cluster=devnet",
} as const;

export const DEFAULT_CHAIN_KEY: WebChain["key"] = "tempo";

/** R1 — CWF aimed EVM rider tracks: attested via the HOME chain (no native
 *  deploys), the review's targetChainId anchoring the audited repo. Values
 *  mirror the agent SPEC-5 registry verbatim — the agent package is never
 *  imported here (same rule as WEB_CHAINS). Robinhood params stay null until
 *  captured at integration — never fabricated (SPEC-5 invariant 16). */
export interface RiderChain {
  key: "ethereum" | "base" | "arbitrum" | "robinhood";
  name: string;
  chainId: number | null;
}

export const RIDER_TARGET_CHAINS: Record<RiderChain["key"], RiderChain> = {
  ethereum: { key: "ethereum", name: "Ethereum", chainId: 1 },
  base: { key: "base", name: "Base", chainId: 8453 },
  arbitrum: { key: "arbitrum", name: "Arbitrum One", chainId: 42161 },
  robinhood: { key: "robinhood", name: "Robinhood Chain", chainId: null },
};

export function isWebChainKey(key: string): key is WebChain["key"] {
  return Object.hasOwn(WEB_CHAINS, key);
}

/** Resolve a chain by the agent row's display name ("Tempo testnet"). */
export function webChainByName(name: string): WebChain | undefined {
  return Object.values(WEB_CHAINS).find((chain) => chain.name === name);
}

/** `0x51ac8214089daf85b188437b087519acfc6c495a` → `0x7fe6…0bcd` (mock form). */
export function shortHex(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
