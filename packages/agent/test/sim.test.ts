// SPEC-3 — fork-sim core: eligibility, excerpt reader, source sanitizer,
// result mapping (confirmed/unproven/skipped), and the frontier PoC
// generation seam. All LLM/container I/O is injected; env is injected too,
// so these tests never touch a network or docker.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generatePocFromEnv, readExcerpt, runSimStage, sanitizePocSource, simEligible,
  type PocRequest, type SimOutcomeMap,
} from "../src/sim";
import { withIds, type Finding } from "../src/findings";

const crit = (id: number): Finding =>
  ({ id, file: "src/Vault.sol", line: 42, severity: "critical", check: "reentrancy-eth", description: "drain" });
const low = (id: number): Finding =>
  ({ id, file: "src/Vault.sol", line: 7, severity: "low", check: "style", description: "naming" });

describe("simEligible", () => {
  it("is critical/high only", () => {
    expect(simEligible(crit(0))).toBe(true);
    expect(simEligible({ ...crit(0), severity: "high" })).toBe(true);
    expect(simEligible(low(0))).toBe(false);
  });
});

describe("sanitizePocSource", () => {
  it("strips CR and collapses 3+ backtick runs so fences cannot be escaped", () => {
    expect(sanitizePocSource("a\r\nb")).toBe("a\nb");
    expect(sanitizePocSource("x```y````z")).toBe("x`y`z");
  });
});

describe("runSimStage", () => {
  const forkEnv = { REXTOR_FORK_RPC_URL: "https://fork.example" };

  it("no eligible findings → unchanged, empty note", async () => {
    const out = await runSimStage(withIds([low(0)]), "/tmp/x", {}, forkEnv);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].poc).toBeUndefined();
    expect(out.simNote).toBe("");
  });

  it("no fork env → eligible findings marked skipped with reason note", async () => {
    const out = await runSimStage(withIds([crit(0)]), "/tmp/x", {}, {});
    expect(out.findings[0].poc?.status).toBe("skipped");
    expect(out.simNote).toContain("no fork configured");
  });

  it("passing test → confirmed with testSource + block", async () => {
    const src = "contract RextorPocTest { function testRextorPoc_0() public {} }";
    const runSim = async (): Promise<SimOutcomeMap> => ({ block: 1234, results: { testRextorPoc_0: true } });
    const out = await runSimStage(withIds([crit(0)]), "/tmp/x",
      { generatePoc: async () => src, runSim }, forkEnv);
    expect(out.findings[0].poc?.status).toBe("confirmed");
    expect(out.findings[0].poc?.testSource).toBe(src);
    expect(out.findings[0].poc?.block).toBe(1234);
    expect(out.simNote).toContain("block 1234");
    expect(out.simNote).toContain("1 confirmed");
  });

  it("failing/missing test → unproven", async () => {
    const runSim = async (): Promise<SimOutcomeMap> => ({ block: 5, results: { testRextorPoc_0: false } });
    const out = await runSimStage(withIds([crit(0)]), "/tmp/x",
      { generatePoc: async () => "src", runSim }, forkEnv);
    expect(out.findings[0].poc?.status).toBe("unproven");
    const runSim2 = async (): Promise<SimOutcomeMap> => ({ block: 5, results: {} });
    const out2 = await runSimStage(withIds([crit(0)]), "/tmp/x",
      { generatePoc: async () => "src", runSim: runSim2 }, forkEnv);
    expect(out2.findings[0].poc?.status).toBe("unproven");
  });

  it("generation or harness failure → unproven, never a throw", async () => {
    const boom = async (): Promise<string> => { throw new Error("llm down"); };
    const out = await runSimStage(withIds([crit(0)]), "/tmp/x", { generatePoc: boom }, forkEnv);
    expect(out.findings[0].poc?.status).toBe("unproven");
    const boomSim = { generatePoc: async () => "src", runSim: async (): Promise<SimOutcomeMap> => { throw new Error("docker"); } };
    const out2 = await runSimStage(withIds([crit(0)]), "/tmp/x", boomSim, forkEnv);
    expect(out2.findings[0].poc?.status).toBe("unproven");
  });

  it("generator absent but harness present → config-gap skip, never unproven", async () => {
    // A misconfigured runner must NOT silently downgrade criticals to
    // rubric-25 unproven: absent generator = config gap → skipped.
    const runSim = async (): Promise<SimOutcomeMap> => ({ block: 9, results: {} });
    const out = await runSimStage(withIds([crit(0)]), "/tmp/x", { runSim }, forkEnv);
    expect(out.findings[0].poc?.status).toBe("skipped");
    expect(out.simNote).toContain("not configured on this runner");
  });

  it("malformed harness result → unproven, never a throw", async () => {
    const out = await runSimStage(withIds([crit(0)]), "/tmp/x",
      { generatePoc: async () => "src", runSim: async () => null as unknown as SimOutcomeMap }, forkEnv);
    expect(out.findings[0].poc?.status).toBe("unproven");
  });

  it("mixed severities: only critical/high touched", async () => {
    const runSim = async (): Promise<SimOutcomeMap> => ({ block: 1, results: { testRextorPoc_0: true } });
    const out = await runSimStage(withIds([crit(0), low(1)]), "/tmp/x",
      { generatePoc: async () => "src", runSim }, forkEnv);
    expect(out.findings[0].poc?.status).toBe("confirmed");
    expect(out.findings[1].poc).toBeUndefined();
  });
});

