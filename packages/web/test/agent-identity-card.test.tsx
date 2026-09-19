// SPEC-6 §3 — agent identity card: live read values, and the honest degraded
// form when the chain read fails ("—" fields + note, card still renders).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentIdentityCard } from "@/components/agent-identity-card";

const AGENT_ADDRESS = "0xE6906A58ea17E28aFEFBA5bBcD5EBa85BF58a122";

describe("AgentIdentityCard", () => {
  it("renders the live agents() read: name, ACTIVE, attested counts", () => {
    render(
      <AgentIdentityCard
        name="rextor-audit[bot]"
        active={true}
        reviewCount={2}
        attestedIncomplete={0}
        agentAddress={AGENT_ADDRESS}
      />,
    );

    const card = screen.getByRole("region", { name: /agent identity/i });
    expect(screen.getByText("rextor-audit[bot]")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    // Short form in the dd, full address carried in the title attribute.
    const address = screen.getByText(/0xE690…a122/);
    expect(address).toHaveAttribute("title", AGENT_ADDRESS);
    expect(card).toBeInTheDocument();
  });

  it("renders INACTIVE when the on-chain flag says so", () => {
    render(
      <AgentIdentityCard
        name="rextor-audit[bot]"
        active={false}
        reviewCount={0}
        attestedIncomplete={0}
        agentAddress={AGENT_ADDRESS}
      />,
    );

    expect(screen.getByText("INACTIVE")).toBeInTheDocument();
    expect(screen.queryByText("ACTIVE")).not.toBeInTheDocument();
  });

  it("degrades to '—' fields with a note when the chain read failed", () => {
    render(
      <AgentIdentityCard
        name={null}
        active={null}
        reviewCount={null}
        attestedIncomplete={0}
        agentAddress={AGENT_ADDRESS}
        unavailableReason="rpc unreachable"
      />,
    );

    const card = screen.getByRole("region", { name: /agent identity/i });
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/chain read unavailable — rpc unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText("ACTIVE")).not.toBeInTheDocument();
    expect(card).toBeInTheDocument();
  });
});
