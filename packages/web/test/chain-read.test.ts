// SPEC-6 §3 + invariant 18 — chain reads happen SERVER-side only. The viem
// client is real (ABI parsed through viem's own resolver), the read is faked.
import { describe, expect, it, vi, type Mock } from "vitest";

import { readAgentIdentity, type AgentsRead } from "@/lib/chain-read";
import { WEB_CHAINS } from "@/lib/chains";

const tempo = WEB_CHAINS.tempo;

function okRead(
  result: readonly [string, boolean, bigint] = ["rextor-audit[bot]", true, 2n],
): { read: AgentsRead; spy: Mock } {
  const spy = vi.fn(async () => result);
  return { read: spy as unknown as AgentsRead, spy };
}

describe("readAgentIdentity", () => {
  it("calls agents(agent) on the live contract with a parsed ABI and maps the tuple", async () => {
    const { read, spy } = okRead();
    const identity = await readAgentIdentity("tempo", { read });

    expect(spy).toHaveBeenCalledWith({
      address: tempo.attestation,
      functionName: "agents",
      args: [tempo.agent],
    });
    expect(identity).toEqual({ name: "rextor-audit[bot]", active: true, reviewCount: 2 });
  });

  it("returns null when the read fails (page degrades to '—' fields)", async () => {
    const failing = vi.fn(async () => {
      throw new Error("rpc down");
    });
    const identity = await readAgentIdentity("tempo", {
      read: failing as unknown as AgentsRead,
    });
    expect(identity).toBeNull();
  });

  it("returns null for an unknown chain key without attempting a read", async () => {
    const { spy } = okRead();
    const identity = await readAgentIdentity("nope", { read: spy as unknown as AgentsRead });
    expect(identity).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads the HyperEVM mainnet deployment when keyed hyperliquid", async () => {
    const hyperliquid = WEB_CHAINS.hyperliquid;
    const { read, spy } = okRead(["rextor-audit[bot]", true, 1n]);
    const identity = await readAgentIdentity("hyperliquid", { read });

    expect(spy).toHaveBeenCalledWith({
      address: hyperliquid.attestation,
      functionName: "agents",
      args: [hyperliquid.agent],
    });
    expect(identity).toEqual({ name: "rextor-audit[bot]", active: true, reviewCount: 1 });
  });
});
