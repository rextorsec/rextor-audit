import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CapabilityTable, type Capabilities } from "@/components/capability-table";
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
  it("renders a shipped check as a receipt link", () => {
    render(<CapabilityTable data={fixture} />);
    const receipt = screen.getByRole("link", { name: "stage 2.0" });
    expect(receipt).toHaveAttribute("href", "#s2");
    expect(receipt.closest("td")).toHaveTextContent("✔");
  });

  it("renders a soon badge for unshipped capabilities", () => {
    render(<CapabilityTable data={fixture} />);
    const badge = screen.getAllByText("Shipping Oct 2026");
    expect(badge.length).toBeGreaterThan(0);
  });

  it("hides rows beyond the soon budget of 2", () => {
    render(<CapabilityTable data={fixture} />);
    expect(screen.getByText("Soon capability A")).toBeInTheDocument();
    expect(screen.getByText("Soon capability B")).toBeInTheDocument();
    expect(screen.queryByText("Soon capability C")).not.toBeInTheDocument();
  });

  it("shows all rows when the data file raises the approved soon budget", () => {
    render(<CapabilityTable data={{ ...fixture, maxSoonRows: 3 }} />);
    expect(screen.getByText("Soon capability C")).toBeInTheDocument();
  });

  it("dates the footnote from asOf", () => {
    render(<CapabilityTable data={fixture} />);
    // Both dated strings render from asOf (chapter para + footnote), non-breaking hyphens per the approved mock.
    expect(screen.getAllByText(/as of 2026‑09‑18/)).toHaveLength(2);
  });

  it("renders the production data file with real receipts and approved statuses", () => {
    render(<CapabilityTable data={prodData as Capabilities} />);

    // Rows 1-6 shipped — every check links a live artifact.
    const receiptLinks = screen.getAllByRole("link");
    const receiptHrefs = receiptLinks.map((a) => a.getAttribute("href"));
    expect(receiptHrefs).toContain("#s1");
    expect(receiptHrefs).toContain("#s2");
    expect(receiptHrefs).toContain("#s3");
    expect(receiptHrefs).toContain("#s4");
    expect(receiptHrefs).toContain("#s5");
    const tempoReceipt = receiptLinks.find((a) =>
      a.getAttribute("href")?.includes("0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd"),
    );
    expect(tempoReceipt).toBeDefined();
    expect(tempoReceipt!.getAttribute("href")).toContain(`${tempoExplorer}/address/`);

    // Multi-chain row — HyperEVM chip remains; Solana flipped to a live
    // receipt (B4 devnet deploy), rendered via the row's receipts array.
    expect(screen.getByText("HyperEVM — Shipping Oct 2026")).toBeInTheDocument();
    expect(screen.queryByText("Solana — Shipping Oct 2026")).not.toBeInTheDocument();
    const solanaReceipt = receiptLinks.find((a) =>
      a.getAttribute("href")?.includes("explorer.solana.com/address/Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs"),
    );
    expect(solanaReceipt).toBeDefined();

    // Receipt state: 13 rows shipped, 2 soon (config-gate, chain-cost) + the
    // HyperEVM dated chip. Pins updated with the flip commits — the data file
    // is the receipt ledger, the test follows it.
    const body = screen.getAllByRole("rowgroup").at(-1)!;
    expect(within(body).getAllByText("Shipping Oct 2026")).toHaveLength(2);
    expect(within(body).getAllByText(/Shipping Oct 2026/)).toHaveLength(3);

    // All 15 rows visible.
    expect(within(body).getAllByRole("row")).toHaveLength(15);
  });
});