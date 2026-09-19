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

// C1 — canonical ERC-8004 identity citation (identity.json feeds the prop).
const ERC8004 = {
  agentRegistry: "eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  agentId: 50891,
  tx: "0xc4c0565c1f07e42cbd9524dadc7a033079ac0d4f7d497cb70abd7ba0dcec3d64",
};

describe("AgentIdentityCard × erc8004 citation", () => {
  it("renders the agentId citation linking the mint tx when present", () => {
    render(
      <AgentIdentityCard
        name="rextor-audit[bot]"
        active={true}
        reviewCount={1}
        attestedIncomplete={0}
        agentAddress={AGENT_ADDRESS}
        erc8004={ERC8004}
      />,
    );
    expect(screen.getByText(/ERC-8004 identity/i)).toBeInTheDocument();
    const citation = screen.getByText(/#50891 · eip155:1/);
    expect(citation.closest("a")).toHaveAttribute(
      "href",
      `https://etherscan.io/tx/${ERC8004.tx}`,
    );
    // Full agentRegistry carried in the title attribute for hover/verification.
    expect(citation).toHaveAttribute("title", ERC8004.agentRegistry);
  });

  it("absent erc8004 → no citation row (degrade, never fabricate)", () => {
    render(
      <AgentIdentityCard
        name="rextor-audit[bot]"
        active={true}
        reviewCount={1}
        attestedIncomplete={0}
        agentAddress={AGENT_ADDRESS}
      />,
    );
    expect(screen.queryByText(/ERC-8004 identity/i)).not.toBeInTheDocument();
  });
});
