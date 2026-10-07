// SPEC-6 §3 — dashboard page tests. All seams faked: global fetch stands in
// for the agent service, "@/lib/chain-read" is module-mocked (no viem client,
// no RPC). No live network, ever.
import { fireEvent, render, screen, within } from "@testing-library/react";
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

interface StubRoutes {
  reviews?: ReviewRow[];
  dismissals?: Array<{ rule_id: string; path: string }>;
  /** null → 404 (no rextor.yaml); string → raw yaml body. */
  configYaml?: string | null;
}

function stubReviews(reviews: ReviewRow[], extra: Omit<StubRoutes, "reviews"> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/reviews/")) return Response.json({ reviews });
    if (url.includes("/dismissals/")) return Response.json({ dismissals: extra.dismissals ?? [] });
    if (url.includes("api.github.com")) {
      if (extra.configYaml === null) return new Response("not found", { status: 404 });
      return new Response(extra.configYaml ?? "", { status: 200 });
    }
    return new Response(`unexpected fetch in test: ${url}`, { status: 404 });
  }) as unknown as typeof fetch;
}

async function renderPage(params: { owner: string; repo: string }) {
  const ui = await DashboardPage({ params: Promise.resolve(params) });
  return render(ui);
}

beforeEach(() => {
  process.env.REXTOR_AGENT_URL = "http://agent.local";
  process.env.REXTOR_AGENT_TOKEN = "test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

    // Base UI panel is closed by default: open it like a reader would.
    fireEvent.click(screen.getByText("Verify"));
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
    // v2 page still fetches repo config (GitHub) independent of the token —
    // stub fetch so the no-live-network contract holds on every path.
    vi.stubGlobal("fetch", stubReviews([]));
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

  it("carries BOTH chains' live reviewCounts on the card (dashboard v2)", async () => {
    vi.stubGlobal("fetch", stubReviews([row()]));
    await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(identityMock).toHaveBeenCalledWith("tempo");
    expect(identityMock).toHaveBeenCalledWith("hyperliquid");
    const card = screen.getByRole("region", { name: /agent identity/i });
    expect(within(card).getByText("Tempo attested")).toBeInTheDocument();
    expect(within(card).getByText("HyperEVM attested")).toBeInTheDocument();
  });
});

describe("dashboard page — metrics strip (dashboard v2)", () => {
  it("derives tiles from real rows: attested of complete, PRs, INCOMPLETE, consecutive run", async () => {
    vi.stubGlobal(
      "fetch",
      stubReviews([
        row({ pr: 3, created_at: "2026-09-26T10:00:00.000Z", risk_score: 90 }),
        row({ pr: 2, created_at: "2026-09-20T10:00:00.000Z", risk_score: 65 }),
        row({ pr: 2, created_at: "2026-09-19T10:00:00.000Z", status: 1, tx_hash: "0x" + "aa".repeat(32) }),
      ]),
    );
    await renderPage({ owner: "rextorsec", repo: "demo" });

    const strip = screen.getByRole("region", { name: /review metrics/i });
    // Tiles render value + label as separate nodes (approved-mock anatomy).
    expect(within(strip).getByText("Attested reviews")).toBeInTheDocument();
    expect(within(strip).getByText("of 2 complete runs")).toBeInTheDocument();
    expect(within(strip).getByText("PRs audited")).toBeInTheDocument();
    expect(within(strip).getAllByText("2")).toHaveLength(2); // attested + PRs-audited values
    expect(within(strip).getByText("INCOMPLETE runs")).toBeInTheDocument();
    expect(within(strip).getByText(/last on 2026-09-19/)).toBeInTheDocument();
    expect(within(strip).getByText("INCOMPLETE since 2026-09-19")).toBeInTheDocument();
    expect(within(strip).getByText(/2 consecutive complete runs since/)).toBeInTheDocument();
    // Distribution chips: n = 2 complete runs (90, 65) → median 90? No —
    // ascending [65, 90]: median = ceil(0.5·2)=1st → 65; P75 = ceil(1.5)=2nd → 90; P90 → 90.
    expect(within(strip).getByText("complete-run distribution · n = 2")).toBeInTheDocument();
    expect(within(strip).getByText("median 65")).toBeInTheDocument();
    expect(within(strip).getByText("P75 90")).toBeInTheDocument();
  });
});

