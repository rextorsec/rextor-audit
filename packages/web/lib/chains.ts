// SPEC-6 §3 + invariant 18 — web-side chain constants. Values MIRROR the
// agent's SPEC-5 registry (packages/agent/src/chains.ts) — verified in
// docs/deployments/tempo.md — but the agent package is NEVER imported here
// (server internals stay server-side; the web pins its own public constants).
// Only chains with a LIVE attestation deployment appear; params are never
// guessed (SPEC-5 invariant 16). HyperEVM joins when its deploy lands.

export interface WebChain {
  /** Registry key — also the /api/chain/[chain] path segment. */
  key: "tempo";
  /** Display name — matches the agent-side row `chain` values verbatim. */
  name: "Tempo testnet";
  chainId: 42431;
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
    attestation: "0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd",
    agent: "0xE6906A58ea17E28aFEFBA5bBcD5EBa85BF58a122",
    explorer: "https://explore.testnet.tempo.xyz",
  },
};

export const DEFAULT_CHAIN_KEY: WebChain["key"] = "tempo";

export function isWebChainKey(key: string): key is WebChain["key"] {
  return Object.hasOwn(WEB_CHAINS, key);
}

/** Resolve a chain by the agent row's display name ("Tempo testnet"). */
export function webChainByName(name: string): WebChain | undefined {
  return Object.values(WEB_CHAINS).find((chain) => chain.name === name);
}

/** `0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd` → `0x7fe6…0bcd` (mock form). */
export function shortHex(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
