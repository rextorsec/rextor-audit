// SPEC-6 §3 — deep-scan ledger tests (approved-mock row anatomy). The server
// component renders directly — no fetch, no mocks needed.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScansLedger } from "@/components/scans-ledger";
import type { ScanRow } from "@/lib/scans";

function row(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    repo: "rextorsec/demo",
    ref: "main",
    head_sha: "ce7f6a9d2b42abcd599537e4abffa33d8760496c",
    status: 0,
    risk_score: 34,
    finding_count: 4,
    created_at: "2026-10-10T19:45:22.000Z",
    ...overrides,
  };
}

function renderLedger(rows: ScanRow[]) {
  return render(<ScansLedger rows={rows} />);
}

function ledger() {
  return screen.getByRole("region", { name: /deep scan ledger/i });
}

describe("ScansLedger — complete row (approved-mock anatomy)", () => {
  it("renders repo, ref, short sha with full-sha title, status chip, risk, findings, scanned", () => {
    renderLedger([row()]);
    const scope = ledger();

    expect(within(scope).getByText("rextorsec/demo")).toBeInTheDocument();
    expect(within(scope).getByText("main")).toBeInTheDocument();

    const headCell = within(scope).getByText("ce7f6a9").closest("td");
    expect(headCell).toHaveAttribute("title", "ce7f6a9d2b42abcd599537e4abffa33d8760496c");

    expect(within(scope).getByText("complete · status 0")).toBeInTheDocument();
    // The risk cell composes swatch + score + "/ 100" across separate
    // elements — assert the cell's composed text, never one flat text node.
    const riskCell = within(scope).getByText("34").closest("td");
    expect(riskCell).toHaveTextContent("34 / 100");
    expect(within(scope).getByText("4")).toBeInTheDocument();
    expect(within(scope).getByText("2026-10-10 19:45:22")).toBeInTheDocument();
    // The scanned cell renders as delivered (T → space), never re-zoned.
    expect(within(scope).getByText("2026-10-10 19:45:22").closest("time")).toHaveAttribute(
      "dateTime",
      "2026-10-10T19:45:22.000Z",
    );
  });

  it("colors the risk swatch by the family band boundary (60)", () => {
    const { container } = renderLedger([
      row({ risk_score: 34 }),
      row({
        risk_score: 67,
        repo: "rextorsec/other",
        created_at: "2026-10-09T08:12:40.000Z",
      }),
    ]);
    const swatches = container.querySelectorAll('td[data-label="Risk"] span[aria-hidden="true"]');
    expect(swatches).toHaveLength(2);
    expect(swatches[0]).toHaveClass("bg-success");
    expect(swatches[1]).toHaveClass("bg-warning");
  });
});

describe("ScansLedger — zero-meaningful display", () => {
  it("keeps an INCOMPLETE row visible with — risk and — findings (never 0)", () => {
    renderLedger([row({ status: 1, risk_score: null, finding_count: 0 })]);
    const cells = within(ledger()).getAllByRole("cell");

    expect(within(ledger()).getByText("INCOMPLETE · status 1")).toBeInTheDocument();
    expect(within(ledger()).queryByText("complete · status 0")).not.toBeInTheDocument();
    // Cells: Repo, Ref, Head, Status, Risk, Findings, Scanned.
    expect(cells[4].textContent).toBe("—");
    expect(cells[5].textContent).toBe("—");
  });

  it("renders — for a completed row carrying a null risk score", () => {
    renderLedger([row({ risk_score: null })]);
    const cells = within(ledger()).getAllByRole("cell");
    expect(cells[4].textContent).toBe("—");
    expect(cells[5].textContent).toBe("4");
  });

  it("renders a completed clean pass as a visible 0 findings", () => {
    renderLedger([row({ finding_count: 0 })]);
    const cells = within(ledger()).getAllByRole("cell");
    expect(cells[5].textContent).toBe("0");
  });

  it("renders — for a run recorded without a head", () => {
    renderLedger([row({ head_sha: "" })]);
    const cells = within(ledger()).getAllByRole("cell");
    expect(cells[2].textContent).toBe("—");
    expect(cells[2]).not.toHaveAttribute("title");
  });
});

describe("ScansLedger — ordering and empty state", () => {
  it("renders rows in delivered order — never re-sorted", () => {
    renderLedger([
      row({ repo: "rextorsec/newer", created_at: "2026-10-10T00:00:00.000Z" }),
      row({ repo: "rextorsec/older", created_at: "2026-10-01T00:00:00.000Z" }),
    ]);
    const cells = within(ledger()).getAllByRole("cell");
    expect(cells[0].textContent).toBe("rextorsec/newer");
    expect(cells[7].textContent).toBe("rextorsec/older");
  });

  it("renders the approved empty-ledger banner when the repo has no scans", () => {
    renderLedger([]);
    expect(screen.getByText("No scans yet — run the first Deep Scan.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
