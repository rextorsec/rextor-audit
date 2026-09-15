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
// ever runs — status-less throws, or a numeric status carrying
// "Cannot connect to the Docker daemon". A real container exit (any other
// numeric status) is final and judged strictly; only daemon churn retries.
const runAnalyzer = (mount: string): RunResult => {
  let lastMessage = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return {
        status: 0,
        stdout: execFileSync("docker", ["run", "--rm", "-v", `${mount}:/repo`, "rextor/analyzer"]).toString(),
      };
    } catch (e) {
      const err = e as {
        status?: number | null;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        message?: string;
      };
      // Final only when a container actually ran to an exit. A daemon-down
      // CLI failure arrives WITH a numeric status (docker exits 1) — that is
      // transient churn, not a verdict.
      const stderr = String(err?.stderr ?? "");
      if (
        typeof err?.status === "number" &&
        !/Cannot connect to the Docker daemon/.test(stderr)
      ) {
        return { status: err.status, stdout: String(err?.stdout ?? "") };
      }
      lastMessage = err?.message ?? String(e);
    }
  }
  throw new Error(`docker run never produced a container exit (transient daemon failure): ${lastMessage}`);
};

describe.skipIf(!docker)("analyzer container contract", () => {
  it("flags reentrancy in the Vault fixture", { timeout: 180_000 }, () => {
    const { stdout } = runAnalyzer(fixturePath);
    const findings = stdout.trim().split("\n").map((l: string) => JSON.parse(l) as Finding);
    expect(findings.some((f: Finding) => f.check === "reentrancy-eth" && f.severity === "high")).toBe(true);
  });
  it("emits incomplete (never silent clean) on analyzer failure", { timeout: 180_000 }, () => {
    // repo with no contracts → analyzer failure → contract requires status:incomplete + exit 3
    const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
    const { status, stdout } = runAnalyzer(tmp);
    expect(status).toBe(3);
    expect(stdout).toContain('"status":"incomplete"');
  });
  it("exits 0 with empty stdout on a zero-findings repo (never incomplete)", { timeout: 180_000 }, () => {
    // Contract case (b): successfully analyzed, zero findings → clean pass,
    // NOT incomplete. Foundry-based fixture: the bare-solc path is amd64-broken
    // on arm64 hosts, so the foundry path is what runs here.
    const { status, stdout } = runAnalyzer(cleanFixturePath);
    // Explicit completion signal: exit-3-with-empty-stdout masquerading as a
    // clean pass must fail here (SPEC-1 §1 makes status the contract).
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
