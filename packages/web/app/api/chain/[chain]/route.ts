// SPEC-6 §3 — server route handler: the browser-safe surface for chain reads
// (invariant 18 — public RPC data, no keys in the response or the client
// bundle). verify() is not exposed: rows carry their own explorer receipts.
import { isWebChainKey } from "@/lib/chains";
import { readAgentIdentity } from "@/lib/chain-read";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: { chain: string } }): Promise<Response> {
  const key = ctx.params.chain;
  if (!isWebChainKey(key)) {
    return Response.json({ error: "unknown chain" }, { status: 404 });
  }
  const identity = await readAgentIdentity(key);
  if (!identity) {
    return Response.json({ error: "chain read failed" }, { status: 502 });
  }
  return Response.json({ chain: key, ...identity });
}
