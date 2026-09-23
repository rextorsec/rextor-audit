import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CapabilityTable, type Capabilities } from "@/components/capability-table";
import { RIDER_TARGET_CHAINS } from "@/lib/chains";
import prodData from "@/content/capabilities.json";

const tempoExplorer = "https://explore.testnet.tempo.xyz";

const fixture: Capabilities = {
  asOf: "2026-09-18",
  rows: [
    {
      id: "analyzer-grounding",
      capability: "Built for money-code — analyzer grounding",
      generic: "no",
      bots: "partial",
      rextor: { shipped: true, receipt: "#s2", receiptLabel: "stage 2.0" },
      backing: "Week-1 engine",
    },
    {
      id: "soon-a",
      capability: "Soon capability A",
      generic: "yes",
      bots: "no",
      rextor: { shipped: false, soon: true },
      backing: "D1",
    },
    {
      id: "soon-b",
      capability: "Soon capability B",
      generic: "no",
      bots: "no",
      rextor: { shipped: false, soon: true },
      backing: "D2",
    },
    {
      id: "soon-c",
      capability: "Soon capability C",
      generic: "no",
      bots: "no",
      rextor: { shipped: false, soon: true },
      backing: "B3",
    },
  ],
};

describe("CapabilityTable", () => {
  it("renders a shipped row as a green mark plus its receipt link", () => {
    render(<CapabilityTable data={fixture} />);
    const receipt = screen.getByRole("link", { name: "stage 2.0" });
    expect(receipt).toHaveAttribute("href", "#s2");
    expect(receipt.closest("td")!.querySelector('[aria-label="shipped"]')).not.toBeNull();
  });

  it("renders partial and not-evidenced marks inside competitor data cells", () => {
    render(<CapabilityTable data={fixture} />);
    const row = screen.getByRole("link", { name: "stage 2.0" }).closest("tr")!;
    // Cell order after the row-header capability th: Generic, Bots, Rextor.
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[0]).getByRole("img", { name: "not evidenced" })).toBeInTheDocument();
    expect(within(cells[1]).getByRole("img", { name: "partial" })).toBeInTheDocument();
    expect(within(cells[2]).getByRole("img", { name: "shipped" })).toBeInTheDocument();
  });

  it("renders a soon badge for unshipped capabilities", () => {
    render(<CapabilityTable data={fixture} />);
    const badges = screen.getAllByText("Oct 2026");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("hides rows beyond the soon budget of 2", () => {
    render(<CapabilityTable data={fixture} />);
    expect(screen.getByText("Soon capability A")).toBeInTheDocument();
    expect(screen.getByText("Soon capability B")).toBeInTheDocument();
    expect(screen.queryByText("Soon capability C")).not.toBeInTheDocument();
  });
  it("splits live from tracked with data-driven counts", () => {
    render(<CapabilityTable data={fixture} />);
    // Count headings interpolate <b> — assert on the heading's full text.
    expect(screen.getByText(/Live now/).textContent).toContain("1 receipts");
    expect(screen.getByText(/Tracked openly/).textContent).toContain("2 on the plan");
  });

  it("shows all rows when the data file raises the approved soon budget", () => {
    render(<CapabilityTable data={{ ...fixture, maxSoonRows: 3 }} />);
    expect(screen.getByText("Soon capability C")).toBeInTheDocument();
  });

  it("dates the footnote from asOf with the dot legend", () => {
    render(<CapabilityTable data={fixture} />);
    expect(screen.getAllByText(/as of 2026‑09‑18/)).toHaveLength(1);
    const footnote = screen.getByText(/not evidenced/).closest("p")!;
    expect(within(footnote).getByText(/shipped/)).toBeInTheDocument();
    expect(within(footnote).getAllByRole("img").length).toBe(3);
  });

  it("renders the production data file with real receipts and approved statuses", () => {
    // Counts derive from the ledger — never pinned literals (a legitimate
    // ledger flip must not require a test edit).
    const prod = prodData as Capabilities;
    const liveCount = prod.rows.filter((row) => row.rextor.shipped).length;
    render(<CapabilityTable data={prod} />);

    // Every shipped check links a live artifact.
    const receiptLinks = screen.getAllByRole("link");
    const receiptHrefs = receiptLinks.map((a) => a.getAttribute("href"));
    for (const anchor of ["#s1", "#s2", "#s3", "#s4", "#s5"]) {
      expect(receiptHrefs).toContain(anchor);
    }
    const tempoReceipt = receiptLinks.find((a) =>
      a.getAttribute("href")?.includes("0x51ac8214089daf85b188437b087519acfc6c495a"),
    );
    expect(tempoReceipt).toBeDefined();
    expect(tempoReceipt!.getAttribute("href")).toContain(`${tempoExplorer}/address/`);

    // Multi-chain row — HyperEVM live MAINNET receipt (deploy #2, 2026-09-21);
    // Solana devnet receipt live.
    const hyperEvmReceipt = receiptLinks.find((a) =>
      a
        .getAttribute("href")
        ?.includes("hyperevmscan.io/address/0x8f63c0581ab3b2836c95f97fcf104d2dd962850c"),
    );
    expect(hyperEvmReceipt).toBeDefined();
    const solanaReceipt = receiptLinks.find((a) =>
      a
        .getAttribute("href")
        ?.includes("explorer.solana.com/address/Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs"),
    );
    expect(solanaReceipt).toBeDefined();

    // Receipt state: every ledger row shipped — the split is fully live, no
    // tracked group. The data file is the receipt ledger; the test follows it.
    expect(screen.getByText(/Live now/).textContent).toContain(`${liveCount} receipts`);
    expect(screen.queryByText(/Tracked openly/)).not.toBeInTheDocument();
    const body = screen.getAllByRole("rowgroup").at(-1)!;
    expect(within(body).queryAllByText(/Oct 2026/)).toHaveLength(0);
    expect(within(body).getAllByRole("row")).toHaveLength(liveCount);

    // ERC-8004 identity row carries the mainnet mint receipt
    // (ownerOf(50891) live-verified 2026-09-22).
    const ercReceipt = receiptLinks.find((a) =>
      a.getAttribute("href")?.includes("etherscan.io/tx/0xc4c0565c1f07e42cbd9524dadc7a033079ac0d4f"),
    );
    expect(ercReceipt).toBeDefined();
    expect(ercReceipt!.textContent).toContain("agentId 50891");

    // R2 — reputation row discloses the automated, evidence-backed pipeline
    // (the settled attestation's findingsURI+hash rides every feedback) while
    // the mainnet broadcast stays config-gated (🔴 RECTOR flag, default OFF).
    const reputationReceipt = receiptLinks.find((a) =>
      a.getAttribute("href")?.includes("etherscan.io/tx/0x02e73670"),
    );
    expect(reputationReceipt).toBeDefined();
    expect(reputationReceipt!.textContent).toContain("automated ingestion pipeline");
    expect(reputationReceipt!.textContent).toContain("evidence-backed");
    expect(reputationReceipt!.textContent).toContain("broadcast config-gated");
  });

  it("renders the rider-coverage footnote from RIDER_TARGET_CHAINS — robinhood shows params at integration, no receipt links", () => {
    render(<CapabilityTable data={fixture} />);
    // Names render interpolated from the constant — assert the paragraph's
    // full text (getByText fails on split text nodes).
    const footnote = screen.getByText(/Rider tracks/).closest("p")!;
    const text = footnote.textContent ?? "";
    for (const rider of Object.values(RIDER_TARGET_CHAINS)) {
      expect(text).toContain(rider.name);
      if (rider.chainId !== null) expect(text).toContain(String(rider.chainId));
    }
    expect(text).toContain("params at integration");
    expect(text).toContain("targetChainId recorded per review");
    // Receipts-not-claims: riders have no native deploys, so no links.
    expect(within(footnote).queryAllByRole("link")).toHaveLength(0);
  });
});
