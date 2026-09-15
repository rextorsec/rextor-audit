import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const docker = (() => {
  try { execFileSync("docker", ["info"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

// Repo root (fixtures/vault lives at the root, not under packages/agent).
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturePath = `${repoRoot}fixtures/vault`;

// NDJSON finding shape pinned by SPEC-1 §1 (severity: critical|high|medium|low).
type Finding = { check: string; severity: "critical" | "high" | "medium" | "low" };

describe.skipIf(!docker)("analyzer container contract", () => {
  it("flags reentrancy in the Vault fixture", () => {
    const out = execFileSync("docker", [
      "run", "--rm", "-v", `${fixturePath}:/repo`, "rextor/analyzer",
    ]).toString();
    const findings = out.trim().split("\n").map((l: string) => JSON.parse(l) as Finding);
    expect(findings.some((f: Finding) => f.check === "reentrancy-eth" && f.severity === "high")).toBe(true);
  });
  it("emits incomplete (never silent clean) on analyzer failure", () => {
    // repo with no contracts → slither errors → contract requires status:incomplete + exit 3
    const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
    let exited3 = false;
    try {
      execFileSync("docker", ["run", "--rm", "-v", `${tmp}:/repo`, "rextor/analyzer"]);
    } catch (e) {
      const err = e as { status?: number } | null; // execFileSync throws a spawn-sync error carrying the container exit code
      exited3 = err?.status === 3;
    }
    expect(exited3).toBe(true);
  });
});
