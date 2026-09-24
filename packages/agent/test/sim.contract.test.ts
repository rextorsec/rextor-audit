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
// executes. FFI denial must make it revert, so `results === false` is a proof
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

// Deliberately failing real PoC for the decoy regression: if the planted
// passing testRextorPoc_0 were counted, the result would read "confirmed".
const FAILING_POC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";

contract RextorPocTest is Test {
    function testRextorPoc_0() public {
        assertTrue(false, "deliberately failing");
    }
}
`;

// The decoy itself: same contract name as the generated PoC, trivially
// passing test fn, planted in the PR's test dir under a name that sorts after
// test/RextorPoc.t.sol (pre-fix, parseForgeJson's bare-name map was
// last-write-wins and the decoy won).
const DECOY_POC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";

contract RextorPocTest is Test {
    function testRextorPoc_0() public {
        assertTrue(true);
    }
}
`;

// ffi-enabling foundry.toml variants a PR might ship (fix round 1: the suite
// must cover more than the linear [profile.default] form).
interface FfiVariant {
  name: string;
  rewrite: (toml: string) => string;
  // "results" = forge runs and denial is proven in-band via the result map;
  // "rejected" = the config itself cannot resolve (parse failure), so the
  // harness must throw (mapped upstream to unproven) instead of running.
  mode: "results" | "rejected";
}
const FFI_TOML_VARIANTS: FfiVariant[] = [
  {
    name: "linear ffi = true under [profile.default]",
    rewrite: (toml) => `${toml}ffi = true\n`,
    mode: "results",
  },
  {
    name: "dotted profile.default.ffi = true inside the table",
    rewrite: (toml) => `${toml}profile.default.ffi = true\n`,
    mode: "results",
  },
  {
    name: "root-level dotted key before any table header",
    rewrite: (toml) => `profile.default.ffi = true\n${toml}`,
    mode: "rejected",
  },
];

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

/** Writable fixture copy under a daemon-bindable base, stripped to the PoC
 *  essentials (no build artifacts, no fixture test file). */
async function makeFixtureCopy(prefix: string): Promise<string> {
  const copy = await mkdtemp(join(simTmpBase(), prefix));
  await cp(FIXTURES_VAULT, copy, { recursive: true });
  await rm(join(copy, "out"), { recursive: true, force: true });
  await rm(join(copy, "cache"), { recursive: true, force: true });
  await rm(join(copy, "test", "Vault.t.sol"));
  return copy;
}

/** Standalone anvil container; returns its bridge IP. */
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

