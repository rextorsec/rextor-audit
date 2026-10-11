// ScanReportView — pure render of a ScanReport: zero-meaningful display
// (null risk → "—", 0 findings visible, head "" → "—"), degraded/incomplete
// cause chips, first-finding expansion labels, severity token encoding, and
// untrusted-string inertness (React escaping only).
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScanReportView } from "@/components/scan-report";
import type { ScanFinding, ScanReport } from "@/lib/scans";

const FINDING: ScanFinding = {
  file: "src/Vault.sol",
  line: 87,
  severity: "high",
  check: "reentrancy-eth",
  description: "External call sends ETH before the balance state flip.",
  triageNote: "Kept at detector severity (high).",
  suggestedDiff: "- (bool ok, ) = msg.sender.call{value: amount}(\"\");\n+ balances[msg.sender] -= amount;",
  poc: { status: "confirmed", testSource: "forge test --match-test test_Withdraw_Reentrancy" },
  mergedChecks: ["arbitrary-send-eth", "calls-loop"],
  learningNote: "This call-before-flip shape has been flagged on earlier runs of this repo.",
};

const SECOND_FINDING: ScanFinding = {
  file: "src/Vault.sol",
  line: 102,
  severity: "medium",
  check: "low-level-calls",
  description: "Result of a low-level call is used without checking success.",
};

function fixture(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    repo: "rextorsec/rextor-audit-test",
    ref: "main",
    head_sha: "ce7f6a9d2b42abcd599537e4abffa33d8760496c",
    status: 0,
    risk_score: 34,
    finding_count: 4,
    findings: [{ ...FINDING }, { ...SECOND_FINDING }],
    ...overrides,
  };
}

