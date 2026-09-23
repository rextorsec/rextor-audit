// SPEC-5 — chain registry: the ONLY place chain differences live (invariant
// 15). Params verified 2026-09-16: Tempo testnet 42431 (tempo.xyz docs),
// HyperEVM testnet 998 (hyperliquid.gitbook.io, for-developers/hyperevm);
// HyperEVM RPC corrected 2026-09-18 — the bare domain 404s, only the `/evm`
// path serves JSON-RPC (live eth_chainId probe → 0x3e6). Unverified → null,
// and null fails loudly downstream (invariant 16) — never a guess.
export type ChainKey = "tempo" | "hyperliquid" | "ethereum" | "base" | "arbitrum" | "robinhood" | "solana";

export interface ChainConfig {
  key: ChainKey;
  name: string;
  testnet: { chainId: number | null; rpc: string | null };
  // SPEC-8 §3 — address is widened beyond `0x${string}`: the Solana slot
  // holds a base58 programId. Both families stay `null` until recorded.
  attestation: { address: string | null; chainId: number | null };
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
    attestation: { address: "0x51ac8214089daf85b188437b087519acfc6c495a", chainId: 42431 }, explorer: null,
    notes: "Flagship track: full loop — Slither+Aderyn, fork-sim, attestation deploy #3 (v2: findingsURI + targetChainId; #2 zeroed by the 2026-09-21 testnet state reset).",
  },
  hyperliquid: {
    key: "hyperliquid", name: "HyperEVM mainnet",
    // Deployment target moved to MAINNET 2026-09-21 (faucet-gated testnet
    // abandoned; gas 0.1 gwei → months of attestations ≈ 0.002 HYPE). The
    // `testnet` field is the schema-historical name for "the chain params
    // the service uses" — it now carries MAINNET values.
    testnet: { chainId: 999, rpc: "https://rpc.hyperliquid.xyz/evm" },
    attestation: { address: "0x8f63c0581ab3b2836c95f97fcf104d2dd962850c", chainId: 999 },
    explorer: "https://hyperevmscan.io",
    notes: "Primary track: attestation deploy #2 MAINNET (v2: findingsURI + targetChainId) — owner + agent post-rotation keys.",
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
  solana: {
    key: "solana", name: "Solana devnet",
    // Non-EVM: no EVM chainId exists — a VERIFIED semantic null (SPEC-8 §3,
    // invariant 27), not a gap; targetChainId skips via the null-skip recipe.
    // RPC verified live 2026-09-19 (getHealth → ok).
    testnet: { chainId: null, rpc: "https://api.devnet.solana.com" },
    // B4 deployed 2026-09-19 — deploy tx n5SVHDzZ…TaCjoSMA, smoke tx
    // 5iognq3W…J3QEkZ (docs/deployments/solana.md is the anchor for these
    // literals).
    attestation: { address: "Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs", chainId: null },
    explorer: null,
    notes: "Adapter tier (SPEC-8): semgrep-over-Anchor slice; verdict program live on devnet (B4).",
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

/**
 * R1 — the audited repo's foundry.toml `chain_id` hint, mapped through the
 * SPEC-5 registry: the PRIMARY targetChainId source (SPEC-4 v2 — the chain
 * the audited code targets). Comments are stripped per line (# and //), then
 * the FIRST chain_id assignment wins. An id matching no registry entry (e.g.
 * a local 1337) returns null — never fabricated (invariant 16); Robinhood
 * (chainId: null) can never match by the same rule.
 */
export function targetChainIdFromFoundry(contents: string | null): number | null {
  if (!contents) return null;
  const code = contents
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      const slash = line.indexOf("//");
      const cut = hash === -1 ? slash : slash === -1 ? hash : Math.min(hash, slash);
      return cut === -1 ? line : line.slice(0, cut);
    })
    .join("\n");
  const match = code.match(/^\s*chain_id\s*=\s*(\d+)/m);
  if (!match) return null;
  const id = Number(match[1]);
  return Object.values(CHAIN_REGISTRY).some((entry) => entry.testnet.chainId === id) ? id : null;
}

export function resolveChain(env: { REXTOR_DEFAULT_CHAIN?: string; REXTOR_FORK_RPC_URL?: string }): ResolvedChain {
  const key = (env.REXTOR_DEFAULT_CHAIN ?? "tempo") as ChainKey;
  if (!Object.hasOwn(CHAIN_REGISTRY, key)) {
    throw new Error(`unknown chain: ${String(env.REXTOR_DEFAULT_CHAIN)} (known: ${Object.keys(CHAIN_REGISTRY).join(", ")})`);
  }
  return { ...CHAIN_REGISTRY[key], forkRpc: env.REXTOR_FORK_RPC_URL ?? CHAIN_REGISTRY[key].testnet.rpc };
}
