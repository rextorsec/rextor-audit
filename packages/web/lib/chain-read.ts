// SPEC-6 §3 + invariant 18 — live agent-identity read over PUBLIC RPC via a
// viem read-only public client. Server-side only. verify() is intentionally
// NOT read here: the row's tx/explorer links carry the verify path.
import { createPublicClient, defineChain, http, parseAbi } from "viem";

import { WEB_CHAINS, type WebChain } from "@/lib/chains";

// parseAbi is NOT optional (agent-side T10 Phase C lesson): viem's
// readContract needs parsed ABI items — raw strings throw at call time.
const ATTESTATION_VIEW_ABI = parseAbi([
  "function agents(address) view returns (string name, bool active, uint64 reviewCount)",
]);

export interface AgentIdentity {
  name: string;
  active: boolean;
  /** uint64 on-chain → number (attested review counts are small). */
  reviewCount: number;
}

/** The read seam — the page/route inject fakes; production closes over viem. */
export type AgentsRead = (params: {
  address: `0x${string}`;
  functionName: "agents";
  args: readonly [`0x${string}`];
}) => Promise<readonly [string, boolean, bigint]>;

function viemChainOf(chain: WebChain) {
  // Native currency is display metadata for these read-only clients — but it
  // must not lie: Tempo's unit is a USD asset (TIP-20), HyperEVM's is HYPE.
  const nativeCurrency =
    chain.key === "tempo"
      ? { name: "USD", symbol: "USD", decimals: 18 }
      : { name: "HYPE", symbol: "HYPE", decimals: 18 };
  return defineChain({
    id: chain.chainId,
    name: chain.name,
    nativeCurrency,
    rpcUrls: { default: { http: [chain.rpc] } },
  });
}

/**
 * Read agents(agent) → (name, active, reviewCount). Unknown chain or any
 * read failure → null; callers degrade honestly ("—" fields), never guess.
 */
export async function readAgentIdentity(
  chainKey: string,
  opts: { read?: AgentsRead } = {},
): Promise<AgentIdentity | null> {
  const chain = Object.hasOwn(WEB_CHAINS, chainKey) ? WEB_CHAINS[chainKey as keyof typeof WEB_CHAINS] : undefined;
  if (!chain) return null;

  const client = createPublicClient({ chain: viemChainOf(chain), transport: http(chain.rpc) });
  const read: AgentsRead =
    opts.read ??
    (async (params) =>
      client.readContract({ ...params, abi: ATTESTATION_VIEW_ABI }) as Promise<
        readonly [string, boolean, bigint]
      >);
  try {
    const [name, active, reviewCount] = await read({
      address: chain.attestation,
      functionName: "agents",
      args: [chain.agent],
    });
    return { name, active, reviewCount: Number(reviewCount) };
  } catch {
    return null;
  }
}
