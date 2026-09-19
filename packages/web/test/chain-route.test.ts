// SPEC-6 §3 + invariant 18 — GET /api/chain/[chain] is the browser-safe
// surface for chain reads (public RPC data only, no keys). The lib read is
// module-mocked: no RPC, no network.
import { describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/chain/[chain]/route";
import { readAgentIdentity } from "@/lib/chain-read";

vi.mock("@/lib/chain-read", () => ({
  readAgentIdentity: vi.fn(),
}));

const readMock = vi.mocked(readAgentIdentity);

describe("GET /api/chain/[chain]", () => {
  it("404s an unknown chain without attempting a read", async () => {
    const res = await GET(new Request("https://web.local/api/chain/nope"), {
      params: { chain: "nope" },
    });
    expect(res.status).toBe(404);
    expect(readMock).not.toHaveBeenCalled();
  });

  it("serves the identity read for a known chain", async () => {
    readMock.mockResolvedValue({ name: "rextor-audit[bot]", active: true, reviewCount: 1 });
    const res = await GET(new Request("https://web.local/api/chain/tempo"), {
      params: { chain: "tempo" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      chain: string;
      name: string;
      active: boolean;
      reviewCount: number;
    };
    expect(body).toEqual({ chain: "tempo", name: "rextor-audit[bot]", active: true, reviewCount: 1 });
  });

  it("502s honestly when the chain read fails", async () => {
    readMock.mockResolvedValue(null);
    const res = await GET(new Request("https://web.local/api/chain/tempo"), {
      params: { chain: "tempo" },
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("chain read failed");
  });
});
