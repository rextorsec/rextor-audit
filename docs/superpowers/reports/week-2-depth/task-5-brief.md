### Task 5: SPEC-3 sim harness — container runner, FFI adversarial test, anvil E2E

**Files:**
- Create: `packages/agent/analyzer/sim.sh`
- Modify: `packages/agent/analyzer/Dockerfile` (bake sim.sh)
- Modify: `packages/agent/src/sim.ts` (real `runSimContainer`)
- Create: `packages/agent/test/sim.contract.test.ts`

**Interfaces:**
- Consumes: `SimOutcomeMap`, `runSimStage` (T4); analyzer image `rextor/analyzer`; `fixtures/vault`.
- Produces: `export async function runSimContainer(repoDir: string, testSource: string, forkUrl: string): Promise<SimOutcomeMap>` — real docker harness (block pinned via `cast block-number` when `REXTOR_FORK_BLOCK` unset; `FOUNDRY_FFI=false`; repo `:ro`; overlay `/poc`; 240 s wall clock).

- [ ] **Step 1: Write the failing tests** (docker-gated; skip gracefully per SPEC-1 invariant 4; E2E additionally gated on `REXTOR_SIM_E2E=1`)

`packages/agent/test/sim.contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { runSimContainer } from "../src/sim";

const execFileP = promisify(execFile);

const dockerUp = async (): Promise<boolean> => {
  try { await execFileP("docker", ["info"], { timeout: 20_000 }); return true; }
  catch { return false; }
};
const maybeIt = process.env.REXTOR_SIM_E2E === "1" ? it : it.skip;

describe("runSimContainer (docker-gated)", () => {
  it("runs a passing PoC against a local anvil fork → confirmed", async () => {
    if (!(await dockerUp())) return; // graceful skip
    // 1. tmp dir with the vault fixture copied + pre-written PoC (non-LLM)
    const poc = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "src/Vault.sol";
contract RextorPocTest is Test {
  function testRextorPoc_0() public {
    Vault v = new Vault();
    address attacker = makeAddr("attacker");
    vm.deal(attacker, 1 ether);
    vm.prank(attacker);
    (bool ok,) = address(v).call{value: 1 ether}("");
    assertTrue(ok, "deposit failed");
    // reentrancy drain modeled on fixtures/vault/test/Vault.t.sol:
    // ... (implementer: mirror the proven exploit from Vault.t.sol exactly —
    // a ReentrantAttacker contract whose receive() re-enters withdraw)
    assertTrue(address(attacker).balance > 1 ether, "drain failed");
  }
}
`;
    // 2. single docker run: start anvil inside the container, then sim.sh with
    //    FORK_URL=http://127.0.0.1:8545 pointing at it.
    const out = await runSimContainerAnvil(join(__dirname, "../../fixtures/vault"), poc);
    expect(out.block).toBeGreaterThan(0);
    expect(out.results["testRextorPoc_0"]).toBe(true);
  }, 300_000);

  maybeIt("adversarial: PR foundry.toml ffi=true + vm.ffi PoC → ffi must stay denied", async () => {
    if (!(await dockerUp())) return;
    // fixture copy with ffi = true appended to foundry.toml, PoC calling vm.ffi
    // expect results["testRextorPoc_0"] === false and stderr mentions ffi
  }, 300_000);
});

/** Runs the E2E: docker run --entrypoint sh rextor/analyzer -c 'anvil & sim.sh'. */
async function runSimContainerAnvil(repoDir: string, pocSource: string) {
  // Implement with the same docker invocation as runSimContainer, but the
  // container command starts `anvil --port 8545 --silent &` first and exports
  // FORK_URL=http://127.0.0.1:8545 before invoking /usr/local/bin/sim.sh.
  // Returns the parsed SimOutcomeMap.
  void repoDir; void pocSource;
  throw new Error("implemented in Step 3");
}
```

(The implementer completes the attacker contract by mirroring `fixtures/vault/test/Vault.t.sol` — the proving exploit — and finishes `runSimContainerAnvil`. The two assertions in the first test are the contract.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run test/sim.contract.test.ts`
Expected: FAIL — `runSimContainer` not exported.

- [ ] **Step 3: Implement**

`packages/agent/analyzer/sim.sh` (baked at `/usr/local/bin/sim.sh`, `chmod +x`):