describe("runSimContainer (docker-gated)", () => {
  maybeIt("runs a passing PoC against a local anvil fork → confirmed", async () => {
    if (!(await dockerUp()) || process.env.REXTOR_SKIP_CONTRACT_TESTS === "1") return; // graceful skip (see ci.yml contract job)
    const out = await runSimContainerAnvil(FIXTURES_VAULT, VAULT_DRAIN_POC);
    expect(out.block).toBeGreaterThan(0);
    expect(out.results["testRextorPoc_0"]).toBe(true);
  }, 300_000);

  it("adversarial: PR foundry.toml ffi=true (linear + dotted forms) → ffi must stay denied", async () => {
    if (!(await dockerUp()) || process.env.REXTOR_SKIP_CONTRACT_TESTS === "1") return; // graceful skip (see ci.yml contract job)
    const anvil = await startAnvilContainer();
    try {
      for (const variant of FFI_TOML_VARIANTS) {
        const fixtureCopy = await makeFixtureCopy("rextor-sim-ffi-");
        await writeFile(
          join(fixtureCopy, "foundry.toml"),
          variant.rewrite(`${await readFile(join(fixtureCopy, "foundry.toml"), "utf8")}`),
          "utf8",
        );
        try {
          if (variant.mode === "results") {
            // Control passing proves fixture + harness are healthy; therefore
            // _0's failure can ONLY be the vm.ffi revert — FFI denial (the
            // resolved-config gate + patched config) beat the PR's ffi = true.
            const out = await runSimContainer(fixtureCopy, FFI_PROBE_POC, `http://${anvil.ip}:8545`);
            expect(out.results["test_controlHarnessRan"], variant.name).toBe(true);
            expect(out.results["testRextorPoc_0"], variant.name).toBe(false);
            expect(out.block, variant.name).toBeGreaterThan(0);
          } else {
            // A config forge cannot resolve is a harness failure (unproven),
            // never a run — and never ffi execution.
            await expect(
              runSimContainer(fixtureCopy, FFI_PROBE_POC, `http://${anvil.ip}:8545`),
              variant.name,
            ).rejects.toThrow();
          }
        } finally {
          await rm(fixtureCopy, { recursive: true, force: true }).catch(() => {});
        }
      }
    } finally {
      await execFileP("docker", ["stop", "-t", "2", anvil.name]).catch(() => {});
    }
  }, 300_000);

  it("FFI gate refusal writes its cause to /poc/stderr.txt (stderrTail visibility)", async () => {
    if (!(await dockerUp()) || process.env.REXTOR_SKIP_CONTRACT_TESTS === "1") return; // graceful skip (see ci.yml contract job)
    const fixtureCopy = await makeFixtureCopy("rextor-sim-gate-");
    // Inline-table profile form: valid TOML forge RESOLVES to ffi=true, but
    // sim.sh's line-based sed rewrite cannot match it — the exact gate-1
    // refusal path (empirically verified on the image's forge 1.8.3).
    await writeFile(join(fixtureCopy, "foundry.toml"), "[profile]\ndefault = { ffi = true }\n", "utf8");
    const pocDir = await mkdtemp(join(simTmpBase(), "rextor-sim-gate-poc-"));
    try {
      // Same hardening as runSimContainer (:ro repo, /poc overlay,
      // FOUNDRY_FFI=false, SIGKILL budget). FORK_BLOCK=1 skips cast, so no
      // fork is contacted before the gates — --network none suffices.
      await chmod(pocDir, 0o777);
      await writeFile(join(pocDir, "RextorPoc.t.sol"), FFI_PROBE_POC, "utf8");
      await expect(execFileP("docker", [
        "run", "--rm", "--network", "none",
        "-v", `${resolve(fixtureCopy)}:/repo:ro`,
        "-v", `${pocDir}:/poc`,
        "-e", "FORK_URL=http://127.0.0.1:8545",
        "-e", "FORK_BLOCK=1",
        "-e", "FOUNDRY_FFI=false",
        "--entrypoint", "/usr/local/bin/sim.sh",
        "rextor/analyzer",
      ], { timeout: 240_000, killSignal: "SIGKILL" })).rejects.toThrow(); // sim.sh exits 1
      // The refusal cause must reach the artifact the runner's stderrTail()
      // parses (readFile + trim + 400-char tail) — otherwise an adversarial
      // refusal is indistinguishable from harness breakage in the log.
      const stderr = await readFile(join(pocDir, "stderr.txt"), "utf8");
      expect(stderr.trim().slice(-400)).toContain(
        "resolved foundry config has ffi enabled — refusing to run",
      );
    } finally {
      await rm(fixtureCopy, { recursive: true, force: true }).catch(() => {});
      await rm(pocDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 300_000);

  it("decoy same-name contract cannot confirm: only test/RextorPoc.t.sol runs", async () => {
    if (!(await dockerUp()) || process.env.REXTOR_SKIP_CONTRACT_TESTS === "1") return; // graceful skip (see ci.yml contract job)
    const fixtureCopy = await makeFixtureCopy("rextor-sim-decoy-");
    await writeFile(join(fixtureCopy, "test", "ZZZ.t.sol"), DECOY_POC, "utf8");
    const anvil = await startAnvilContainer();
    try {
      // The real PoC deliberately FAILS while the decoy's same-named test
      // passes: only --match-path test/RextorPoc.t.sol keeps the decoy out of
      // the result map, so testRextorPoc_0 must read false (pre-fix, the
      // bare-name map was last-write-wins and the decoy read "confirmed").
      const out = await runSimContainer(fixtureCopy, FAILING_POC, `http://${anvil.ip}:8545`);
      expect(out.results["testRextorPoc_0"]).toBe(false);
    } finally {
      await execFileP("docker", ["stop", "-t", "2", anvil.name]).catch(() => {});
      await rm(fixtureCopy, { recursive: true, force: true }).catch(() => {});
    }
  }, 300_000);
});