describe("readExcerpt (against the real fixture)", () => {
  it("returns numbered lines around the target line", async () => {
    const vault = join(__dirname, "../../../fixtures/vault/src/Vault.sol");
    const excerpt = await readExcerpt(join(__dirname, "../../../fixtures/vault"), "src/Vault.sol", 5, 2);
    expect(excerpt).toContain("src/Vault.sol");
    const firstLine = (await readFile(vault, "utf8")).split("\n")[4];
    expect(excerpt).toContain(firstLine.trim().slice(0, 10));
  });
  it("missing file → placeholder, no throw", async () => {
    expect(await readExcerpt("/tmp", "nope.sol", 1)).toContain("unavailable");
  });
});

describe("generatePocFromEnv", () => {
  it("validates the generated source shape (contract + test fns) and rejects bad shape", async () => {
    const good = 'import "forge-std/Test.sol";\ncontract RextorPocTest { function testRextorPoc_0() public {} }';
    const fetchFn = (async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "```solidity\n" + good + "\n```" } }] }),
    })) as unknown as typeof fetch;
    const gen = generatePocFromEnv(() => ({
      OPENROUTER_API_KEY: "k", REXTOR_FRONTIER_MODEL: "vendor/front",
    }), { fetchFn });
    const reqs: PocRequest[] = [{ finding: crit(0), excerpt: "..." }];
    await expect(gen!(reqs)).resolves.toContain("RextorPocTest");
    const badFetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "I cannot write that." } }] }),
    })) as unknown as typeof fetch;
    const gen2 = generatePocFromEnv(() => ({
      OPENROUTER_API_KEY: "k", REXTOR_FRONTIER_MODEL: "vendor/front",
    }), { fetchFn: badFetch });
    await expect(gen2!(reqs)).rejects.toThrow();
  });

  it("shape validation is id-exact: testRextorPoc_1 is not satisfied by _10", async () => {
    // Substring matching would let finding #1 ride on finding #10's test fn.
    const onlyTen = 'import "forge-std/Test.sol";\ncontract RextorPocTest { function testRextorPoc_10() public {} }';
    const fetchFn = (async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "```solidity\n" + onlyTen + "\n```" } }] }),
    })) as unknown as typeof fetch;
    const gen = generatePocFromEnv(() => ({
      OPENROUTER_API_KEY: "k", REXTOR_FRONTIER_MODEL: "vendor/front",
    }), { fetchFn });
    await expect(gen!([{ finding: crit(1), excerpt: "..." }])).rejects.toThrow();
  });
  it("unset env → undefined dep", () => {
    expect(generatePocFromEnv(() => ({}))).toBeUndefined();
  });
});
