// SPEC-6 §3 — dashboard page tests. All seams faked: global fetch stands in
// for the agent service, "@/lib/chain-read" is module-mocked (no viem client,
// no RPC). No live network, ever.
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/dashboard/[owner]/[repo]/page";
import { readAgentIdentity } from "@/lib/chain-read";
import type { ReviewRow } from "@/lib/reviews";

vi.mock("@/lib/chain-read", () => ({
  readAgentIdentity: vi.fn(async () => ({
    name: "rextor-audit[bot]",
    active: true,
    reviewCount: 1,
  })),
}));

const identityMock = vi.mocked(readAgentIdentity);

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    repo: "rextorsec/demo",
    pr: 2,
    head_sha: "3fa9c2d17e0b4a559a1d8c93e6f8d0a1b2c3d4e5",
    review_id: "0xabc123",
    chain: "Tempo testnet",
    tx_hash: "0x62dbf0790000000000000000000000000000000000000000000000000000f079",
    explorer_url: "https://explore.testnet.tempo.xyz/tx/0x62dbf079",
    risk_score: 41,
    finding_count: 3,
    status: 0,
    comment_url: "https://github.com/rextorsec/demo/pull/2#issuecomment-1",
    created_at: "2026-09-18T10:00:00.000Z",
    ...overrides,
  };
}

function stubReviews(reviews: ReviewRow[]) {
  return vi.fn(async () => Response.json({ reviews })) as unknown as typeof fetch;
}

async function renderPage(params: { owner: string; repo: string }) {
  const ui = await DashboardPage({ params });
  return render(ui);
}

beforeEach(() => {
  process.env.REXTOR_AGENT_URL = "http://agent.local";
  process.env.REXTOR_AGENT_TOKEN = "test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("dashboard page — ledger", () => {
  it("renders rows from the /reviews payload: score, status, tx link, short sha", async () => {
    vi.stubGlobal("fetch", stubReviews([row()]));
    await renderPage({ owner: "rextorsec", repo: "demo" });

    const ledger = screen.getByRole("region", { name: /review ledger/i });
    const cells = within(ledger).getAllByRole("cell");
    expect(within(ledger).getByText("#2")).toBeInTheDocument();
    // Cells: PR, Risk score, Status, Attestation.
    expect(cells[0].textContent).toContain("3fa9c2d");
    expect(cells[1].textContent).toBe("41 / 100");
    expect(cells[2].textContent).toBe("complete");

    const txLink = within(ledger).getByRole("link", { name: /tx ↗/i });
    expect(txLink).toHaveAttribute(
      "href",
      "https://explore.testnet.tempo.xyz/tx/0x62dbf079",
    );
  });

  it("renders an honest 'none' note for a row with no attestation", async () => {
    vi.stubGlobal(
      "fetch",
      stubReviews([row({ tx_hash: "", explorer_url: "", chain: "", risk_score: 69 })]),
    );
    await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(screen.getByText(/none — not attested/i)).toBeInTheDocument();
    // No verify expander on unattested rows.
    expect(screen.queryByText("Verify")).not.toBeInTheDocument();
    // Comment receipt still links the settled review.
    expect(screen.getByRole("link", { name: /PR comment ↗/i })).toHaveAttribute(
      "href",
      "https://github.com/rextorsec/demo/pull/2#issuecomment-1",
    );
  });

  it("expands the verify recipe with REAL row values — never fabricated ones", async () => {
    vi.stubGlobal("fetch", stubReviews([row()]));
    await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(screen.getByText("Verify")).toBeInTheDocument();
    // reviewId recipe carries the row's true head_sha, not a placeholder.
    expect(
      screen.getByText(
        /keccak256\("rextor\/review\/v1\|rextorsec\/demo\|2\|3fa9c2d17e0b4a559a1d8c93e6f8d0a1b2c3d4e5"\)/,
      ),
    ).toBeInTheDocument();
    // findingsHash stays a recipe + link (hash is NOT stored in the row).
    expect(screen.getByText(/sha256 of the canonical findings JSON/)).toBeInTheDocument();
    expect(screen.getByText(/compare on-chain via verify\(\)/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PR comment ↗/i })).toHaveAttribute(
      "href",
      "https://github.com/rextorsec/demo/pull/2#issuecomment-1",
    );
    // chain line mirrors the live v2 deployment constants.
    expect(screen.getByText(/Tempo testnet 42431 · contract 0x51ac…495a/)).toBeInTheDocument();
  });

  it("unknown-chain attested rows render their own chain and omit registry constants (T10 carry)", async () => {
    vi.stubGlobal(
      "fetch",
      stubReviews([row({ chain: "hyperliquid", explorer_url: "" })]),
    );
    await renderPage({ owner: "rextorsec", repo: "demo" });

    // The attestation cell shows the row's own chain string…
    const cell = screen.getAllByRole("cell")[3];
    expect(cell.textContent).toContain("hyperliquid");
    // …and its verify expander never asserts Tempo constants for a foreign
    // chain (honest omission until the web registry knows the chain).
    expect(cell.textContent).not.toContain("Tempo");
    expect(cell.textContent).not.toContain("42431");
    expect(cell.textContent).not.toContain("0x7fe6");
    expect(cell.textContent).not.toContain("0xE690");
  });

  it("renders row strings as inert text (untrusted PR-derived data)", async () => {
    vi.stubGlobal(
      "fetch",
      stubReviews([
        row({
          head_sha: "<script>window.pwned=1</script>",
          comment_url: 'https://github.com/x/y"><script>alert(2)</script>',
        }),
      ]),
    );
    const { container } = await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.textContent).toContain("<script>window.pwned=1</script>");
  });
});