describe("dashboard page — score history window (dashboard v2)", () => {
  it("draws only the last 6 complete runs, INCOMPLETE runs excluded", async () => {
    // Service rows are NEWEST-first — fixture respects the input contract.
    const many = Array.from({ length: 8 }, (_, i) =>
      row({ pr: 17 - i, created_at: `2026-09-${String(17 - i).padStart(2, "0")}T10:00:00.000Z` }),
    );
    vi.stubGlobal(
      "fetch",
      stubReviews([...many, row({ pr: 99, status: 1, created_at: "2026-09-09T10:00:00.000Z" })]),
    );
    await renderPage({ owner: "rextorsec", repo: "demo" });

    const history = screen.getByRole("region", { name: /score history/i });
    expect(within(history).getByText(/last 6 complete runs \(of 8\)/)).toBeInTheDocument();
    // INCOMPLETE #99 never draws; the two oldest complete runs (#10, #11) fall out of the window.
    expect(within(history).queryByText(/#99 ·/)).not.toBeInTheDocument();
    expect(within(history).queryByText(/#10 ·/)).not.toBeInTheDocument();
    expect(within(history).queryByText(/#11 ·/)).not.toBeInTheDocument();
    expect(within(history).getByText(/#12 ·/)).toBeInTheDocument(); // oldest in window
    expect(within(history).getByText(/#17 ·/)).toBeInTheDocument(); // newest in window
  });
});

describe("dashboard page — INCOMPLETE row anatomy (dashboard v2)", () => {
  it("renders the status chip and the why-incomplete expander; never a score of fake origin", async () => {
    vi.stubGlobal(
      "fetch",
      stubReviews([row({ status: 1, risk_score: 0, tx_hash: "0x" + "bb".repeat(32) })]),
    );
    await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(screen.getByText(/INCOMPLETE · status 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Why incomplete"));
    expect(screen.getByText(/never silent/)).toBeInTheDocument();
    expect(screen.getByText(/deduped by \(repo, pr, headSha\)/)).toBeInTheDocument();
  });
});

describe("dashboard page — run-config line (dashboard v2)", () => {
  it("names the analyzer and reads the model label from env, — when unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_TRIAGE_MODEL", "");
    vi.stubGlobal("fetch", stubReviews([row()]));
    await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(screen.getByText("run config")).toBeInTheDocument();
    expect(
      screen.getByText(/analyzer Slither \(offline container\) · model — · rextor\.yaml from the PR base branch/),
    ).toBeInTheDocument();
  });

  it("renders a configured model label verbatim", async () => {
    vi.stubEnv("NEXT_PUBLIC_TRIAGE_MODEL", "glm-5.3-flash");
    vi.stubGlobal("fetch", stubReviews([row()]));
    await renderPage({ owner: "rextorsec", repo: "demo" });

    expect(
      screen.getByText(/analyzer Slither \(offline container\) · model glm-5\.3-flash · rextor\.yaml/),
    ).toBeInTheDocument();
  });
});

describe("dashboard page — config live-preview pane (dashboard v2)", () => {
  it("shows the repo's real rextor.yaml when the default branch has one", async () => {
    vi.stubGlobal(
      "fetch",
      stubReviews([row()], { configYaml: "severity_gate:\n  minimum: high\n" }),
    );
    await renderPage({ owner: "rextorsec", repo: "demo" });

    const pane = screen.getByRole("region", { name: /review configuration/i });
    expect(within(pane).getByText(/severity_gate:\s*minimum: high/)).toBeInTheDocument();
    expect(within(pane).queryByText(/sample knobs/)).not.toBeInTheDocument();
    // The rendered-artifact pane cites the REAL merged receipt.
    expect(within(pane).getByText(/sip-protocol\/sip-protocol#1267/)).toBeInTheDocument();
    expect(
      within(pane).getByRole("link", { name: /the real review ↗/i }),
    ).toHaveAttribute("href", "https://github.com/sip-protocol/sip-protocol/pull/1267#issuecomment-5995895646");
  });

  it("falls back to the labelled sample when the repo has no rextor.yaml", async () => {
    vi.stubGlobal("fetch", stubReviews([row()], { configYaml: null }));
    await renderPage({ owner: "rextorsec", repo: "demo" });

    const pane = screen.getByRole("region", { name: /review configuration/i });
    expect(within(pane).getByText(/sample knobs — this repo has no rextor\.yaml/)).toBeInTheDocument();
    expect(within(pane).getByText(/ADERYN-L01/)).toBeInTheDocument();
  });
});

describe("dashboard page — dismissals panel (dashboard v2)", () => {
  it("shows the real server-side count", async () => {
    vi.stubGlobal(
      "fetch",
      stubReviews([row()], { dismissals: [{ rule_id: "ADERYN-L01", path: "src/a.sol" }] }),
    );
    await renderPage({ owner: "rextorsec", repo: "demo" });

    const panel = screen.getByRole("region", { name: /dismissal memory/i });
    expect(within(panel).getByText("1 dismissal")).toBeInTheDocument();
    expect(within(panel).getByText(/never in a repo file/)).toBeInTheDocument();
  });

  it("renders the honest reason when the count read fails — never a fabricated 0", async () => {
    delete process.env.REXTOR_AGENT_TOKEN;
    vi.stubGlobal("fetch", stubReviews([]));
    await renderPage({ owner: "rextorsec", repo: "demo" });

    const panel = screen.getByRole("region", { name: /dismissal memory/i });
    expect(within(panel).getByText("—")).toBeInTheDocument();
    expect(within(panel).getByText(/count unavailable —/)).toBeInTheDocument();
  });
});
