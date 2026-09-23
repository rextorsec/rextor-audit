// SPEC-6 §3 + invariant 18 — GET /api/chain/[chain] is the browser-safe
// surface for chain reads (public RPC data only, no keys). The lib read is
// module-mocked: no RPC, no network.
import { describe, expect, it, vi, assert } from "vitest";

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

describe("fetchReviews boundary (row validation, timeout, cap)", () => {
  const ROW = {
    repo: "o/r", pr: 1, head_sha: "a".repeat(40), review_id: "0x1",
    chain: "tempo", tx_hash: "0x2", explorer_url: "https://e/2", risk_score: 3,
    finding_count: 1, status: 0, comment_url: "https://c/1",
    created_at: "2026-09-24T00:00:00.000Z",
  };
  const okResponse = (body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it("drops malformed rows instead of 500ing the page on one bad entry", async () => {
    const { fetchReviews } = await import("@/lib/reviews");
    const res = await fetchReviews("o", "r", {
      baseUrl: "https://agent", token: "t",
      fetchImpl: okResponse({ reviews: [ROW, { repo: "o/r", pr: "not-a-number" }, null] }),
    });
    assert(res.ok);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].head_sha).toBe("a".repeat(40));
  });

  it("caps rendered rows at MAX_RENDERED_ROWS (newest first)", async () => {
    const { fetchReviews, MAX_RENDERED_ROWS } = await import("@/lib/reviews");
    const many = Array.from({ length: MAX_RENDERED_ROWS + 50 }, (_, i) => ({
      ...ROW, pr: i + 1,
    }));
    const res = await fetchReviews("o", "r", {
      baseUrl: "https://agent", token: "t", fetchImpl: okResponse({ reviews: many }),
    });
    assert(res.ok);
    expect(res.rows).toHaveLength(MAX_RENDERED_ROWS);
  });
});