describe("dashboard page — casing canonicalization (T9 review #2)", () => {
  it("lowercases owner/repo before the service call", async () => {
    const fetchMock = stubReviews([]);
    vi.stubGlobal("fetch", fetchMock);
    await renderPage({ owner: "RextorSec", repo: "Demo" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent.local/reviews/rextorsec/demo",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-API-Token": "test-token" }),
      }),
    );
    // Header shows the canonical form the ledger was queried with.
    expect(screen.getByText("rextorsec / demo")).toBeInTheDocument();
  });
});

describe("dashboard page — empty state (approved-mock copy)", () => {
  it("shows the exact empty copy and no ledger/history when there are no reviews", async () => {
    vi.stubGlobal("fetch", stubReviews([]));
    await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(
      screen.getByText(
        /No attested reviews yet for this repo\. Install the GitHub App and open a pull request that touches money-code — the first verdict lands here, with its on-chain receipt\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /score history/i })).not.toBeInTheDocument();
  });
});

describe("dashboard page — honest error panel", () => {
  it("renders an explicit unavailable panel when the service is unreachable; page + identity still render", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    );
    await renderPage({ owner: "rextorsec", repo: "demo" });

    const panel = screen.getByRole("region", { name: /index unavailable/i });
    expect(within(panel).getByText(/no data is shown/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Identity card is an independent live read — it still renders.
    expect(screen.getByRole("region", { name: /agent identity/i })).toBeInTheDocument();
  });

  it("renders the unavailable panel when the token is not configured", async () => {
    delete process.env.REXTOR_AGENT_TOKEN;
    await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(screen.getByRole("region", { name: /index unavailable/i })).toBeInTheDocument();
  });
});

describe("dashboard page — identity card wiring", () => {
  it("reads the agent identity from the chain of the latest attested row", async () => {
    vi.stubGlobal("fetch", stubReviews([row()]));
    await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(identityMock).toHaveBeenCalledWith("tempo");
    const card = screen.getByRole("region", { name: /agent identity/i });
    expect(within(card).getByText("rextor-audit[bot]")).toBeInTheDocument();
    expect(within(card).getByText("ACTIVE")).toBeInTheDocument();
  });
});
