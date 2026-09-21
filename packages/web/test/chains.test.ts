// SPEC-6 §3 — web chain registry contracts: entries exist only for chains
// with a LIVE deployment, and the display names must match the agent-side
// row `chain` values verbatim (the dashboard resolves rows via
// webChainByName — a name drift silently strands the row on the default).
import { describe, expect, it } from "vitest";

import { isWebChainKey, webChainByName, WEB_CHAINS } from "@/lib/chains";

describe("WEB_CHAINS", () => {
  it("resolves live rows by their verbatim agent-side display names", () => {
    expect(webChainByName("Tempo testnet")?.key).toBe("tempo");
    expect(webChainByName("HyperEVM mainnet")?.key).toBe("hyperliquid");
  });

  it("keeps the two live deployments distinct and fully populated", () => {
    expect(WEB_CHAINS.tempo.chainId).toBe(42431);
    expect(WEB_CHAINS.hyperliquid.chainId).toBe(999);
    for (const chain of Object.values(WEB_CHAINS)) {
      expect(chain.attestation).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.agent).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.rpc).toMatch(/^https:/);
      expect(chain.explorer).toMatch(/^https:/);
    }
  });

  it("guards the /api/chain path segment", () => {
    expect(isWebChainKey("hyperliquid")).toBe(true);
    expect(isWebChainKey("nope")).toBe(false);
  });
});