```sh
#!/bin/sh
# SPEC-3 §2 — fork-sim harness. Runs INSIDE the analyzer container.
# Mounts: /repo (target repo, read-only), /poc (writable overlay holding
# RextorPoc.t.sol). Env: FORK_URL (required), FORK_BLOCK (optional pin).
set -eu
: "${FORK_URL:?FORK_URL is required}"
BLOCK="${FORK_BLOCK:-$(cast block-number --rpc-url "$FORK_URL")}"
mkdir -p /poc/simroot/test
# Mirror the repo into the writable sim root via symlinks (skip build dirs).
for d in /repo/* /repo/.[!.]*; do
  [ -e "$d" ] || continue
  base="$(basename "$d")"
  case "$base" in out|cache|.git) continue ;; esac
  ln -sfn "$d" "/poc/simroot/$base"
done
cp /poc/RextorPoc.t.sol /poc/simroot/test/RextorPoc.t.sol
cd /poc/simroot
# FFI denied — env overrides any ffi=true in the PR-controlled foundry.toml.
export FOUNDRY_FFI=false
status=0
timeout -k 5s 220s forge test --match-contract RextorPocTest \
  --fork-url "$FORK_URL" --fork-block "$BLOCK" --json \
  > /poc/result.json 2> /poc/stderr.txt || status=$?
echo "$status" > /poc/exit.txt
echo "$BLOCK" > /poc/block.txt
```

Dockerfile: `COPY sim.sh /usr/local/bin/sim.sh && chmod +x /usr/local/bin/sim.sh` (same layer family as run.sh; keep image slim). Rebuild: `docker build -t rextor/analyzer packages/agent/analyzer`.

`sim.ts` — the real harness:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);
const SIM_TIMEOUT_MS = 240_000;

export async function runSimContainer(repoDir: string, testSource: string, forkUrl: string): Promise<SimOutcomeMap> {
  const pocDir = await mkdtemp(join(tmpdir(), "rextor-sim-"));
  try {
    await writeFile(join(pocDir, "RextorPoc.t.sol"), testSource, "utf8");
    await execFileP("docker", [
      "run", "--rm",
      "--network", "bridge", // the ONLY network-enabled container (SPEC-3 §2)
      "-v", `${repoDir}:/repo:ro`,
      "-v", `${pocDir}:/poc`,
      "-e", `FORK_URL=${forkUrl}`,
      ...(process.env.REXTOR_FORK_BLOCK ? ["-e", `FORK_BLOCK=${process.env.REXTOR_FORK_BLOCK}`] : []),
      "-e", "FOUNDRY_FFI=false",
      "--entrypoint", "/usr/local/bin/sim.sh",
      "rextor/analyzer",
    ], { timeout: SIM_TIMEOUT_MS, killSignal: "SIGKILL" });
    const block = parseInt(await readFile(join(pocDir, "block.txt"), "utf8").then((s) => s.trim()), 10);
    const raw = await readFile(join(pocDir, "result.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      success?: boolean;
      test_results?: Array<{ name?: string; success?: boolean }> | Record<string, { success?: boolean }>;
    };
    const results: Record<string, boolean> = {};
    if (Array.isArray(parsed.test_results)) {
      for (const t of parsed.test_results) {
        if (typeof t.name === "string") results[t.name.replace(/^.*::/, "")] = t.success === true;
      }
    } else if (parsed.test_results) {
      for (const [name, t] of Object.entries(parsed.test_results)) results[name.replace(/^.*::/, "")] = t.success === true;
    }
    return { block: Number.isFinite(block) ? block : 0, results };
  } finally {
    await rm(pocDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

IMPORTANT: verify the actual `forge test --json` output shape of local forge 1.5.1 (`cd fixtures/vault && forge test --json`) and adapt the parsing to what it really emits (`test_results` name format is typically `test/RextorPoc.t.sol:RextorPocTest:testRextorPoc_0(...)` — normalize to the bare test name via the `::` split). Pin the normalized shape in the unit-testable parser by exporting `parseForgeJson(raw: string): Record<string, boolean>` and unit-testing it with a captured real fixture output offline (no docker needed) — add that pure test to `sim.test.ts` with the captured JSON literal.

`github.ts`: wire `runSim: runSimContainer,` into default deps.

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker build -t rextor/analyzer packages/agent/analyzer && cd packages/agent && pnpm vitest run && pnpm typecheck && cd ../.. && pnpm test:run`
Expected: docker-gated tests run (daemon up via colima) and PASS; E2E passes with `REXTOR_SIM_E2E=1 pnpm vitest run test/sim.contract.test.ts`; offline suite all green.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/analyzer/sim.sh packages/agent/analyzer/Dockerfile packages/agent/src/sim.ts packages/agent/src/github.ts packages/agent/test/sim.contract.test.ts packages/agent/test/sim.test.ts
git commit -m "feat: SPEC-3 sim harness — containerized forge fork run, FFI-denied, anvil E2E"
```

---

