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
const runAnalyzer = (mount: string, entrypoint?: string): RunResult => {
  let lastMessage = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const args = ["run", "--rm", "-v", `${mount}:/repo`];
      if (entrypoint) args.push("--entrypoint", entrypoint);
      args.push("rextor/analyzer");
      return {
        status: 0,
        stdout: execFileSync("docker", args).toString(),
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

// SPEC-8 §1 — Solana (Anchor) slice contract: same NDJSON/incomplete rules as
// the EVM path (invariant 25). Synthetic trees are built under os.tmpdir():
// on GitHub runners (2026-09-24), files created at job runtime under the
// workspace do NOT propagate into docker bind mounts (checkout-time fixture
// dirs do) — a workspace-mounted synthetic tree dispatches against an EMPTY
// /repo and fails. os.tmpdir() is bind-mount-visible on the runner AND under
// Docker Desktop (the colima /tmp caveat below is obsolete: this machine runs
// Docker Desktop, which shares /tmp; sim.contract.test.ts already relied on
// tmpdir mounts across both environments).
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const solanaFixturePath = `${repoRoot}fixtures/solana-vault`;
const SOLANA_ENTRYPOINT = "/usr/local/bin/solana.sh";

describe.skipIf(!docker)("solana slice contract (SPEC-8 §1)", () => {
  it("emits exactly the three pinned findings on the solana-vault fixture", { timeout: 240_000 }, () => {
    const { status, stdout } = runAnalyzer(solanaFixturePath, SOLANA_ENTRYPOINT);
    expect(status).toBe(0);
    const findings = stdout.trim().split("\n").map((l: string) => JSON.parse(l))
      .sort((a: { line: number }, b: { line: number }) => a.line - b.line);
    expect(findings).toEqual([
      { file: "src/lib.rs", line: 19, severity: "low", check: "REXTOR-SOL-003", description: expect.any(String) },
      { file: "src/lib.rs", line: 20, severity: "high", check: "REXTOR-SOL-001", description: expect.any(String) },
      { file: "src/lib.rs", line: 30, severity: "high", check: "REXTOR-SOL-002", description: expect.any(String) },
    ]);
  });

  it("run.sh dispatches Anchor-shaped repos to the slice (default entrypoint, same findings)", { timeout: 240_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "anchor-dispatch-"));
    try {
      writeFileSync(join(dir, "Anchor.toml"), "");
      mkdirSync(join(dir, "programs/x/src"), { recursive: true });
      writeFileSync(join(dir, "programs/x/Cargo.toml"), '[dependencies]\nanchor-lang = "0.30.1"\n');
      copyFileSync(join(solanaFixturePath, "src/lib.rs"), join(dir, "programs/x/src/lib.rs"));
      const { status, stdout } = runAnalyzer(dir);
      expect(status).toBe(0);
      const findings = stdout.trim().split("\n").map((l: string) => JSON.parse(l))
        .sort((a: { line: number }, b: { line: number }) => a.line - b.line);
      expect(findings.map((f: { check: string }) => f.check))
        .toEqual(["REXTOR-SOL-003", "REXTOR-SOL-001", "REXTOR-SOL-002"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Anchor-dispatched repo without rust sources → incomplete no-rust-analyzed (never clean)", { timeout: 120_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "anchor-empty-"));
    try {
      writeFileSync(join(dir, "Anchor.toml"), "");
      const { status, stdout } = runAnalyzer(dir);
      expect(status).toBe(3);
      expect(stdout).toContain('"status":"incomplete"');
      expect(stdout).toContain("no-rust-analyzed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
