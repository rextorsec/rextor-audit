// SPEC-6 §3 — server route handler: the browser-safe surface for chain reads
// (invariant 18 — public RPC data, no keys in the response or the client
// bundle). verify() is not exposed: rows carry their own explorer receipts.
import { unstable_cache } from "next/cache";

import { isWebChainKey } from "@/lib/chains";
import { readAgentIdentity } from "@/lib/chain-read";

// ISR: Vercel's edge strips hand-set `s-maxage` from dynamic handlers, but
// honors this segment config — edge-cache the response for 60s, serve stale
// while revalidating.
export const revalidate = 60;

// Amplification control (defense in depth with the segment config above): the
// RPC read itself goes through the Next Data Cache — 60s reuse keyed per
// chain — so even per-request invocations cannot drive per-request eth_calls
// from our egress, and a wedged RPC cannot turn the route into an attacker
// lever against the upstreams. Same 60s staleness class the landing already
// accepts (revalidate=300).
const cachedIdentity = unstable_cache(
  (chainKey: string) => readAgentIdentity(chainKey),
  ["agent-identity"],
  { revalidate: 60 },
);

export async function GET(_req: Request, ctx: { params: Promise<{ chain: string }> }): Promise<Response> {
  // Next 15: dynamic route params are a Promise — awaited before any read.
  const { chain: key } = await ctx.params;
  if (!isWebChainKey(key)) {
    return Response.json({ error: "unknown chain" }, { status: 404 });
  }
  const identity = await cachedIdentity(key);
  if (!identity) {
    return Response.json({ error: "chain read failed" }, { status: 502 });
  }
  return Response.json({ chain: key, ...identity });
}