describe("ScanReportView — zero-meaningful hero", () => {
  it("renders a null risk as — with the no-score microcopy, never a fake 0", () => {
    render(
      <ScanReportView
        report={fixture({
          status: 1,
          risk_score: null,
          finding_count: 0,
          findings: [],
          incomplete: "analyzer container exited before reporting",
          incompleteCause: "infra",
        })}
      />,
    );

    const risk = screen.getByRole("group", { name: "No risk score — incomplete" });
    expect(within(risk).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("no score — incomplete")).toBeInTheDocument();
    expect(screen.getByText("status 1 · INCOMPLETE")).toBeInTheDocument();
  });

  it("renders a real 0-findings clean pass visibly, never hidden", () => {
    render(<ScanReportView report={fixture({ risk_score: 8, finding_count: 0, findings: [] })} />);

    expect(screen.getByText("0 findings — clean pass")).toBeInTheDocument();
    expect(screen.getByText("findings — clean pass")).toBeInTheDocument();
    expect(screen.getByText("status 0 · complete")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Risk score 8 of 100" })).toBeInTheDocument();
  });

  it("renders an empty head_sha as — in the receipt line, never a fake hash", () => {
    render(<ScanReportView report={fixture({ head_sha: "" })} />);

    expect(screen.getByText(/· main @ —/)).toBeInTheDocument();
  });
});

describe("ScanReportView — degraded (status stays 0)", () => {
  it("renders degradation chips and the status-stays-0 note", () => {
    render(
      <ScanReportView report={fixture({ degraded: ["poc unproven — generation failed"] })} />,
    );

    expect(
      screen.getByText("degraded · poc unproven — generation failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("status stays 0")).toBeInTheDocument();
    expect(
      screen.getByText(/they ride along with a complete status/i),
    ).toBeInTheDocument();
    expect(screen.getByText("status 0 · complete")).toBeInTheDocument();
  });
});

describe("ScanReportView — incomplete cause chips", () => {
  it("renders the reason line plus BOTH cause chips, highlighting the actual cause", () => {
    render(
      <ScanReportView
        report={fixture({
          status: 1,
          risk_score: null,
          finding_count: 0,
          findings: [],
          incomplete: "analyzer container exited before reporting",
          incompleteCause: "infra",
        })}
      />,
    );

    expect(
      screen.getByText("analyzer container exited before reporting The cause chip says which side failed:"),
    ).toBeInTheDocument();
    const infraChip = screen.getByText("infra — not a verdict on the code");
    const contentChip = screen.getByText("content — nothing in scope to analyze");
    expect(infraChip).toBeInTheDocument();
    expect(contentChip).toBeInTheDocument();
    expect(infraChip.className).toContain("border-warning");
    expect(contentChip.className).not.toContain("border-warning");
    expect(screen.getByText(/infra: service-side failure/i)).toBeInTheDocument();
  });

  it("renders both chips unhighlighted when the run carries no cause", () => {
    render(
      <ScanReportView
        report={fixture({
          status: 1,
          risk_score: null,
          finding_count: 0,
          findings: [],
          incomplete: "unknown failure",
        })}
      />,
    );

    expect(screen.getByText("infra — not a verdict on the code").className).not.toContain(
      "border-warning",
    );
    expect(screen.getByText("content — nothing in scope to analyze").className).not.toContain(
      "border-warning",
    );
  });
});

describe("ScanReportView — first-finding expansion", () => {
  it("renders the FIRST finding expanded with every detail-block label", () => {
    render(<ScanReportView report={fixture()} />);

    const summary = screen.getByText("triage detail · finding #0");
    expect(summary).toBeInTheDocument();
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("triage note")).toBeInTheDocument();
    expect(screen.getByText("suggested fix — review before applying")).toBeInTheDocument();
    expect(screen.getByText("proof of concept")).toBeInTheDocument();
    expect(screen.getByText("merged checks")).toBeInTheDocument();
    expect(screen.getByText("server-side learnings ledger")).toBeInTheDocument();
    expect(screen.queryByText("triage detail · finding #1")).not.toBeInTheDocument();
  });

  it("renders diff lines with the mock's del/add/ctx tones and merged checks listed", () => {
    render(<ScanReportView report={fixture()} />);

    expect(screen.getByText(/msg\.sender\.call/)).toBeInTheDocument();
    const delLine = screen.getByText((_, el) => el?.textContent === '- (bool ok, ) = msg.sender.call{value: amount}("");');
    const addLine = screen.getByText((_, el) => el?.textContent === "+ balances[msg.sender] -= amount;");
    expect(delLine?.className).toContain("text-danger");
    expect(addLine?.className).toContain("text-success");
    expect(screen.getByText("arbitrary-send-eth")).toBeInTheDocument();
    expect(screen.getByText("calls-loop")).toBeInTheDocument();
  });

  it("omits detail blocks the run did not carry", () => {
    render(
      <ScanReportView
        report={fixture({ findings: [{ ...SECOND_FINDING }], finding_count: 1 })}
      />,
    );

    expect(screen.getByText("triage detail · finding #0")).toBeInTheDocument();
    expect(screen.queryByText("triage note")).not.toBeInTheDocument();
    expect(screen.queryByText("suggested fix — review before applying")).not.toBeInTheDocument();
    expect(screen.queryByText("proof of concept")).not.toBeInTheDocument();
    expect(screen.queryByText("merged checks")).not.toBeInTheDocument();
    expect(screen.queryByText("server-side learnings ledger")).not.toBeInTheDocument();
  });
});

describe("ScanReportView — severity encoding + untrusted strings", () => {
  it("carries danger/warning/muted/subtle ink per the approved mock", () => {
    render(
      <ScanReportView
        report={fixture({
          findings: [
            { ...FINDING, severity: "critical" },
            { ...SECOND_FINDING, severity: "low" },
          ],
          finding_count: 2,
        })}
      />,
    );

    const critRow = screen.getByText("reentrancy-eth").closest("tr");
    const lowRow = screen.getByText("low-level-calls").closest("tr");
    // The ink span carries the severity's text token; the color dot is its
    // first child span (aria-hidden), per the component's anatomy.
    const criticalInk = within(critRow as HTMLElement).getByText("critical");
    expect(criticalInk.className).toContain("text-danger");
    expect(criticalInk.firstElementChild?.className).toContain("bg-danger");
    expect(within(lowRow as HTMLElement).getByText("low").className).toContain("text-subtle-foreground");
  });

  it("renders scan-derived strings as inert text — never injected markup", () => {
    const { container } = render(
      <ScanReportView
        report={fixture({
          findings: [
            {
              ...FINDING,
              description: "<script>alert(1)</script>",
              check: "<img src=x onerror=alert(2)>",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
