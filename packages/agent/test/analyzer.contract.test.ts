import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const docker = (() => {
  try { execFileSync("docker", ["info"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

// Repo root (fixtures live at the repo root, not under packages/agent).
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturePath = `${repoRoot}fixtures/vault`;
const cleanFixturePath = `${repoRoot}fixtures/vault-clean`;

// NDJSON finding shape pinned by SPEC-1 §1 (severity: critical|high|medium|low).
type Finding = { check: string; severity: "critical" | "high" | "medium" | "low" };

type RunResult = { status: number; stdout: string };

// Shared colima daemon churn can make the docker CLI fail before a container
// ever runs — those throws carry no numeric status. A real container exit is
// final and judged strictly; only status-less transients justify a retry.
const runAnalyzer = (mount: string): RunResult => {
  let lastMessage = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return {
        status: 0,
        stdout: execFileSync("docker", ["run", "--rm", "-v", `${mount}:/repo`, "rextor/analyzer"]).toString(),
      };
    } catch (e) {
      const err = e as { status?: number | null; stdout?: string | Buffer; message?: string };
      if (typeof err?.status === "number") {
        return { status: err.status, stdout: String(err?.stdout ?? "") };
      }
      lastMessage = err?.message ?? String(e);
    }
  }
  throw new Error(`docker run never produced a container exit (transient daemon failure): ${lastMessage}`);
};

describe.skipIf(!docker)("analyzer container contract", () => {
  it("flags reentrancy in the Vault fixture", () => {
    const { stdout } = runAnalyzer(fixturePath);
    const findings = stdout.trim().split("\n").map((l: string) => JSON.parse(l) as Finding);
    expect(findings.some((f: Finding) => f.check === "reentrancy-eth" && f.severity === "high")).toBe(true);
  });
  it("emits incomplete (never silent clean) on analyzer failure", () => {
    // repo with no contracts → analyzer failure → contract requires status:incomplete + exit 3
    const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
    const { status, stdout } = runAnalyzer(tmp);
    expect(status).toBe(3);
    expect(stdout).toContain('"status":"incomplete"');
  });
  it("exits 0 with empty stdout on a zero-findings repo (never incomplete)", () => {
    // Contract case (b): successfully analyzed, zero findings → clean pass, NOT incomplete.
    // Foundry-based fixture: the bare-solc path is amd64-broken on arm64 hosts.
    const { stdout } = runAnalyzer(cleanFixturePath);
    expect(stdout.trim()).toBe("");
  });
});
