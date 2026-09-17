### Task 7: SPEC-5 chain registry + track profiles

**Files:**
- Create: `packages/agent/src/chains.ts`, `packages/agent/test/chains.test.ts`, `docs/track-profiles.md`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `export type ChainKey = "tempo" | "hyperliquid" | "ethereum" | "base" | "arbitrum" | "robinhood"`; `export interface ChainConfig { key: ChainKey; name: string; testnet: { chainId: number | null; rpc: string | null }; attestation: { address: \`0x${string}\` | null; chainId: number | null }; explorer: string | null; notes: string }`; `export const CHAIN_REGISTRY: Record<ChainKey, ChainConfig>`; `export interface ResolvedChain extends ChainConfig { forkRpc: string | null }`; `export function resolveChain(env: { REXTOR_DEFAULT_CHAIN?: string; REXTOR_FORK_RPC_URL?: string }): ResolvedChain` (throws on unknown key).

- [ ] **Step 1: Write the failing tests**

`packages/agent/test/chains.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run test/chains.test.ts` — FAIL, module missing.

- [ ] **Step 3: Implement**

`packages/agent/src/chains.ts`:

```ts
// SPEC-5 — chain registry: the ONLY place chain differences live (invariant
// 15). Params verified 2026-09-16: Tempo testnet 42431 (tempo.xyz docs),
// HyperEVM testnet 998 (hyperliquid.gitbook.io). Unverified → null, and null
// fails loudly downstream (invariant 16) — never a guess.
export type ChainKey = "tempo" | "hyperliquid" | "ethereum" | "base" | "arbitrum" | "robinhood";

export interface ChainConfig {
  key: ChainKey;
  name: string;
  testnet: { chainId: number | null; rpc: string | null };
  attestation: { address: `0x${string}` | null; chainId: number | null };
  explorer: string | null; // null until verified — footer omits the link
  notes: string;
}

export const CHAIN_REGISTRY: Record<ChainKey, ChainConfig> = {
  tempo: {
    key: "tempo", name: "Tempo testnet",
    testnet: { chainId: 42431, rpc: "https://rpc.moderato.tempo.xyz" },
    attestation: { address: null, chainId: null }, explorer: null,
    notes: "Flagship track: full loop — Slither+Aderyn, fork-sim, attestation deploy #1.",
  },
  hyperliquid: {
    key: "hyperliquid", name: "HyperEVM testnet",
    testnet: { chainId: 998, rpc: "https://rpc.hyperliquid-testnet.xyz" },
    attestation: { address: null, chainId: null }, explorer: null,
    notes: "Primary track: same loop, attestation deploy #2.",
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
};

export interface ResolvedChain extends ChainConfig { forkRpc: string | null }

export function resolveChain(env: { REXTOR_DEFAULT_CHAIN?: string; REXTOR_FORK_RPC_URL?: string }): ResolvedChain {
  const key = (env.REXTOR_DEFAULT_CHAIN ?? "tempo") as ChainKey;
  if (!(key in CHAIN_REGISTRY)) {
    throw new Error(`unknown chain: ${String(env.REXTOR_DEFAULT_CHAIN)} (known: ${Object.keys(CHAIN_REGISTRY).join(", ")})`);
  }
  return { ...CHAIN_REGISTRY[key], forkRpc: env.REXTOR_FORK_RPC_URL ?? CHAIN_REGISTRY[key].testnet.rpc };
}
```

`docs/track-profiles.md`: table per track (key, name, chainId, what runs: analyzers / fork-sim / attestation status, deployment pointer `docs/deployments/<chain>.md` when it exists) + a "Config-level riders" section + date stamp. Content mirrors CHAIN_REGISTRY exactly (same chainIds — the test below enforces the doc mirrors the registry is a PLAN-level acceptance, checked in review).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run && pnpm typecheck && cd ../.. && pnpm test:run`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/chains.ts packages/agent/test/chains.test.ts docs/track-profiles.md
git commit -m "feat: SPEC-5 chain registry (tempo flagship, hyperliquid, riders) + track profiles doc"
```

---

